// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IRestorationEscrow} from "./IRestorationEscrow.sol";

interface IEscrowViews is IRestorationEscrow {
    function getReports(uint256 plotId) external view returns (Report[] memory);
}

/// @title RecoveryRegistry
/// @notice Verified Recovery Units (VRU) with anti-double-counting by design.
///         1 VRU = 1 hectare returned to its pre-fire vegetation condition, weighted by the final verified score of
///         the plot (control-adjusted recovery, capped at 100%). Units are issued exactly once per completed plot,
///         a 20% buffer is withheld against reversal (e.g. re-burn), and the rest is allocated pro-rata to the plot's
///         funders. Units cannot be transferred: a funder can only retire them, once, with a public beneficiary and
///         purpose (e.g. a company's annual sustainability report). Every unit therefore has exactly one claimant.
/// @dev Amounts use 2 decimals (1 VRU = 100). Areas are set once per plot by the plot manager before issuance.
contract RecoveryRegistry is AccessControl {
    bytes32 public constant PLOT_MANAGER_ROLE = keccak256("PLOT_MANAGER_ROLE");
    uint16 public constant BPS = 10_000;
    uint16 public constant BUFFER_BPS = 2_000;
    uint256 public constant UNIT = 100; // 2 decimals

    IEscrowViews public immutable escrow;

    struct Issuance {
        uint64 issuedAt;
        uint32 areaHa;
        int32 finalScoreBps;
        uint256 units; // allocated to funders (after buffer)
        uint256 buffer; // withheld, never retired
    }

    struct Retirement {
        uint256 plotId;
        address account;
        uint256 amount;
        uint64 retiredAt;
        string beneficiary;
        string purpose;
    }

    mapping(uint256 => uint32) public areaHa;
    mapping(uint256 => Issuance) private _issuance;
    mapping(uint256 => mapping(address => uint256)) public retired;
    Retirement[] private _retirements;
    uint256 public totalIssued;
    uint256 public totalRetired;

    event AreaSet(uint256 indexed plotId, uint32 areaHa);
    event UnitsIssued(uint256 indexed plotId, uint32 areaHa, int32 finalScoreBps, uint256 units, uint256 buffer);
    event UnitsRetired(uint256 indexed plotId, address indexed account, uint256 amount, uint256 index, string beneficiary, string purpose);

    error AreaAlreadySet();
    error AreaMissing();
    error NotCompleted();
    error AlreadyIssued();
    error NotIssued();
    error InvalidAmount();
    error ExceedsEntitlement();
    error TextTooLong();

    constructor(IEscrowViews escrow_, address admin) {
        escrow = escrow_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Record a plot's area once (hectares), before units are issued.
    function setArea(uint256 plotId, uint32 ha) external onlyRole(PLOT_MANAGER_ROLE) {
        if (areaHa[plotId] != 0) revert AreaAlreadySet();
        if (ha == 0) revert InvalidAmount();
        areaHa[plotId] = ha;
        emit AreaSet(plotId, ha);
    }

    /// @notice Issue a completed plot's units, once. Anyone may call; the amount follows from on-chain data only.
    function issue(uint256 plotId) external {
        if (_issuance[plotId].issuedAt != 0) revert AlreadyIssued();
        uint32 ha = areaHa[plotId];
        if (ha == 0) revert AreaMissing();
        IRestorationEscrow.Plot memory p = escrow.getPlot(plotId);
        if (p.status != IRestorationEscrow.Status.Completed) revert NotCompleted();
        IRestorationEscrow.Report[] memory reports = escrow.getReports(plotId);
        int32 score = reports[reports.length - 1].scoreBps;
        uint256 factor = score <= 0 ? 0 : (uint256(uint32(score)) > BPS ? BPS : uint256(uint32(score)));
        uint256 gross = uint256(ha) * UNIT * factor / BPS;
        uint256 buffer = gross * BUFFER_BPS / BPS;
        _issuance[plotId] = Issuance(uint64(block.timestamp), ha, score, gross - buffer, buffer);
        totalIssued += gross - buffer;
        emit UnitsIssued(plotId, ha, score, gross - buffer, buffer);
    }

    /// @notice Units a funder may retire for a plot: pro-rata share of the issued units minus what they retired.
    function available(uint256 plotId, address account) public view returns (uint256) {
        Issuance memory iss = _issuance[plotId];
        if (iss.issuedAt == 0) return 0;
        IRestorationEscrow.Plot memory p = escrow.getPlot(plotId);
        if (p.totalFunded == 0) return 0;
        uint256 share = iss.units * escrow.positionOf(plotId, account).amount / p.totalFunded;
        return share - retired[plotId][account];
    }

    /// @notice Retire units permanently on behalf of a named beneficiary for a stated purpose. Not reversible.
    function retire(uint256 plotId, uint256 amount, string calldata beneficiary, string calldata purpose)
        external
        returns (uint256 index)
    {
        if (_issuance[plotId].issuedAt == 0) revert NotIssued();
        if (amount == 0) revert InvalidAmount();
        if (bytes(beneficiary).length > 120 || bytes(purpose).length > 200) revert TextTooLong();
        if (amount > available(plotId, msg.sender)) revert ExceedsEntitlement();
        retired[plotId][msg.sender] += amount;
        totalRetired += amount;
        index = _retirements.length;
        _retirements.push(Retirement(plotId, msg.sender, amount, uint64(block.timestamp), beneficiary, purpose));
        emit UnitsRetired(plotId, msg.sender, amount, index, beneficiary, purpose);
    }

    function issuance(uint256 plotId) external view returns (Issuance memory) {
        return _issuance[plotId];
    }

    function retirementCount() external view returns (uint256) {
        return _retirements.length;
    }

    function retirements(uint256 from, uint256 count) external view returns (Retirement[] memory out) {
        uint256 end = from + count > _retirements.length ? _retirements.length : from + count;
        out = new Retirement[](end > from ? end - from : 0);
        for (uint256 i = from; i < end; ++i) {
            out[i - from] = _retirements[i];
        }
    }
}
