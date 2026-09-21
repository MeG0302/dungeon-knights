// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Rng.sol";

/// @notice The slice of `Knights` a capsule open needs: the current size (which is where on
///         the price ramp we are) and the mint.
/// @dev There is deliberately no supply getter here. The collection has no ceiling, so a
///      price cannot be derived from "how full is it" — the ramp is measured against this
///      contract's own `PRICE_ANCHOR`, which is a schedule, not a limit.
interface IKnightsMint {
    function totalSupply() external view returns (uint256);
    function mintFromCapsule(address to, uint8 rarity) external returns (uint256);
}

interface IRewardVaultDeposit {
    function fund(uint256 amount) external;
}

/// @title Capsules — the weekly draw's prize, and the only faucet for Knights.
///
/// @notice A capsule is not an NFT of a knight: it is a claim on one, with the tier decided
///         when it is opened. Four rungs exist, and each raises its holder's **floor** as
///         well as their ceiling — a Common Capsule can still produce a Legendary, but a
///         Prime Capsule cannot produce a Common. That is the property that makes the rungs
///         worth valuing differently, and it is why the odds tables are not one table.
///
/// The four tables are `lib/staking-config.js#CAPSULE_TYPES`, and they are checked at
/// construction for the two things that make an odds table safe:
///
///   1. **Every rung sums to exactly 100%.** A table that sums to 98% silently hands the
///      remainder to whatever the code falls through to, which is how a "1% Legendary"
///      becomes something else.
///   2. **Every outcome is a tier the reward contracts can pay.** This is not decoration:
///      an earlier revision of this economy listed a *Mythic* capsule, and a Mythic knight
///      has no reward slot in `DungeonKnightsGameV4` — it would have minted a token that
///      reverts on every claim, forever. The constructor refuses to deploy such a table.
///
/// **The open price rises, then flattens.** Capsules are the collection's growth, and a flat
/// fee cannot price a growing collection: 200 capsules a week compounds the Knights supply
/// about 20% a week early on, while a 500-DNG open funds around 2% of the weekly budget, so
/// per-Knight payouts would fall roughly ten-fold a year. The price instead ramps linearly
/// with the collection's size — 500 DNG when empty to 5,000 DNG at `PRICE_ANCHOR` — and the
/// crossover is worth knowing because it is the point from which the faucet funds itself:
/// **from roughly 5,700 Knights on, the 200 weekly opens alone cover the whole Knights
/// lines.** `tools/check-token-math.js` asserts that crossover against this same formula.
///
/// Above the anchor the price is flat, which is a decision rather than an oversight: the
/// collection has no supply ceiling, so a ramp that kept climbing would have no end and no
/// published top. Flat at 5,000 DNG means the ten-thousandth knight and the hundred-thousandth
/// cost the same to reveal, while the yield each one earns is smaller — the pressure a growing
/// supply is supposed to feel lands on the buyer's expected return rather than on a wall.
///
/// **Every DNG paid goes into the reward vault**, not to an address that spends it. Opening
/// a capsule is a depositor, in the only sense the economy has one.
///
/// @dev There is deliberately **no owner mint**. Every capsule in existence came out of a
///      weekly draw, and `mint` is restricted to the raffle contract. An owner mint would be
///      an unbounded faucet beside a capped collection, and the cap would then mean nothing.
contract Capsules is ERC1155, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Rng for uint256;

    uint8 public constant TYPE_COUNT = 4;
    uint8 public constant RARITY_COUNT = 5;
    uint16 private constant BPS = 10_000;

    /// @notice The open price at an empty collection, and at the anchor. `reward-config.js`
    ///         derives these as 500 → 5,000 across `KNIGHTS_REFERENCE_SIZE`.
    uint256 public constant OPEN_PRICE_BASE = 500 ether;
    uint256 public constant OPEN_PRICE_TOP = 5_000 ether;

    /// @notice The collection size the ramp is measured against — **not a supply limit**.
    ///         The collection is unlimited; at and beyond this size the price is the flat top.
    ///         Matches `lib/staking-config.js#KNIGHTS_REFERENCE_SIZE`, and
    ///         `tools/check-contracts.js` compares the two.
    uint256 public constant PRICE_ANCHOR = 10_000;

    /// @notice How many capsules one transaction may open. Not a policy — a ceiling on the
    ///         loop, so a single call cannot be made to run out of gas halfway through and
    ///         leave the caller with burnt capsules and fewer knights than they paid for.
    uint256 public constant MAX_OPEN_PER_TX = 20;

    struct Odds {
        uint8 length;
        uint8[5] tiers;
        uint16[5] bps;
    }

    Odds[TYPE_COUNT] private _odds;

    /// @notice Capsule id → name. Ids are 1-based and match the `id` field in
    ///         `lib/staking-config.js#CAPSULE_TYPES`, so the page and the chain agree on
    ///         which rung is which without a lookup table anywhere.
    mapping(uint256 => string) private _typeName;

    IERC20 public immutable dngToken;
    IRewardVaultDeposit public immutable rewardVault;
    IKnightsMint public immutable knights;

    /// @notice The only address allowed to mint capsules, set once — the draw.
    address public raffle;

    uint256 public rollNonce;
    string private _uri;

    event CapsuleOpened(
        address indexed player,
        uint256 indexed capsuleId,
        uint256 amount,
        uint256 paidDng
    );
    event KnightRevealed(address indexed player, uint256 indexed tokenId, uint8 rarity);
    event RaffleMinted(address indexed to, uint256 indexed capsuleId, uint256 amount);
    event RaffleSet(address indexed raffle);
    event URISet(string uri);

    constructor(
        address _dngToken,
        address _rewardVault,
        address _knights,
        string memory initialUri
    ) ERC1155(initialUri) Ownable(msg.sender) {
        require(_dngToken != address(0), "Zero address: dng");
        require(_rewardVault != address(0), "Zero address: vault");
        require(_knights != address(0), "Zero address: knights");

        dngToken = IERC20(_dngToken);
        rewardVault = IRewardVaultDeposit(_rewardVault);
        knights = IKnightsMint(_knights);
        _uri = initialUri;

        // The published rungs. Order is the config's: 1 Common, 2 Rare, 3 Legendary, 4 Prime.
        _addType(1, "Common Capsule", 5, [uint8(0), 1, 2, 3, 4], [uint16(6000), 2500, 1000, 400, 100]);
        _addType(2, "Rare Capsule", 4, [uint8(1), 2, 3, 4, 0], [uint16(3000), 4000, 2000, 1000, 0]);
        _addType(3, "Legendary Capsule", 3, [uint8(2), 3, 4, 0, 0], [uint16(2000), 4000, 4000, 0, 0]);
        _addType(4, "Prime Capsule", 2, [uint8(3), 4, 0, 0, 0], [uint16(3000), 7000, 0, 0, 0]);
    }

    /// @dev Registering a rung, with the two invariants that make an odds table safe. A
    ///      zero-probability row is allowed because the fixed-size arrays need padding, but
    ///      it can never be rolled — `length` bounds the walk.
    function _addType(
        uint256 id,
        string memory name,
        uint8 length,
        uint8[5] memory tiers,
        uint16[5] memory bps
    ) private {
        require(length > 0 && length <= RARITY_COUNT, "Bad odds length");

        uint256 total = 0;
        for (uint8 i = 0; i < length; i++) {
            require(tiers[i] < RARITY_COUNT, "Outcome has no reward slot");
            require(bps[i] > 0, "Zero-probability outcome inside the table");
            total += bps[i];
        }
        require(total == BPS, "Odds must sum to 100%");

        Odds storage table = _odds[id - 1];
        table.length = length;
        table.tiers = tiers;
        table.bps = bps;
        _typeName[id] = name;
    }

    // ------------------------------------------------------------------------ opening

    /// @notice What one capsule costs right now, per capsule, in wei.
    /// @dev Linear in the collection's size up to `PRICE_ANCHOR` — 500 DNG empty, 5,000 DNG at
    ///      the anchor — and flat above it. The *size* is read from the collection rather than
    ///      mirrored here, so the price cannot disagree with the supply that justifies it; the
    ///      anchor is not, because it is a property of this schedule and not of the collection.
    function openPrice() public view returns (uint256) {
        uint256 minted = knights.totalSupply();
        if (minted >= PRICE_ANCHOR) return OPEN_PRICE_TOP;
        return OPEN_PRICE_BASE + ((OPEN_PRICE_TOP - OPEN_PRICE_BASE) * minted) / PRICE_ANCHOR;
    }

    /// @notice Burn `amount` capsules of one rung, pay the fee, and reveal that many knights.
    /// @dev The order matters and is deliberate: validate everything, burn the capsules, take
    ///      the money into the vault, then mint. A failure after the burn reverts the whole
    ///      transaction, so there is no window in which capsules are gone and nothing was
    ///      revealed — which is what makes the burn-first order safe rather than reckless.
    ///
    ///      The fee is pulled from the caller before it is handed on, and that line is load
    ///      bearing: `RewardVault.fund` collects from `msg.sender`, which inside that call is
    ///      this contract. Without the pull the vault asks the capsule contract for DNG it has
    ///      never held and the call reverts — the player's approval goes unused.
    function open(uint256 capsuleId, uint256 amount) external nonReentrant {
        require(capsuleId >= 1 && capsuleId <= TYPE_COUNT, "Unknown capsule");
        require(amount > 0 && amount <= MAX_OPEN_PER_TX, "Amount out of range");

        uint256 cost = openPrice() * amount;
        Odds storage table = _odds[capsuleId - 1];

        _burn(msg.sender, capsuleId, amount);

        dngToken.safeTransferFrom(msg.sender, address(this), cost);
        dngToken.forceApprove(address(rewardVault), cost);
        rewardVault.fund(cost);

        for (uint256 i = 0; i < amount; i++) {
            uint8 rarity = _rollOutcome(table);
            uint256 tokenId = knights.mintFromCapsule(msg.sender, rarity);
            emit KnightRevealed(msg.sender, tokenId, rarity);
        }

        emit CapsuleOpened(msg.sender, capsuleId, amount, cost);
    }

    /// @dev Weighted pick against the rung's own cumulative basis points. The `length` bound
    ///      means padded zero rows are never reached.
    function _rollOutcome(Odds storage table) private returns (uint8) {
        uint256 pick = Rng.below(rollNonce++, BPS);
        uint256 cumulative = 0;
        for (uint8 i = 0; i < table.length; i++) {
            cumulative += table.bps[i];
            if (pick < cumulative) return table.tiers[i];
        }
        return table.tiers[0]; // unreachable while the table sums to 10,000
    }

    // ------------------------------------------------------------------- the draw mints

    /// @notice Mint capsules to a winner. `RaffleContract` is the only caller.
    function mint(address to, uint256 capsuleId, uint256 amount) external {
        require(msg.sender == raffle, "Only the raffle");
        require(to != address(0), "Zero address: to");
        require(capsuleId >= 1 && capsuleId <= TYPE_COUNT, "Unknown capsule");
        require(amount > 0, "Nothing to mint");

        _mint(to, capsuleId, amount, "");
        emit RaffleMinted(to, capsuleId, amount);
    }

    // -------------------------------------------------------------- what the UI reads

    /// @notice A rung's odds, as `(tiers, bps, length)`. Served from the chain so the page
    ///         and the buyer's expectation are the same table, not two copies of it.
    function odds(uint256 capsuleId)
        external
        view
        returns (uint8[5] memory tiers, uint16[5] memory bps, uint8 length)
    {
        require(capsuleId >= 1 && capsuleId <= TYPE_COUNT, "Unknown capsule");
        Odds storage o = _odds[capsuleId - 1];
        return (o.tiers, o.bps, o.length);
    }

    function typeName(uint256 capsuleId) external view returns (string memory) {
        require(capsuleId >= 1 && capsuleId <= TYPE_COUNT, "Unknown capsule");
        return _typeName[capsuleId];
    }

    function setRaffle(address _raffle) external onlyOwner {
        require(raffle == address(0), "Raffle already set");
        require(_raffle != address(0), "Zero address: raffle");
        raffle = _raffle;
        emit RaffleSet(_raffle);
    }

    function setURI(string calldata newUri) external onlyOwner {
        _uri = newUri;
        _setURI(newUri);
        emit URISet(newUri);
    }

    function uri(uint256) public view override returns (string memory) {
        return _uri;
    }
}
