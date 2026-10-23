// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title ImpactCertificate
/// @notice One soulbound certificate per (funder, plot), minted by the escrow on a funder's first deposit.
///         Metadata (name, plot, amount, live status, image) is served from `baseURI` and reflects escrow state.
/// @dev Soulbound on purpose: the certificate records who funded verified recovery; it is not a tradable credit.
contract ImpactCertificate is ERC721, Ownable {
    using Strings for uint256;

    address public immutable escrow;
    uint256 public totalSupply;
    string public baseURI;

    struct Cert {
        uint256 plotId;
        address funder;
        uint64 mintedAt;
    }

    mapping(uint256 => Cert) public certs;
    mapping(uint256 => mapping(address => uint256)) public tokenOf; // plotId => funder => tokenId (0 = none)
    mapping(address => uint256[]) private _ownedBy;

    event BaseURIUpdated(string baseURI);

    error OnlyEscrow();
    error Soulbound();

    constructor(address escrow_, address owner_, string memory baseURI_) ERC721("ReGrow Impact Certificate", "REGROW") Ownable(owner_) {
        escrow = escrow_;
        baseURI = baseURI_;
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        baseURI = baseURI_;
        emit BaseURIUpdated(baseURI_);
    }

    function mintIfNeeded(address funder, uint256 plotId) external returns (uint256 tokenId) {
        if (msg.sender != escrow) revert OnlyEscrow();
        tokenId = tokenOf[plotId][funder];
        if (tokenId != 0) return tokenId;
        tokenId = ++totalSupply;
        tokenOf[plotId][funder] = tokenId;
        certs[tokenId] = Cert(plotId, funder, uint64(block.timestamp));
        _ownedBy[funder].push(tokenId);
        _mint(funder, tokenId); // not _safeMint: soulbound, and contract funders (DAOs, the replanting pool) must not be blocked
    }

    /// @notice All certificate ids held by `funder` (soulbound, so ownership never changes after mint).
    function certificatesOf(address funder) external view returns (uint256[] memory) {
        return _ownedBy[funder];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(baseURI, tokenId.toString());
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }
}
