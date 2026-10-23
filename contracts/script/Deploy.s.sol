// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Filiz} from "../src/Filiz.sol";
import {RestorationEscrow, IImpactCertificate} from "../src/RestorationEscrow.sol";
import {IRestorationEscrow} from "../src/IRestorationEscrow.sol";
import {ImpactCertificate} from "../src/ImpactCertificate.sol";
import {ReplantingPool} from "../src/ReplantingPool.sol";
import {RecoveryRegistry, IEscrowViews} from "../src/RecoveryRegistry.sol";

/// @notice Deploys Filiz (FLZ), TimelockController, ReplantingPool, RestorationEscrow and ImpactCertificate; registers
///         the oracle committee, guardian and plot manager; creates the demo plots; then hands admin to the timelock
///         and renounces the deployer's admin role.
/// Env: PRIVATE_KEY (deployer), ORACLE_ADDRESSES (comma separated, >= threshold), ORACLE_THRESHOLD (default 2),
///      RELAYER_ADDRESS (submits signed data, gets gas), STEWARD_ADDRESS, GUARDIAN_ADDRESS (default deployer),
///      APP_URL, API_URL (certificate metadata base, default APP_URL), TIMELOCK_DELAY (s, default 2 days),
///      CHALLENGE_WINDOW (s, default 0), MAX_PAUSE (s, default 30 days), CHALLENGE_BOND (FLZ, default 100),
///      SEED_PLOTS (default 0), RELAYER_GAS_WEI (default 0.003 ether)
contract Deploy is Script {
    struct PlotSpec {
        uint256 areaHa;
        uint256 chainId;
        string id;
        string name;
        uint256 planType;
    }

    /// 15% start · 4 × 5% quarterly check-ins · 30% early recovery (target 30%) · 35% sustained (target 60%).
    function schedule() internal pure returns (IRestorationEscrow.Milestone[] memory s) {
        s = new IRestorationEscrow.Milestone[](7);
        s[0] = IRestorationEscrow.Milestone(1500, 0, 0, 0);
        for (uint256 i = 1; i <= 4; ++i) {
            s[i] = IRestorationEscrow.Milestone(500, 0, 0, 0);
        }
        s[5] = IRestorationEscrow.Milestone(3000, 3000, 5000, 0);
        s[6] = IRestorationEscrow.Milestone(3500, 6000, 5000, 0);
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address[] memory oracles = vm.envAddress("ORACLE_ADDRESSES", ",");
        uint8 threshold = uint8(vm.envOr("ORACLE_THRESHOLD", uint256(2)));
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        address steward = vm.envAddress("STEWARD_ADDRESS");
        address guardian = vm.envOr("GUARDIAN_ADDRESS", deployer);
        string memory appUrl = vm.envString("APP_URL");
        string memory apiUrl = vm.envOr("API_URL", appUrl);

        RestorationEscrow.Config memory config = RestorationEscrow.Config({
            challengeWindow: uint64(vm.envOr("CHALLENGE_WINDOW", uint256(0))),
            maxPause: uint64(vm.envOr("MAX_PAUSE", uint256(30 days))),
            verifierFeeBps: 0,
            oracleThreshold: threshold,
            feeRecipient: deployer,
            challengeBond: vm.envOr("CHALLENGE_BOND", uint256(100)) * 1e6
        });
        PlotSpec[] memory specs =
            abi.decode(vm.parseJson(vm.readFile("../backend/data/chain_plots.json"), ".plots"), (PlotSpec[]));
        require(oracles.length >= threshold, "not enough oracles for threshold");

        vm.startBroadcast(pk);
        Filiz usd = new Filiz();

        address[] memory proposers = new address[](1);
        proposers[0] = deployer;
        address[] memory executors = new address[](1);
        executors[0] = address(0); // anyone may execute a proposal once its delay has passed
        TimelockController timelock =
            new TimelockController(vm.envOr("TIMELOCK_DELAY", uint256(2 days)), proposers, executors, address(0));

        ReplantingPool pool = new ReplantingPool(usd, deployer);
        RestorationEscrow escrow = new RestorationEscrow(usd, deployer, address(pool), config);
        ImpactCertificate cert = new ImpactCertificate(address(escrow), address(timelock), string.concat(apiUrl, "/api/certificates/"));
        escrow.setCertificate(IImpactCertificate(address(cert)));
        pool.setEscrow(escrow);
        pool.transferOwnership(address(timelock));

        for (uint256 i; i < oracles.length; ++i) {
            escrow.grantRole(escrow.ORACLE_ROLE(), oracles[i]);
        }
        escrow.grantRole(escrow.GUARDIAN_ROLE(), guardian);
        escrow.grantRole(escrow.PLOT_MANAGER_ROLE(), deployer);

        for (uint256 i; i < specs.length; ++i) {
            require(specs[i].chainId == i, "chain_plots.json must be ordered by chainId");
            escrow.createPlot(
                steward,
                IRestorationEscrow.PlanType(specs[i].planType),
                schedule(),
                specs[i].name,
                string.concat(appUrl, "/plot/", specs[i].id)
            );
        }

        RecoveryRegistry registry = new RecoveryRegistry(IEscrowViews(address(escrow)), deployer);
        registry.grantRole(registry.PLOT_MANAGER_ROLE(), deployer);
        for (uint256 i; i < specs.length; ++i) {
            registry.setArea(i, uint32(specs[i].areaHa));
        }

        // hand governance to the timelock: from here on, role and config changes are delayed and public
        escrow.grantRole(escrow.DEFAULT_ADMIN_ROLE(), address(timelock));
        escrow.renounceRole(escrow.DEFAULT_ADMIN_ROLE(), deployer);
        registry.grantRole(registry.DEFAULT_ADMIN_ROLE(), address(timelock));
        registry.renounceRole(registry.DEFAULT_ADMIN_ROLE(), deployer);

        // the relayer submits committed data on-chain, so give it gas money
        uint256 gas = vm.envOr("RELAYER_GAS_WEI", uint256(0.003 ether));
        if (relayer.balance < gas) payable(relayer).transfer(gas - relayer.balance);

        uint256 seedPlots = vm.envOr("SEED_PLOTS", uint256(0));
        if (seedPlots > 0) {
            usd.faucet();
            usd.approve(address(escrow), type(uint256).max);
            for (uint256 i; i < seedPlots && i < specs.length; ++i) {
                escrow.fund(i, 2_500e6, true);
            }
        }
        vm.stopBroadcast();

        string memory obj = "addresses";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "deployBlock", block.number);
        vm.serializeAddress(obj, "Filiz", address(usd));
        vm.serializeAddress(obj, "TimelockController", address(timelock));
        vm.serializeAddress(obj, "ReplantingPool", address(pool));
        vm.serializeAddress(obj, "RecoveryRegistry", address(registry));
        vm.serializeAddress(obj, "ImpactCertificate", address(cert));
        string memory json = vm.serializeAddress(obj, "RestorationEscrow", address(escrow));
        vm.writeJson(json, "../backend/chain/addresses.json");
        vm.writeJson(json, "../app/src/lib/chain/addresses.json");

        console.log("RestorationEscrow ", address(escrow));
        console.log("TimelockController", address(timelock));
        console.log("ReplantingPool    ", address(pool));
        console.log("plots created     ", specs.length);
    }
}
