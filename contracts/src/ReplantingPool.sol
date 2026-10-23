// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRestorationEscrow} from "./IRestorationEscrow.sol";

/// @title ReplantingPool
/// @notice Receives unearned funds of funders who chose "replanting" and challenge bonds of rejected disputes.
///         Funds can only ever be reinvested into ReGrow plots: there is no withdraw function.
/// @dev Owned by the TimelockController, so every reinvestment is proposed publicly and delayed.
contract ReplantingPool is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    IRestorationEscrow public escrow;

    event EscrowSet(address escrow);
    event Reinvested(uint256 indexed plotId, uint256 amount);

    error EscrowAlreadySet();

    constructor(IERC20 token_, address owner_) Ownable(owner_) {
        token = token_;
    }

    /// @notice One-time link to the escrow (the escrow needs the pool's address at construction).
    function setEscrow(IRestorationEscrow escrow_) external onlyOwner {
        if (address(escrow) != address(0)) revert EscrowAlreadySet();
        escrow = escrow_;
        emit EscrowSet(address(escrow_));
    }

    /// @notice Fund a plot from the pool (as a non-refund funder, so any shortfall flows back here).
    function reinvest(uint256 plotId, uint256 amount) external onlyOwner {
        token.forceApprove(address(escrow), amount);
        escrow.fund(plotId, amount, false);
        emit Reinvested(plotId, amount);
    }

    function balance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
