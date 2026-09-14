// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IKnightNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getKnightInfo(uint256 tokenId)
        external view returns (address owner, uint8 rarity, string memory rarityName);
}

/// @title DungeonKnightsGameV2
/// @notice Rewards are derived on-chain from NFT rarity. Nothing client-supplied is trusted.
/// @dev Fixes the signature exploit where msg.sender signed their own reward amount.
///      Now the contract reads rarity from the NFT and computes reward deterministically.
contract DungeonKnightsGameV2 is Ownable, ReentrancyGuard {
    IKnightNFT public knightNFT;
    IERC20  public dngToken;

    uint8 public constant RARITY_COUNT     = 5;
    uint256 public constant MAX_BATCH      = 15;     // matches the 15-knight squad cap
    uint256 public constant RESET_HOUR_UTC = 12;     // daily reset at 12:00 UTC
    uint256 public constant RUN_COOLDOWN   = 30;     // seconds between runs for one knight

    /// @notice DNG paid per completed run, indexed by rarity. 18 decimals.
    /// @dev 0=common, 1=uncommon, 2=rare, 3=epic, 4=legendary
    uint256[RARITY_COUNT] public rarityReward;

    /// @notice Max runs per knight per UTC day, indexed by rarity.
    uint8[RARITY_COUNT] public dailyCap;

    struct KnightState {
        uint32  dayIndex;      // which reset-day runsUsed refers to
        uint8   runsUsed;      // runs consumed during dayIndex
        uint64  lastRunTime;   // unix seconds, for RUN_COOLDOWN
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
    event RewardsClaimed(address indexed player, uint256 amount, uint256 knightCount);
    event RarityRewardUpdated(uint8 rarity, uint256 reward);
    event DailyCapUpdated(uint8 rarity, uint8 cap);
    event PausedSet(bool paused);

    constructor(address _knightNFT, address _dngToken) Ownable(msg.sender) {
        require(_knightNFT != address(0) && _dngToken != address(0), "Zero address");
        knightNFT = IKnightNFT(_knightNFT);
        dngToken  = IERC20(_dngToken);

        // Must match characters.js RARITY and dungeon-session.js rarityRewards.
        rarityReward[0] =  10 ether; // Common
        rarityReward[1] =  17 ether; // Uncommon
        rarityReward[2] =  30 ether; // Rare
        rarityReward[3] =  75 ether; // Epic
        rarityReward[4] = 150 ether; // Legendary

        dailyCap[0] = 5; // Common
        dailyCap[1] = 5; // Uncommon
        dailyCap[2] = 4; // Rare
        dailyCap[3] = 3; // Epic
        dailyCap[4] = 4; // Legendary
    }

    /// @notice Reset-day index. Day rolls over at 12:00 UTC, matching the client.
    function currentDayIndex() public view returns (uint32) {
        return uint32((block.timestamp - (RESET_HOUR_UTC * 1 hours)) / 1 days);
    }

    function runsRemaining(uint256 knightId) public view returns (uint8) {
        (, uint8 rarity, ) = knightNFT.getKnightInfo(knightId);
        require(rarity < RARITY_COUNT, "Bad rarity");
        KnightState storage ks = knightState[knightId];
        if (ks.dayIndex != currentDayIndex()) return dailyCap[rarity];
        if (ks.runsUsed >= dailyCap[rarity]) return 0;
        return dailyCap[rarity] - ks.runsUsed;
    }

    /// @notice Claim one run for each listed knight. Reward is computed on-chain.
    /// @param knightIds Knights that completed the run. Must be owned by msg.sender, no duplicates.
    /// @param dungeonId Which dungeon, for analytics only. Does not affect payout.
    function completeDungeons(uint256[] calldata knightIds, uint256 dungeonId)
        external
        nonReentrant
    {
        require(!paused, "Paused");
        require(knightIds.length > 0, "No knights");
        require(knightIds.length <= MAX_BATCH, "Too many knights");

        uint32  today       = currentDayIndex();
        uint256 totalReward = 0;

        for (uint256 i = 0; i < knightIds.length; i++) {
            uint256 knightId = knightIds[i];

            require(knightNFT.ownerOf(knightId) == msg.sender, "Not your knight");

            (, uint8 rarity, ) = knightNFT.getKnightInfo(knightId);
            require(rarity < RARITY_COUNT, "Bad rarity");

            KnightState storage ks = knightState[knightId];

            // Roll the day over lazily.
            if (ks.dayIndex != today) {
                ks.dayIndex = today;
                ks.runsUsed = 0;
            }

            require(ks.runsUsed < dailyCap[rarity], "No runs left today");
            // Also rejects a duplicate knightId inside one call: the first
            // iteration writes lastRunTime = block.timestamp, so the second fails.
            require(
                block.timestamp >= uint256(ks.lastRunTime) + RUN_COOLDOWN,
                "Run cooldown"
            );

            uint256 reward = rarityReward[rarity];

            ks.runsUsed    += 1;
            ks.lastRunTime  = uint64(block.timestamp);
            ks.totalClaimed += reward;

            totalReward += reward;

            emit DungeonCompleted(
                msg.sender, knightId, dungeonId, rarity, reward, block.timestamp
            );
        }

        require(
            dngToken.balanceOf(address(this)) >= totalReward,
            "Treasury empty"
        );
        require(dngToken.transfer(msg.sender, totalReward), "Transfer failed");

        emit RewardsClaimed(msg.sender, totalReward, knightIds.length);
    }

    // ---- views used by the client ----

    function getKnightStats(uint256 knightId)
        external view returns (uint256 totalClaimed, uint8 remaining, uint64 lastRunTime)
    {
        KnightState storage ks = knightState[knightId];
        return (ks.totalClaimed, runsRemaining(knightId), ks.lastRunTime);
    }

    function treasuryBalance() external view returns (uint256) {
        return dngToken.balanceOf(address(this));
    }

    // ---- admin ----

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
        require(dngToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
    }

    function withdrawTokens(uint256 amount) external onlyOwner {
        require(dngToken.transfer(msg.sender, amount), "Transfer failed");
    }
}
