// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title RewardVault
/// @notice The only place $DNG rewards come from.
///
/// The first two revisions of this economy published absolute rewards — "12 DNG a clear,
/// 300 for Genesis" — and never bounded the total. The bound was the token supply, and it
/// did not fit: at those rates the whole supply was 29.5 knight-years of play, a single day
/// of every Genesis Knight playing would have claimed more than the supply, and 200 free
/// capsules a week minted knights carrying 317x the supply in claim capacity. Nothing in
/// the design said what happens when more players arrive than the table was sized for,
/// because nothing in the design *could*.
///
/// This contract is the fix, and it is deliberately small. Four rules:
///
///   1. **One budget.** The vault releases `min(configuredWeeklyBudget, balance / MIN_WEEKS)`
///      per week. The second term is why the vault can never outlive itself: as it empties,
///      the release shrinks automatically, and no owner action and no bug can drain it in a
///      week.
///   2. **Four partitioned lines.** Genesis dungeon, Genesis staking, Knights dungeon,
///      Knights staking — each a fixed share of the budget. Because the shares are fixed,
///      an uncapped Knights collection can never dilute what Genesis was promised.
///   3. **A hard ceiling per line, per week.** A claim that would exceed its line reverts.
///      This is what converts the old economy's weakest assumption — that payouts would
///      stay near the level they were sized for — into something the chain enforces.
///   4. **One published scale.** `epochScale` is settled once a week from the burn the last
///      week actually produced. Every payout is `table x scale`, so when the crowd is larger
///      than the reference every published ratio — the tier ladder, the 90% staking rule,
///      the split between collections — survives intact at a lower level. It is capped at
///      1, because the published table is a maximum and never a promise to exceed.
///
/// The line shares and the budget are not invented here. They are derived in
/// `lib/reward-config.js` from the reference population, and `tools/check-token-math.js`
/// asserts that the constructor arguments this contract is deployed with are exactly the
/// derived ones.
contract RewardVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable dngToken;

    // ---------------------------------------------------------------- the four lines
    uint8 public constant LINE_COUNT = 4;
    uint8 public constant LINE_GENESIS_DUNGEON = 0;
    uint8 public constant LINE_GENESIS_STAKING = 1;
    uint8 public constant LINE_KNIGHTS_DUNGEON = 2;
    uint8 public constant LINE_KNIGHTS_STAKING = 3;

    uint16 public constant BPS = 10_000;

    /// @notice The weekly budget may never release more than `balance / MIN_WEEKS`.
    /// @dev Twelve weeks is a quarter of runway. It is a constant, not a setting, because
    ///      the ceiling is the safety property rather than a tuning knob.
    uint8 public constant MIN_WEEKS = 12;

    /// @notice Monday 2024-01-01 00:00 UTC — the same fixed epoch the interface computes
    ///         week numbers from, so the contract and the page cannot disagree about which
    ///         week it is.
    uint256 public constant WEEK_EPOCH = 1_704_067_200;
    uint256 public constant WEEK_SECONDS = 7 days;

    uint16[LINE_COUNT] public lineBps;
    uint256 public configuredWeeklyBudget;

    /// @notice The week the counters below refer to.
    uint256 public spendEpoch;
    uint256[LINE_COUNT] public spentThisWeek;

    /// @notice Total paid during the week that ended most recently, and the scale the
    ///         current week pays at. `epochScaleBps` starts at `BPS` (scale 1.0), so a vault
    ///         funded for the reference population pays the published table exactly.
    uint256 public lastWeekBurn;
    uint16 public epochScaleBps = BPS;

    /// @notice Who may charge a line — the game contract on the dungeon lines, the staking
    ///         contract on the staking lines. Kept explicit so a compromised caller cannot
    ///         spend a line it has nothing to do with.
    mapping(address => bool) public payers;

    event PayerSet(address indexed payer, bool allowed);
    event BudgetSet(uint256 weeklyBudget);
    event LineBpsSet(uint8 indexed line, uint16 bps);
    event EpochSettled(uint256 indexed epoch, uint256 burn, uint16 scaleBps, uint256 budget);
    event Paid(uint8 indexed line, address indexed to, uint256 amount);
    event Funded(address indexed from, uint256 amount);
    event TokensWithdrawn(address indexed to, uint256 amount);

    modifier onlyPayer() {
        require(payers[msg.sender], "Not a payer");
        _;
    }

    /// @param _dngToken            The $DNG token this vault pays in.
    /// @param _configuredBudget    The weekly budget at the reference population, in
    ///                             wei — `weeklyBudgetDng() x 1e18` from `lib/reward-config.js`.
    /// @param _lineBps             The four line shares in basis points, summing to 10,000.
    constructor(address _dngToken, uint256 _configuredBudget, uint16[LINE_COUNT] memory _lineBps)
        Ownable(msg.sender)
    {
        require(_dngToken != address(0), "Zero address: token");
        require(_configuredBudget > 0, "Zero budget");
        dngToken = IERC20(_dngToken);

        spendEpoch = currentWeek();
        configuredWeeklyBudget = _configuredBudget;
        _setLineBps(_lineBps);
    }

    // ------------------------------------------------------------------- the clock
    function weekIndex(uint256 timestamp) public pure returns (uint256) {
        if (timestamp < WEEK_EPOCH) return 0;
        return (timestamp - WEEK_EPOCH) / WEEK_SECONDS;
    }

    function currentWeek() public view returns (uint256) {
        return weekIndex(block.timestamp);
    }

    // ------------------------------------------------------------------ the budget
    function balance() public view returns (uint256) {
        return dngToken.balanceOf(address(this));
    }

    /// @notice `min(configuredWeeklyBudget, balance / MIN_WEEKS)`.
    /// @dev The published table is sized against the configured budget; this is the ceiling
    ///      that stops the vault promising what it does not hold.
    function weeklyBudget() public view returns (uint256) {
        uint256 runwayCeiling = balance() / MIN_WEEKS;
        return configuredWeeklyBudget < runwayCeiling ? configuredWeeklyBudget : runwayCeiling;
    }

    function lineBudget(uint8 line) public view returns (uint256) {
        require(line < LINE_COUNT, "Bad line");
        return (weeklyBudget() * lineBps[line]) / BPS;
    }

    function spent(uint8 line) public view returns (uint256) {
        require(line < LINE_COUNT, "Bad line");
        return _spent(line);
    }

    function lineRemaining(uint8 line) public view returns (uint256) {
        uint256 budget = lineBudget(line);
        uint256 used = _spent(line);
        return used >= budget ? 0 : budget - used;
    }

    function _spent(uint8 line) internal view returns (uint256) {
        return spendEpoch == currentWeek() ? spentThisWeek[line] : 0;
    }

    /// @notice Settle the week that has ended and publish the scale the new one pays at.
    ///
    /// Anyone may call this; it moves no money and reads only counters the vault already
    /// holds. `epochScale = min(1, budget / lastWeekBurn)` — capped at 1 deliberately, so
    /// the published table is a maximum: when participation falls the lines simply go
    /// under-spent and the vault lengthens its own runway, which is what a funded pool
    /// should do.
    function rollEpoch() public {
        uint256 week = currentWeek();
        if (week == spendEpoch) return;

        // The burn of the week that just ended. If the vault went unused for longer than a
        // week the intervening weeks really did pay nothing, so the last one did too.
        uint256 burn = week == spendEpoch + 1 ? _sum(spentThisWeek) : 0;

        lastWeekBurn = burn;
        spendEpoch = week;
        for (uint8 i = 0; i < LINE_COUNT; i++) spentThisWeek[i] = 0;

        uint256 budget = weeklyBudget();
        epochScaleBps = burn == 0 || budget >= burn
            ? BPS
            : uint16((budget * BPS) / burn);

        emit EpochSettled(week, burn, epochScaleBps, budget);
    }

    function _sum(uint256[LINE_COUNT] storage values) internal view returns (uint256 total) {
        for (uint8 i = 0; i < LINE_COUNT; i++) total += values[i];
    }

    // --------------------------------------------------------------------- paying
    /// @notice Charge `amount` against `line` and send it to `to`.
    /// @dev The two ceilings meet here: the line's weekly budget, and the token balance.
    ///      The balance check is not redundant with `weeklyBudget()` — a line's budget is
    ///      computed from the *whole* vault balance, so lines spent out of order can still
    ///      run the vault down before the week is over.
    function pay(uint8 line, address to, uint256 amount) external nonReentrant onlyPayer {
        require(line < LINE_COUNT, "Bad line");
        require(to != address(0), "Zero address: to");
        require(amount > 0, "Nothing to pay");

        rollEpoch();

        uint256 used = spentThisWeek[line];
        uint256 budget = lineBudget(line);
        require(used + amount <= budget, "Line budget exhausted");
        require(dngToken.balanceOf(address(this)) >= amount, "Vault empty");

        spentThisWeek[line] = used + amount;
        dngToken.safeTransfer(to, amount);

        emit Paid(line, to, amount);
    }

    /// @notice Scale a published table figure for the current week.
    function scaled(uint256 tableAmount) external view returns (uint256) {
        return (tableAmount * epochScaleBps) / BPS;
    }

    // ------------------------------------------------------------------ the owner
    function setPayer(address payer, bool allowed) external onlyOwner {
        payers[payer] = allowed;
        emit PayerSet(payer, allowed);
    }

    function setLineBps(uint16[LINE_COUNT] calldata _lineBps) external onlyOwner {
        _setLineBps(_lineBps);
    }

    /// @notice Change the weekly budget. Raising it does not raise what the vault can pay,
    ///         because `weeklyBudget()` is still capped by the balance.
    function setWeeklyBudget(uint256 _configuredBudget) external onlyOwner {
        configuredWeeklyBudget = _configuredBudget;
        emit BudgetSet(_configuredBudget);
    }

    function _setLineBps(uint16[LINE_COUNT] memory _lineBps) internal {
        uint256 total = 0;
        for (uint8 i = 0; i < LINE_COUNT; i++) {
            require(_lineBps[i] > 0, "Line share must be positive");
            total += _lineBps[i];
            lineBps[i] = _lineBps[i];
            emit LineBpsSet(i, _lineBps[i]);
        }
        require(total == BPS, "Line shares must sum to 100%");
    }

    // ------------------------------------------------------------------- funding
    function fund(uint256 amount) external nonReentrant {
        require(amount > 0, "Nothing to fund");
        dngToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    function withdrawTokens(uint256 amount) external onlyOwner nonReentrant {
        require(amount <= balance(), "More than the vault holds");
        dngToken.safeTransfer(owner(), amount);
        emit TokensWithdrawn(owner(), amount);
    }

    // ------------------------------------------------------------- what the UI reads
    /// @notice Everything the interface needs in one call: the budget, the scale, and how
    ///         much of each line is left this week. Served so the page never has to
    ///         reconstruct the arithmetic and get it subtly wrong.
    function state() external view returns (
        uint256 balanceDng,
        uint256 weeklyBudgetDng,
        uint256 lastWeekBurnDng,
        uint16 scaleBps,
        uint256 weekNumber,
        uint256[LINE_COUNT] memory lineBudgets,
        uint256[LINE_COUNT] memory lineSpent
    ) {
        uint256 budget = weeklyBudget();
        uint256 week = currentWeek();
        for (uint8 i = 0; i < LINE_COUNT; i++) {
            lineBudgets[i] = (budget * lineBps[i]) / BPS;
            lineSpent[i] = _spent(i);
        }
        return (balance(), budget, lastWeekBurn, epochScaleBps, week, lineBudgets, lineSpent);
    }
}
