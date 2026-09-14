// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title DungeonKnightsGame
 * @notice Handles dungeon completions, reward claiming, and anti-cheat validation
 */
contract DungeonKnightsGame is Ownable {
    using ECDSA for bytes32;

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
    uint256 public constant MIN_CLAIM_INTERVAL = 1 minutes; // Can claim every minute
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
        rarityRewards[0] = 12 ether;   // Common: 12 DNG
        rarityRewards[1] = 20 ether;   // Uncommon: 20 DNG
        rarityRewards[2] = 36 ether;   // Rare: 36 DNG
        rarityRewards[3] = 60 ether;   // Epic: 60 DNG
        rarityRewards[4] = 100 ether;  // Legendary: 100 DNG

        // Initialize default dungeon
        dungeons[1] = DungeonConfig({
            minCompletionTime: 5 minutes,
            maxRewardPerRun: 100 ether,
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
    ) external {
        // Ownership check
        require(knightNFT.ownerOf(knightId) == msg.sender, "Not your knight");

        // Dungeon must be active
        require(dungeons[dungeonId].active, "Dungeon not active");

        // Rate limiting
        require(
            block.timestamp >= lastClaimTime[knightId] + MIN_CLAIM_INTERVAL,
            "Claim too soon"
        );

        // Timestamp validation (not too old, not in future)
        require(timestamp <= block.timestamp, "Future timestamp");
        require(block.timestamp - timestamp < 1 hours, "Completion too old");

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

        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(signature);
        
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
        // Note: This requires the game contract to have minter role
        // or token balance to transfer
        require(dngToken.transfer(msg.sender, reward), "Transfer failed");

        emit RewardsClaimed(msg.sender, knightId, reward);
    }

    /**
     * @notice Batch claim multiple dungeon completions
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

        for (uint i = 0; i < dungeonIds.length; i++) {
            completeDungeon(
                knightId,
                dungeonIds[i],
                timeSpents[i],
                rewards[i],
                timestamps[i],
                signatures[i]
            );
        }
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
