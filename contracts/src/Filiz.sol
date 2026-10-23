// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Filiz (FLZ)
/// @notice Play money for the ReGrow testnet demo ("filiz" is Turkish for a young sprout). 1 FLZ stands for one test
///         dollar; anyone can mint from the faucet. No real value. In production the escrow takes a dollar stablecoin.
contract Filiz is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000e6;

    constructor() ERC20("Filiz", "FLZ") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint 10,000 FLZ to the caller.
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
