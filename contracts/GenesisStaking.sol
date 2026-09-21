// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StakingPool.sol";

/// @title GenesisStaking — vault line 1, plus the raffle's ticket ledger.
///
/// @notice Yield is identical to the Knights side; the difference is that Genesis Knights
///         also earn **tickets**, and tickets are the only entry to the weekly draw. Nothing
///         here mints capsules — `RaffleContract` reads this contract's ticket numbers and
///         decides. Keeping the two apart is what makes the draw auditable: the numbers it
///         acts on are a public view on a contract it does not control.
///
/// **Tickets are time, and they stop at 168 hours.**
///
///     tickets = floor(min(stakedHours, 168) × hashPower)
///
/// A knight banks exactly its hash power per hour staked, which is why a band's range is its
/// yield range. The 168-hour cap is what stops "park forever" from being strictly better than
/// playing: a stake that never moves earns one week's worth of tickets per week and no more.
/// Because a week *is* 168 hours, the arithmetic below implements the cap structurally — a
/// stake's overlap with one week is at most 168 hours, so the `min` can only bind when a
/// caller asks about a span longer than a week, which the week clock never does.
///
/// **The ledger is segments, not a running total.** Every stake opens a segment `(tokenId,
/// hashPower, from, to)` and unstaking closes it, so a week's tickets can be recomputed
/// exactly at any time — including for weeks that have already closed. A running counter
/// could not do that: it would know what a wallet has earned *now*, and a draw needs to know
/// what a wallet earned *in the week being drawn*, after the fact.
///
/// @dev Line 1 of `RewardVault` is `genesisStaking`, a fixed share of the weekly budget. The
///      staking line is `0.9 ×` the dungeon line by construction (`reward-config.js`), so
///      staking pays 90% of what playing does — expressed per collection, which is what makes
///      it survive a change in participation instead of only holding at the reference.
contract GenesisStaking is StakingPool {
    /// @notice `RewardVault.LINE_GENESIS_STAKING`.
    uint8 public constant GENESIS_STAKING_LINE = 1;

    /// @notice A stake stops earning tickets after a week. Stated in the interface, not
    ///         hidden: a player who leaves a knight parked should be told it has plateaued.
    uint256 public constant TICKET_CAP_HOURS = 168;

    uint256 public constant TICKET_CAP_SECONDS = TICKET_CAP_HOURS * 1 hours;

    /// @notice Monday 2024-01-01 00:00 UTC. The same fixed epoch `RewardVault` counts its
    ///         budget weeks from and the interface computes week numbers from, so the
    ///         contract, the vault and the page cannot disagree about which week it is.
    uint256 public constant WEEK_EPOCH = 1_704_067_200;

    struct Segment {
        uint256 tokenId;
        uint16 hp;
        uint64 from;
        uint64 to; // 0 while the stake is open
    }

    mapping(address => Segment[]) private _segments;

    /// @notice Every wallet that has ever staked, append-only.
    /// @dev The raffle has to find every participant to draw fairly, and a `mapping` cannot
    ///      be enumerated. A registry is what makes the draw possible on chain at all — and
    ///      it is bounded, because Genesis is: at most 1,024 knights mean at most 1,024
    ///      stakes, so the set the draw must walk can never grow past the collection.
    address[] private _stakers;
    mapping(address => bool) public isStaker;

    event SegmentOpened(address indexed staker, uint256 indexed tokenId, uint16 hp, uint64 from);
    event SegmentClosed(address indexed staker, uint256 indexed tokenId, uint16 hp, uint64 to);

    constructor(address genesisNFT, address vault)
        StakingPool(genesisNFT, vault, GENESIS_STAKING_LINE)
    {}

    // ------------------------------------------------------------------ ticket bookkeeping

    function _onStake(address wallet, uint256 tokenId, uint16 hp) internal override {
        _segments[wallet].push(
            Segment({ tokenId: tokenId, hp: hp, from: uint64(block.timestamp), to: 0 })
        );
        if (!isStaker[wallet]) {
            isStaker[wallet] = true;
            _stakers.push(wallet);
        }
        emit SegmentOpened(wallet, tokenId, hp, uint64(block.timestamp));
    }

    function _onUnstake(address wallet, uint256 tokenId, uint16 hp) internal override {
        Segment[] storage segments = _segments[wallet];
        for (uint256 i = segments.length; i > 0; i--) {
            Segment storage segment = segments[i - 1];
            if (segment.tokenId == tokenId && segment.to == 0) {
                segment.to = uint64(block.timestamp);
                emit SegmentClosed(wallet, tokenId, hp, uint64(block.timestamp));
                return;
            }
        }
    }

    // -------------------------------------------------------------------- tickets, exactly

    /// @notice The first second of week `week`.
    function weekStart(uint256 week) public pure returns (uint256) {
        return WEEK_EPOCH + week * WEEK_SECONDS;
    }

    function weekEnd(uint256 week) public pure returns (uint256) {
        return weekStart(week) + WEEK_SECONDS;
    }

    /// @notice The week containing `timestamp`.
    function weekOf(uint256 timestamp) public pure returns (uint256) {
        if (timestamp < WEEK_EPOCH) return 0;
        return (timestamp - WEEK_EPOCH) / WEEK_SECONDS;
    }

    function currentWeek() external view returns (uint256) {
        return weekOf(block.timestamp);
    }

    /// @notice Tickets a wallet holds for week `week`, recomputed from its segments.
    /// @dev Deliberately a pure function of recorded history rather than a counter. The draw
    ///      runs after a week has closed, so the number has to be reproducible *after* the
    ///      fact; anything derived from "now" would give a different answer each time it was
    ///      asked, and a raffle whose odds move while you look at them is not a raffle.
    ///      A segment that is still open is cut at the end of the week rather than at now,
    ///      so a live stake's closed-week tickets stop growing when the week does.
    function ticketsInWeek(uint256 week, address wallet) public view returns (uint256 tickets) {
        uint256 start = weekStart(week);
        uint256 end = weekEnd(week);
        Segment[] storage segments = _segments[wallet];

        for (uint256 i = 0; i < segments.length; i++) {
            Segment storage segment = segments[i];
            if (segment.from >= end) continue; // opened after the week ended

            uint256 from = segment.from > start ? segment.from : start;
            uint256 to = segment.to == 0 ? end : (segment.to < end ? segment.to : end);
            if (to <= from) continue;

            uint256 span = to - from;
            if (span > TICKET_CAP_SECONDS) span = TICKET_CAP_SECONDS;

            tickets += (span * segment.hp) / 1 hours;
        }
    }

    /// @notice Tickets a wallet holds for the week that is running right now.
    function ticketsThisWeek(address wallet) external view returns (uint256) {
        return ticketsInWeek(weekOf(block.timestamp), wallet);
    }

    /// @notice Tickets still available to a stake in the current week: what it would earn if
    ///         it stayed staked to the end. The interface shows this next to "capped", so
    ///         "168 hours" is a visible plateau rather than a surprise.
    function ticketsRemainingThisWeek(address wallet) external view returns (uint256 earned, uint256 total) {
        uint256 week = weekOf(block.timestamp);
        earned = ticketsInWeek(week, wallet);

        Segment[] storage segments = _segments[wallet];
        for (uint256 i = 0; i < segments.length; i++) {
            Segment storage segment = segments[i];
            if (segment.from >= weekEnd(week)) continue;
            uint256 from = segment.from > weekStart(week) ? segment.from : weekStart(week);
            if (from >= weekEnd(week)) continue;
            uint256 span = weekEnd(week) - from;
            if (span > TICKET_CAP_SECONDS) span = TICKET_CAP_SECONDS;
            total += (span * segment.hp) / 1 hours;
        }
    }

    // ---------------------------------------------------------------- the staker registry

    function stakerCount() external view returns (uint256) {
        return _stakers.length;
    }

    function stakerAt(uint256 index) external view returns (address) {
        require(index < _stakers.length, "Index out of range");
        return _stakers[index];
    }

    function segmentsOf(address wallet) external view returns (Segment[] memory) {
        return _segments[wallet];
    }
}
