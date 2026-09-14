// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title DungeonKnightsGame
 * @notice Handles dungeon completions, reward claiming, and anti-cheat validation
 */
contract DungeonKnightsGame is Ownable {
    // Contracts
    IERC721 public knightNFT;
    IERC20 public dngToken;

    // Dungeon configuration
    struct DungeonConfig {
        uint256 minCompletionTime; // Minimum time to complete (anti-speed-hack)
        uint256 maxRewardPerRun;   // Maximum $DNG per completion
        bool active;
    }

    mapping(uint256 => DungeonConfig) public dungeons;

    // Knight rarity rewards (DNG per dungeon based on rarity)
    mapping(uint256 => uint256) public rarityRewards; // 0=common, 1=uncommon, 2=rare, 3=epic, 4=legendary

    // Track last claim time per knight (anti-spam)
    mapping(uint256 => uint256) public lastClaimTime;
    
    // Track total claimed per knight
    mapping(uint256 => uint256) public totalClaimed;

    // Session tracking
    struct Session {
        uint256 startTime;
        uint256 knightId;
        bool active;
    }
    
    mapping(address => Session) public activeSessions;

    // Constants
    uint256 public constant MIN_CLAIM_INTERVAL = 0; // No cooldown - can claim anytime
    uint256 public constant MAX_SESSION_DURATION = 24 hours; // Max 24hr session

    // Events
    event SessionStarted(address indexed player, uint256 indexed knightId, uint256 timestamp);
    event DungeonCompleted(
        address indexed player,
        uint256 indexed knightId,
        uint256 dungeonId,
        uint256 timeSpent,
        uint256 reward,
        uint256 timestamp
    );
    event RewardsClaimed(address indexed player, uint256 indexed knightId, uint256 amount);

    constructor(address _knightNFT, address _dngToken) Ownable(msg.sender) {
        knightNFT = IERC721(_knightNFT);
        dngToken = IERC20(_dngToken);

        // Initialize rarity rewards (DNG per dungeon)
        rarityRewards[0] = 10 ether;   // Common: 10 DNG
        rarityRewards[1] = 17 ether;   // Uncommon: 17 DNG
        rarityRewards[2] = 30 ether;   // Rare: 30 DNG
        rarityRewards[3] = 75 ether;   // Epic: 75 DNG
        rarityRewards[4] = 150 ether;  // Legendary: 150 DNG

        // Initialize default dungeon
        dungeons[1] = DungeonConfig({
            minCompletionTime: 30 seconds,  // Allow fast clears with multiple knights
            maxRewardPerRun: 2250 ether,    // 15 Legendary knights max (15 × 150 = 2250)
            active: true
        });
    }

    /**
     * @notice Start a gaming session (optional, for tracking)
     */
    function startSession(uint256 knightId) external {
        require(knightNFT.ownerOf(knightId) == msg.sender, "Not your knight");
        require(!activeSessions[msg.sender].active, "Session already active");

        activeSessions[msg.sender] = Session({
            startTime: block.timestamp,
            knightId: knightId,
            active: true
        });

        emit SessionStarted(msg.sender, knightId, block.timestamp);
    }

    /**
     * @notice Complete dungeon and claim rewards
     * @param knightId Knight NFT ID
     * @param dungeonId Dungeon completed
     * @param timeSpent Time spent in seconds
     * @param reward Amount of DNG to claim
     * @param timestamp When dungeon was completed
     * @param signature Player's signature of the completion data
     */
    function completeDungeon(
        uint256 knightId,
        uint256 dungeonId,
        uint256 timeSpent,
        uint256 reward,
        uint256 timestamp,
        bytes calldata signature
    ) public {
        // Ownership check
        require(knightNFT.ownerOf(knightId) == msg.sender, "Not your knight");

        // Dungeon must be active
        require(dungeons[dungeonId].active, "Dungeon not active");

        // Rate limiting
        require(
            block.timestamp >= lastClaimTime[knightId] + MIN_CLAIM_INTERVAL,
            "Claim too soon"
        );

        // Timestamp validation (not in future - removed age limit so players can claim anytime)
        require(timestamp <= block.timestamp, "Future timestamp");

        // Anti-cheat: minimum time check
        require(
            timeSpent >= dungeons[dungeonId].minCompletionTime,
            "Completion too fast"
        );

        // Anti-cheat: maximum reward check
        require(
            reward <= dungeons[dungeonId].maxRewardPerRun,
            "Reward too high"
        );

        // Verify signature
        bytes32 messageHash = keccak256(abi.encodePacked(
            knightId,
            dungeonId,
            timeSpent,
            reward,
            timestamp,
            msg.sender
        ));

        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address signer = ECDSA.recover(ethSignedHash, signature);
        
        require(signer == msg.sender, "Invalid signature");

        // Update state
        lastClaimTime[knightId] = block.timestamp;
        totalClaimed[knightId] += reward;

        // Emit event (permanent on-chain record)
        emit DungeonCompleted(
            msg.sender,
            knightId,
            dungeonId,
            timeSpent,
            reward,
            timestamp
        );

        // Mint/transfer DNG rewards
        require(dngToken.transfer(msg.sender, reward), "Transfer failed");

        emit RewardsClaimed(msg.sender, knightId, reward);
    }

    /**
     * @notice Batch claim multiple dungeon completions - TRUE BATCH (no per-claim cooldown)
     */
    function batchCompleteDungeons(
        uint256 knightId,
        uint256[] calldata dungeonIds,
        uint256[] calldata timeSpents,
        uint256[] calldata rewards,
        uint256[] calldata timestamps,
        bytes[] calldata signatures
    ) external {
        require(
            dungeonIds.length == timeSpents.length &&
            timeSpents.length == rewards.length &&
            rewards.length == timestamps.length &&
            timestamps.length == signatures.length,
            "Array length mismatch"
        );

        // Ownership check (only once for batch)
        require(knightNFT.ownerOf(knightId) == msg.sender, "Not your knight");

        uint256 totalReward = 0;

        // Process all completions
        for (uint i = 0; i < dungeonIds.length; i++) {
            uint256 dungeonId = dungeonIds[i];
            uint256 timeSpent = timeSpents[i];
            uint256 reward = rewards[i];
            uint256 timestamp = timestamps[i];
            bytes calldata signature = signatures[i];

            // Dungeon must be active
            require(dungeons[dungeonId].active, "Dungeon not active");

            // Timestamp validation (not in future)
            require(timestamp <= block.timestamp, "Future timestamp");

            // Anti-cheat: minimum time check
            require(
                timeSpent >= dungeons[dungeonId].minCompletionTime,
                "Completion too fast"
            );

            // Anti-cheat: maximum reward check
            require(
                reward <= dungeons[dungeonId].maxRewardPerRun,
                "Reward too high"
            );

            // Verify signature
            bytes32 messageHash = keccak256(abi.encodePacked(
                knightId,
                dungeonId,
                timeSpent,
                reward,
                timestamp,
                msg.sender
            ));

            bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
            address signer = ECDSA.recover(ethSignedHash, signature);
            
            require(signer == msg.sender, "Invalid signature");

            // Accumulate rewards
            totalReward += reward;

            // Emit event for each completion
            emit DungeonCompleted(
                msg.sender,
                knightId,
                dungeonId,
                timeSpent,
                reward,
                timestamp
            );
        }

        // Update state ONCE at the end
        lastClaimTime[knightId] = block.timestamp;
        totalClaimed[knightId] += totalReward;

        // Transfer total rewards in ONE transaction
        require(dngToken.transfer(msg.sender, totalReward), "Transfer failed");

        emit RewardsClaimed(msg.sender, knightId, totalReward);
    }

    /**
     * @notice Get completion history for a knight
     */
    function getKnightStats(uint256 knightId) 
        external 
        view 
        returns (
            uint256 _totalClaimed,
            uint256 _lastClaimTime
        ) 
    {
        return (totalClaimed[knightId], lastClaimTime[knightId]);
    }

    // Admin functions
    function setDungeon(
        uint256 dungeonId,
        uint256 minTime,
        uint256 maxReward,
        bool active
    ) external onlyOwner {
        dungeons[dungeonId] = DungeonConfig({
            minCompletionTime: minTime,
            maxRewardPerRun: maxReward,
            active: active
        });
    }

    function setRarityReward(uint256 rarity, uint256 reward) external onlyOwner {
        rarityRewards[rarity] = reward;
    }

    function fundContract(uint256 amount) external onlyOwner {
        require(
            dngToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
    }

    function withdrawTokens(uint256 amount) external onlyOwner {
        require(dngToken.transfer(msg.sender, amount), "Transfer failed");
    }
}
