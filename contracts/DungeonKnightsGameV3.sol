// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IKnightNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getKnightInfo(uint256 tokenId)
        external view returns (address owner, uint8 rarity, string memory rarityName);
}

/// @title DungeonKnightsGameV3
/// @notice Batch claiming with backend signature verification for gameplay validation
/// @dev No transactions needed until claiming - play multiple dungeons, claim once!
contract DungeonKnightsGameV3 is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    IKnightNFT public knightNFT;
    IERC20  public dngToken;

    uint8 public constant RARITY_COUNT     = 5;
    uint256 public constant MAX_BATCH      = 50;     // Can claim up to 50 runs at once
    uint256 public constant RESET_HOUR_UTC = 12;    // Daily reset at 12:00 UTC
    uint256 public constant MIN_GAME_DURATION = 30; // Minimum 30 seconds per game

    /// @notice Backend signer that validates gameplay
    address public trustedSigner;

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

    /// @notice Prevent signature replay attacks
    mapping(bytes32 => bool) public usedSignatures;

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
    event TrustedSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event RarityRewardUpdated(uint8 rarity, uint256 reward);
    event DailyCapUpdated(uint8 rarity, uint8 cap);
    event PausedSet(bool paused);

    struct CompletionData {
        uint256[] knightIds;     // Knights that completed this run
        uint256 dungeonId;       // Which dungeon (1=Crypts, 2=Mines, etc.)
        uint256 completedAt;     // When game was completed (Unix timestamp)
        uint256 duration;        // How long game took (seconds)
        bytes32 gameDataHash;    // Hash of: lootCollected, enemiesKilled, etc.
    }

    constructor(
        address _knightNFT, 
        address _dngToken,
        address _trustedSigner
    ) Ownable(msg.sender) {
        require(_knightNFT != address(0), "Zero address: knightNFT");
        require(_dngToken != address(0), "Zero address: dngToken");
        require(_trustedSigner != address(0), "Zero address: trustedSigner");
        
        knightNFT = IKnightNFT(_knightNFT);
        dngToken  = IERC20(_dngToken);
        trustedSigner = _trustedSigner;

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
    /// @param completions Array of dungeon completions to claim
    /// @param signatures Backend signatures (one per completion)
    function batchClaimRewards(
        CompletionData[] calldata completions,
        bytes[] calldata signatures
    ) external nonReentrant {
        require(!paused, "Paused");
        require(completions.length > 0, "No completions");
        require(completions.length <= MAX_BATCH, "Too many completions");
        require(completions.length == signatures.length, "Length mismatch");

        uint32 today = currentDayIndex();
        uint256 totalReward = 0;
        uint256 totalKnights = 0;

        for (uint256 i = 0; i < completions.length; i++) {
            CompletionData calldata completion = completions[i];
            
            require(completion.knightIds.length > 0, "No knights");
            require(completion.knightIds.length <= 15, "Too many knights");
            require(completion.duration >= MIN_GAME_DURATION, "Game too fast");
            require(completion.completedAt <= block.timestamp, "Future timestamp");
            require(
                completion.completedAt >= block.timestamp - 1 hours, 
                "Completion too old"
            );

            // Verify backend signature
            bytes32 messageHash = keccak256(abi.encodePacked(
                msg.sender,
                completion.knightIds,
                completion.dungeonId,
                completion.completedAt,
                completion.duration,
                completion.gameDataHash
            ));
            
            bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
            
            require(!usedSignatures[ethSignedHash], "Signature already used");
            require(
                ethSignedHash.recover(signatures[i]) == trustedSigner,
                "Invalid signature"
            );
            
            // Mark signature as used (prevent replay)
            usedSignatures[ethSignedHash] = true;

            // Process each knight in this completion
            for (uint256 j = 0; j < completion.knightIds.length; j++) {
                uint256 knightId = completion.knightIds[j];

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
                    completion.dungeonId, 
                    rarity, 
                    reward, 
                    completion.completedAt
                );
            }
        }

        require(
            dngToken.balanceOf(address(this)) >= totalReward,
            "Treasury empty"
        );
        require(dngToken.transfer(msg.sender, totalReward), "Transfer failed");

        emit RewardsClaimed(msg.sender, totalReward, completions.length, totalKnights);
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

    function setTrustedSigner(address _signer) external onlyOwner {
        require(_signer != address(0), "Zero address");
        address oldSigner = trustedSigner;
        trustedSigner = _signer;
        emit TrustedSignerUpdated(oldSigner, _signer);
    }

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

    function fundContract(uint256 amount) external onlyOwner {
        require(
            dngToken.transferFrom(msg.sender, address(this), amount), 
            "Transfer failed"
        );
    }

    function withdrawTokens(uint256 amount) external onlyOwner {
        require(dngToken.transfer(msg.sender, amount), "Transfer failed");
    }

    function withdrawAllTokens() external onlyOwner {
        uint256 balance = dngToken.balanceOf(address(this));
        require(dngToken.transfer(msg.sender, balance), "Transfer failed");
    }
}
