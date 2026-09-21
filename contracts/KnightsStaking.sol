// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StakingPool.sol";

/// @title KnightsStaking — vault line 3, yield only.
///
/// @notice The uncapped collection stakes for a share of the Knights staking line and earns
///         **no raffle tickets**. That is the whole difference between the two collections,
///         and it is deliberate rather than an omission left in place: the raffle is the
///         Genesis collection's premium, and awarding its capsules to a collection that can
///         be minted without limit would price the premium at zero.
///
/// The two staking lines are separate fixed shares of the weekly budget, so a Knights staker
/// cannot dilute what Genesis was promised and vice versa. Within the Knights line, share is
/// by hash power and time, exactly as on the Genesis side — one engine, two lines.
///
/// @dev A staked knight is held by this contract, so `DungeonKnightsGameV4` will not accept it
///      in a run: its owner is not the player. That is the intended reading of the published
///      90% rule — staking is the *alternative* to playing, not an addition to it. The
///      interface says so beside the stake button; a knight staked here must be unstaked
///      before it can be sent into a dungeon.
contract KnightsStaking is StakingPool {
    /// @notice `RewardVault.LINE_KNIGHTS_STAKING`.
    uint8 public constant KNIGHTS_STAKING_LINE = 3;

    constructor(address knightsNFT, address vault)
        StakingPool(knightsNFT, vault, KNIGHTS_STAKING_LINE)
    {}
}
