// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "./Rng.sol";

/// @title GenesisKnights — 1,024 knights, each carrying hash power from the published bands.
///
/// @notice The collection's whole design is one sentence: **every Genesis Knight pays the
///         same 300 DNG a clear, and hash power moves only its staking income.** Playing is
///         therefore identical across the collection — there is no "good" Genesis Knight for
///         dungeon runs — and the thing a buyer is actually choosing between is positioning
///         on the passive side, which is exactly what the band table publishes before mint.
///
/// The bands are the fairness rule, so they are contracts, not prose. `lib/staking-config.js`
/// states them, and this contract states them again in the same six rows:
///
///   band             hash power        count
///   Spark            300 – 424          200
///   Ember            425 – 549          210
///   Forge            550 – 674          210
///   Radiant          675 – 799          200
///   Ascendant        800 – 899          140
///   Genesis Prime    900 – 1,000         64
///                                        ───
///                                        1,024
///
/// Two properties make that table a promise rather than a description, and both are checked
/// in the constructor so a bad table cannot be deployed at all:
///
///   1. the counts sum to exactly the supply, and
///   2. the bands tile 300…1,000 with no gap and no overlap.
///
/// A knight banks exactly its hash power in raffle tickets for every hour staked, so a band's
/// range *is* its yield range: a 1,000-HP knight earns 1,000 tickets an hour and a 300-HP
/// knight earns 300. Rolls inside a band are uniform, which is precisely why the *bands* —
/// not the individual values — are what a buyer can hold the project to.
///
/// @dev The mint venue is deliberately not decided here. `ownerMint` is the only way in:
///      whether that is a sale contract, a marketplace listing or a manual distribution is a
///      decision about *how* the collection is sold, and pinning one into the token would
///      make the other two a redeploy. There is no public mint and no price in this contract.
contract GenesisKnights is ERC721, ERC721Enumerable, Ownable2Step {
    using Rng for uint256;

    /// @notice Fixed, and the only supply figure that matters. `lib/staking-config.js`.
    uint256 public constant MAX_SUPPLY = 1024;

    /// @notice The published hash-power range. A value outside it cannot exist.
    uint256 public constant HASH_POWER_MIN = 300;
    uint256 public constant HASH_POWER_MAX = 1000;

    uint8 public constant BAND_COUNT = 6;

    struct Band {
        string name;
        uint16 lo;
        uint16 hi;
        uint16 count;
    }

    Band[6] private _bands;

    /// @notice How many rolls each band still has. Minting decrements it, which is what makes
    ///         the published counts exact rather than merely intended: the 200th Spark cannot
    ///         be minted twice, because after 200 there are none left.
    uint16[6] private _remaining;

    /// @notice Hash power is rolled at mint and then fixed for the knight's life. There is no
    ///         setter: a knight whose hash power could be changed is a knight whose staking
    ///         promise could be changed.
    mapping(uint256 => uint16) public hashPowerOf;

    /// @notice Which band a knight rolled into, 0…5.
    mapping(uint256 => uint8) public bandIndexOf;

    /// @notice Increments on every roll, so two mints in one block cannot draw the same
    ///         number out of `Rng`.
    uint256 public rollNonce;

    string private _baseTokenURI;

    event KnightMinted(
        address indexed to,
        uint256 indexed tokenId,
        uint8 bandIndex,
        uint16 hashPower
    );
    event BaseURISet(string baseURI);

    constructor() ERC721("Dungeon Knights Genesis", "DKNG") Ownable(msg.sender) {
        _bands[0] = Band("Spark", 300, 424, 200);
        _bands[1] = Band("Ember", 425, 549, 210);
        _bands[2] = Band("Forge", 550, 674, 210);
        _bands[3] = Band("Radiant", 675, 799, 200);
        _bands[4] = Band("Ascendant", 800, 899, 140);
        _bands[5] = Band("Genesis Prime", 900, 1000, 64);

        uint256 total = 0;
        for (uint8 i = 0; i < BAND_COUNT; i++) {
            Band memory band = _bands[i];
            require(band.count > 0, "Empty band");
            require(band.lo <= band.hi, "Band range inverted");

            // Bands must tile the published range: band 0 starts at the floor, each band
            // begins exactly one above the previous band's top, and the last ends at the
            // ceiling. This is the assertion that makes "no gap, no overlap" true rather
            // than claimed. Checking band 0 and then each successor's `lo` against its
            // predecessor's `hi` also rejects a duplicate range, which a sum check would not.
            if (i == 0) {
                require(band.lo == HASH_POWER_MIN, "First band must start at the floor");
            } else {
                require(band.lo == _bands[i - 1].hi + 1, "Bands must tile the range");
            }
            if (i == BAND_COUNT - 1) {
                require(band.hi == HASH_POWER_MAX, "Last band must end at the ceiling");
            }

            _remaining[i] = band.count;
            total += band.count;
        }
        require(total == MAX_SUPPLY, "Band counts must sum to the supply");
    }

    // ------------------------------------------------------------------------------ mint

    /// @notice Mint one Genesis Knight to `to`, rolling its band and hash power from the
    ///         published pool.
    /// @dev Rolls a band in proportion to what is *left* of it, so the published counts are
    ///      respected no matter how the mints are ordered. Rolling uniformly over bands would
    ///      let the scarce top band be exhausted early and the rest of the sale would have to
    ///      break its own promise; weighting by `_remaining` cannot.
    function ownerMint(address to) external onlyOwner returns (uint256 tokenId) {
        return _mintRolled(to);
    }

    /// @notice Mint `count` in one transaction, for a distribution run or a sale contract.
    function ownerMintBatch(address to, uint256 count) external onlyOwner {
        require(count > 0 && count <= 64, "Count out of range");
        for (uint256 i = 0; i < count; i++) {
            _mintRolled(to);
        }
    }

    /// @dev Shared, rather than `ownerMintBatch` calling `ownerMint` through `this`, which
    ///      would make the contract its own caller and fail `onlyOwner` on the second mint.
    function _mintRolled(address to) private returns (uint256 tokenId) {
        require(to != address(0), "Zero address: to");
        require(totalSupply() < MAX_SUPPLY, "Supply exhausted");

        uint256 pool = 0;
        for (uint8 i = 0; i < BAND_COUNT; i++) pool += _remaining[i];
        require(pool > 0, "No bands left");

        uint256 pick = Rng.below(rollNonce++, pool);
        uint8 bandIndex = 0;
        for (uint8 i = 0; i < BAND_COUNT; i++) {
            if (pick < _remaining[i]) {
                bandIndex = i;
                break;
            }
            pick -= _remaining[i];
        }

        Band memory band = _bands[bandIndex];
        uint16 hashPower = uint16(
            band.lo + Rng.below(rollNonce++, uint256(band.hi - band.lo) + 1)
        );
        _remaining[bandIndex] -= 1;

        tokenId = totalSupply() + 1;
        hashPowerOf[tokenId] = hashPower;
        bandIndexOf[tokenId] = bandIndex;
        _safeMint(to, tokenId);

        emit KnightMinted(to, tokenId, bandIndex, hashPower);
    }

    // ------------------------------------------------------------- what the game reads

    /// @notice The pair of facts anything on chain needs about a Genesis Knight: who owns it,
    ///         and how much hash power it carries.
    /// @dev `ownerOf` reverts for a token that does not exist, which is the right behaviour:
    ///      a non-existent knight should not read as "owned by nobody with zero power".
    function getGenesisKnightInfo(uint256 tokenId)
        external
        view
        returns (address owner, uint16 hashPower, uint8 bandIndex)
    {
        owner = ownerOf(tokenId);
        return (owner, hashPowerOf[tokenId], bandIndexOf[tokenId]);
    }

    /// @notice Staking weight for a token — the number `GenesisStaking` pays against.
    /// @dev Named to match `Knights.hashPowerOfToken`, because `StakingPool` holds one
    ///      collection of either kind behind one interface and a shared base cannot call two
    ///      differently-named getters. Adding the alias here is cheaper than making the base
    ///      abstract over the lookup, which is how a subtle bug would get into both pools.
    function hashPowerOfToken(uint256 tokenId) external view returns (uint16) {
        ownerOf(tokenId); // reverts for a knight that does not exist
        return hashPowerOf[tokenId];
    }

    /// @notice The published band table, in the same six rows as `lib/staking-config.js`.
    function bands() external view returns (Band[6] memory) {
        return _bands;
    }

    /// @notice How many rolls are left in each band. Zero remaining is a fact buyers can
    ///         watch, rather than something they learn from a support reply.
    function bandRemaining() external view returns (uint16[6] memory) {
        return _remaining;
    }

    function contractURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    function setBaseURI(string calldata baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
        emit BaseURISet(baseURI);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // ------------------------------------------------------------------ OZ v5 plumbing

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
