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

/// @title DungeonKnightsGameV4 - Signed Runs
/// @notice V3 paid any batch of runs an address sent, which meant a script that never
///         opened the game could claim the full daily allowance — the only things V3
///         checked were ownership, rarity and the daily cap. V4 adds the missing gate:
///         every run must carry a signature from the backend's trusted signer, over the
///         exact run it authorizes, bound to this chain and this contract.
///
///         The backend, not the browser, decides how long a run took (it issues a run
///         token when the dungeon starts and refuses to sign before the minimum time has
///         passed on *its* clock), and it decides the reward — which this contract
///         re-derives from on-chain rarity, so a bad signature cannot overpay either.
contract DungeonKnightsGameV4 is Ownable, ReentrancyGuard {
    IKnightNFT public knightNFT;
    IERC20  public dngToken;

    /// @notice The backend key allowed to authorize runs. Rotatable by the owner.
    address public trustedSigner;

    uint8   public constant RARITY_COUNT     = 5;
    uint256 public constant MAX_BATCH        = 50;    // runs per claim transaction
    uint256 public constant MAX_RUN_KNIGHTS  = 15;    // knights per run
    uint256 public constant RESET_HOUR_UTC   = 12;    // daily reset at 12:00 UTC
    uint256 public constant DUNGEON_COUNT    = 5;     // 1=Crypts … 5=Void Rift
    uint256 public constant MAX_RECEIPT_LIFE = 1 days; // an unused receipt may not outlive this

    /// @notice DNG paid per completed run, indexed by rarity. 18 decimals.
    /// @dev 0=common, 1=uncommon, 2=rare, 3=epic, 4=legendary — unchanged from V3.
    uint256[RARITY_COUNT] public rarityReward;

    /// @notice Max runs per knight per UTC day, indexed by rarity. Unchanged from V3.
    uint8[RARITY_COUNT] public dailyCap;

    struct KnightState {
        uint32  dayIndex;      // which reset-day runsUsed refers to
        uint8   runsUsed;      // runs consumed during dayIndex
        uint256 totalClaimed;  // lifetime DNG, 18 decimals
    }
    mapping(uint256 => KnightState) public knightState;

    /// @notice Receipts are single use. The nonce is chosen by the backend, so this is
    ///         the replay guard and it needs no database behind it.
    mapping(bytes32 => bool) public usedNonce;

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
    event TrustedSignerUpdated(address indexed signer);
    event RarityRewardUpdated(uint8 rarity, uint256 reward);
    event DailyCapUpdated(uint8 rarity, uint8 cap);
    event PausedSet(bool paused);

    /// @param knightIds Knights that finished the run.
    /// @param dungeonId  Which dungeon (1=Crypts, 2=Mines, 3=Temple, 4=Magma, 5=Void).
    /// @param reward     Total DNG this run pays, computed by the backend.
    /// @param nonce      Backend-chosen single-use id.
    /// @param expiry     Unix time after which the receipt is void.
    /// @param signature  65-byte signature from `trustedSigner` (see receiptHash).
    struct SignedRun {
        uint256[] knightIds;
        uint256   dungeonId;
        uint256   reward;
        uint256   nonce;
        uint256   expiry;
        bytes     signature;
    }

    constructor(address _knightNFT, address _dngToken, address _trustedSigner) Ownable(msg.sender) {
        require(_knightNFT != address(0), "Zero address: knightNFT");
        require(_dngToken != address(0), "Zero address: dngToken");
        require(_trustedSigner != address(0), "Zero address: signer");

        knightNFT = IKnightNFT(_knightNFT);
        dngToken  = IERC20(_dngToken);
        trustedSigner = _trustedSigner;

        // Rarity rewards — identical to V3 so balances and payouts do not shift.
        rarityReward[0] =  10 ether; // Common
        rarityReward[1] =  17 ether; // Uncommon
        rarityReward[2] =  30 ether; // Rare
        rarityReward[3] =  75 ether; // Epic
        rarityReward[4] = 150 ether; // Legendary

        // Daily run limits — identical to V3.
        dailyCap[0] = 5; // Common
        dailyCap[1] = 5; // Uncommon
        dailyCap[2] = 4; // Rare
        dailyCap[3] = 3; // Epic
        dailyCap[4] = 4; // Legendary
    }

    // ------------------------------------------------------------------ gameplay

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

    /// @notice The message the backend signs for a run. Kept public so anyone can
    ///         independently reproduce a receipt instead of trusting the UI.
    /// @dev `abi.encodePacked(knightIds)` packs each id as 32 bytes with no length
    ///      prefix — the same bytes ethers' solidityKeccak256(['uint256[]']) produces.
    function receiptHash(
        address player,
        uint256[] memory knightIds,
        uint256 dungeonId,
        uint256 reward,
        uint256 nonce,
        uint256 expiry
    ) public view returns (bytes32) {
        return keccak256(abi.encode(
            player,
            keccak256(abi.encodePacked(knightIds)),
            dungeonId,
            reward,
            nonce,
            expiry,
            block.chainid,
            address(this)
        ));
    }

    /// @notice Claim a batch of backend-signed runs.
    /// @dev Every run is validated before any DNG moves: signature, expiry, nonce,
    ///      ownership, daily cap, and the reward the backend promised against the
    ///      reward this contract computes from on-chain rarity.
    function claimSignedRuns(SignedRun[] calldata runs) external nonReentrant {
        require(!paused, "Paused");
        require(runs.length > 0, "No runs");
        require(runs.length <= MAX_BATCH, "Too many runs");

        uint32  today       = currentDayIndex();
        uint256 totalReward = 0;
        uint256 totalKnights = 0;

        for (uint256 i = 0; i < runs.length; i++) {
            SignedRun calldata run = runs[i];

            require(run.knightIds.length > 0, "No knights");
            require(run.knightIds.length <= MAX_RUN_KNIGHTS, "Too many knights");
            require(run.dungeonId >= 1 && run.dungeonId <= DUNGEON_COUNT, "Unknown dungeon");
            require(block.timestamp <= run.expiry, "Receipt expired");
            require(run.expiry <= block.timestamp + MAX_RECEIPT_LIFE, "Receipt life too long");
            require(!usedNonce[bytes32(run.nonce)], "Receipt already used");

            bytes32 digest = keccak256(abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                receiptHash(msg.sender, run.knightIds, run.dungeonId, run.reward, run.nonce, run.expiry)
            ));
            require(_recover(digest, run.signature) == trustedSigner, "Bad signature");

            // Burn the nonce before any external call, and never reuse it even if the
            // rest of this run turns out to be invalid — a rejected receipt must not be
            // quietly replayable after the state it failed on changes.
            usedNonce[bytes32(run.nonce)] = true;

            uint256 expected = 0;

            for (uint256 j = 0; j < run.knightIds.length; j++) {
                uint256 knightId = run.knightIds[j];

                require(knightNFT.ownerOf(knightId) == msg.sender, "Not your knight");

                (, uint8 rarity, ) = knightNFT.getKnightInfo(knightId);
                require(rarity < RARITY_COUNT, "Bad rarity");

                KnightState storage ks = knightState[knightId];

                if (ks.dayIndex != today) {
                    ks.dayIndex = today;
                    ks.runsUsed = 0;
                }

                require(ks.runsUsed < dailyCap[rarity], "No runs left today");

                uint256 reward = rarityReward[rarity];

                ks.runsUsed      += 1;
                ks.totalClaimed  += reward;

                // Accumulated per run, then checked against the signed total below.
                expected += reward;

                emit DungeonCompleted(
                    msg.sender,
                    knightId,
                    run.dungeonId,
                    rarity,
                    reward,
                    block.timestamp
                );
            }

            // The signature covers the amount, so this catches a signer bug or a
            // tampered reward field. It is also what keeps the payout pinned to on-chain
            // rarity: the contract recomputes the run's worth and refuses to pay a
            // promised figure that does not match it.
            require(expected == run.reward, "Reward mismatch");

            totalReward  += expected;
            totalKnights += run.knightIds.length;
        }

        require(dngToken.balanceOf(address(this)) >= totalReward, "Treasury empty");
        require(dngToken.transfer(msg.sender, totalReward), "Transfer failed");

        emit RewardsClaimed(msg.sender, totalReward, runs.length, totalKnights);
    }

    /// @dev Self-contained ECDSA recovery: returns address(0) for a malformed,
    ///      low-s-invalid or high-s (malleable) signature, so a bad receipt can never
    ///      recover the trusted signer by accident.
    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8   v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        // EIP-2: reject the upper half of the curve order, which would let one run be
        // signed twice into two different-looking (but both valid) receipts.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }

        return ecrecover(digest, v, r, s);
    }

    // ------------------------------------------------------------------- views

    function getKnightStats(uint256 knightId)
        external view returns (uint256 totalClaimed, uint8 remaining)
    {
        KnightState storage ks = knightState[knightId];
        return (ks.totalClaimed, runsRemaining(knightId));
    }

    function treasuryBalance() external view returns (uint256) {
        return dngToken.balanceOf(address(this));
    }

    // ------------------------------------------------------------------- admin

    function setTrustedSigner(address signer) external onlyOwner {
        require(signer != address(0), "Zero address");
        trustedSigner = signer;
        emit TrustedSignerUpdated(signer);
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
        require(dngToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
    }

    function withdrawTokens(uint256 amount) external onlyOwner {
        require(dngToken.transfer(msg.sender, amount), "Transfer failed");
    }

    function withdrawAllTokens() external onlyOwner {
        uint256 balance = dngToken.balanceOf(address(this));
        require(dngToken.transfer(msg.sender, balance), "Transfer failed");
    }
}
