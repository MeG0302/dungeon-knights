// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Rng.sol";

/// @notice The vault pays and takes $DNG. Interface rather than import so this contract
///         compiles against any vault revision that keeps the same two calls.
interface IRewardVaultDeposit {
    function fund(uint256 amount) external;
}

/// @title Knights — the summonable collection: five tiers, two ways in, no ceiling.
///
/// @notice This is the collection the site mints into, with three things fixed that the live
///         contract got wrong.
///
/// **1. It is unlimited on purpose, and the cost is published rather than capped.** The
/// collection has no `MAX_SUPPLY`: knights come from capsules, summons and promises to
/// players, and a ceiling on the product's own faucet is a promise that has to be rationed
/// or broken. What an unlimited collection costs is a fact about *yield*, not about supply:
/// the two Knights lines in `RewardVault` are fixed shares of the weekly budget, so more
/// knights divide the same money and per-knight earnings keep falling — 5% of the reference
/// rate at 10,000 knights, 0.5% at 100,000, and no floor at any size. That direction of
/// travel is stated on `/tokenomics` and beside the stake button, because it is the honest
/// thing to do with an unbounded number.
///
///         **Genesis is unaffected by any of that**, and not by luck: the four reward lines
///         are fixed *shares*, so an uncapped collection cannot dilute the fixed one however
///         large it grows. That partition is what protects Genesis. A supply cap would have
///         been a second, weaker guard on a problem the vault had already solved.
///
/// **2. The tier table is on chain, and it is the published one.** The five rates
/// (12/20/36/60/100), the five daily caps (5/5/4/3/4), the five hash powers (15/25/36/45/100)
/// and the five drop rates (50/30/15/4/1%) all come from `lib/knights.js`, and
/// `tools/check-contracts.js` reads them back out of this source and fails when they differ.
/// The live contract holds a table the interface no longer agrees with, which is how a
/// player ends up reading one reward and receiving another.
///
/// **3. Enumerable.** The deployed collection answers `ownerOf` and `getKnightInfo` and
/// nothing else — no `totalSupply`, no `tokenOfOwnerByIndex` — so "which knights does this
/// wallet own" cannot be asked of it, and the site has to reconstruct it from `Transfer`
/// logs (see `lib/staking-chain.js`, which does exactly that, including the wallet whose 45
/// knights are ids 10–13, 22–55 and 67–74). Logs work, but a contract that can be asked is
/// better than a contract that must be inferred, and the cost here is one inheritance.
///
/// **Two ways in, and they are different prices for different things.** `summon()` charges
/// `SUMMON_PRICE_DNG` — the 500 DNG funding gate that the site has always advertised — and
/// rolls a tier at the published drop rates. `mintFromCapsule` is called by `Capsules` when
/// someone opens a capsule, which is a *different* price path (a rising DNG fee) and draws
/// from a different odds table, because a capsule rung raises its holder's floor rather than
/// only their ceiling. Both end up here, so a Knight is a Knight whatever door it came
/// through, and both pay their DNG into the same vault.
///
/// @dev There is no `setRarity` and no per-token override. A knight's tier is decided once,
///      at mint, and the table it was drawn from is a constant.
contract Knights is ERC721, ERC721Enumerable, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Rng for uint256;

    /// @notice On-chain tier order, and the order the game contract indexes by:
    ///         0 = Common … 4 = Legendary. Never reorder this — it is written into every
    ///         reward receipt the backend signs.
    uint8 public constant RARITY_COUNT = 5;

    /// @notice What a summon costs. `lib/reward-config.js#SUMMON_PRICE_DNG`.
    uint256 public constant SUMMON_PRICE = 500 ether;

    /// @notice DNG paid per clear, indexed by tier. The published table.
    uint256[5] public rarityReward;

    /// @notice Max runs per knight per day, indexed by tier. The published table.
    uint8[5] public dailyCap;

    /// @notice Staking weight per tier: `dailyCapacity / 4`, which is what makes the 90%
    ///         staking rule uniform across the collection instead of a per-tier accident.
    uint16[5] public rarityHashPower;

    /// @notice Drop rates in basis points: 50/30/15/4/1%.
    uint16[5] public tierDropBps;

    IERC20 public immutable dngToken;
    IRewardVaultDeposit public immutable rewardVault;

    /// @notice The only address allowed to mint as a capsule prize, set once.
    /// @dev `Capsules` needs this contract's address in its own constructor, so it cannot be
    ///      passed in here — the two would have to be deployed in the same transaction. It is
    ///      settable exactly once, which is the property that matters: after the wire-up
    ///      nobody, including the owner, can point capsule mints at a different collection.
    address public capsules;

    uint256 public rollNonce;
    string private _baseTokenURI;

    event Summoned(address indexed to, uint256 indexed tokenId, uint8 rarity);
    event CapsuleMinted(address indexed to, uint256 indexed tokenId, uint8 rarity);
    event CapsulesSet(address indexed capsules);
    event BaseURISet(string baseURI);

    constructor(address _dngToken, address _rewardVault)
        ERC721("Dungeon Knights", "DKN")
        Ownable(msg.sender)
    {
        require(_dngToken != address(0), "Zero address: dng");
        require(_rewardVault != address(0), "Zero address: vault");
        dngToken = IERC20(_dngToken);
        rewardVault = IRewardVaultDeposit(_rewardVault);

        // The published table, in on-chain tier order. `tools/check-contracts.js` compares
        // every one of these against `lib/knights.js`.
        rarityReward[0] = 12 ether;
        rarityReward[1] = 20 ether;
        rarityReward[2] = 36 ether;
        rarityReward[3] = 60 ether;
        rarityReward[4] = 100 ether;

        dailyCap[0] = 5;
        dailyCap[1] = 5;
        dailyCap[2] = 4;
        dailyCap[3] = 3;
        dailyCap[4] = 4;

        rarityHashPower[0] = 15;
        rarityHashPower[1] = 25;
        rarityHashPower[2] = 36;
        rarityHashPower[3] = 45;
        rarityHashPower[4] = 100;

        tierDropBps[0] = 5000;
        tierDropBps[1] = 3000;
        tierDropBps[2] = 1500;
        tierDropBps[3] = 400;
        tierDropBps[4] = 100;
    }

    // --------------------------------------------------------------------------- summon

    /// @notice Summon one knight for `SUMMON_PRICE` DNG, rolling its tier at the published
    ///         drop rates.
    /// @dev The 500 DNG is not revenue and is not burned: it is transferred **into the reward
    ///      vault**, which is the pool the same knight will later be paid from. That is what
    ///      "the funding gate" means here — the summon price is a deposit against the claims
    ///      the collection can make, not a fee taken out of the system.
    function summon() external nonReentrant returns (uint256 tokenId) {
        // Three steps, and the first one is not optional.
        //
        // `RewardVault.fund(amount)` collects from **`msg.sender`**, and inside that call the
        // sender is this contract — not the player. So the DNG has to be pulled in here first:
        // without this line the vault asks the collection for 500 DNG it has never held and the
        // whole call reverts `ERC20InsufficientBalance(address(knights))`, which is what the
        // deployed collection did. The player's approval is to **this** contract for exactly
        // that reason, and it goes unused without the pull that consumes it.
        //
        // The money does not rest here — it is approved onward and collected by the vault in the
        // same transaction, which is the point of the comment below: the vault's own accounting
        // sees the money arrive (`RewardVault.fund`) instead of a bare transfer appearing in it.
        dngToken.safeTransferFrom(msg.sender, address(this), SUMMON_PRICE);
        dngToken.forceApprove(address(rewardVault), SUMMON_PRICE);
        rewardVault.fund(SUMMON_PRICE);

        uint8 rarity = rollTier();
        tokenId = _mintTier(msg.sender, rarity);
        emit Summoned(msg.sender, tokenId, rarity);
    }

    /// @notice Mint a knight as a capsule prize. `Capsules` is the only caller.
    function mintFromCapsule(address to, uint8 rarity) external returns (uint256 tokenId) {
        require(msg.sender == capsules, "Only the capsule contract");
        require(to != address(0), "Zero address: to");
        require(rarity < RARITY_COUNT, "Bad rarity");

        tokenId = _mintTier(to, rarity);
        emit CapsuleMinted(to, tokenId, rarity);
    }

    function _mintTier(address to, uint8 rarity) private returns (uint256 tokenId) {
        tokenId = totalSupply() + 1;
        _safeMint(to, tokenId);
        rarityOf[tokenId] = rarity;
    }

    /// @notice Roll a tier at the published drop rates: cumulative basis points against a
    ///         single random draw in `[0, 10,000)`.
    function rollTier() public view returns (uint8) {
        uint256 pick = Rng.below(rollNonce, 10_000);
        uint256 cumulative = 0;
        for (uint8 i = 0; i < RARITY_COUNT; i++) {
            cumulative += tierDropBps[i];
            if (pick < cumulative) return i;
        }
        return 0; // unreachable while the drop rates sum to 10,000
    }

    // --------------------------------------------------------------- what the game reads

    /// @notice The tier of each token. Public because the game contract and the interface
    ///         both need it, and a getter is cheaper than a view function that wraps it.
    mapping(uint256 => uint8) public rarityOf;

    /// @notice The shape the game contract and the site already read from the live
    ///         collection — kept identical so V4 does not need a second interface.
    function getKnightInfo(uint256 tokenId)
        external
        view
        returns (address owner, uint8 rarity, string memory rarityName)
    {
        owner = ownerOf(tokenId);
        rarity = rarityOf[tokenId];
        return (owner, rarity, rarityNameOf(rarity));
    }

    function rarityNameOf(uint8 rarity) public pure returns (string memory) {
        if (rarity == 0) return "Common";
        if (rarity == 1) return "Uncommon";
        if (rarity == 2) return "Rare";
        if (rarity == 3) return "Epic";
        if (rarity == 4) return "Legendary";
        return "Unknown";
    }

    /// @notice Staking weight for a token — the number `KnightsStaking` pays against.
    function hashPowerOfToken(uint256 tokenId) external view returns (uint16) {
        return rarityHashPower[rarityOf[tokenId]];
    }

    // ------------------------------------------------------------------------ the owner

    function setCapsules(address _capsules) external onlyOwner {
        require(capsules == address(0), "Capsules already set");
        require(_capsules != address(0), "Zero address: capsules");
        capsules = _capsules;
        emit CapsulesSet(_capsules);
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
