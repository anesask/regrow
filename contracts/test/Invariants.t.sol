// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {Filiz} from "../src/Filiz.sol";
import {RestorationEscrow, IImpactCertificate} from "../src/RestorationEscrow.sol";
import {IRestorationEscrow} from "../src/IRestorationEscrow.sol";
import {ImpactCertificate} from "../src/ImpactCertificate.sol";
import {ReplantingPool} from "../src/ReplantingPool.sol";
import {RecoveryRegistry, IEscrowViews} from "../src/RecoveryRegistry.sol";

/// Drives the escrow through random but well-formed sequences: deposits (several funders, both refund choices,
/// dust and large amounts, late deposits), committed reports with any score, challenges, disturbances, expiries,
/// overdue claims, refund claims, and VRU issuance and retirement. Tracks every token flow in ghost variables.
contract EscrowHandler is Test {
    Filiz public usd;
    RestorationEscrow public escrow;
    ReplantingPool public pool;
    RecoveryRegistry public registry;
    ImpactCertificate public cert;

    address public admin = makeAddr("admin");
    address public guardian = makeAddr("guardian");
    address public feeRecipient = makeAddr("fee");
    address public challenger = makeAddr("challenger");
    address[4] public funders;
    uint256[2] internal keys; // two oracles, sorted by address

    uint256 public constant MAX_PLOTS = 8;
    uint64 public constant WINDOW = 1 hours;
    uint64 public constant MAX_PAUSE = 7 days;
    uint256 public constant BOND = 50e6;

    uint256 internal nonce;

    // ghost accounting, per plot
    mapping(uint256 => uint256) public ghostToSteward; // steward + verifier fee
    mapping(uint256 => uint256) public ghostToPool; // refunds of non-refund funders
    mapping(uint256 => uint256) public ghostClaimed;
    mapping(uint256 => mapping(address => uint256)) public ghostDeposited;
    mapping(uint256 => mapping(address => uint256)) public ghostFunderClaimed;
    mapping(uint256 => uint16) public ghostSettledBps;
    mapping(uint256 => bool) public ghostTerminal;
    mapping(uint256 => uint256) public ghostTerminalReleased;
    mapping(uint256 => uint256) public ghostTerminalRefunded;
    mapping(uint256 => uint256) public ghostTerminalFunded;
    mapping(uint256 => uint256) public ghostIssueCount;
    mapping(uint256 => uint256) public ghostIssuedUnits;
    uint256 public ghostBondsHeld;
    bool public ghostSettledBpsDecreased;
    bool public ghostTerminalChanged;
    bool public ghostIssuanceChanged;

    mapping(bytes32 => uint256) public hits; // actions that took effect

    constructor() {
        vm.warp(1_000_000);
        usd = new Filiz();
        pool = new ReplantingPool(usd, admin);
        escrow = new RestorationEscrow(
            usd,
            admin,
            address(pool),
            RestorationEscrow.Config({
                challengeWindow: WINDOW,
                maxPause: MAX_PAUSE,
                verifierFeeBps: 100,
                oracleThreshold: 2,
                feeRecipient: feeRecipient,
                challengeBond: BOND
            })
        );
        cert = new ImpactCertificate(address(escrow), admin, "u/");
        registry = new RecoveryRegistry(IEscrowViews(address(escrow)), admin);

        address[2] memory oracles;
        (oracles[0], keys[0]) = makeAddrAndKey("inv-oracle0");
        (oracles[1], keys[1]) = makeAddrAndKey("inv-oracle1");
        if (oracles[1] < oracles[0]) {
            (oracles[0], oracles[1]) = (oracles[1], oracles[0]);
            (keys[0], keys[1]) = (keys[1], keys[0]);
        }

        vm.startPrank(admin);
        escrow.setCertificate(IImpactCertificate(address(cert)));
        pool.setEscrow(escrow);
        escrow.grantRole(escrow.ORACLE_ROLE(), oracles[0]);
        escrow.grantRole(escrow.ORACLE_ROLE(), oracles[1]);
        escrow.grantRole(escrow.GUARDIAN_ROLE(), guardian);
        escrow.grantRole(escrow.PLOT_MANAGER_ROLE(), admin);
        registry.grantRole(registry.PLOT_MANAGER_ROLE(), admin);
        vm.stopPrank();

        for (uint256 i; i < 4; ++i) {
            funders[i] = makeAddr(string.concat("funder", vm.toString(i)));
            vm.prank(funders[i]);
            usd.approve(address(escrow), type(uint256).max);
        }
        vm.prank(challenger);
        usd.approve(address(escrow), type(uint256).max);

        _createPlot(0);
        _createPlot(1);
    }

    // ------------------------------------------------------------------ helpers

    function stewardOf(uint256 plotId) public pure returns (address) {
        return address(uint160(0x57e0a4d000 + plotId));
    }

    function funder(uint256 i) external view returns (address) {
        return funders[i];
    }

    function _createPlot(uint256 kind) internal {
        uint256 id = escrow.plotCount();
        IRestorationEscrow.Milestone[] memory s;
        if (kind % 3 == 0) {
            s = new IRestorationEscrow.Milestone[](3);
            s[0] = IRestorationEscrow.Milestone(4000, 0, 0, 0);
            s[1] = IRestorationEscrow.Milestone(3000, 3000, 2000, uint64(block.timestamp + 60 days));
            s[2] = IRestorationEscrow.Milestone(3000, 6000, 0, 0);
        } else if (kind % 3 == 1) {
            s = new IRestorationEscrow.Milestone[](3); // odd split for rounding
            s[0] = IRestorationEscrow.Milestone(3333, 0, 0, 0);
            s[1] = IRestorationEscrow.Milestone(3333, 7000, 0, 0);
            s[2] = IRestorationEscrow.Milestone(3334, 9999, 5000, uint64(block.timestamp + 90 days));
        } else {
            s = new IRestorationEscrow.Milestone[](1);
            s[0] = IRestorationEscrow.Milestone(10_000, 5000, 0, uint64(block.timestamp + 40 days));
        }
        vm.startPrank(admin);
        escrow.createPlot(stewardOf(id), IRestorationEscrow.PlanType.ASSISTED, s, "inv", "u");
        registry.setArea(id, uint32(10 + id));
        vm.stopPrank();
    }

    function _plot(uint256 seed) internal view returns (uint256 id, IRestorationEscrow.Plot memory p) {
        id = seed % escrow.plotCount();
        p = escrow.getPlot(id);
    }

    uint8 internal constant PENDING = 0; // report waiting for execution
    uint8 internal constant IN_WINDOW = 1; // report still challengeable
    uint8 internal constant CHALLENGED = 2;
    uint8 internal constant PAUSED = 3;
    uint8 internal constant DUE = 4; // active, next milestone has a deadline and no report
    uint8 internal constant COMPLETED = 5;

    function _eligible(uint256 id, uint8 mode) internal view returns (bool) {
        IRestorationEscrow.Plot memory p = escrow.getPlot(id);
        if (mode == PAUSED) return p.status == IRestorationEscrow.Status.Paused;
        if (mode == COMPLETED) return p.status == IRestorationEscrow.Status.Completed;
        if (p.nextMilestone >= p.milestones.length) return false;
        IRestorationEscrow.Report memory r = escrow.getReports(id)[p.nextMilestone];
        if (mode == CHALLENGED) return r.challenged;
        if (p.status != IRestorationEscrow.Status.Active) return false;
        if (mode == PENDING) return r.exists && !r.challenged;
        if (mode == IN_WINDOW) return r.exists && !r.challenged && block.timestamp < r.reportedAt + WINDOW;
        return p.milestones[p.nextMilestone].dueAt != 0 && !r.exists; // DUE
    }

    /// First plot from `seed` on that is in `mode`, so actions rarely go to waste.
    function _find(uint256 seed, uint8 mode) internal view returns (bool, uint256, IRestorationEscrow.Plot memory p) {
        uint256 n = escrow.plotCount();
        for (uint256 k; k < n; ++k) {
            uint256 id = (seed % n + k) % n;
            if (_eligible(id, mode)) return (true, id, escrow.getPlot(id));
        }
        return (false, 0, p);
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Commit a two-leaf dataset {a, b}; returns its root.
    function _commit(bytes32 a, bytes32 b) internal returns (bytes32 root) {
        root = _hashPair(a, b);
        string memory cid = vm.toString(nonce);
        bytes32 digest = escrow.datasetDigest(root, cid, escrow.datasetCount());
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(keys[0], digest);
        sigs[1] = _sign(keys[1], digest);
        escrow.commitDataset(root, cid, sigs);
    }

    /// Run `fn`-style calls with pool and fee flows measured, then attribute them to `plotId`.
    function _poolAndFee() internal view returns (uint256, uint256) {
        return (usd.balanceOf(address(pool)), usd.balanceOf(feeRecipient));
    }

    function _attribute(uint256 plotId, uint256 poolBefore, uint256 feeBefore, uint256 stewardBefore) internal {
        ghostToPool[plotId] += usd.balanceOf(address(pool)) - poolBefore;
        ghostToSteward[plotId] += usd.balanceOf(feeRecipient) - feeBefore + usd.balanceOf(stewardOf(plotId))
        - stewardBefore;
    }

    function _checkpoint() internal {
        uint256 n = escrow.plotCount();
        for (uint256 i; i < n; ++i) {
            IRestorationEscrow.Plot memory p = escrow.getPlot(i);
            if (p.settledBps < ghostSettledBps[i]) ghostSettledBpsDecreased = true;
            ghostSettledBps[i] = p.settledBps;
            bool terminal =
                p.status == IRestorationEscrow.Status.Failed || p.status == IRestorationEscrow.Status.Completed;
            if (ghostTerminal[i]) {
                if (
                    !terminal || p.released != ghostTerminalReleased[i] || p.refunded != ghostTerminalRefunded[i]
                        || p.totalFunded != ghostTerminalFunded[i]
                ) ghostTerminalChanged = true;
            } else if (terminal) {
                ghostTerminal[i] = true;
                ghostTerminalReleased[i] = p.released;
                ghostTerminalRefunded[i] = p.refunded;
                ghostTerminalFunded[i] = p.totalFunded;
            }
            RecoveryRegistry.Issuance memory iss = registry.issuance(i);
            if (ghostIssueCount[i] > 0 && iss.units != ghostIssuedUnits[i]) ghostIssuanceChanged = true;
        }
    }

    modifier checkpoint() {
        _;
        _checkpoint();
    }

    // ------------------------------------------------------------------ actions

    function createPlot(uint256 kind) external checkpoint {
        if (escrow.plotCount() >= MAX_PLOTS) return;
        _createPlot(kind);
    }

    function fund(uint256 plotSeed, uint256 funderSeed, uint256 amount, bool refundOnFail) external checkpoint {
        (uint256 id, IRestorationEscrow.Plot memory p) = _plot(plotSeed);
        if (p.status != IRestorationEscrow.Status.Active) return;
        address f = funders[funderSeed % 4];
        IRestorationEscrow.Position memory pos = escrow.positionOf(id, f);
        if (pos.amount > 0) refundOnFail = pos.refundOnFail;
        amount = amount % 3 == 0 ? bound(amount, 1, 50) : bound(amount, 1, 5_000e6); // dust and real amounts
        deal(address(usd), f, usd.balanceOf(f) + amount);
        vm.prank(f);
        escrow.fund(id, amount, refundOnFail);
        ghostDeposited[id][f] += amount;
        hits["fund"]++;
    }

    function report(uint256 plotSeed, int32 score) external checkpoint {
        (uint256 id, IRestorationEscrow.Plot memory p) = _plot(plotSeed);
        if (p.status != IRestorationEscrow.Status.Active) return;
        uint8 idx = p.nextMilestone;
        IRestorationEscrow.Report memory r = escrow.getReports(id)[idx];
        if (r.challenged) return;
        score = int32(bound(int256(score), -3000, 15_000));
        bytes32 evidence = keccak256(abi.encode("report", ++nonce));
        bytes32 ms = escrow.leaf(0, id, idx, score, evidence);
        bytes32 other = escrow.leaf(1, id, 0, 0, keccak256(abi.encode("unused", nonce)));
        bytes32 root = _commit(ms, other);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = other;
        escrow.submitReport(id, idx, score, evidence, root, proof);
        hits["report"]++;
    }

    function execute(uint256 plotSeed, uint256 wait) external checkpoint {
        (bool ok, uint256 id, IRestorationEscrow.Plot memory p) = _find(plotSeed, PENDING);
        if (!ok) return;
        uint8 idx = p.nextMilestone;
        IRestorationEscrow.Report memory r = escrow.getReports(id)[idx];
        uint256 opens = r.reportedAt + WINDOW;
        if (wait % 2 == 0 && block.timestamp < opens) vm.warp(opens); // exactly at the boundary
        else vm.warp(block.timestamp + bound(wait, 0, 2 * WINDOW));
        if (block.timestamp < opens) return;
        (uint256 poolBefore, uint256 feeBefore) = _poolAndFee();
        uint256 stewardBefore = usd.balanceOf(stewardOf(id));
        escrow.execute(id, idx);
        _attribute(id, poolBefore, feeBefore, stewardBefore);
        hits["execute"]++;
    }

    function challenge(uint256 plotSeed) external checkpoint {
        (bool ok, uint256 id, IRestorationEscrow.Plot memory p) = _find(plotSeed, IN_WINDOW);
        if (!ok) return;
        uint8 idx = p.nextMilestone;
        deal(address(usd), challenger, usd.balanceOf(challenger) + BOND);
        vm.prank(challenger);
        escrow.challenge(id, idx);
        ghostBondsHeld += BOND;
        hits["challenge"]++;
    }

    function resolveChallenge(uint256 plotSeed, bool upheld) external checkpoint {
        (bool ok, uint256 id, IRestorationEscrow.Plot memory p) = _find(plotSeed, CHALLENGED);
        if (!ok) return;
        uint8 idx = p.nextMilestone;
        vm.prank(guardian);
        escrow.resolveChallenge(id, idx, upheld);
        ghostBondsHeld -= BOND;
    }

    function disturb(uint256 plotSeed) external checkpoint {
        if (plotSeed % 4 != 0) return; // rarer than the rest, or most plots end paused and failed
        (uint256 id, IRestorationEscrow.Plot memory p) = _plot(plotSeed / 4);
        if (p.status != IRestorationEscrow.Status.Active) return;
        bytes32 evidence = keccak256(abi.encode("disturbance", ++nonce));
        bytes32 d = escrow.leaf(1, id, 0, 0, evidence);
        bytes32 other = escrow.leaf(0, id, 200, 0, evidence);
        bytes32 root = _commit(d, other);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = other;
        escrow.submitDisturbance(id, evidence, root, proof);
        hits["disturb"]++;
    }

    function resolveDisturbance(uint256 plotSeed, bool resume, uint256 wait) external checkpoint {
        (bool ok, uint256 id, IRestorationEscrow.Plot memory p) = _find(plotSeed, PAUSED);
        if (!ok) return;
        vm.warp(block.timestamp + bound(wait, 0, MAX_PAUSE));
        if (resume && block.timestamp >= p.pausedAt + MAX_PAUSE) return;
        (uint256 poolBefore, uint256 feeBefore) = _poolAndFee();
        uint256 stewardBefore = usd.balanceOf(stewardOf(id));
        vm.prank(guardian);
        escrow.resolveDisturbance(id, resume);
        _attribute(id, poolBefore, feeBefore, stewardBefore);
    }

    function expirePause(uint256 plotSeed, uint256 wait) external checkpoint {
        (bool ok, uint256 id, IRestorationEscrow.Plot memory p) = _find(plotSeed, PAUSED);
        if (!ok) return;
        uint256 expires = p.pausedAt + MAX_PAUSE;
        if (wait % 2 == 0 && block.timestamp < expires) vm.warp(expires); // exactly at the boundary
        else vm.warp(block.timestamp + bound(wait, 0, 2 days));
        if (block.timestamp < expires) return;
        (uint256 poolBefore, uint256 feeBefore) = _poolAndFee();
        uint256 stewardBefore = usd.balanceOf(stewardOf(id));
        escrow.expirePause(id);
        _attribute(id, poolBefore, feeBefore, stewardBefore);
        hits["expirePause"]++;
    }

    function claimOverdue(uint256 plotSeed, uint256 wait) external checkpoint {
        (bool ok, uint256 id, IRestorationEscrow.Plot memory p) = _find(plotSeed, DUE);
        if (!ok) return;
        uint64 due = p.milestones[p.nextMilestone].dueAt;
        if (wait % 4 == 0 && block.timestamp <= due) vm.warp(due + 1); // rare: it fails the plot
        else vm.warp(block.timestamp + bound(wait, 0, 1 days));
        if (block.timestamp <= due) return;
        (uint256 poolBefore, uint256 feeBefore) = _poolAndFee();
        uint256 stewardBefore = usd.balanceOf(stewardOf(id));
        escrow.claimOverdue(id);
        _attribute(id, poolBefore, feeBefore, stewardBefore);
        hits["claimOverdue"]++;
    }

    function claimRefund(uint256 plotSeed, uint256 funderSeed) external checkpoint {
        uint256 n = escrow.plotCount();
        uint256 id;
        address f;
        uint256 owed;
        for (uint256 k; k < n * 4 && owed == 0; ++k) {
            id = (plotSeed % n + k / 4) % n;
            f = funders[(funderSeed % 4 + k) % 4];
            owed = escrow.claimable(id, f);
        }
        if (owed == 0) return;
        uint256 before = usd.balanceOf(f);
        vm.prank(f);
        escrow.claimRefund(id);
        uint256 got = usd.balanceOf(f) - before;
        assertEq(got, owed, "claim pays exactly claimable");
        ghostClaimed[id] += got;
        ghostFunderClaimed[id][f] += got;
        hits["claimRefund"]++;
    }

    function issue(uint256 plotSeed) external checkpoint {
        (bool ok, uint256 id, IRestorationEscrow.Plot memory p) = _find(plotSeed, COMPLETED);
        if (!ok || plotSeed % 4 == 0) (id, p) = _plot(plotSeed); // sometimes any plot, issued or not
        try registry.issue(id) {
            ghostIssueCount[id]++;
            hits["issue"]++;
            ghostIssuedUnits[id] = registry.issuance(id).units;
            assertEq(uint8(p.status), uint8(IRestorationEscrow.Status.Completed), "issued for an incomplete plot");
        } catch {}
    }

    function retire(uint256 plotSeed, uint256 funderSeed, uint256 amount) external checkpoint {
        uint256 n = escrow.plotCount();
        uint256 id;
        address f;
        uint256 avail;
        for (uint256 k; k < n * 4 && avail == 0; ++k) {
            id = (plotSeed % n + k / 4) % n;
            f = funders[(funderSeed % 4 + k) % 4];
            avail = registry.available(id, f);
        }
        if (avail == 0) return;
        amount = bound(amount, 1, avail + 1); // sometimes one unit too many
        vm.prank(f);
        if (amount > avail) {
            vm.expectRevert(RecoveryRegistry.ExceedsEntitlement.selector);
            registry.retire(id, amount, "b", "p");
        } else {
            registry.retire(id, amount, "b", "p");
            hits["retire"]++;
        }
    }

    function warp(uint256 secs) external checkpoint {
        vm.warp(block.timestamp + bound(secs, 1, 10 days));
    }
}

contract InvariantsTest is Test {
    EscrowHandler handler;
    Filiz usd;
    RestorationEscrow escrow;
    RecoveryRegistry registry;

    function setUp() public {
        handler = new EscrowHandler();
        usd = handler.usd();
        escrow = handler.escrow();
        registry = handler.registry();
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](15);
        selectors[0] = EscrowHandler.createPlot.selector;
        selectors[1] = EscrowHandler.fund.selector;
        selectors[2] = EscrowHandler.fund.selector; // weighted: deposits are common
        selectors[3] = EscrowHandler.report.selector;
        selectors[4] = EscrowHandler.execute.selector;
        selectors[5] = EscrowHandler.execute.selector;
        selectors[6] = EscrowHandler.challenge.selector;
        selectors[7] = EscrowHandler.resolveChallenge.selector;
        selectors[8] = EscrowHandler.disturb.selector;
        selectors[9] = EscrowHandler.resolveDisturbance.selector;
        selectors[10] = EscrowHandler.expirePause.selector;
        selectors[11] = EscrowHandler.claimOverdue.selector;
        selectors[12] = EscrowHandler.claimRefund.selector;
        selectors[13] = EscrowHandler.issue.selector;
        selectors[14] = EscrowHandler.retire.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// (a) Every token in the escrow is accounted for: deposits minus steward payouts, pool transfers and claimed
    /// refunds, plus outstanding challenge bonds. Also ties the ghosts to the contract's own fields.
    function invariant_TokenConservation() public view {
        uint256 expected = handler.ghostBondsHeld();
        uint256 n = escrow.plotCount();
        for (uint256 i; i < n; ++i) {
            IRestorationEscrow.Plot memory p = escrow.getPlot(i);
            expected += p.totalFunded - handler.ghostToSteward(i) - handler.ghostToPool(i) - handler.ghostClaimed(i);
            assertEq(p.released, handler.ghostToSteward(i), "released != paid to steward and fee");
            assertEq(p.settled, p.released + p.refunded, "settled != released + refunded");
            assertLe(handler.ghostToPool(i), p.refunded, "pool got more than refunded");
        }
        assertEq(usd.balanceOf(address(escrow)), expected, "escrow balance drift");
    }

    /// (b) per plot, never more out than in; (c) claimable refunds are covered, per plot and in total;
    /// (d) no funder can get back more than they deposited.
    function invariant_Solvency() public view {
        uint256 n = escrow.plotCount();
        uint256 totalOwed;
        for (uint256 i; i < n; ++i) {
            IRestorationEscrow.Plot memory p = escrow.getPlot(i);
            assertLe(p.settled, p.totalFunded, "settled more than funded");
            assertLe(
                handler.ghostToSteward(i) + handler.ghostToPool(i) + handler.ghostClaimed(i),
                p.totalFunded,
                "paid out more than deposited"
            );
            uint256 owed;
            for (uint256 j; j < 4; ++j) {
                address f = handler.funder(j);
                uint256 c = escrow.claimable(i, f);
                owed += c;
                assertLe(
                    handler.ghostFunderClaimed(i, f) + c,
                    handler.ghostDeposited(i, f),
                    "funder refunded more than deposited"
                );
                assertEq(escrow.positionOf(i, f).amount, handler.ghostDeposited(i, f), "position amount drift");
            }
            // refunds to funders are what was refunded minus what went to the pool
            assertLe(
                owed + handler.ghostClaimed(i), p.refunded - handler.ghostToPool(i), "claims exceed funder refunds"
            );
            totalOwed += owed;
        }
        assertLe(totalOwed + handler.ghostBondsHeld(), usd.balanceOf(address(escrow)), "claimable exceeds balance");
    }

    /// (e) settledBps is bounded and never decreases; (f) a Failed or Completed plot never moves funds again.
    function invariant_Settlement() public view {
        uint256 n = escrow.plotCount();
        for (uint256 i; i < n; ++i) {
            IRestorationEscrow.Plot memory p = escrow.getPlot(i);
            assertLe(p.settledBps, 10_000, "settledBps above 100%");
            if (p.status == IRestorationEscrow.Status.Completed || p.status == IRestorationEscrow.Status.Failed) {
                assertEq(p.settledBps, 10_000, "terminal plot not fully settled");
                assertEq(p.settled, p.totalFunded, "terminal plot holds unsettled funds");
            }
        }
        assertFalse(handler.ghostSettledBpsDecreased(), "settledBps decreased");
        assertFalse(handler.ghostTerminalChanged(), "terminal plot changed");
    }

    /// (g) units are issued once per plot and never change; retirements never exceed a funder's share or the total.
    function invariant_RegistryIssuesOnceRetiresOnce() public view {
        uint256 n = escrow.plotCount();
        for (uint256 i; i < n; ++i) {
            assertLe(handler.ghostIssueCount(i), 1, "issued twice");
            RecoveryRegistry.Issuance memory iss = registry.issuance(i);
            uint256 retiredSum;
            for (uint256 j; j < 4; ++j) {
                address f = handler.funder(j);
                uint256 r = registry.retired(i, f);
                retiredSum += r;
                if (iss.issuedAt != 0 && escrow.getPlot(i).totalFunded > 0) {
                    uint256 share = iss.units * escrow.positionOf(i, f).amount / escrow.getPlot(i).totalFunded;
                    assertLe(r, share, "retired more than entitled");
                } else {
                    assertEq(r, 0, "retired without an entitlement");
                }
            }
            assertLe(retiredSum, iss.units, "plot retired more than issued");
        }
        assertFalse(handler.ghostIssuanceChanged(), "issuance changed");
        assertLe(registry.totalRetired(), registry.totalIssued(), "retired more than issued overall");
    }

    /// Shows how often each action actually took effect (run with -vv when tuning the handler).
    function afterInvariant() external view {
        string[8] memory names =
            ["fund", "report", "execute", "challenge", "disturb", "expirePause", "claimOverdue", "claimRefund"];
        for (uint256 i; i < names.length; ++i) {
            console.log(names[i], handler.hits(bytes32(bytes(names[i]))));
        }
        console.log("issue", handler.hits("issue"), "retire", handler.hits("retire"));
        console.log("plots", escrow.plotCount(), "datasets", escrow.datasetCount());
    }
}
