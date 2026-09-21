// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title DNGToken — the reward token, with no way to make more of it.
///
/// @notice One billion $DNG, minted once at construction into the four published buckets,
///         and then never again. There is deliberately **no owner, no mint, no pause and no
///         blacklist** on this contract: the only privileged act in the token's life is the
///         construction call that splits the supply, and after that the contract has no
///         admin surface at all. A reward token whose issuer can mint is a promise with a
///         footnote, and the footnote is always the same one.
///
/// The split is `lib/reward-config.js#DISTRIBUTION`, and it is a constant here rather than a
/// constructor argument so the numbers a buyer reads and the numbers the chain mints cannot
/// be different:
///
///   bucket             share    custody
///   Reward vault        45%      `RewardVault` — the only bucket that gets spent
///   Liquidity           30%      DEX LP, locked 12 months
///   Treasury            15%      multisig, released quarterly
///   Marketing           10%      multisig, no cliff and no vesting
///   Team                 0%      there is no team allocation
///
/// Two of those deserve saying out loud, because both are absences:
///
///   - **Team is 0%.** The 15% treasury is the whole budget for operations and development.
///     A vesting schedule that does not exist is worse than one that does, because it
///     invites the reader to assume it does.
///   - **Marketing is unvested.** It is therefore the one bucket that can reach the market
///     from day one. Since there is no lock to point at, the spend cadence has to be
///     disclosed instead — `WHITEPAPER.md` §5.2 — and the token cannot enforce good
///     behaviour it never claimed to have.
///
/// The 45% going to the vault is what makes the published reward table affordable: the vault
/// releases `min(configuredWeeklyBudget, balance / 12 weeks)`, so the funded supply is a
/// runway measured in years rather than a number that runs out without warning. See
/// `RewardVault.sol`.
///
/// @dev Named `DNGToken` rather than `DungeonKnightsToken` because that is the name that
///      appears in `docs/`, in Remix's contract dropdown and in the deploy checklists, and a
///      contract whose name does not match the document that tells you to deploy it is its
///      own small trap.
contract DNGToken is ERC20 {
    /// @notice 1,000,000,000 DNG, fixed. Matches `lib/reward-config.js#DNG_SUPPLY`.
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    /// @notice Basis points, so a share is stated the way the rest of the system states it.
    uint16 private constant BPS = 10_000;

    uint8 public constant BUCKET_COUNT = 4;

    struct Bucket {
        string name;
        address holder;
        uint16 bps;
        uint256 amount;
    }

    Bucket[] private _buckets;

    event BucketFunded(uint8 indexed index, string name, address indexed holder, uint256 amount);

    /// @param rewardVault The `RewardVault` — 45%, the only bucket that gets spent.
    /// @param liquidity   The LP custody address — 30%.
    /// @param treasury    The treasury multisig — 15%.
    /// @param marketing   The marketing/community multisig — 10%.
    ///
    /// @dev Every address is required to be non-zero. A zero address here is not a typo that
    ///      costs a redeploy: it is a fifth of the supply burned on arrival, and the failure
    ///      is silent because `balanceOf(0)` reads 0 and nothing reverts.
    constructor(
        address rewardVault,
        address liquidity,
        address treasury,
        address marketing
    ) ERC20("Dungeon Knights Gold", "DNG") {
        _addBucket("Reward vault", rewardVault, 4500);
        _addBucket("Liquidity", liquidity, 3000);
        _addBucket("Treasury", treasury, 1500);
        _addBucket("Marketing / community", marketing, 1000);

        uint256 minted = 0;
        for (uint8 i = 0; i < _buckets.length; i++) {
            uint256 amount = (MAX_SUPPLY * _buckets[i].bps) / BPS;
            _buckets[i].amount = amount;
            _mint(_buckets[i].holder, amount);
            minted += amount;
            emit BucketFunded(i, _buckets[i].name, _buckets[i].holder, amount);
        }

        // The loop above cannot fail to mint the whole supply unless a share is wrong, and a
        // wrong share is the one thing here nobody would notice by reading a balance. The
        // assertion makes "1,000,000,000 minted, in four pieces" a fact the deploy proved.
        require(minted == MAX_SUPPLY, "Supply not fully minted");
    }

    function _addBucket(string memory name, address holder, uint16 bps) private {
        require(holder != address(0), "Zero address: bucket holder");
        require(bps > 0, "Zero bucket share");
        _buckets.push(Bucket({ name: name, holder: holder, bps: bps, amount: 0 }));
    }

    // ------------------------------------------------------------------ what the UI reads

    /// @notice The whole distribution in one call: names, holders, shares and amounts.
    function distribution() external view returns (Bucket[] memory) {
        return _buckets;
    }

    function bucketCount() external view returns (uint256) {
        return _buckets.length;
    }

    /// @notice The four published shares, in basis points, as the source of truth for the
    ///         constructor above. A pure function rather than a constant array because
    ///         Solidity has no array constants, and a second home for these numbers is
    ///         exactly what `tools/check-contracts.js` exists to prevent.
    function bucketShares() external pure returns (uint16[4] memory) {
        return [uint16(4500), uint16(3000), uint16(1500), uint16(1000)];
    }
}
