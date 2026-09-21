// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ICapsuleMinter {
    function mint(address to, uint256 capsuleId, uint256 amount) external;
}

/// @notice The ticket ledger, read from `GenesisStaking`. Nothing here trusts a number the
///         raffle was handed: every ticket total is recomputed by the staking contract from
///         its own segment history, so the draw acts on figures it does not control.
interface ITicketLedger {
    function stakerCount() external view returns (uint256);
    function stakerAt(uint256 index) external view returns (address);
    function ticketsInWeek(uint256 week, address wallet) external view returns (uint256);
    function weekOf(uint256 timestamp) external pure returns (uint256);
    function weekEnd(uint256 week) external pure returns (uint256);
}

/// @title RaffleContract — 200 capsules a week, drawn from Genesis tickets.
///
/// @notice Once a week the stakers of the Genesis collection share out `CAPSULES_PER_WEEK`
///         capsules in proportion to their tickets. Tickets come from `GenesisStaking` and
///         nowhere else, and the draw is computed on chain, so the outcome is checkable by
///         anyone who can read the ledger.
///
/// **The draw is two phases, and both are permissionless.** A weighted draw needs every
/// participant's ticket count, and there is no way to learn those without visiting them, so
/// the work is split:
///
///   1. `creditPage(week, count)` walks a page of the staker registry and records each
///      staker's tickets for the closed week, building a cumulative range table. Paged
///      because the registry is walked from storage and one transaction cannot walk an
///      unbounded list — though it *is* bounded here: Genesis is 1,024 knights, so the set
///      can never exceed 1,024, and most weeks it is a small fraction of that.
///   2. `runDraw(week)` runs once every staker is credited. It copies the range table into
///      memory, then picks each capsule by drawing a random ticket and binary-searching the
///      table for the ticket's owner.
///
/// **Why the randomness is stated with its limits.** The seed mixes `block.prevrandao`, the
/// previous block's hash and the week. That is stronger than the mint rolling in `Rng.sol`
/// because a capsule is worth more than one knight and because a proposer who wants to bias
/// the draw has to do it against a value committed in a block they may not produce. It is
/// still **not** a VRF: a validator who controls a block *and* holds tickets can choose
/// between candidate seeds, and the honest fix is a commit–reveal or an oracle. Two things
/// bound the damage meanwhile: the draw can only run once per week, and the seed is public
/// after the fact, so the manipulation is visible rather than hidden.
///
/// **What a winner gets is a claim, not an airdrop.** `runDraw` records capsules owed per
/// winner and mints nothing, because writing to 200 winners' balances inside the draw is the
/// kind of loop that runs out of gas at the worst moment. Winners call `claim`, which is a
/// small transaction that mints exactly what they won.
///
/// @dev The per-week stock split across the four capsule rungs is a **constructor argument**,
///      and it is enforced to total exactly `CAPSULES_PER_WEEK`. The split is still an open
///      question in `lib/staking-config.js`; what is not open is the total, and the contract
///      makes the total impossible to inflate by a later owner call, because there is no
///      setter for it.
contract RaffleContract is Ownable2Step, ReentrancyGuard {
    uint8 public constant CAPSULE_TYPE_COUNT = 4;

    /// @notice Capsules handed out per weekly draw. `lib/staking-config.js`.
    uint256 public constant CAPSULES_PER_WEEK = 200;

    /// @notice Stakers visited per `creditPage` call. Bounds a page's gas so the draw cannot
    ///         be made un-runnable by a registry that grew.
    uint256 public constant PAGE_LIMIT = 100;

    ICapsuleMinter public immutable capsules;
    ITicketLedger public immutable ticketLedger;

    /// @notice How the 200 are split across the four rungs: index 0 is capsule id 1.
    uint256[4] private _weeklyStock;

    // --------------------------------------------------------------------- credit state
    mapping(uint256 => uint256) public creditCursor;
    mapping(uint256 => uint256) public totalTickets;
    mapping(uint256 => bool) public credited;
    mapping(uint256 => bool) public drawn;

    /// @dev The range table for a week: entry `i` owns tickets `(ends[i-1], ends[i]]`. Two
    ///      parallel arrays rather than an array of structs, because both are copied into
    ///      memory in the draw and flat arrays copy in one operation.
    mapping(uint256 => uint256[]) private _rangeEnds;
    mapping(uint256 => address[]) private _rangeOwners;

    /// @notice Capsules owed to a wallet for a week, by capsule id (index 0 is id 1).
    mapping(uint256 => mapping(address => uint256[4])) public capsulesOwed;

    uint256 public drawNonce;

    event StakerCredited(uint256 indexed week, address indexed staker, uint256 tickets, uint256 cumulative);
    event WeekCredited(uint256 indexed week, uint256 stakers, uint256 totalTickets);
    event Drawn(uint256 indexed week, uint256 capsules, uint256 totalTickets, uint256 winners);
    event CapsulesClaimed(uint256 indexed week, address indexed winner, uint256 capsuleId, uint256 amount);

    /// @param _capsuleContract The `Capsules` contract the prizes come from.
    /// @param _ticketLedger    `GenesisStaking`, which owns the ticket arithmetic.
    /// @param stock            The per-rung split of the 200. Must sum to exactly 200.
    constructor(address _capsuleContract, address _ticketLedger, uint256[4] memory stock)
        Ownable(msg.sender)
    {
        require(_capsuleContract != address(0), "Zero address: capsules");
        require(_ticketLedger != address(0), "Zero address: ledger");

        capsules = ICapsuleMinter(_capsuleContract);
        ticketLedger = ITicketLedger(_ticketLedger);

        uint256 sum = 0;
        for (uint8 i = 0; i < CAPSULE_TYPE_COUNT; i++) sum += stock[i];
        require(sum == CAPSULES_PER_WEEK, "Stock must total 200 capsules");

        _weeklyStock = stock;
    }

    // ------------------------------------------------------------------------ phase one

    /// @notice Credit the next `count` stakers in the registry with their tickets for `week`.
    /// @dev Permissionless, and safe to call by anyone: the numbers written are read from the
    ///      staking contract, not supplied by the caller. A page can only ever write what the
    ///      ledger already says, which is what makes an open-ended, multi-transaction phase
    ///      acceptable — a caller cannot pick the winners by choosing what to credit.
    function creditPage(uint256 week, uint256 count) external {
        require(!credited[week], "Week already credited");
        require(week < ticketLedger.weekOf(block.timestamp), "Week has not closed");
        require(count > 0 && count <= PAGE_LIMIT, "Page size out of range");

        uint256 stakers = ticketLedger.stakerCount();
        uint256 cursor = creditCursor[week];
        if (cursor == 0 && stakers > 0) {
            // The table is append-only within a week; clear it the first time a week is
            // credited so a re-run after an unrelated revert cannot double-count.
            delete _rangeEnds[week];
            delete _rangeOwners[week];
        }

        uint256 stop = cursor + count;
        if (stop > stakers) stop = stakers;

        uint256 cumulative = totalTickets[week];
        for (uint256 i = cursor; i < stop; i++) {
            address staker = ticketLedger.stakerAt(i);
            uint256 tickets = ticketLedger.ticketsInWeek(week, staker);
            if (tickets > 0) {
                cumulative += tickets;
                _rangeEnds[week].push(cumulative);
                _rangeOwners[week].push(staker);
            }
            emit StakerCredited(week, staker, tickets, cumulative);
        }

        creditCursor[week] = stop;
        totalTickets[week] = cumulative;

        if (stop >= stakers) {
            credited[week] = true;
            emit WeekCredited(week, stop, cumulative);
        }
    }

    // ------------------------------------------------------------------------ phase two

    /// @notice Draw one closed week's capsules and record who won what.
    /// @dev Requires every staker credited. That requirement is the crux: a partial table
    ///      would silently omit whoever had not been visited yet, and a draw that skips
    ///      stakers is worse than one that has not happened.
    function runDraw(uint256 week) external nonReentrant {
        require(credited[week], "Not every staker is credited yet");
        require(!drawn[week], "Week already drawn");

        uint256 pool = totalTickets[week];
        require(pool > 0, "Nobody held tickets");

        drawn[week] = true;

        uint256[] memory ends = _rangeEnds[week];
        address[] memory owners = _rangeOwners[week];

        uint256 awarded = 0;
        uint256 winners = 0;

        for (uint8 capsuleType = 0; capsuleType < CAPSULE_TYPE_COUNT; capsuleType++) {
            uint256 stock = _weeklyStock[capsuleType];
            for (uint256 n = 0; n < stock; n++) {
                uint256 ticket = _randomTicket(week, awarded) % pool;
                address winner = owners[_findRange(ends, ticket)];
                capsulesOwed[week][winner][capsuleType] += 1;
                awarded += 1;
                winners += 1;
            }
        }

        emit Drawn(week, awarded, pool, winners);
    }

    /// @dev Binary search: the first cumulative end strictly greater than the drawn ticket.
    ///      `upperBound` rather than a linear scan because the table can hold as many entries
    ///      as there are stakers, and 200 draws against 1,024 entries would otherwise be a
    ///      quarter of a million storage iterations.
    function _findRange(uint256[] memory ends, uint256 ticket) private pure returns (uint256) {
        uint256 low = 0;
        uint256 high = ends.length - 1;
        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (ends[mid] > ticket) high = mid;
            else low = mid + 1;
        }
        return low;
    }

    /// @dev The seed, and its limits, are described in the contract header. `awarded` is in
    ///      the mix so that 200 capsules in one transaction do not all draw from the same
    ///      value — without it the first pick would repeat for every capsule.
    function _randomTicket(uint256 week, uint256 ordinal) private returns (uint256) {
        uint256 seed = uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao,
                    blockhash(block.number - 1),
                    block.timestamp,
                    week,
                    ordinal,
                    drawNonce++
                )
            )
        );
        return seed;
    }

    // --------------------------------------------------------------------------- claiming

    /// @notice Mint the capsules this wallet won in `week`, by rung.
    /// @dev Ids are 1-based and match `lib/staking-config.js#CAPSULE_TYPES`; index 0 here is
    ///      capsule id 1 there.
    function claim(uint256 week, uint256 capsuleId) external nonReentrant returns (uint256 amount) {
        require(capsuleId >= 1 && capsuleId <= CAPSULE_TYPE_COUNT, "Unknown capsule");
        require(drawn[week], "That week has not been drawn");

        uint256 slot = capsuleId - 1;
        amount = capsulesOwed[week][msg.sender][slot];
        require(amount > 0, "Nothing was won");

        capsulesOwed[week][msg.sender][slot] = 0;
        capsules.mint(msg.sender, capsuleId, amount);

        emit CapsulesClaimed(week, msg.sender, capsuleId, amount);
    }

    // ---------------------------------------------------------------- what the UI reads

    function weeklyStock() external view returns (uint256[4] memory) {
        return _weeklyStock;
    }

    function rangeCount(uint256 week) external view returns (uint256) {
        return _rangeEnds[week].length;
    }

    /// @notice Everything the interface needs about a week in one call.
    function drawState(uint256 week)
        external
        view
        returns (
            uint256 stakersCredited,
            uint256 totalStakers,
            uint256 weekTickets,
            bool isCredited,
            bool isDrawn
        )
    {
        return (
            creditCursor[week],
            ticketLedger.stakerCount(),
            totalTickets[week],
            credited[week],
            drawn[week]
        );
    }

    /// @notice What a wallet won in a week, across all four rungs.
    function owedFor(uint256 week, address wallet) external view returns (uint256[4] memory) {
        return capsulesOwed[week][wallet];
    }

    /// @notice The week currently being drawn, and whether it can be.
    function currentDrawWeek() external view returns (uint256 week, bool closed) {
        uint256 now_ = ticketLedger.weekOf(block.timestamp);
        return (now_ > 0 ? now_ - 1 : 0, now_ > 0);
    }
}
