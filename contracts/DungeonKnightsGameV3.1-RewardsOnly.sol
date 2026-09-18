// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IKnightNFT is IERC721 {
    function getKnightInfo(uint256 tokenId) 
        external view returns (uint256 level, uint8 rarity, uint256 experience);
}

/**
 * @title DungeonKnightsGameV3.1 - Pure Reward Distribution
 * @notice Batch claim rewards with NO gameplay validation
 * @dev Claims only verify ownership and pay rewards - no daily limits, no run tracking
 */
contract DungeonKnightsGameV3_1 is Ownable, ReentrancyGuard {
    
    IKnightNFT public immutable knightNFT;
    IERC20 public immutable dngToken;
    
    bool public paused;
    
    uint8 public constant RARITY_COUNT = 5;
    uint256 public constant MAX_BATCH = 50;
    
    // Rarity-based rewards (owner can adjust)
    mapping(uint256 => uint256) public rarityReward;
    
    // Total claimed tracking (for stats only, not validation)
    mapping(uint256 => uint256) public knightTotalClaimed;
    
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
    
    constructor(address _knightNFT, address _dngToken) {
        knightNFT = IKnightNFT(_knightNFT);
        dngToken = IERC20(_dngToken);
        
        // Default rewards per rarity
        rarityReward[0] = 10 ether;   // Common: 10 DNG
        rarityReward[1] = 17 ether;   // Uncommon: 17 DNG
        rarityReward[2] = 30 ether;   // Rare: 30 DNG
        rarityReward[3] = 75 ether;   // Epic: 75 DNG
        rarityReward[4] = 150 ether;  // Legendary: 150 DNG
    }
    
    /// @notice Batch claim rewards for multiple dungeon completions
    /// @dev Pure reward distribution - only validates ownership, no gameplay checks
    /// @param runs Array of dungeon runs to claim
    function batchClaimRewards(RunData[] calldata runs) external nonReentrant {
        require(!paused, "Paused");
        require(runs.length > 0, "No runs");
        require(runs.length <= MAX_BATCH, "Too many runs");

        uint256 totalReward = 0;
        uint256 totalKnights = 0;

        for (uint256 i = 0; i < runs.length; i++) {
            RunData calldata run = runs[i];
            
            require(run.knightIds.length > 0, "No knights");
            require(run.knightIds.length <= 15, "Too many knights per run");

            // Process each knight in this run
            for (uint256 j = 0; j < run.knightIds.length; j++) {
                uint256 knightId = run.knightIds[j];

                // Only verify ownership - no gameplay validation!
                require(
                    knightNFT.ownerOf(knightId) == msg.sender, 
                    "Not your knight"
                );

                // Get knight rarity to calculate reward
                (, uint8 rarity, ) = knightNFT.getKnightInfo(knightId);
                require(rarity < RARITY_COUNT, "Invalid rarity");

                uint256 reward = rarityReward[rarity];

                // Update stats (for analytics only, not validation)
                knightTotalClaimed[knightId] += reward;

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
        require(dngToken.transfer(msg.sender, totalReward), "Transfer failed");

        emit RewardsClaimed(msg.sender, totalReward, runs.length, totalKnights);
    }

    /// @notice Claim a single dungeon run (convenience function)
    /// @param knightIds Knights that completed the run
    /// @param dungeonId Which dungeon was completed
    function claimRewards(
        uint256[] calldata knightIds,
        uint256 dungeonId
    ) external nonReentrant {
        RunData[] memory runs = new RunData[](1);
        runs[0] = RunData({
            knightIds: knightIds,
            dungeonId: dungeonId
        });
        
        // Call the batch function with single run
        this.batchClaimRewards(runs);
    }

    // ---- Views ----

    /// @notice Get total tokens claimed by a knight (stats only)
    function getKnightTotalClaimed(uint256 knightId) external view returns (uint256) {
        return knightTotalClaimed[knightId];
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
    }

    /// @notice Pause/unpause claims
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }

    /// @notice Fund the contract treasury
    function fundContract(uint256 amount) external onlyOwner {
        require(
            dngToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
    }

    /// @notice Emergency withdrawal
    function withdrawTokens(uint256 amount) external onlyOwner {
        require(dngToken.transfer(msg.sender, amount), "Transfer failed");
    }

    /// @notice Withdraw all tokens
    function withdrawAllTokens() external onlyOwner {
        uint256 balance = dngToken.balanceOf(address(this));
        require(balance > 0, "Nothing to withdraw");
        require(dngToken.transfer(msg.sender, balance), "Transfer failed");
    }
}
