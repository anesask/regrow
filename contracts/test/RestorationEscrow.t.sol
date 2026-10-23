// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Filiz} from "../src/Filiz.sol";
import {RestorationEscrow, IImpactCertificate} from "../src/RestorationEscrow.sol";
import {IRestorationEscrow} from "../src/IRestorationEscrow.sol";
import {ImpactCertificate} from "../src/ImpactCertificate.sol";
import {ReplantingPool} from "../src/ReplantingPool.sol";

/// Minimal OpenZeppelin-compatible Merkle tree (sorted pairs) for building datasets in tests.
library Merkle {
    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            bytes32[] memory next = new bytes32[]((level.length + 1) / 2);
            for (uint256 i; i < level.length; i += 2) {
                next[i / 2] = i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i];
            }
            level = next;
        }
        return level[0];
    }

    function proof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory out) {
        bytes32[] memory tmp = new bytes32[](32);
        uint256 n;
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            uint256 sib = index ^ 1;
            if (sib < level.length) tmp[n++] = level[sib];
            bytes32[] memory next = new bytes32[]((level.length + 1) / 2);
            for (uint256 i; i < level.length; i += 2) {
                next[i / 2] = i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i];
            }
            level = next;
            index /= 2;
        }
        out = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            out[i] = tmp[i];
        }
    }
}

contract RestorationEscrowTest is Test {
    Filiz usd;
    RestorationEscrow escrow;
    ImpactCertificate cert;
    ReplantingPool pool;

    address admin = makeAddr("admin");
    address guardian = makeAddr("guardian");
    address steward = makeAddr("steward");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address relayer = makeAddr("relayer");

    address[3] oracles;
    uint256[3] keys;

    uint256 plotId;
    bytes32 constant EVIDENCE = keccak256("evidence");
    uint64 constant MAX_PAUSE = 30 days;
    uint256 constant BOND = 100e6;

    uint8 constant M0 = 0;
    uint8 constant C1 = 1;
    uint8 constant M1 = 5;
    uint8 constant M2 = 6;

    // dataset state for the plot under test
    bytes32[] leaves;
    bytes32 root;

    function setUp() public {
        vm.warp(1_000_000);
        usd = new Filiz();
        pool = new ReplantingPool(usd, admin);
        escrow = new RestorationEscrow(usd, admin, address(pool), _config(0, 2));
        cert = new ImpactCertificate(address(escrow), admin, "https://regrow.test/api/certificates/");

        // oracle committee, sorted by address so signature order is easy
        for (uint256 i; i < 3; ++i) {
            (oracles[i], keys[i]) = makeAddrAndKey(string.concat("oracle", vm.toString(i)));
        }
        _sortOracles();

        vm.startPrank(admin);
        escrow.setCertificate(IImpactCertificate(address(cert)));
        pool.setEscrow(escrow);
        for (uint256 i; i < 3; ++i) {
            escrow.grantRole(escrow.ORACLE_ROLE(), oracles[i]);
        }
        escrow.grantRole(escrow.GUARDIAN_ROLE(), guardian);
        escrow.grantRole(escrow.PLOT_MANAGER_ROLE(), admin);
        plotId = escrow.createPlot(steward, IRestorationEscrow.PlanType.NATURAL_REGEN, _schedule(0), "Test slope", "u");
        vm.stopPrank();
        _faucet(alice);
        _faucet(bob);
        _faucet(carol);
    }

    // ------------------------------------------------------------------ helpers

    function _config(uint64 window, uint8 threshold) internal view returns (RestorationEscrow.Config memory) {
        return RestorationEscrow.Config({
            challengeWindow: window,
            maxPause: MAX_PAUSE,
            verifierFeeBps: 0,
            oracleThreshold: threshold,
            feeRecipient: admin,
            challengeBond: BOND
        });
    }

    function _sortOracles() internal {
        for (uint256 i; i < 3; ++i) {
            for (uint256 j = i + 1; j < 3; ++j) {
                if (oracles[j] < oracles[i]) {
                    (oracles[i], oracles[j]) = (oracles[j], oracles[i]);
                    (keys[i], keys[j]) = (keys[j], keys[i]);
                }
            }
        }
    }

    /// 15% start · 4 × 5% quarterly check-ins · 30% early recovery (target 30%) · 35% sustained (target 60%)
    function _schedule(uint64 m1Due) internal pure returns (IRestorationEscrow.Milestone[] memory s) {
        s = new IRestorationEscrow.Milestone[](7);
        s[0] = IRestorationEscrow.Milestone(1500, 0, 0, 0);
        for (uint256 i = 1; i <= 4; ++i) {
            s[i] = IRestorationEscrow.Milestone(500, 0, 0, 0);
        }
        s[5] = IRestorationEscrow.Milestone(3000, 3000, 5000, m1Due);
        s[6] = IRestorationEscrow.Milestone(3500, 6000, 5000, 0);
    }

    function _faucet(address who) internal {
        vm.startPrank(who);
        usd.faucet();
        usd.approve(address(escrow), type(uint256).max);
        vm.stopPrank();
    }

    function _fund(address who, uint256 amount, bool refund) internal {
        vm.prank(who);
        escrow.fund(plotId, amount, refund);
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Commit a dataset with one leaf per milestone score (and an optional disturbance leaf), signed by oracles 0 and 1.
    function _commit(int32[7] memory scores, bool disturbance) internal {
        delete leaves;
        for (uint8 i; i < 7; ++i) {
            leaves.push(escrow.leaf(0, plotId, i, scores[i], EVIDENCE));
        }
        if (disturbance) leaves.push(escrow.leaf(1, plotId, 0, 0, EVIDENCE));
        root = Merkle.root(leaves);
        bytes32 digest = escrow.datasetDigest(root, "bafytest", escrow.datasetCount());
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(keys[0], digest);
        sigs[1] = _sign(keys[1], digest);
        vm.prank(relayer);
        escrow.commitDataset(root, "bafytest", sigs);
    }

    function _submit(uint8 idx, int32 score) internal {
        vm.prank(relayer); // anyone can relay
        escrow.submitReport(plotId, idx, score, EVIDENCE, root, Merkle.proof(leaves, idx));
    }

    function _run(uint8 idx, int32 score) internal {
        _submit(idx, score);
        escrow.execute(plotId, idx);
    }

    int32[7] standard = [int32(10_000), 1, 1, 1, 1, 3000, 6000];

    function _status() internal view returns (IRestorationEscrow.Status) {
        return escrow.getPlot(plotId).status;
    }

    function _claim(address who) internal returns (uint256 got) {
        uint256 before = usd.balanceOf(who);
        vm.prank(who);
        escrow.claimRefund(plotId);
        got = usd.balanceOf(who) - before;
    }

    // ------------------------------------------------------- oracle committee

    function test_FullScheduleViaCommittedDataset() public {
        _fund(alice, 1_000e6, true);
        _fund(bob, 3_000e6, false);
        int32[7] memory s = [int32(10_000), 1, 1, 1, 1, 4200, 7700];
        _commit(s, false);
        for (uint8 i; i < 7; ++i) {
            _run(i, s[i]);
        }
        assertEq(usd.balanceOf(steward), 4_000e6);
        assertEq(uint8(_status()), uint8(IRestorationEscrow.Status.Completed));
        assertEq(usd.balanceOf(address(escrow)), 0);
        assertEq(escrow.getReports(plotId)[M2].datasetRoot, root);
    }

    function test_CommitNeedsThresholdOfDistinctOracles() public {
        bytes32 r = keccak256("root");
        bytes32 digest = escrow.datasetDigest(r, "cid", 0);

        bytes[] memory one = new bytes[](1);
        one[0] = _sign(keys[0], digest);
        vm.expectRevert(RestorationEscrow.BadSignatures.selector);
        escrow.commitDataset(r, "cid", one);

        bytes[] memory dup = new bytes[](2);
        dup[0] = _sign(keys[0], digest);
        dup[1] = _sign(keys[0], digest);
        vm.expectRevert(RestorationEscrow.BadSignatures.selector);
        escrow.commitDataset(r, "cid", dup);

        bytes[] memory unsorted = new bytes[](2);
        unsorted[0] = _sign(keys[1], digest);
        unsorted[1] = _sign(keys[0], digest);
        vm.expectRevert(RestorationEscrow.BadSignatures.selector);
        escrow.commitDataset(r, "cid", unsorted);

        (, uint256 outsiderKey) = makeAddrAndKey("outsider");
        bytes[] memory outsider = new bytes[](2);
        outsider[0] = _sign(keys[0], digest);
        outsider[1] = _sign(outsiderKey, digest);
        vm.expectRevert(RestorationEscrow.BadSignatures.selector);
        escrow.commitDataset(r, "cid", outsider);
    }

    function test_SignatureForOtherNonceOrCidRejected() public {
        bytes32 r = keccak256("root");
        bytes32 wrongNonce = escrow.datasetDigest(r, "cid", 7);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(keys[0], wrongNonce);
        sigs[1] = _sign(keys[1], wrongNonce);
        vm.expectRevert(RestorationEscrow.BadSignatures.selector);
        escrow.commitDataset(r, "cid", sigs);

        bytes32 good = escrow.datasetDigest(r, "cid", 0);
        sigs[0] = _sign(keys[0], good);
        sigs[1] = _sign(keys[1], good);
        vm.expectRevert(RestorationEscrow.BadSignatures.selector);
        escrow.commitDataset(r, "other-cid", sigs);
    }

    function test_ReportsMustBeProvenAgainstCommittedData() public {
        _fund(alice, 1_000e6, true);
        _commit(standard, false);

        vm.expectRevert(RestorationEscrow.InvalidProof.selector);
        escrow.submitReport(plotId, M0, 9_999, EVIDENCE, root, Merkle.proof(leaves, 0)); // tampered score

        vm.expectRevert(RestorationEscrow.UnknownDataset.selector);
        escrow.submitReport(plotId, M0, 10_000, EVIDENCE, keccak256("uncommitted"), Merkle.proof(leaves, 0));

        vm.expectRevert(RestorationEscrow.WrongMilestone.selector);
        escrow.submitReport(plotId, M1, 3000, EVIDENCE, root, Merkle.proof(leaves, M1));
    }

    // ------------------------------------------------------- graded payouts and refunds

    function test_GradedPayoutRefundsShortfallImmediately() public {
        _fund(alice, 1_000e6, true); // 25% refundable
        _fund(bob, 3_000e6, false); // 75% to replanting pool
        int32[7] memory s = [int32(10_000), 1, 1, 1, 1, 2400, 6000];
        _commit(s, false);
        for (uint8 i; i < M1; ++i) {
            _run(i, s[i]);
        }
        uint256 stewardBefore = usd.balanceOf(steward);
        _run(M1, 2400); // 24% vs 30% target → 80% of the 1,200 tranche
        assertEq(usd.balanceOf(steward) - stewardBefore, 960e6);
        assertEq(escrow.getReports(plotId)[M1].fractionBps, 8000);
        assertEq(escrow.claimable(plotId, alice), 60e6, "alice: 25% of 240");
        assertEq(_claim(alice), 60e6);
        assertEq(usd.balanceOf(address(pool)), 180e6, "bob's share in the replanting pool");
    }

    function test_MissedCheckInRefundsOnlyThatTranche() public {
        _fund(alice, 1_000e6, true);
        int32[7] memory s = [int32(10_000), 0, 1, 1, 1, 3000, 6000];
        _commit(s, false);
        _run(M0, s[0]);
        _run(C1, 0);
        assertEq(usd.balanceOf(steward), 150e6);
        assertEq(escrow.claimable(plotId, alice), 50e6);
        assertEq(uint8(_status()), uint8(IRestorationEscrow.Status.Active));
    }

    function test_BelowMinimumFailsPlotAndRefundsRemainder() public {
        _fund(alice, 1_000e6, true);
        int32[7] memory s = [int32(10_000), 1, 1, 1, 1, 1000, 6000];
        _commit(s, false);
        for (uint8 i; i <= M1; ++i) {
            _run(i, s[i]);
        }
        assertEq(uint8(_status()), uint8(IRestorationEscrow.Status.Failed));
        assertEq(usd.balanceOf(steward), 449.99e6);
        assertEq(_claim(alice), 550.01e6);
        assertEq(usd.balanceOf(address(escrow)), 0);
    }

    function test_LateFunderDoesNotShareEarlierRefunds() public {
        _fund(alice, 1_000e6, true);
        int32[7] memory s = [int32(10_000), 0, 0, 1, 1, 3000, 6000];
        _commit(s, false);
        _run(M0, s[0]);
        _run(C1, 0);
        _fund(carol, 1_000e6, true);
        assertEq(escrow.claimable(plotId, carol), 0);
        _run(2, 0); // 300 refunded: 5% of alice's 1,000 and carol's 25% catch-up
        assertEq(escrow.claimable(plotId, alice), 100e6, "50 from check-in 1, 50 from check-in 2");
        assertEq(escrow.claimable(plotId, carol), 250e6, "carol's own catch-up, none of it to alice");
    }

    // ------------------------------------------------------- disputes

    function test_ChallengeUpheldRemovesReportAndReturnsBond() public {
        vm.prank(admin);
        escrow.setConfig(_config(1 hours, 2));
        _fund(alice, 1_000e6, true);
        _commit(standard, false);
        _submit(M0, 10_000);

        vm.prank(bob);
        escrow.challenge(plotId, M0);
        assertEq(usd.balanceOf(bob), 10_000e6 - BOND);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(RestorationEscrow.Challenged.selector);
        escrow.execute(plotId, M0);

        vm.prank(guardian);
        escrow.resolveChallenge(plotId, M0, true);
        assertEq(usd.balanceOf(bob), 10_000e6, "bond returned");
        vm.expectRevert(RestorationEscrow.NoReport.selector);
        escrow.execute(plotId, M0);
    }

    function test_ChallengeRejectedSendsBondToPool() public {
        vm.prank(admin);
        escrow.setConfig(_config(1 hours, 2));
        _fund(alice, 1_000e6, true);
        _commit(standard, false);
        _submit(M0, 10_000);
        vm.prank(bob);
        escrow.challenge(plotId, M0);
        vm.prank(guardian);
        escrow.resolveChallenge(plotId, M0, false);
        assertEq(usd.balanceOf(address(pool)), BOND);
        escrow.execute(plotId, M0); // executable right away after a rejected challenge
        assertEq(usd.balanceOf(steward), 150e6);
    }

    function test_ChallengeOnlyInsideWindow() public {
        vm.prank(admin);
        escrow.setConfig(_config(1 hours, 2));
        _fund(alice, 1_000e6, true);
        _commit(standard, false);
        _submit(M0, 10_000);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(bob);
        vm.expectRevert(RestorationEscrow.ChallengeWindowClosed.selector);
        escrow.challenge(plotId, M0);
    }

    // ------------------------------------------------------- disturbance

    function test_DisturbanceNeedsProofAndPauseExpires() public {
        _fund(alice, 1_000e6, true);
        _commit(standard, true);
        _run(M0, 10_000);

        vm.expectRevert(RestorationEscrow.InvalidProof.selector);
        escrow.submitDisturbance(plotId, keccak256("other"), root, Merkle.proof(leaves, 7));
        escrow.submitDisturbance(plotId, EVIDENCE, root, Merkle.proof(leaves, 7));
        assertEq(uint8(_status()), uint8(IRestorationEscrow.Status.Paused));

        vm.expectRevert(RestorationEscrow.NotActive.selector);
        _fund(bob, 1e6, true);
        vm.expectRevert(RestorationEscrow.PauseNotExpired.selector);
        escrow.expirePause(plotId);

        vm.warp(block.timestamp + MAX_PAUSE);
        vm.prank(guardian);
        vm.expectRevert(RestorationEscrow.PauseExpired.selector);
        escrow.resolveDisturbance(plotId, true); // guardian cannot keep funds frozen past the limit

        vm.prank(carol);
        escrow.expirePause(plotId);
        assertEq(uint8(_status()), uint8(IRestorationEscrow.Status.Failed));
        assertEq(_claim(alice), 850e6);
    }

    function test_GuardianCanResumeBeforeExpiry() public {
        _fund(alice, 1_000e6, true);
        _commit(standard, true);
        escrow.submitDisturbance(plotId, EVIDENCE, root, Merkle.proof(leaves, 7));
        vm.prank(guardian);
        escrow.resolveDisturbance(plotId, true);
        _run(M0, 10_000);
        assertEq(usd.balanceOf(steward), 150e6);
    }

    function test_UpheldReportCannotBeResubmitted() public {
        vm.prank(admin);
        escrow.setConfig(_config(1 hours, 2));
        _fund(alice, 1_000e6, true);
        _commit(standard, false);
        _submit(M0, 10_000);
        vm.prank(bob);
        escrow.challenge(plotId, M0);
        vm.prank(guardian);
        escrow.resolveChallenge(plotId, M0, true);

        // the struck-down report cannot be replayed to force a new bond and ruling
        vm.prank(relayer);
        vm.expectRevert(RestorationEscrow.Challenged.selector);
        escrow.submitReport(plotId, M0, 10_000, EVIDENCE, root, Merkle.proof(leaves, M0));

        // a corrected score from a new dataset is accepted
        int32[7] memory fixedScores = standard;
        fixedScores[M0] = 9_000;
        _commit(fixedScores, false);
        _submit(M0, 9_000);
        vm.warp(block.timestamp + 1 hours);
        escrow.execute(plotId, M0);
        assertEq(usd.balanceOf(steward), 150e6);
    }

    function test_PauseExtendsDeadlines() public {
        uint64 due = uint64(block.timestamp + 365 days);
        vm.prank(admin);
        plotId = escrow.createPlot(steward, IRestorationEscrow.PlanType.ASSISTED, _schedule(due), "Due", "u");
        _fund(alice, 1_000e6, true);
        _commit(standard, true);
        for (uint8 i; i < M1; ++i) {
            _run(i, standard[i]);
        }
        // paused for 20 days just before the deadline, then cleared by the guardian
        vm.warp(due - 1 days);
        escrow.submitDisturbance(plotId, EVIDENCE, root, Merkle.proof(leaves, 7));
        vm.warp(due + 19 days);
        vm.prank(guardian);
        escrow.resolveDisturbance(plotId, true);

        // the deadline moved by the pause: the steward still has the day that was left
        assertEq(escrow.getPlot(plotId).milestones[M1].dueAt, due + 20 days);
        vm.expectRevert(RestorationEscrow.NotOverdue.selector);
        escrow.claimOverdue(plotId);
        vm.warp(due + 20 days + 1);
        escrow.claimOverdue(plotId);
        assertEq(uint8(_status()), uint8(IRestorationEscrow.Status.Failed));
    }

    function test_OverdueMilestoneOpensRefunds() public {
        vm.prank(admin);
        plotId = escrow.createPlot(steward, IRestorationEscrow.PlanType.ASSISTED, _schedule(uint64(block.timestamp + 365 days)), "Due", "u");
        _fund(alice, 1_000e6, true);
        _commit(standard, false);
        for (uint8 i; i < M1; ++i) {
            _run(i, standard[i]);
        }
        vm.expectRevert(RestorationEscrow.NotOverdue.selector);
        escrow.claimOverdue(plotId);
        vm.warp(block.timestamp + 366 days);
        escrow.claimOverdue(plotId);
        assertEq(_claim(alice), 650e6);
    }

    // ------------------------------------------------------- governance and access

    function test_RolesAreSeparated() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, escrow.PLOT_MANAGER_ROLE())
        );
        vm.prank(alice);
        escrow.createPlot(steward, IRestorationEscrow.PlanType.ASSISTED, _schedule(0), "x", "y");

        vm.expectRevert();
        vm.prank(oracles[0]); // oracles sign data; they hold no other power
        escrow.resolveDisturbance(plotId, false);

        vm.expectRevert();
        vm.prank(guardian);
        escrow.setConfig(_config(0, 2));
    }

    function test_ConfigIsBounded() public {
        RestorationEscrow.Config memory c = _config(15 days, 2); // window above the 14-day cap
        vm.prank(admin);
        vm.expectRevert(RestorationEscrow.InvalidConfig.selector);
        escrow.setConfig(c);

        c = _config(0, 4); // threshold above the 3 oracles
        vm.prank(admin);
        vm.expectRevert(RestorationEscrow.InvalidConfig.selector);
        escrow.setConfig(c);

        c = _config(0, 2);
        c.verifierFeeBps = 600;
        vm.prank(admin);
        vm.expectRevert(RestorationEscrow.InvalidConfig.selector);
        escrow.setConfig(c);
    }

    function test_AdminActionsGoThroughTimelock() public {
        address[] memory proposers = new address[](1);
        proposers[0] = admin;
        address[] memory executors = new address[](1);
        executors[0] = address(0); // anyone can execute once the delay has passed
        TimelockController timelock = new TimelockController(2 days, proposers, executors, address(0));

        vm.startPrank(admin);
        escrow.grantRole(escrow.DEFAULT_ADMIN_ROLE(), address(timelock));
        escrow.renounceRole(escrow.DEFAULT_ADMIN_ROLE(), admin);
        vm.stopPrank();

        bytes memory call = abi.encodeCall(RestorationEscrow.setConfig, (_config(1 hours, 2)));
        vm.prank(admin);
        vm.expectRevert();
        escrow.setConfig(_config(1 hours, 2)); // no direct admin power left

        vm.prank(admin);
        timelock.schedule(address(escrow), 0, call, bytes32(0), bytes32(0), 2 days);
        vm.expectRevert();
        timelock.execute(address(escrow), 0, call, bytes32(0), bytes32(0));
        vm.warp(block.timestamp + 2 days);
        timelock.execute(address(escrow), 0, call, bytes32(0), bytes32(0));
        assertEq(escrow.challengeWindow(), 1 hours);
    }

    function test_ReplantingPoolCanOnlyReinvest() public {
        _fund(bob, 1_000e6, false);
        _commit([int32(10_000), 0, 0, 1, 1, 3000, 6000], false);
        _run(M0, 10_000);
        _run(C1, 0);
        _run(2, 0);
        assertEq(usd.balanceOf(address(pool)), 100e6);

        vm.prank(bob);
        vm.expectRevert();
        pool.reinvest(plotId, 100e6);

        vm.prank(admin);
        pool.reinvest(plotId, 100e6);
        assertEq(usd.balanceOf(address(pool)), 0);
        assertEq(escrow.positionOf(plotId, address(pool)).amount, 100e6);
    }

    function test_CertificateSoulboundWithMetadataURI() public {
        _fund(alice, 100e6, true);
        _fund(alice, 50e6, true);
        uint256 id = cert.tokenOf(plotId, alice);
        assertEq(id, 1);
        assertEq(cert.certificatesOf(alice).length, 1);
        assertEq(cert.tokenURI(id), "https://regrow.test/api/certificates/1");
        vm.prank(alice);
        vm.expectRevert(ImpactCertificate.Soulbound.selector);
        cert.transferFrom(alice, bob, id);
        vm.expectRevert(ImpactCertificate.OnlyEscrow.selector);
        cert.mintIfNeeded(bob, plotId);
    }

    /// Every token is accounted for: steward + pool + claimable refunds == total funded, whatever the scores.
    function testFuzz_Conservation(uint256 a, uint256 b, uint256 late, int32 s1, int32 s2, uint8 missed) public {
        a = bound(a, 1, 10_000e6);
        b = bound(b, 1, 10_000e6);
        late = bound(late, 0, 10_000e6);
        s1 = int32(bound(int256(s1), -5000, 9000));
        s2 = int32(bound(int256(s2), -5000, 9000));
        int32[7] memory s;
        s[0] = 10_000;
        for (uint8 i = 1; i <= 4; ++i) {
            s[i] = (missed >> i) & 1 == 1 ? int32(0) : int32(1);
        }
        s[5] = s1;
        s[6] = s2;
        _fund(alice, a, true);
        _fund(bob, b, false);
        _commit(s, false);
        for (uint8 i; i < M1; ++i) {
            _run(i, s[i]);
        }
        if (late > 0) _fund(carol, late, true);
        _run(M1, s1);
        if (_status() == IRestorationEscrow.Status.Active) _run(M2, s2);

        uint256 total = a + b + late;
        uint256 owed = escrow.claimable(plotId, alice) + escrow.claimable(plotId, carol);
        uint256 accounted = usd.balanceOf(steward) + usd.balanceOf(address(pool)) + owed;
        assertLe(accounted, total, "never pays out more than funded");
        assertApproxEqAbs(accounted, total, 3, "only rounding dust stays behind");
    }

    // ------------------------------------------------------- adversarial

    function _twoMilestonePlot(uint16 target1) internal returns (uint256 id) {
        IRestorationEscrow.Milestone[] memory s = new IRestorationEscrow.Milestone[](2);
        s[0] = IRestorationEscrow.Milestone(5000, 0, 0, 0);
        s[1] = IRestorationEscrow.Milestone(5000, target1, 0, 0);
        vm.prank(admin);
        id = escrow.createPlot(steward, IRestorationEscrow.PlanType.NATURAL_REGEN, s, "Two", "u");
    }

    function _commitLeaves(string memory cid) internal {
        root = Merkle.root(leaves);
        bytes32 digest = escrow.datasetDigest(root, cid, escrow.datasetCount());
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(keys[0], digest);
        sigs[1] = _sign(keys[1], digest);
        escrow.commitDataset(root, cid, sigs);
    }

    function test_CommitReplayIsNoOpAndSignaturesDoNotTransfer() public {
        _commit(standard, false);
        bytes32 committed = root;
        assertEq(escrow.datasetCount(), 1);
        bytes32 digest = escrow.datasetDigest(committed, "bafytest", 0);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(keys[0], digest);
        sigs[1] = _sign(keys[1], digest);

        escrow.commitDataset(committed, "bafytest", sigs); // replay of an existing commit: no-op
        assertEq(escrow.datasetCount(), 1);

        vm.expectRevert(RestorationEscrow.BadSignatures.selector); // same signatures over another root
        escrow.commitDataset(keccak256("other root"), "bafytest", sigs);

        bytes32 fresh = keccak256("fresh");
        bytes32 stale = escrow.datasetDigest(fresh, "c", 0); // signed for nonce 0, which is already taken
        sigs[0] = _sign(keys[0], stale);
        sigs[1] = _sign(keys[1], stale);
        vm.expectRevert(RestorationEscrow.BadSignatures.selector);
        escrow.commitDataset(fresh, "c", sigs);
    }

    function test_SignatureFromRemovedOracleRejected() public {
        vm.startPrank(admin);
        escrow.revokeRole(escrow.ORACLE_ROLE(), oracles[1]);
        vm.stopPrank();
        bytes32 r = keccak256("root");
        bytes32 digest = escrow.datasetDigest(r, "cid", 0);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(keys[0], digest);
        sigs[1] = _sign(keys[1], digest);
        vm.expectRevert(RestorationEscrow.BadSignatures.selector);
        escrow.commitDataset(r, "cid", sigs);

        sigs[1] = _sign(keys[2], digest); // a still-active oracle works
        escrow.commitDataset(r, "cid", sigs);
        assertEq(escrow.datasetCount(), 1);
    }

    function test_MalleableOrMalformedSignatureRejected() public {
        bytes32 r = keccak256("root");
        bytes32 digest = escrow.datasetDigest(r, "cid", 0);
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(keys[1], digest);
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(keys[0], digest);
        sigs[1] = abi.encodePacked(rr, bytes32(n - uint256(ss)), v == 27 ? uint8(28) : uint8(27)); // high-s twin
        vm.expectRevert();
        escrow.commitDataset(r, "cid", sigs);
        sigs[1] = hex"1234";
        vm.expectRevert();
        escrow.commitDataset(r, "cid", sigs);
    }

    function test_ProofForOtherPlotIdxOrKindRejected() public {
        uint256 other = _twoMilestonePlot(0);
        delete leaves;
        leaves.push(escrow.leaf(0, plotId, 0, 10_000, EVIDENCE));
        leaves.push(escrow.leaf(0, plotId, 1, 1, EVIDENCE));
        leaves.push(escrow.leaf(0, other, 0, 10_000, EVIDENCE));
        leaves.push(escrow.leaf(1, other, 0, 0, EVIDENCE));
        _commitLeaves("c");

        vm.expectRevert(RestorationEscrow.InvalidProof.selector); // other plot's leaf
        escrow.submitReport(plotId, 0, 10_000, EVIDENCE, root, Merkle.proof(leaves, 2));
        vm.expectRevert(RestorationEscrow.InvalidProof.selector); // idx 1's proof used for idx 0
        escrow.submitReport(plotId, 0, 1, EVIDENCE, root, Merkle.proof(leaves, 1));
        vm.expectRevert(RestorationEscrow.InvalidProof.selector); // disturbance leaf as a milestone
        escrow.submitReport(other, 0, 0, EVIDENCE, root, Merkle.proof(leaves, 3));
        vm.expectRevert(RestorationEscrow.InvalidProof.selector); // milestone leaf as a disturbance
        escrow.submitDisturbance(plotId, EVIDENCE, root, Merkle.proof(leaves, 0));
        vm.expectRevert(RestorationEscrow.InvalidProof.selector); // other plot's disturbance
        escrow.submitDisturbance(plotId, EVIDENCE, root, Merkle.proof(leaves, 3));

        escrow.submitReport(plotId, 0, 10_000, EVIDENCE, root, Merkle.proof(leaves, 0));
    }

    function test_ExecuteTimingAndDoubleExecution() public {
        vm.prank(admin);
        escrow.setConfig(_config(1 hours, 2));
        _fund(alice, 1_000e6, true);
        _commit(standard, false);
        _submit(M0, 10_000);
        vm.warp(block.timestamp + 1 hours - 1);
        vm.expectRevert(RestorationEscrow.ChallengeWindowOpen.selector);
        escrow.execute(plotId, M0);
        vm.prank(bob);
        escrow.challenge(plotId, M0); // last second of the window still accepts a challenge
        vm.prank(guardian);
        escrow.resolveChallenge(plotId, M0, false);
        escrow.execute(plotId, M0);
        vm.expectRevert(RestorationEscrow.AlreadyExecuted.selector);
        escrow.execute(plotId, M0);
        vm.expectRevert(RestorationEscrow.WrongMilestone.selector);
        escrow.submitReport(plotId, M0, 10_000, EVIDENCE, root, Merkle.proof(leaves, 0));
        vm.expectRevert(RestorationEscrow.NotChallenged.selector);
        vm.prank(guardian);
        escrow.resolveChallenge(plotId, M0, true);
        vm.expectRevert(RestorationEscrow.AlreadyExecuted.selector);
        vm.prank(bob);
        escrow.challenge(plotId, M0);
    }

    function test_OutOfOrderExecutionRejected() public {
        _fund(alice, 1_000e6, true);
        _commit(standard, false);
        vm.expectRevert(RestorationEscrow.NoReport.selector);
        escrow.execute(plotId, C1);
        vm.expectRevert(RestorationEscrow.WrongMilestone.selector);
        escrow.submitReport(plotId, C1, 1, EVIDENCE, root, Merkle.proof(leaves, C1));
    }

    function test_RefundClaimTwiceReverts() public {
        _fund(alice, 1_000e6, true);
        _commit([int32(10_000), 0, 1, 1, 1, 3000, 6000], false);
        _run(M0, 10_000);
        _run(C1, 0);
        assertEq(_claim(alice), 50e6);
        vm.prank(alice);
        vm.expectRevert(RestorationEscrow.NothingToClaim.selector);
        escrow.claimRefund(plotId);
        vm.prank(bob); // never funded
        vm.expectRevert(RestorationEscrow.NothingToClaim.selector);
        escrow.claimRefund(plotId);
    }

    function test_NonRefundFunderNeverClaims() public {
        _fund(bob, 1_000e6, false);
        _commit(standard, true);
        escrow.submitDisturbance(plotId, EVIDENCE, root, Merkle.proof(leaves, 7));
        vm.prank(guardian);
        escrow.resolveDisturbance(plotId, false);
        assertEq(escrow.claimable(plotId, bob), 0);
        assertEq(usd.balanceOf(address(pool)), 1_000e6);
        vm.expectRevert(RestorationEscrow.NotActive.selector);
        _fund(bob, 1, true);
    }

    function test_RefundChoiceIsFixedPerPosition() public {
        _fund(bob, 1_000e6, false);
        vm.expectRevert(RestorationEscrow.RefundChoiceMismatch.selector);
        _fund(bob, 1, true);
    }

    function test_OneUnitAndOddDepositsLeaveOnlyDust() public {
        int32[7] memory s = [int32(10_000), 0, 1, 0, 1, 1700, 3100];
        _fund(alice, 1, true);
        _fund(bob, 1, false);
        _fund(carol, 7, true);
        _commit(s, false);
        for (uint8 i; i < 7; ++i) {
            _run(i, s[i]);
        }
        assertEq(uint8(_status()), uint8(IRestorationEscrow.Status.Completed));
        uint256 owedA = escrow.claimable(plotId, alice);
        uint256 owedC = escrow.claimable(plotId, carol);
        assertLe(owedA + owedC, usd.balanceOf(address(escrow)));
        if (owedA > 0) _claim(alice);
        if (owedC > 0) _claim(carol);
        uint256 dust = usd.balanceOf(address(escrow));
        assertLe(dust, 2, "at most rounding dust is stranded");
        assertEq(usd.balanceOf(steward) + usd.balanceOf(address(pool)) + owedA + owedC + dust, 9);
    }

    /// Regression: a late deposit made when the refund accumulator is fractional must not round its debt down,
    /// otherwise funders can claim more than the plot refunded and drain other plots' funds.
    function test_LateDepositRoundingCannotOverdrawEscrow() public {
        _fund(alice, 1_000e6, true); // another plot's money that must stay untouched
        uint256 id = _twoMilestonePlot(10_000);
        plotId = id;
        _fund(alice, 2, true);
        delete leaves;
        leaves.push(escrow.leaf(0, id, 0, 0, EVIDENCE));
        leaves.push(escrow.leaf(0, id, 1, 5000, EVIDENCE));
        _commitLeaves("c");
        _run(0, 0); // 1 unit refunded over 2 refundable units: 0.5 per unit
        _fund(bob, 1, true);
        _fund(carol, 1, true);
        _run(1, 5000); // tranche 3: steward 1, 2 refunded over 4 units

        uint256 owed = escrow.claimable(id, alice) + escrow.claimable(id, bob) + escrow.claimable(id, carol);
        IRestorationEscrow.Plot memory p = escrow.getPlot(id);
        assertEq(p.totalFunded - p.released, 3);
        assertLe(owed, 3, "refunds exceed what the plot holds");
        if (escrow.claimable(id, alice) > 0) _claim(alice);
        if (escrow.claimable(id, bob) > 0) _claim(bob);
        if (escrow.claimable(id, carol) > 0) _claim(carol);
        assertGe(usd.balanceOf(address(escrow)), 1_000e6, "other plot's funds were used");
    }

    /// Regression: when a plot fails after a late deposit, the late money's catch-up must not be split pro rata with
    /// earlier funders (an early refund funder used to get back more than they deposited, taken from the late
    /// funder or the replanting pool).
    function test_LateDepositFailureRefundsEachFunderOwnMoney() public {
        _fund(alice, 1_000e6, true);
        _commit([int32(0), 1, 1, 1, 1, 3000, 6000], true);
        _run(M0, 0); // 150 refunded to alice
        _fund(bob, 3_000e6, false); // late, replanting choice
        _fund(carol, 2_000e6, true); // late, refund choice
        escrow.submitDisturbance(plotId, EVIDENCE, root, Merkle.proof(leaves, 7));
        vm.prank(guardian);
        escrow.resolveDisturbance(plotId, false);

        assertEq(_claim(alice), 1_000e6, "alice gets exactly her deposit back");
        assertEq(_claim(carol), 2_000e6, "carol gets exactly her deposit back");
        assertEq(usd.balanceOf(address(pool)), 3_000e6, "bob's deposit goes to the replanting pool");
        assertEq(usd.balanceOf(address(escrow)), 0);
    }

    /// Regression: a disturbance finding the guardian already resolved cannot be replayed to pause the plot again
    /// (and, if nobody notices within maxPause, fail it).
    function test_ResolvedDisturbanceCannotBeReplayed() public {
        _fund(alice, 1_000e6, true);
        _commit(standard, true);
        escrow.submitDisturbance(plotId, EVIDENCE, root, Merkle.proof(leaves, 7));
        vm.prank(guardian);
        escrow.resolveDisturbance(plotId, true);

        vm.expectRevert(RestorationEscrow.AlreadyExecuted.selector);
        escrow.submitDisturbance(plotId, EVIDENCE, root, Merkle.proof(leaves, 7));
        assertEq(uint8(_status()), uint8(IRestorationEscrow.Status.Active));

        // a new finding (new evidence) still pauses
        bytes32 newEvidence = keccak256("re-burn");
        delete leaves;
        leaves.push(escrow.leaf(1, plotId, 0, 0, newEvidence));
        leaves.push(escrow.leaf(0, plotId, 0, 10_000, EVIDENCE));
        _commitLeaves("c2");
        escrow.submitDisturbance(plotId, newEvidence, root, Merkle.proof(leaves, 0));
        assertEq(uint8(_status()), uint8(IRestorationEscrow.Status.Paused));
    }

    /// Regression: re-submitting a pending report from the same (or an older) dataset must not restart its challenge
    /// window, or anyone could stall a plot forever by front-running execute.
    function test_PendingReportCannotBeResubmittedToStall() public {
        vm.prank(admin);
        escrow.setConfig(_config(1 hours, 2));
        _fund(alice, 1_000e6, true);
        _commit(standard, false);
        bytes32 first = root;
        bytes32[] memory firstProof = Merkle.proof(leaves, 0);
        _submit(M0, 10_000);
        uint256 t = block.timestamp;
        vm.warp(t + 1 hours - 1);
        vm.expectRevert(RestorationEscrow.ChallengeWindowOpen.selector);
        escrow.submitReport(plotId, M0, 10_000, EVIDENCE, first, firstProof);

        // a newer dataset may still correct the pending score (and restarts the window)
        _commit([int32(9_000), 1, 1, 1, 1, 3000, 6000], false);
        _submit(M0, 9_000);
        vm.expectRevert(RestorationEscrow.ChallengeWindowOpen.selector); // but the older one cannot come back
        escrow.submitReport(plotId, M0, 10_000, EVIDENCE, first, firstProof);
        vm.warp(t + 2 hours - 1); // window of the corrected report, submitted at t + 1h - 1
        escrow.execute(plotId, M0);
        assertEq(escrow.getReports(plotId)[M0].scoreBps, 9_000);
    }

    function test_PauseExpiryBoundary() public {
        _fund(alice, 1_000e6, true);
        _commit(standard, true);
        escrow.submitDisturbance(plotId, EVIDENCE, root, Merkle.proof(leaves, 7));
        uint256 pausedAt = block.timestamp;

        vm.warp(pausedAt + MAX_PAUSE - 1);
        vm.expectRevert(RestorationEscrow.PauseNotExpired.selector);
        escrow.expirePause(plotId);
        uint256 snap = vm.snapshotState();
        vm.prank(guardian);
        escrow.resolveDisturbance(plotId, true); // one second before the limit the guardian can still resume
        vm.revertToState(snap);

        vm.warp(pausedAt + MAX_PAUSE); // exactly at the limit: expiry only, never both
        vm.prank(guardian);
        vm.expectRevert(RestorationEscrow.PauseExpired.selector);
        escrow.resolveDisturbance(plotId, true);
        escrow.expirePause(plotId);
        vm.expectRevert(RestorationEscrow.NotPaused.selector);
        escrow.expirePause(plotId);
        vm.prank(guardian);
        vm.expectRevert(RestorationEscrow.NotPaused.selector);
        escrow.resolveDisturbance(plotId, false);
        assertEq(_claim(alice), 1_000e6);
    }

    function test_FundingRequiresActivePlot() public {
        _fund(alice, 1_000e6, true);
        _commit(standard, true);
        escrow.submitDisturbance(plotId, EVIDENCE, root, Merkle.proof(leaves, 7));
        vm.expectRevert(RestorationEscrow.NotActive.selector);
        _fund(bob, 1e6, true); // paused
        vm.prank(guardian);
        escrow.resolveDisturbance(plotId, false);
        vm.expectRevert(RestorationEscrow.NotActive.selector);
        _fund(bob, 1e6, true); // failed

        plotId = _twoMilestonePlot(0);
        _fund(bob, 1e6, false);
        delete leaves;
        leaves.push(escrow.leaf(0, plotId, 0, 1, EVIDENCE));
        leaves.push(escrow.leaf(0, plotId, 1, 1, EVIDENCE));
        _commitLeaves("c");
        _run(0, 1);
        _run(1, 1);
        assertEq(uint8(_status()), uint8(IRestorationEscrow.Status.Completed));
        vm.expectRevert(RestorationEscrow.NotActive.selector);
        _fund(bob, 1e6, false); // completed
        vm.expectRevert(RestorationEscrow.InvalidAmount.selector);
        _fund(bob, 0, false);
        vm.expectRevert(RestorationEscrow.UnknownPlot.selector);
        escrow.fund(99, 1, false);
    }

    function test_TerminalPlotRejectsEveryPayoutPath() public {
        _fund(alice, 1_000e6, true);
        _commit(standard, true);
        _submit(M0, 10_000); // pending, unexecuted
        vm.prank(guardian);
        vm.expectRevert(RestorationEscrow.NotPaused.selector);
        escrow.resolveDisturbance(plotId, false);
        escrow.submitDisturbance(plotId, EVIDENCE, root, Merkle.proof(leaves, 7));
        vm.prank(guardian);
        escrow.resolveDisturbance(plotId, false);
        IRestorationEscrow.Plot memory before = escrow.getPlot(plotId);

        vm.expectRevert(RestorationEscrow.NotActive.selector);
        escrow.execute(plotId, M0);
        vm.expectRevert(RestorationEscrow.NotActive.selector);
        escrow.claimOverdue(plotId);
        vm.expectRevert(RestorationEscrow.NotActive.selector);
        escrow.submitDisturbance(plotId, EVIDENCE, root, Merkle.proof(leaves, 7));
        vm.expectRevert(RestorationEscrow.NotPaused.selector);
        escrow.expirePause(plotId);
        IRestorationEscrow.Plot memory afterwards = escrow.getPlot(plotId);
        assertEq(afterwards.released, before.released);
        assertEq(afterwards.refunded, before.refunded);
        assertEq(_claim(alice), 1_000e6);
    }

    function test_CertificateCannotMoveByAnyPath() public {
        _fund(alice, 100e6, true);
        uint256 id = cert.tokenOf(plotId, alice);
        vm.startPrank(alice);
        cert.approve(bob, id);
        cert.setApprovalForAll(carol, true);
        vm.expectRevert(ImpactCertificate.Soulbound.selector);
        cert.safeTransferFrom(alice, bob, id);
        vm.expectRevert(ImpactCertificate.Soulbound.selector);
        cert.safeTransferFrom(alice, bob, id, "");
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(ImpactCertificate.Soulbound.selector);
        cert.transferFrom(alice, bob, id);
        vm.prank(carol);
        vm.expectRevert(ImpactCertificate.Soulbound.selector);
        cert.transferFrom(alice, carol, id);
        assertEq(cert.ownerOf(id), alice);
    }

    /// FLZ has no transfer hooks, but check the ordering anyway: state is written before tokens move.
    function test_StateWrittenBeforeTransfers() public {
        _fund(alice, 1_000e6, true);
        _commit([int32(10_000), 0, 1, 1, 1, 3000, 6000], false);
        _run(M0, 10_000);
        _run(C1, 0);
        assertEq(escrow.positionOf(plotId, alice).refundDebt, 0);
        _claim(alice);
        IRestorationEscrow.Position memory pos = escrow.positionOf(plotId, alice);
        assertEq(pos.refundDebt, 50e6);
        assertEq(pos.refundClaimed, 50e6);
        assertTrue(escrow.getReports(plotId)[C1].executed);
    }
}
