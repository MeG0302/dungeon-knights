// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Rng — one honest place for "random", with the limits written down.
///
/// @notice Every random choice in this system — which hash-power band a Genesis Knight
///         rolls, which tier a capsule reveals — comes through here, so the honesty note
///         lives in one file instead of being rediscovered in three.
///
/// **What this is.** `block.prevrandao` (the beacon value the proposer commits to),
/// `block.timestamp`, the caller and a per-contract counter, hashed together. It is
/// unpredictable to the *caller* in the sense that they cannot choose the output they get:
/// they can only choose whether to send the transaction now or later.
///
/// **What this is not.** It is not immune to a validator who is also a player. A proposer
/// can see `prevrandao` for their own block and can decline to include a transaction, so a
/// miner/validator with enough patience can nudge an outcome — the standard failure of every
/// on-chain RNG of this shape. The remedy is a commit–reveal or an oracle (Chainlink VRF),
/// and neither is in place.
///
/// **Why it is acceptable here anyway, and where it would not be.** The tiers this decides
/// are worth a few hundred DNG and the rolls are not a single high-value draw: the cost of
/// manipulating one roll is a block, and the reward is a marginal upgrade on one knight.
/// The same trade would be wrong for something like a rare-supply auction, and it is worth
/// being explicit that the *weekly raffle* is the one place this reasoning is thinner — see
/// `RaffleContract.sol`, which mixes in a settled block hash for that reason.
library Rng {
    /// @notice A number that the caller cannot choose, from the given extra entropy.
    /// @dev `extra` should be unique per call — a counter that increments on every mint is
    ///      the usual choice — because two calls in one block with the same `extra` would
    ///      return the same value, and a batch mint would then hand out identical knights.
    function roll(uint256 extra) internal view returns (uint256) {
        return uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao,
                    block.timestamp,
                    block.number,
                    msg.sender,
                    extra
                )
            )
        );
    }

    /// @notice `roll`, brought into `[0, bound)`. Zero bound returns zero rather than
    ///         dividing by zero, so a caller cannot be tricked by an empty pool into a revert
    ///         it cannot explain.
    function below(uint256 extra, uint256 bound) internal view returns (uint256) {
        if (bound == 0) return 0;
        return roll(extra) % bound;
    }
}
