// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRestorationEscrow} from "./IRestorationEscrow.sol";

interface IImpactCertificate {
    function mintIfNeeded(address funder, uint256 plotId) external returns (uint256 tokenId);
}

/// @title RestorationEscrow
/// @notice Pay-for-results escrow for post-wildfire recovery. Funders lock a dollar stablecoin per plot (FLZ in the demo). A committee of oracle
///         signers commits each evidence set as a Merkle root (EIP-712, k-of-n signatures). Anyone can then submit a
///         milestone report with a Merkle proof; after a challenge window anyone can execute it. Payouts are graded:
///         the steward receives the earned fraction of a tranche and the shortfall is refunded at once.
/// @dev Trust model:
///      - No single key decides a payout: scores must be in a dataset signed by `oracleThreshold` distinct oracles.
///      - DEFAULT_ADMIN_ROLE is meant to be held by a TimelockController, so role and config changes are delayed and
///        public. Config values are bounded.
///      - GUARDIAN_ROLE can only (a) resolve a disturbance before its pause expires and (b) rule on open challenges.
///      - PLOT_MANAGER_ROLE opens plots. Both roles are meant for the public forest authority (in Türkiye the General
///        Directorate of Forestry, OGM), which owns the land and approves the steward and the restoration method; the
///        guardian role is shared with an independent reviewer. In the demo a test account holds them.
///      - Unearned funds of non-refund funders go to an immutable replanting pool that can only reinvest in plots.
///      Tranches are cumulative (`totalFunded * settledBps / 10000` settled after each milestone), so a late deposit
///      catches up on earlier milestones at the next settlement. Refunds use a per-unit accumulator plus a per-
///      settlement catch-up rate for units deposited since the previous settlement, so late deposits never share in
///      earlier refunds and their catch-up shortfall is refunded to them, not to earlier funders.
contract RestorationEscrow is IRestorationEscrow, AccessControlEnumerable, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant PLOT_MANAGER_ROLE = keccak256("PLOT_MANAGER_ROLE");
    bytes32 public constant DATASET_TYPEHASH = keccak256("DatasetCommit(bytes32 root,string cid,uint256 nonce)");

    uint8 public constant KIND_MILESTONE = 0;
    uint8 public constant KIND_DISTURBANCE = 1;
    uint16 public constant BPS = 10_000;
    uint16 public constant MAX_FEE_BPS = 500;
    uint64 public constant MAX_CHALLENGE_WINDOW = 14 days;
    uint64 public constant MIN_MAX_PAUSE = 1 minutes;
    uint64 public constant MAX_MAX_PAUSE = 90 days;
    uint256 private constant ACC = 1e18;

    IERC20 public immutable token;
    address public immutable replantingPool;
    IImpactCertificate public certificate;

    uint64 public challengeWindow;
    uint64 public maxPause;
    uint16 public verifierFeeBps;
    uint8 public oracleThreshold;
    address public feeRecipient;
    uint256 public challengeBond;

    Plot[] private _plots;
    mapping(uint256 => mapping(uint256 => Report)) private _reports;
    mapping(uint256 => mapping(address => Position)) private _positions;
    mapping(uint256 => address[]) private _funders;
    mapping(bytes32 => Dataset) private _datasets;
    bytes32[] public datasetRoots;
    mapping(bytes32 => bool) private _disturbanceUsed; // disturbance leaf => already acted on
    mapping(bytes32 => bool) private _reportRejected; // milestone leaf whose report a guardian struck down

    /// @dev Refundable units deposited since a plot's last settlement catch up from 0 bps at the next one, so they
    ///      get an extra refund per unit on top of the accumulator, recorded per settlement (epoch).
    struct Fresh {
        uint32 epoch;
        uint256 amount;
    }

    mapping(uint256 => uint32) private _epoch; // settlements so far, per plot
    mapping(uint256 => uint256) private _freshRefundable; // refundable units deposited since the last settlement
    mapping(uint256 => mapping(uint256 => uint256)) private _catchUpPerUnit; // plotId => epoch => extra refund (ACC)
    mapping(uint256 => mapping(address => Fresh)) private _fresh;
    mapping(uint256 => mapping(address => uint256)) private _catchUpCredit; // catch-up refunds of older epochs
    mapping(uint256 => uint256) private _refundPromised; // all refunds accrued to funders of a plot (ACC)

    event PlotCreated(uint256 indexed plotId, address indexed steward, PlanType planType, string name, string metadataURI);
    event Funded(uint256 indexed plotId, address indexed funder, uint256 amount, bool refundOnFail, uint256 certificateId);
    event DatasetCommitted(bytes32 indexed root, uint32 index, string cid, address[] signers);
    event MilestoneReported(uint256 indexed plotId, uint8 indexed idx, int32 scoreBps, bytes32 evidenceHash, bytes32 datasetRoot);
    event ReportChallenged(uint256 indexed plotId, uint8 indexed idx, address indexed challenger, uint256 bond);
    event ChallengeResolved(uint256 indexed plotId, uint8 indexed idx, bool upheld);
    event MilestoneExecuted(
        uint256 indexed plotId, uint8 indexed idx, int32 scoreBps, uint16 fractionBps, uint256 toSteward, uint256 refunded, uint256 fee
    );
    event RefundsReleased(uint256 indexed plotId, uint256 toFunders, uint256 toReplantingPool);
    event PlotPaused(uint256 indexed plotId, bytes32 evidenceHash);
    event PlotResumed(uint256 indexed plotId);
    event PlotFailed(uint256 indexed plotId, uint256 remaining, string reason);
    event PlotCompleted(uint256 indexed plotId);
    event Refunded(uint256 indexed plotId, address indexed funder, uint256 amount);
    event ConfigUpdated(uint64 challengeWindow, uint64 maxPause, uint16 verifierFeeBps, uint8 oracleThreshold, address feeRecipient, uint256 challengeBond);

    error UnknownPlot();
    error InvalidMilestones();
    error InvalidAmount();
    error InvalidConfig();
    error NotActive();
    error NotPaused();
    error WrongMilestone();
    error NoReport();
    error AlreadyExecuted();
    error ChallengeWindowOpen();
    error ChallengeWindowClosed();
    error Challenged();
    error NotChallenged();
    error RefundChoiceMismatch();
    error NothingToClaim();
    error CertificateAlreadySet();
    error PauseNotExpired();
    error PauseExpired();
    error NotOverdue();
    error UnknownDataset();
    error InvalidProof();
    error BadSignatures();
    error ZeroAddress();

    struct Config {
        uint64 challengeWindow;
        uint64 maxPause;
        uint16 verifierFeeBps;
        uint8 oracleThreshold;
        address feeRecipient;
        uint256 challengeBond;
    }

    constructor(IERC20 token_, address admin, address replantingPool_, Config memory config)
        EIP712("ReGrow RestorationEscrow", "3")
    {
        if (address(token_) == address(0) || admin == address(0) || replantingPool_ == address(0)) revert ZeroAddress();
        token = token_;
        replantingPool = replantingPool_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _applyConfig(config, false);
    }

    modifier plotExists(uint256 plotId) {
        if (plotId >= _plots.length) revert UnknownPlot();
        _;
    }

    // ---------------------------------------------------------------- admin (timelocked)

    function setCertificate(IImpactCertificate certificate_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(certificate) != address(0)) revert CertificateAlreadySet();
        certificate = certificate_;
    }

    /// @notice Change bounded parameters. DEFAULT_ADMIN_ROLE is held by a TimelockController, so this is delayed.
    function setConfig(Config calldata config) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _applyConfig(config, true);
    }

    // ---------------------------------------------------------------- plot manager

    function createPlot(
        address steward,
        PlanType planType,
        Milestone[] calldata milestones,
        string calldata name,
        string calldata metadataURI
    ) external onlyRole(PLOT_MANAGER_ROLE) returns (uint256 plotId) {
        if (steward == address(0) || milestones.length == 0 || milestones.length > type(uint8).max) {
            revert InvalidMilestones();
        }
        uint256 sum;
        for (uint256 i; i < milestones.length; ++i) {
            if (milestones[i].failBelowBps > BPS) revert InvalidMilestones();
            sum += milestones[i].bps;
        }
        if (sum != BPS) revert InvalidMilestones();

        plotId = _plots.length;
        Plot storage p = _plots.push();
        p.steward = steward;
        p.planType = planType;
        for (uint256 i; i < milestones.length; ++i) {
            p.milestones.push(milestones[i]);
        }
        p.name = name;
        p.metadataURI = metadataURI;
        emit PlotCreated(plotId, steward, planType, name, metadataURI);
    }

    // ---------------------------------------------------------------- oracle committee (anyone relays)

    /// @notice Commit an evidence set: Merkle root over all report leaves, signed by `oracleThreshold` oracles.
    /// @param signatures EIP-712 signatures over DatasetCommit(root, cid, nonce), ordered by ascending signer address.
    function commitDataset(bytes32 root, string calldata cid, bytes[] calldata signatures) external {
        if (_datasets[root].committedAt != 0) return; // idempotent
        uint256 nonce = datasetRoots.length;
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(DATASET_TYPEHASH, root, keccak256(bytes(cid)), nonce)));
        address[] memory signers = _checkSignatures(digest, signatures);
        _datasets[root] = Dataset({committedAt: uint64(block.timestamp), index: uint32(nonce), cid: cid});
        datasetRoots.push(root);
        emit DatasetCommitted(root, uint32(nonce), cid, signers);
    }

    /// @notice Submit the next milestone's score, proven to be part of a committed dataset. Callable by anyone.
    function submitReport(uint256 plotId, uint8 idx, int32 scoreBps, bytes32 evidenceHash, bytes32 root, bytes32[] calldata proof)
        external
        plotExists(plotId)
    {
        Plot storage p = _plots[plotId];
        if (p.status != Status.Active) revert NotActive();
        if (idx != p.nextMilestone) revert WrongMilestone();
        bytes32 l = leaf(KIND_MILESTONE, plotId, idx, scoreBps, evidenceHash);
        _verify(root, proof, l);
        if (_reportRejected[l]) revert Challenged(); // an upheld challenge needs a corrected score, not a replay
        Report storage r = _reports[plotId][idx];
        if (r.executed) revert AlreadyExecuted();
        if (r.challenged) revert Challenged();
        // a pending report can only be replaced by a newer dataset, so re-submitting cannot restart its window forever
        if (r.exists && _datasets[root].index <= _datasets[r.datasetRoot].index) revert ChallengeWindowOpen();
        _reports[plotId][idx] = Report({
            exists: true,
            executed: false,
            challenged: false,
            scoreBps: scoreBps,
            fractionBps: 0,
            reportedAt: uint64(block.timestamp),
            challenger: address(0),
            evidenceHash: evidenceHash,
            datasetRoot: root
        });
        emit MilestoneReported(plotId, idx, scoreBps, evidenceHash, root);
    }

    /// @notice Pause payouts after a committed disturbance finding (clearing, construction, re-burn). Anyone relays.
    function submitDisturbance(uint256 plotId, bytes32 evidenceHash, bytes32 root, bytes32[] calldata proof)
        external
        plotExists(plotId)
    {
        Plot storage p = _plots[plotId];
        if (p.status != Status.Active) revert NotActive();
        bytes32 l = leaf(KIND_DISTURBANCE, plotId, 0, 0, evidenceHash);
        _verify(root, proof, l);
        if (_disturbanceUsed[l]) revert AlreadyExecuted(); // a resolved finding cannot pause the plot again
        _disturbanceUsed[l] = true;
        p.status = Status.Paused;
        p.pausedAt = uint64(block.timestamp);
        emit PlotPaused(plotId, evidenceHash);
    }

    // ---------------------------------------------------------------- disputes

    /// @notice Dispute a pending report during its challenge window by posting `challengeBond` tokens.
    function challenge(uint256 plotId, uint8 idx) external nonReentrant plotExists(plotId) {
        Report storage r = _reports[plotId][idx];
        if (!r.exists) revert NoReport();
        if (r.executed) revert AlreadyExecuted();
        if (r.challenged) revert Challenged();
        if (block.timestamp >= r.reportedAt + challengeWindow) revert ChallengeWindowClosed();
        r.challenged = true;
        r.challenger = msg.sender;
        token.safeTransferFrom(msg.sender, address(this), challengeBond);
        emit ReportChallenged(plotId, idx, msg.sender, challengeBond);
    }

    /// @notice Guardian ruling. Upheld: report removed, bond returned. Rejected: report stands, bond to replanting.
    function resolveChallenge(uint256 plotId, uint8 idx, bool upheld) external nonReentrant onlyRole(GUARDIAN_ROLE) plotExists(plotId) {
        Report storage r = _reports[plotId][idx];
        if (!r.challenged) revert NotChallenged();
        address challenger = r.challenger;
        if (upheld) {
            _reportRejected[leaf(KIND_MILESTONE, plotId, idx, r.scoreBps, r.evidenceHash)] = true;
            delete _reports[plotId][idx];
            token.safeTransfer(challenger, challengeBond);
        } else {
            r.challenged = false;
            r.challenger = address(0);
            r.reportedAt = uint64(block.timestamp) - challengeWindow; // executable now
            token.safeTransfer(replantingPool, challengeBond);
        }
        emit ChallengeResolved(plotId, idx, upheld);
    }

    // ---------------------------------------------------------------- guardian

    /// @notice Close a disturbance review before the pause expires: resume the plot, or fail it and refund.
    function resolveDisturbance(uint256 plotId, bool resume) external onlyRole(GUARDIAN_ROLE) plotExists(plotId) {
        Plot storage p = _plots[plotId];
        if (p.status != Status.Paused) revert NotPaused();
        if (resume) {
            if (block.timestamp >= p.pausedAt + maxPause) revert PauseExpired();
            // reports cannot be submitted while paused, so the remaining deadlines move by the length of the pause
            uint64 paused = uint64(block.timestamp) - p.pausedAt;
            for (uint256 i = p.nextMilestone; i < p.milestones.length; ++i) {
                if (p.milestones[i].dueAt != 0) p.milestones[i].dueAt += paused;
            }
            p.status = Status.Active;
            p.pausedAt = 0;
            emit PlotResumed(plotId);
        } else {
            _failRemaining(plotId, p, "disturbance confirmed");
        }
    }

    // --------------------------------------------------------------- funders

    /// @notice Lock `amount` tokens for a plot. Mints the funder's Impact Certificate on first deposit.
    /// @param refundOnFail true: shortfalls and failures are refunded to you; false: they go to the replanting pool.
    function fund(uint256 plotId, uint256 amount, bool refundOnFail) external nonReentrant plotExists(plotId) {
        if (amount == 0) revert InvalidAmount();
        Plot storage p = _plots[plotId];
        if (p.status != Status.Active) revert NotActive();

        Position storage pos = _positions[plotId][msg.sender];
        if (pos.amount == 0) {
            _funders[plotId].push(msg.sender);
            pos.refundOnFail = refundOnFail;
        } else if (pos.refundOnFail != refundOnFail) {
            revert RefundChoiceMismatch();
        }
        pos.amount += amount;
        p.totalFunded += amount;
        if (refundOnFail) {
            // earlier refunds are not theirs; round up so rounding never lets claims exceed what was refunded
            pos.refundDebt += Math.mulDiv(amount, p.accRefundPerUnit, ACC, Math.Rounding.Ceil);
            p.refundableFunded += amount;
            Fresh storage f = _fresh[plotId][msg.sender];
            uint32 epoch = _epoch[plotId];
            if (f.amount > 0 && f.epoch != epoch) {
                _catchUpCredit[plotId][msg.sender] += f.amount * _catchUpPerUnit[plotId][f.epoch] / ACC;
                f.amount = 0;
            }
            f.epoch = epoch;
            f.amount += amount;
            _freshRefundable[plotId] += amount;
        }

        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 certId = address(certificate) == address(0) ? 0 : certificate.mintIfNeeded(msg.sender, plotId);
        emit Funded(plotId, msg.sender, amount, refundOnFail, certId);
    }

    /// @notice Claim refunds accrued so far (graded shortfalls, failure, expired pause). Callable any time.
    function claimRefund(uint256 plotId) external nonReentrant plotExists(plotId) {
        Position storage pos = _positions[plotId][msg.sender];
        uint256 owed = _owed(plotId, msg.sender);
        if (owed == 0) revert NothingToClaim();
        pos.refundDebt += owed;
        pos.refundClaimed += owed;
        token.safeTransfer(msg.sender, owed);
        emit Refunded(plotId, msg.sender, owed);
    }

    // ---------------------------------------------------------------- anyone

    /// @notice Apply a reported milestone once its challenge window has passed: pay the earned share, refund the rest.
    function execute(uint256 plotId, uint8 idx) external nonReentrant plotExists(plotId) {
        Plot storage p = _plots[plotId];
        Report storage r = _reports[plotId][idx];
        if (!r.exists) revert NoReport();
        if (r.executed) revert AlreadyExecuted();
        if (r.challenged) revert Challenged();
        if (p.status != Status.Active) revert NotActive();
        if (idx != p.nextMilestone) revert WrongMilestone();
        if (block.timestamp < r.reportedAt + challengeWindow) revert ChallengeWindowOpen();

        Milestone memory m = p.milestones[idx];
        uint16 fraction = _fraction(r.scoreBps, m.targetBps);
        bool last = idx == p.milestones.length - 1;
        uint256 tranche = last ? p.totalFunded - p.settled : p.totalFunded * (p.settledBps + m.bps) / BPS - p.settled;
        uint256 pay = tranche * fraction / BPS;
        uint256 shortfall = tranche - pay;
        uint256 fee = pay * verifierFeeBps / BPS;

        uint16 fromBps = p.settledBps;
        r.executed = true;
        r.fractionBps = fraction;
        p.settled += tranche;
        p.settledBps += m.bps;
        p.released += pay;
        p.nextMilestone = idx + 1;

        bool fails = m.failBelowBps > 0 && fraction < m.failBelowBps;
        if (!fails && last) p.status = Status.Completed;

        if (fee > 0) token.safeTransfer(feeRecipient, fee);
        if (pay - fee > 0) token.safeTransfer(p.steward, pay - fee);
        emit MilestoneExecuted(plotId, idx, r.scoreBps, fraction, pay - fee, shortfall, fee);
        _releaseRefunds(plotId, p, shortfall, fromBps, BPS - fraction);

        if (fails) _failRemaining(plotId, p, "below minimum recovery");
        else if (last) emit PlotCompleted(plotId);
    }

    /// @notice If a disturbance pause is not resolved within `maxPause`, anyone can fail the plot and open refunds.
    function expirePause(uint256 plotId) external nonReentrant plotExists(plotId) {
        Plot storage p = _plots[plotId];
        if (p.status != Status.Paused) revert NotPaused();
        if (block.timestamp < p.pausedAt + maxPause) revert PauseNotExpired();
        _failRemaining(plotId, p, "pause expired");
    }

    /// @notice If the next milestone was not reported by its deadline, anyone can fail the plot and open refunds.
    function claimOverdue(uint256 plotId) external nonReentrant plotExists(plotId) {
        Plot storage p = _plots[plotId];
        if (p.status != Status.Active) revert NotActive();
        uint64 due = p.milestones[p.nextMilestone].dueAt;
        if (due == 0 || block.timestamp <= due || _reports[plotId][p.nextMilestone].exists) revert NotOverdue();
        _failRemaining(plotId, p, "milestone overdue");
    }

    // ----------------------------------------------------------------- views

    /// @notice Merkle leaf of a committed finding (OpenZeppelin StandardMerkleTree format: double-hashed abi.encode).
    function leaf(uint8 kind, uint256 plotId, uint8 idx, int32 scoreBps, bytes32 evidenceHash) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(kind, plotId, idx, scoreBps, evidenceHash))));
    }

    function datasetDigest(bytes32 root, string calldata cid, uint256 nonce) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(DATASET_TYPEHASH, root, keccak256(bytes(cid)), nonce)));
    }

    function getDataset(bytes32 root) external view returns (Dataset memory) {
        return _datasets[root];
    }

    function datasetCount() external view returns (uint256) {
        return datasetRoots.length;
    }

    function plotCount() external view returns (uint256) {
        return _plots.length;
    }

    function getPlot(uint256 plotId) external view plotExists(plotId) returns (Plot memory) {
        return _plots[plotId];
    }

    function getReports(uint256 plotId) external view plotExists(plotId) returns (Report[] memory reports) {
        uint256 n = _plots[plotId].milestones.length;
        reports = new Report[](n);
        for (uint256 i; i < n; ++i) {
            reports[i] = _reports[plotId][i];
        }
    }

    function fundersOf(uint256 plotId) external view plotExists(plotId) returns (address[] memory) {
        return _funders[plotId];
    }

    function positionOf(uint256 plotId, address funder) external view plotExists(plotId) returns (Position memory) {
        return _positions[plotId][funder];
    }

    /// @notice Refund currently claimable by `funder` for a plot.
    function claimable(uint256 plotId, address funder) external view plotExists(plotId) returns (uint256) {
        return _owed(plotId, funder);
    }

    // -------------------------------------------------------------- internal

    function _applyConfig(Config memory c, bool checkThreshold) private {
        if (
            c.challengeWindow > MAX_CHALLENGE_WINDOW || c.maxPause < MIN_MAX_PAUSE || c.maxPause > MAX_MAX_PAUSE
                || c.verifierFeeBps > MAX_FEE_BPS || c.oracleThreshold == 0 || c.feeRecipient == address(0)
                || (checkThreshold && c.oracleThreshold > getRoleMemberCount(ORACLE_ROLE))
        ) revert InvalidConfig();
        challengeWindow = c.challengeWindow;
        maxPause = c.maxPause;
        verifierFeeBps = c.verifierFeeBps;
        oracleThreshold = c.oracleThreshold;
        feeRecipient = c.feeRecipient;
        challengeBond = c.challengeBond;
        emit ConfigUpdated(c.challengeWindow, c.maxPause, c.verifierFeeBps, c.oracleThreshold, c.feeRecipient, c.challengeBond);
    }

    /// @dev Requires `oracleThreshold` valid signatures from distinct oracles, ordered by ascending address.
    function _checkSignatures(bytes32 digest, bytes[] calldata signatures) private view returns (address[] memory signers) {
        if (signatures.length < oracleThreshold) revert BadSignatures();
        signers = new address[](signatures.length);
        address last;
        for (uint256 i; i < signatures.length; ++i) {
            address s = ECDSA.recover(digest, signatures[i]);
            if (s <= last || !hasRole(ORACLE_ROLE, s)) revert BadSignatures();
            signers[i] = s;
            last = s;
        }
    }

    function _verify(bytes32 root, bytes32[] calldata proof, bytes32 leaf_) private view {
        if (_datasets[root].committedAt == 0) revert UnknownDataset();
        if (!MerkleProof.verifyCalldata(proof, root, leaf_)) revert InvalidProof();
    }

    function _fraction(int32 scoreBps, uint16 targetBps) private pure returns (uint16) {
        if (scoreBps <= 0) return 0;
        if (targetBps == 0) return BPS; // binary check: any positive score passes
        uint256 f = uint256(uint32(scoreBps)) * BPS / targetBps;
        return f >= BPS ? BPS : uint16(f);
    }

    function _owed(uint256 plotId, address funder) private view returns (uint256) {
        Position storage pos = _positions[plotId][funder];
        if (!pos.refundOnFail) return 0;
        uint256 accrued = pos.amount * _plots[plotId].accRefundPerUnit / ACC + _catchUpCredit[plotId][funder];
        Fresh storage f = _fresh[plotId][funder];
        if (f.amount > 0 && f.epoch < _epoch[plotId]) accrued += f.amount * _catchUpPerUnit[plotId][f.epoch] / ACC;
        return accrued > pos.refundDebt ? accrued - pos.refundDebt : 0;
    }

    /// @dev Settlement from `fromBps` to `p.settledBps` with `amount` unearned (`unearnedBps` of the tranche). Units
    ///      funded before the last settlement settle the difference, units funded since then catch up from zero.
    ///      Refund-choosing funders accrue exactly their units' share (claim any time); the rest goes to the pool.
    function _releaseRefunds(uint256 plotId, Plot storage p, uint256 amount, uint256 fromBps, uint256 unearnedBps)
        private
    {
        uint32 epoch = _epoch[plotId]++;
        uint256 fresh = _freshRefundable[plotId];
        _freshRefundable[plotId] = 0;
        if (amount == 0) return;
        uint256 inc = (p.settledBps - fromBps) * unearnedBps * ACC / (uint256(BPS) * BPS); // per unit
        uint256 catchUp = fromBps * unearnedBps * ACC / (uint256(BPS) * BPS); // extra per fresh unit
        uint256 seasoned = p.refundableFunded - fresh;
        uint256 raw = seasoned * inc + fresh * (inc + catchUp);
        if (raw > amount * ACC) {
            // the tranche was rounded down, so scale the per-unit rates to what is actually there
            inc = Math.mulDiv(inc, amount * ACC, raw);
            catchUp = Math.mulDiv(catchUp, amount * ACC, raw);
            raw = seasoned * inc + fresh * (inc + catchUp);
        }
        // floor the cumulative total, not each settlement: claims floor once over the cumulative rates
        uint256 promised = _refundPromised[plotId];
        _refundPromised[plotId] = promised + raw;
        uint256 toFunders = (promised + raw) / ACC - promised / ACC;
        uint256 toPool = amount - toFunders;
        p.accRefundPerUnit += inc;
        _catchUpPerUnit[plotId][epoch] = catchUp;
        p.refunded += amount;
        if (toPool > 0) token.safeTransfer(replantingPool, toPool);
        emit RefundsReleased(plotId, toFunders, toPool);
    }

    function _failRemaining(uint256 plotId, Plot storage p, string memory reason) private {
        uint256 remaining = p.totalFunded - p.settled;
        uint16 fromBps = p.settledBps;
        p.settled = p.totalFunded;
        p.settledBps = BPS;
        p.status = Status.Failed;
        emit PlotFailed(plotId, remaining, reason);
        _releaseRefunds(plotId, p, remaining, fromBps, BPS);
    }
}
