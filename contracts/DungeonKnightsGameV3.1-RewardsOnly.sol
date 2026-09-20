// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IKnightNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getKnightInfo(uint256 tokenId)
        external view returns (address owner, uint8 rarity, string memory rarityName);
}

/**
 * @title DungeonKnightsGameV3.1 - Pure Reward Distribution (QUARANTINED)
 * @notice DO NOT DEPLOY. This variant originally removed the per-knight daily cap, which
 *         let a single call repeat one knight id up to 50 x 15 times and drain the whole
 *         treasury in one transaction (security report Finding 2). The daily cap and lazy
 *         day rollover have since been restored so the source is no longer catastrophic,
 *         but it still has no gameplay validation and remains superseded by
 *         DungeonKnightsGameV4.sol. Kept only for history; not a deployment candidate.
 * @dev Claims verify ownership and enforce a per-knight daily cap. No run tracking.
 */
contract DungeonKnightsGameV3_1 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IKnightNFT public immutable knightNFT;
    IERC20 public immutable dngToken;

    bool public paused;

    uint8 public constant RARITY_COUNT = 5;
    uint256 public constant MAX_BATCH = 50;
    uint256 public constant RESET_HOUR_UTC = 12; // daily reset at 12:00 UTC

    // Rarity-based rewards (owner can adjust)
    mapping(uint256 => uint256) public rarityReward;

    // Max runs per knight per UTC day, indexed by rarity (report Finding 2 fix)
    uint8[RARITY_COUNT] public dailyCap;

    struct KnightState {
        uint32 dayIndex;      // which reset-day runsUsed refers to
        uint8  runsUsed;      // runs consumed during dayIndex
        uint256 totalClaimed; // lifetime DNG, 18 decimals
    }
    mapping(uint256 => KnightState) public knightState;

    struct RunData {
        uint256[] knightIds;
        uint256 dungeonId;
    }

    event DungeonCompleted(
        address indexed player,
        uint256 indexed knightId,
        uint256 indexed dungeonId,
        uint8 rarity,
        uint256 reward,
        uint256 timestamp
    );

    event RewardsClaimed(
        address indexed player,
        uint256 amount,
        uint256 runsCount,
        uint256 knightCount
    );

    event RarityRewardUpdated(uint8 rarity, uint256 reward);
    event DailyCapUpdated(uint8 rarity, uint8 cap);
    event PausedSet(bool paused);
    event Funded(address indexed from, uint256 amount);
    event TokensWithdrawn(address indexed to, uint256 amount);

    constructor(address _knightNFT, address _dngToken) Ownable(msg.sender) {
        require(_knightNFT != address(0), "Zero address: knightNFT");
        require(_dngToken != address(0), "Zero address: dngToken");

        knightNFT = IKnightNFT(_knightNFT);
        dngToken = IERC20(_dngToken);

        // Default rewards per rarity
        rarityReward[0] = 10 ether;   // Common: 10 DNG
        rarityReward[1] = 17 ether;   // Uncommon: 17 DNG
        rarityReward[2] = 30 ether;   // Rare: 30 DNG
        rarityReward[3] = 75 ether;   // Epic: 75 DNG
        rarityReward[4] = 150 ether;  // Legendary: 150 DNG

        // Daily run limits (restored)
        dailyCap[0] = 5; // Common
        dailyCap[1] = 5; // Uncommon
        dailyCap[2] = 4; // Rare
        dailyCap[3] = 3; // Epic
        dailyCap[4] = 4; // Legendary
    }

    /// @notice Reset-day index. Day rolls over at 12:00 UTC.
    function currentDayIndex() public view returns (uint32) {
        return uint32((block.timestamp - (RESET_HOUR_UTC * 1 hours)) / 1 days);
    }

    function runsRemaining(uint256 knightId) public view returns (uint8) {
        (, uint8 rarity, ) = knightNFT.getKnightInfo(knightId);
        require(rarity < RARITY_COUNT, "Invalid rarity");

        KnightState storage ks = knightState[knightId];
        uint32 today = currentDayIndex();

        if (ks.dayIndex != today) return dailyCap[rarity];
        if (ks.runsUsed >= dailyCap[rarity]) return 0;
        return dailyCap[rarity] - ks.runsUsed;
    }

    /// @notice Batch claim rewards for multiple dungeon completions
    /// @dev Enforces ownership and the per-knight daily cap. No gameplay proof.
    /// @param runs Array of dungeon runs to claim
    function batchClaimRewards(RunData[] calldata runs) external nonReentrant {
        require(!paused, "Paused");
        require(runs.length > 0, "No runs");
        require(runs.length <= MAX_BATCH, "Too many runs");

        uint32 today = currentDayIndex();
        uint256 totalReward = 0;
        uint256 totalKnights = 0;

        for (uint256 i = 0; i < runs.length; i++) {
            RunData calldata run = runs[i];

            require(run.knightIds.length > 0, "No knights");
            require(run.knightIds.length <= 15, "Too many knights per run");

            // Process each knight in this run
            for (uint256 j = 0; j < run.knightIds.length; j++) {
                uint256 knightId = run.knightIds[j];

                require(
                    knightNFT.ownerOf(knightId) == msg.sender,
                    "Not your knight"
                );

                // Get knight rarity to calculate reward
                (, uint8 rarity, ) = knightNFT.getKnightInfo(knightId);
                require(rarity < RARITY_COUNT, "Invalid rarity");

                KnightState storage ks = knightState[knightId];

                // Roll the day over lazily
                if (ks.dayIndex != today) {
                    ks.dayIndex = today;
                    ks.runsUsed = 0;
                }

                require(ks.runsUsed < dailyCap[rarity], "No runs left today");

                uint256 reward = rarityReward[rarity];

                ks.runsUsed += 1;
                ks.totalClaimed += reward;

                totalReward += reward;
                totalKnights += 1;

                emit DungeonCompleted(
                    msg.sender,
                    knightId,
                    run.dungeonId,
                    rarity,
                    reward,
                    block.timestamp
                );
            }
        }

        // Verify treasury has enough and transfer
        require(
            dngToken.balanceOf(address(this)) >= totalReward,
            "Treasury empty"
        );
        dngToken.safeTransfer(msg.sender, totalReward);

        emit RewardsClaimed(msg.sender, totalReward, runs.length, totalKnights);
    }

    // ---- Views ----

    /// @notice Get lifetime DNG claimed across all runs for a knight
    function getKnightTotalClaimed(uint256 knightId) external view returns (uint256) {
        return knightState[knightId].totalClaimed;
    }

    /// @notice Check contract treasury balance
    function treasuryBalance() external view returns (uint256) {
        return dngToken.balanceOf(address(this));
    }

    // ---- Owner Functions ----

    /// @notice Update reward for a rarity tier
    function setRarityReward(uint8 rarity, uint256 reward) external onlyOwner {
        require(rarity < RARITY_COUNT, "Invalid rarity");
        rarityReward[rarity] = reward;
        emit RarityRewardUpdated(rarity, reward);
    }

    /// @notice Update the per-day run cap for a rarity tier
    function setDailyCap(uint8 rarity, uint8 cap) external onlyOwner {
        require(rarity < RARITY_COUNT, "Invalid rarity");
        dailyCap[rarity] = cap;
        emit DailyCapUpdated(rarity, cap);
    }

    /// @notice Pause/unpause claims
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    /// @notice Fund the contract treasury
    function fundContract(uint256 amount) external nonReentrant onlyOwner {
        dngToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    /// @notice Emergency withdrawal
    function withdrawTokens(uint256 amount) external nonReentrant onlyOwner {
        dngToken.safeTransfer(msg.sender, amount);
        emit TokensWithdrawn(msg.sender, amount);
    }

    /// @notice Withdraw all tokens
    function withdrawAllTokens() external nonReentrant onlyOwner {
        uint256 balance = dngToken.balanceOf(address(this));
        dngToken.safeTransfer(msg.sender, balance);
        emit TokensWithdrawn(msg.sender, balance);
    }
}
