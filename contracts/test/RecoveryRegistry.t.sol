// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Filiz} from "../src/Filiz.sol";
import {RestorationEscrow, IImpactCertificate} from "../src/RestorationEscrow.sol";
import {IRestorationEscrow} from "../src/IRestorationEscrow.sol";
import {ReplantingPool} from "../src/ReplantingPool.sol";
import {RecoveryRegistry, IEscrowViews} from "../src/RecoveryRegistry.sol";

contract RecoveryRegistryTest is Test {
    Filiz usd;
    RestorationEscrow escrow;
    RecoveryRegistry registry;
    address admin = makeAddr("admin");
    address steward = makeAddr("steward");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address oracle;
    uint256 oracleKey;
    uint256 plotId;
    bytes32 constant EVIDENCE = keccak256("e");

    function setUp() public {
        usd = new Filiz();
        ReplantingPool pool = new ReplantingPool(usd, admin);
        escrow = new RestorationEscrow(
            usd,
            admin,
            address(pool),
            RestorationEscrow.Config({challengeWindow: 0, maxPause: 30 days, verifierFeeBps: 0, oracleThreshold: 1, feeRecipient: admin, challengeBond: 0})
        );
        registry = new RecoveryRegistry(IEscrowViews(address(escrow)), admin);
        (oracle, oracleKey) = makeAddrAndKey("oracle");
        vm.startPrank(admin);
        escrow.grantRole(escrow.ORACLE_ROLE(), oracle);
        escrow.grantRole(escrow.PLOT_MANAGER_ROLE(), admin);
        registry.grantRole(registry.PLOT_MANAGER_ROLE(), admin);
        IRestorationEscrow.Milestone[] memory s = new IRestorationEscrow.Milestone[](2);
        s[0] = IRestorationEscrow.Milestone(5000, 0, 0, 0);
        s[1] = IRestorationEscrow.Milestone(5000, 6000, 5000, 0);
        plotId = escrow.createPlot(steward, IRestorationEscrow.PlanType.NATURAL_REGEN, s, "Plot", "u");
        registry.setArea(plotId, 64);
        vm.stopPrank();
        for (uint256 i; i < 2; ++i) {
            address who = i == 0 ? alice : bob;
            vm.startPrank(who);
            usd.faucet();
            usd.approve(address(escrow), type(uint256).max);
            escrow.fund(plotId, i == 0 ? 1_000e6 : 3_000e6, true);
            vm.stopPrank();
        }
    }

    function _complete(int32 finalScore) internal {
        bytes32 l0 = escrow.leaf(0, plotId, 0, 10_000, EVIDENCE);
        bytes32 l1 = escrow.leaf(0, plotId, 1, finalScore, EVIDENCE);
        bytes32 root = l0 < l1 ? keccak256(abi.encodePacked(l0, l1)) : keccak256(abi.encodePacked(l1, l0));
        bytes[] memory sigs = new bytes[](1);
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(oracleKey, escrow.datasetDigest(root, "cid", 0));
        sigs[0] = abi.encodePacked(r, s_, v);
        escrow.commitDataset(root, "cid", sigs);
        bytes32[] memory p0 = new bytes32[](1);
        p0[0] = l1;
        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = l0;
        escrow.submitReport(plotId, 0, 10_000, EVIDENCE, root, p0);
        escrow.execute(plotId, 0);
        escrow.submitReport(plotId, 1, finalScore, EVIDENCE, root, p1);
        escrow.execute(plotId, 1);
    }

    function test_IssueOnceFromFinalScoreWithBuffer() public {
        vm.expectRevert(RecoveryRegistry.NotCompleted.selector);
        registry.issue(plotId);
        _complete(7_700);
        registry.issue(plotId);
        RecoveryRegistry.Issuance memory iss = registry.issuance(plotId);
        // 64 ha x 77% = 49.28 VRU gross; 20% buffer → 39.42 to funders (2 decimals, floor)
        assertEq(iss.units + iss.buffer, 4928);
        assertEq(iss.buffer, 985);
        assertEq(iss.units, 3943);
        vm.expectRevert(RecoveryRegistry.AlreadyIssued.selector);
        registry.issue(plotId);
    }

    function test_ProRataEntitlementAndSingleRetirement() public {
        _complete(10_000);
        registry.issue(plotId);
        uint256 units = registry.issuance(plotId).units; // 64 x 100 x 80% = 5120
        assertEq(registry.available(plotId, alice), units / 4);
        assertEq(registry.available(plotId, bob), units * 3 / 4);

        vm.prank(alice);
        registry.retire(plotId, 1000, "Alice GmbH", "CSRD 2026 sustainability report");
        assertEq(registry.available(plotId, alice), units / 4 - 1000);
        assertEq(registry.retirementCount(), 1);
        RecoveryRegistry.Retirement[] memory r = registry.retirements(0, 10);
        assertEq(r[0].beneficiary, "Alice GmbH");

        vm.prank(alice);
        vm.expectRevert(RecoveryRegistry.ExceedsEntitlement.selector);
        registry.retire(plotId, units / 4, "Alice GmbH", "again");

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(RecoveryRegistry.ExceedsEntitlement.selector);
        registry.retire(plotId, 1, "x", "y");
    }

    function test_FailedPlotIssuesNothingAndAreaIsSetOnce() public {
        vm.prank(admin);
        vm.expectRevert(RecoveryRegistry.AreaAlreadySet.selector);
        registry.setArea(plotId, 100);
        vm.expectRevert(RecoveryRegistry.NotIssued.selector);
        registry.retire(plotId, 1, "x", "y");
    }
}
