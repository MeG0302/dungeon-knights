// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IKnightNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getKnightInfo(uint256 tokenId)
        external view returns (address owner, uint8 rarity, string memory rarityName);
}

/// @title DungeonKnightsGameV3 - Simple Batch Claims
/// @notice Batch claiming without cooldowns - no backend required!
/// @dev Play multiple dungeons, claim all in one transaction
///
/// @custom:security WARNING — UNSIGNED CLAIMS (report Finding 1).
///         `batchClaimRewards` pays out on a client-supplied run list with no proof a
///         dungeon was played, so any knight owner can extract their full daily cap
///         without playing. This source is retained only for the deployed testnet
///         address; do NOT redeploy it. Use `DungeonKnightsGameV4.sol` (backend-signed
///         runs) for any new deployment, and pause this deployment once players migrate.
contract DungeonKnightsGameV3 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IKnightNFT public immutable knightNFT;
    IERC20  public immutable dngToken;

    uint8 public constant RARITY_COUNT     = 5;
    uint256 public constant MAX_BATCH      = 50;    // Can claim up to 50 runs at once
    uint256 public constant RESET_HOUR_UTC = 12;    // Daily reset at 12:00 UTC

    /// @notice DNG paid per completed run, indexed by rarity. 18 decimals.
    /// @dev 0=common, 1=uncommon, 2=rare, 3=epic, 4=legendary
    uint256[RARITY_COUNT] public rarityReward;

    /// @notice Max runs per knight per UTC day, indexed by rarity.
    uint8[RARITY_COUNT] public dailyCap;

    struct KnightState {
        uint32  dayIndex;      // which reset-day runsUsed refers to
        uint8   runsUsed;      // runs consumed during dayIndex
        uint256 totalClaimed;  // lifetime DNG, 18 decimals
    }
    mapping(uint256 => KnightState) public knightState;

    bool public paused;

    event DungeonCompleted(
        address indexed player,
        uint256 indexed knightId,
        uint256 indexed dungeonId,
        uint8   rarity,
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

    struct RunData {
        uint256[] knightIds;  // Knights that completed this run
        uint256 dungeonId;    // Which dungeon (1=Crypts, 2=Mines, etc.)
    }

    constructor(address _knightNFT, address _dngToken) Ownable(msg.sender) {
        require(_knightNFT != address(0), "Zero address: knightNFT");
        require(_dngToken != address(0), "Zero address: dngToken");
        
        knightNFT = IKnightNFT(_knightNFT);
        dngToken  = IERC20(_dngToken);

        // Rarity rewards (must match characters.js)
        rarityReward[0] =  10 ether; // Common
        rarityReward[1] =  17 ether; // Uncommon
        rarityReward[2] =  30 ether; // Rare
        rarityReward[3] =  75 ether; // Epic
        rarityReward[4] = 150 ether; // Legendary

        // Daily run limits
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
        require(rarity < RARITY_COUNT, "Bad rarity");
        
        KnightState storage ks = knightState[knightId];
        uint32 today = currentDayIndex();
        
        if (ks.dayIndex != today) return dailyCap[rarity];
        if (ks.runsUsed >= dailyCap[rarity]) return 0;
        return dailyCap[rarity] - ks.runsUsed;
    }

    /// @notice Batch claim rewards for multiple dungeon completions
    /// @dev No cooldowns, no signatures - just validates ownership and daily limits
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
            require(run.knightIds.length <= 15, "Too many knights");

            // Process each knight in this run
            for (uint256 j = 0; j < run.knightIds.length; j++) {
                uint256 knightId = run.knightIds[j];

                require(
                    knightNFT.ownerOf(knightId) == msg.sender, 
                    "Not your knight"
                );

                (, uint8 rarity, ) = knightNFT.getKnightInfo(knightId);
                require(rarity < RARITY_COUNT, "Bad rarity");

                KnightState storage ks = knightState[knightId];

                // Roll the day over lazily
                if (ks.dayIndex != today) {
                    ks.dayIndex = today;
                    ks.runsUsed = 0;
                }

                require(ks.runsUsed < dailyCap[rarity], "No runs left today");

                uint256 reward = rarityReward[rarity];

                ks.runsUsed    += 1;
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

        require(
            dngToken.balanceOf(address(this)) >= totalReward,
            "Treasury empty"
        );
        dngToken.safeTransfer(msg.sender, totalReward);

        emit RewardsClaimed(msg.sender, totalReward, runs.length, totalKnights);
    }

    // ---- Views ----

    function getKnightStats(uint256 knightId)
        external view returns (uint256 totalClaimed, uint8 remaining)
    {
        KnightState storage ks = knightState[knightId];
        return (ks.totalClaimed, runsRemaining(knightId));
    }

    function treasuryBalance() external view returns (uint256) {
        return dngToken.balanceOf(address(this));
    }

    // ---- Admin ----

    function setRarityReward(uint8 rarity, uint256 reward) external onlyOwner {
        require(rarity < RARITY_COUNT, "Bad rarity");
        rarityReward[rarity] = reward;
        emit RarityRewardUpdated(rarity, reward);
    }

    function setDailyCap(uint8 rarity, uint8 cap) external onlyOwner {
        require(rarity < RARITY_COUNT, "Bad rarity");
        dailyCap[rarity] = cap;
        emit DailyCapUpdated(rarity, cap);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    function fundContract(uint256 amount) external nonReentrant onlyOwner {
        dngToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    function withdrawTokens(uint256 amount) external nonReentrant onlyOwner {
        dngToken.safeTransfer(msg.sender, amount);
        emit TokensWithdrawn(msg.sender, amount);
    }

    function withdrawAllTokens() external nonReentrant onlyOwner {
        uint256 balance = dngToken.balanceOf(address(this));
        dngToken.safeTransfer(msg.sender, balance);
        emit TokensWithdrawn(msg.sender, balance);
    }
}
