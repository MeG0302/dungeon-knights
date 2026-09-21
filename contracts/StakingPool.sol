// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Everything `StakingPool` needs from either collection: who owns a knight, how much
///         hash power it carries, and the ability to hold it.
interface IStakableCollection is IERC721 {
    function hashPowerOfToken(uint256 tokenId) external view returns (uint16);
}

/// @notice The part of `RewardVault` a staking pool uses. `lineRemaining` is the important
///         one: it is how a claim finds out that this week's line is already spent.
interface IRewardVaultLines {
    function pay(uint8 line, address to, uint256 amount) external;
    function lineRemaining(uint8 line) external view returns (uint256);
    function lineBudget(uint8 line) external view returns (uint256);
    function scaled(uint256 tableAmount) external view returns (uint256);
    function epochScaleBps() external view returns (uint16);
}

/// @title StakingPool — one vault line, one collection, paid pro rata by hash power and time.
///
/// @notice Both staking products are the same machine pointed at different lines, so the
///         machine is written once. `GenesisStaking` adds the raffle ticket ledger;
///         `KnightsStaking` adds nothing, because the uncapped collection earns yield and
///         nothing else — the draw is Genesis-only, by design and not by omission.
///
/// **The knight is held, not merely flagged.** Staking transfers the NFT into this contract
/// and unstaking transfers it back. That is a real decision with a visible cost — a staked
/// knight is not in the owner's wallet, cannot be sold, and cannot be sent into a dungeon —
/// and it is the right one, for three reasons:
///
///   - **The alternative double-pays.** The published rule is "staking pays 90% of what
///     playing does", which only means something if staking is the *alternative* to playing.
///     A knight that could do both would earn 190%, and the four vault lines are separate
///     budgets, so no ceiling would ever notice.
///   - **Ownership stops being ambiguous.** A flagged stake keeps earning for whoever
///     staked it after the NFT is sold, unless the contract is told about every transfer —
///     which needs an ERC-721 hook on the *collection*, and the collection is a separate
///     contract that a marketplace transfer never tells us about.
///   - **It is legible.** "Staked" is a fact you can verify against the collection's own
///     `ownerOf`, not a row in this contract's storage that could be wrong.
///
/// **How the yield is computed.** The pool accrues at the rate the vault publishes for its
/// line — `lineBudget(line)` after the weekly scale, divided across the week — pro rata to
/// hash power, using the standard cumulative-per-unit accumulator:
///
///     accPerHp += elapsed * ratePerSecond * 1e18 / totalHashPower
///
/// **What that means for the 168-hour cap.** `lib/staking-config.js` caps a stake's tickets
/// at 168 hours so "parking forever must not be strictly better than playing". For yield the
/// cap is structural rather than a counter: the rate is *one week's* line, so a stake that
/// sits for a month earns exactly one week's worth each week — never more, and never
/// compounding. The cap needs enforcing explicitly only on the ticket side, where the raffle
/// wants a number to be proportional to, and `GenesisStaking` does that there.
///
/// @dev Rate freshness, stated plainly because it is the one approximation here. The pool
///      accrues at whatever rate was last read from the vault, and the rate is re-read
///      whenever anyone touches the pool. The vault's own budget can change without this
///      contract being called — its balance changes when dungeon claims are paid — so between
///      touches the accrual uses a slightly stale rate. `sync()` is public and costs one
///      transaction for anyone, so the gap is bounded by patience rather than by design, and
///      it is the same approximation every accumulator of this shape makes.
abstract contract StakingPool is Ownable2Step, ReentrancyGuard {
    IStakableCollection public immutable collection;
    IRewardVaultLines public immutable rewardVault;

    /// @notice Which of the vault's four lines pays this pool.
    uint8 public immutable vaultLine;

    uint256 public constant WEEK_SECONDS = 7 days;
    uint256 public constant ACC_PRECISION = 1e18;

    struct Stake {
        uint16 hp; // hash power locked in
        uint64 stakedAt; // when it went in
        address staker; // who it belongs to — always the previous owner
    }

    /// @notice One stake per knight. A knight is either staked or it is not; there is no
    ///         second position to keep in sync.
    mapping(uint256 => Stake) public stakes;

    /// @notice The knights each wallet has staked, so the interface can list them without
    ///         reading logs and `claim` can settle them in one pass.
    mapping(address => uint256[]) private _stakedBy;
    mapping(uint256 => uint256) private _stakedIndex; // tokenId → position in _stakedBy, +1

    /// @notice Total hash power in the pool, and therefore the denominator of every share.
    uint256 public totalHashPower;

    /// @notice DNG accrued per unit of hash power, cumulative, scaled by `ACC_PRECISION`.
    ///         Monotonic: it is never reset, which is what lets an untouched stake be settled
    ///         correctly at any later time.
    uint256 public accPerHp;

    /// @notice What each stake had already been credited when it was last touched.
    mapping(uint256 => uint256) public stakeDebt;

    /// @notice Rewards already settled to a wallet that the vault line could not pay yet.
    ///         Unstaking moves a stake's accrual here, so a wallet's earnings survive the
    ///         unstake instead of being forfeited.
    mapping(address => uint256) public claimable;

    uint256 public lastAccruedAt;
    uint256 public lastRatePerSecond;

    event Staked(address indexed staker, uint256 indexed tokenId, uint16 hashPower);
    event Unstaked(address indexed staker, uint256 indexed tokenId, uint16 hashPower);
    event Claimed(address indexed staker, uint256 amount);
    event RateSynced(uint256 ratePerSecond);

    constructor(address _collection, address _vault, uint8 _line) Ownable(msg.sender) {
        require(_collection != address(0), "Zero address: collection");
        require(_vault != address(0), "Zero address: vault");
        require(_line < 4, "Bad vault line");

        collection = IStakableCollection(_collection);
        rewardVault = IRewardVaultLines(_vault);
        vaultLine = _line;
        lastAccruedAt = block.timestamp;
        lastRatePerSecond = _currentRatePerSecond();
    }

    // --------------------------------------------------------------------------- staking

    /// @notice Stake a knight, transferring it into this contract.
    function stake(uint256 tokenId) external nonReentrant {
        require(collection.ownerOf(tokenId) == msg.sender, "Not your knight");
        require(stakes[tokenId].hp == 0, "Already staked");

        uint16 hp = collection.hashPowerOfToken(tokenId);
        require(hp > 0, "Knight has no hash power");

        _updatePool();

        stakes[tokenId] = Stake({ hp: hp, stakedAt: uint64(block.timestamp), staker: msg.sender });
        stakeDebt[tokenId] = _debtFor(hp);
        totalHashPower += hp;
        _addToWallet(msg.sender, tokenId);
        _onStake(msg.sender, tokenId, hp);

        collection.transferFrom(msg.sender, address(this), tokenId);

        emit Staked(msg.sender, tokenId, hp);
    }

    /// @notice Unstake a knight, settling its accrual and transferring it back.
    /// @dev Anyone may pay for the `_updatePool` call inside; only the staker may unstake.
    function unstake(uint256 tokenId) external nonReentrant {
        Stake memory position = stakes[tokenId];
        require(position.staker == msg.sender, "Not the staker");
        require(position.hp > 0, "Not staked");

        _updatePool();

        // Settled before the position is removed, so the final partial interval is paid at
        // the rate that was live during it rather than at whatever comes next.
        claimable[msg.sender] += _accruedSinceDebt(position.hp, stakeDebt[tokenId]);

        totalHashPower -= position.hp;
        delete stakes[tokenId];
        delete stakeDebt[tokenId];
        _removeFromWallet(msg.sender, tokenId);
        _onUnstake(msg.sender, tokenId, position.hp);

        collection.transferFrom(address(this), msg.sender, tokenId);

        emit Unstaked(msg.sender, tokenId, position.hp);
    }

    /// @notice Re-read the vault's rate without staking, unstaking or claiming.
    /// @dev Permissionless on purpose: the accrual rate is the one thing here that goes stale
    ///      on its own, and the fix should not require holding a knight or a position of
    ///      trust. Anyone can call this, and anyone who notices a stale rate should.
    function sync() external {
        _updatePool();
        emit RateSynced(lastRatePerSecond);
    }

    // ------------------------------------------------------------------------- claiming

    /// @notice Pay out everything this wallet has accrued, up to what the line can pay now.
    /// @dev Clamped rather than reverting. The vault's line has a weekly ceiling, and the
    ///      honest reading of a claim that exceeds it is "not yet", not "you cannot have your
    ///      money": the shortfall stays in `claimable` and is paid on a later call. Reverting
    ///      would leave a player with a claim that is impossible to make *and* no way to see
    ///      why, and the pool's rate is one week's line, so in steady state the queue drains.
    function claim() external nonReentrant returns (uint256 paid) {
        _updatePool();
        _settle(msg.sender);

        uint256 owed = claimable[msg.sender];
        require(owed > 0, "Nothing to claim");

        uint256 remaining = rewardVault.lineRemaining(vaultLine);
        require(remaining > 0, "This week's line is already spent");

        paid = owed > remaining ? remaining : owed;
        claimable[msg.sender] = owed - paid;
        rewardVault.pay(vaultLine, msg.sender, paid);

        emit Claimed(msg.sender, paid);
    }

    /// @dev Move a wallet's live accrual into `claimable`, so it can be paid later.
    function _settle(address wallet) private {
        uint256[] storage held = _stakedBy[wallet];
        for (uint256 i = 0; i < held.length; i++) {
            uint256 tokenId = held[i];
            Stake storage position = stakes[tokenId];
            if (position.hp == 0) continue;
            uint256 earned = _accruedSinceDebt(position.hp, stakeDebt[tokenId]);
            stakeDebt[tokenId] = _debtFor(position.hp);
            claimable[wallet] += earned;
        }
    }

    /// @dev Hooks, so a subclass can keep its own ledger in step without reimplementing
    ///      `stake`/`unstake`. `GenesisStaking` needs them for its ticket segments; returning
    ///      the yield engine's invariants to a subclass is how the two would drift.
    function _onStake(address wallet, uint256 tokenId, uint16 hp) internal virtual {}

    function _onUnstake(address wallet, uint256 tokenId, uint16 hp) internal virtual {}

    // ---------------------------------------------------------------------- the accrual

    function _debtFor(uint256 hp) private view returns (uint256) {
        return (hp * accPerHp) / ACC_PRECISION;
    }

    function _accruedSinceDebt(uint256 hp, uint256 debt) private view returns (uint256) {
        uint256 owed = _debtFor(hp);
        return owed > debt ? owed - debt : 0;
    }

    /// @dev The rate the vault publishes right now for this pool's line, per second.
    ///      `scaled` applies the vault's weekly epoch scale, so when the crowd outgrows the
    ///      budget every staker's rate falls by the same factor — the same rule the dungeon
    ///      payouts follow, rather than a second one invented here.
    function _currentRatePerSecond() internal view returns (uint256) {
        uint256 weekly = rewardVault.scaled(rewardVault.lineBudget(vaultLine));
        return weekly / WEEK_SECONDS;
    }

    function _updatePool() internal {
        uint256 elapsed = block.timestamp - lastAccruedAt;
        if (elapsed > 0 && totalHashPower > 0 && lastRatePerSecond > 0) {
            accPerHp += (elapsed * lastRatePerSecond * ACC_PRECISION) / totalHashPower;
        }
        lastAccruedAt = block.timestamp;
        lastRatePerSecond = _currentRatePerSecond();
    }

    // ------------------------------------------------------------------ what the UI reads

    /// @notice What `wallet` could be paid right now if the line were not a limit.
    function pending(address wallet) public view returns (uint256 total) {
        total = claimable[wallet];

        uint256 accNow = _accNow();
        uint256[] storage held = _stakedBy[wallet];
        for (uint256 i = 0; i < held.length; i++) {
            Stake storage position = stakes[held[i]];
            if (position.hp == 0) continue;
            uint256 owed = (position.hp * accNow) / ACC_PRECISION;
            if (owed > stakeDebt[held[i]]) total += owed - stakeDebt[held[i]];
        }
    }

    /// @notice What `claim()` would actually pay: `pending` capped by the line's remainder.
    ///         Two numbers rather than one, because they are usually equal and unequal for a
    ///         reason the player is entitled to see.
    function claimableNow(address wallet) external view returns (uint256) {
        uint256 owed = pending(wallet);
        uint256 remaining = rewardVault.lineRemaining(vaultLine);
        return owed > remaining ? remaining : owed;
    }

    function stakedCount(address wallet) external view returns (uint256) {
        return _stakedBy[wallet].length;
    }

    function stakedTokens(address wallet) external view returns (uint256[] memory) {
        return _stakedBy[wallet];
    }

    /// @notice This pool's live rate, in DNG per day, for the interface to display without
    ///         reconstructing the vault's arithmetic.
    function ratePerDay() external view returns (uint256) {
        return _currentRatePerSecond() * 1 days;
    }

    function vaultState() external view returns (uint256 lineBudget, uint256 lineRemaining, uint16 scaleBps) {
        return (
            rewardVault.lineBudget(vaultLine),
            rewardVault.lineRemaining(vaultLine),
            rewardVault.epochScaleBps()
        );
    }

    /// @dev `accPerHp` as it would be right now, without writing anything.
    function _accNow() private view returns (uint256) {
        uint256 elapsed = block.timestamp - lastAccruedAt;
        if (elapsed == 0 || totalHashPower == 0 || lastRatePerSecond == 0) return accPerHp;
        return accPerHp + (elapsed * lastRatePerSecond * ACC_PRECISION) / totalHashPower;
    }

    // ------------------------------------------------------------------------- plumbing

    function _addToWallet(address wallet, uint256 tokenId) private {
        _stakedBy[wallet].push(tokenId);
        _stakedIndex[tokenId] = _stakedBy[wallet].length; // 1-based so 0 means "absent"
    }

    /// @dev Swap-and-pop, so the list stays dense and `_settle`'s loop has no holes in it.
    function _removeFromWallet(address wallet, uint256 tokenId) private {
        uint256 index = _stakedIndex[tokenId];
        if (index == 0) return;
        uint256 last = _stakedBy[wallet].length - 1;
        uint256 at = index - 1;
        if (at != last) {
            uint256 moved = _stakedBy[wallet][last];
            _stakedBy[wallet][at] = moved;
            _stakedIndex[moved] = at + 1;
        }
        _stakedBy[wallet].pop();
        delete _stakedIndex[tokenId];
    }
}
