// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./IGroth16Verifier.sol";

/**
 * @title PrivateTransferClaim
 * @notice Allows users to claim TeleBTC privately using ZK proofs
 * @dev Integrates with TeleSwap's LockersManager for minting
 *
 * Flow:
 * 1. User sends BTC to locker with commitment in OP_RETURN
 *    - Commitment includes recipient address (prevents front-running)
 * 2. User generates ZK proof of the transaction
 * 3. User calls claimPrivate() with the proof
 * 4. Contract verifies proof and mints TeleBTC
 *
 * Privacy guarantees:
 * - Transaction details remain private (only hash is verified)
 * - Secret is never revealed (only nullifier is public)
 * - Hidden root selection: user proves TX is in one of N merkle roots without revealing which
 *
 * Security guarantees:
 * - Front-running protection: recipient is bound in commitment at deposit time
 */
contract PrivateTransferClaim is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ═══════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════

    event PrivateClaim(
        uint256 indexed nullifier,
        address indexed recipient,
        uint256 amount,
        uint256 merkleRoot
    );

    event LockerHashRegistered(uint256 indexed lockerScriptHash, bytes lockerScript);
    event LockerHashRemoved(uint256 indexed lockerScriptHash);
    event ZkVerifierSet(address indexed verifier);
    event LockersManagerSet(address indexed lockersManager);

    // ═══════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Number of merkle roots for hidden selection (privacy enhancement)
    uint256 public constant NUM_MERKLE_ROOTS = 2;

    /// @notice Mask to truncate 256-bit merkle root to 254 bits for circuit
    /// Circuit uses BN254 curve which has ~254-bit field elements
    uint256 private constant FIELD_MASK = (1 << 254) - 1;

    /// @notice BN254 scalar field prime (used by Groth16 on this curve)
    /// Values must be reduced modulo this prime to match circuit field elements
    uint256 private constant BN254_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // ═══════════════════════════════════════════════════════════════════
    // STORAGE
    // ═══════════════════════════════════════════════════════════════════

    /// @notice ZK verifier contract (Groth16)
    address public zkVerifier;

    /// @notice LockersManager contract for minting
    address public lockersManager;

    /// @notice Chain ID (for cross-chain replay protection)
    uint256 public claimChainId;

    /// @notice Nullifier tracking - prevents double-claiming
    mapping(uint256 => bool) public nullifierUsed;

    /// @notice Valid locker script hashes
    mapping(uint256 => bool) public isValidLockerHash;

    /// @notice Locker script hash to actual script (for minting)
    mapping(uint256 => bytes) public lockerScriptFromHash;

    /// @notice Total claims processed
    uint256 public totalClaims;

    /// @notice Total amount claimed (in satoshis)
    uint256 public totalAmountClaimed;

    // ═══════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param _zkVerifier Address of the Groth16 verifier contract
     * @param _lockersManager Address of the LockersManager contract (optional until minting enabled)
     * @param _chainId Chain ID for this deployment
     */
    function initialize(
        address _zkVerifier,
        address _lockersManager,
        uint256 _chainId
    ) public initializer {
        __Ownable_init();
        __ReentrancyGuard_init();

        require(_zkVerifier != address(0), "PTC: zero verifier");
        // NOTE: lockersManager can be zero until minting is enabled
        require(_chainId > 0, "PTC: zero chainId");

        zkVerifier = _zkVerifier;
        lockersManager = _lockersManager;
        claimChainId = _chainId;
    }

    // ═══════════════════════════════════════════════════════════════════
    // MAIN CLAIM FUNCTION
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Claim TeleBTC privately with a ZK proof
     * @dev The proof demonstrates knowledge of a Bitcoin transaction
     *      without revealing transaction details
     *
     * @param _pA Groth16 proof point A
     * @param _pB Groth16 proof point B
     * @param _pC Groth16 proof point C
     * @param _merkleRoots Array of merkle roots (user proves TX is in ONE, hidden which)
     * @param _nullifier Nullifier derived from secret (prevents double-claim)
     * @param _amount Amount in satoshis
     * @param _recipient Address to receive TeleBTC (must match commitment for front-running protection)
     * @param _lockerScriptHash Hash of locker's Bitcoin script
     * @return success True if claim succeeded
     */
    function claimPrivate(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[2] calldata _merkleRoots,
        uint256 _nullifier,
        uint256 _amount,
        address _recipient,
        uint256 _lockerScriptHash
    ) external nonReentrant returns (bool success) {
        // Copy calldata to memory for internal function
        uint256[2] memory roots = [_merkleRoots[0], _merkleRoots[1]];

        return _claimPrivateInternal(
            _pA,
            _pB,
            _pC,
            roots,
            _nullifier,
            _amount,
            _recipient,
            _lockerScriptHash
        );
    }

    /**
     * @notice Claim TeleBTC privately using Bitcoin-format merkle roots
     * @dev Convenience wrapper that accepts merkle roots in Bitcoin display format
     *      (reversed byte order, as shown in block explorers) and converts them
     *      to the circuit-compatible format.
     *
     * Bitcoin Display Format vs Internal Format:
     * - Display (block explorer): 4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b
     * - Internal (hash output):   3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a
     *
     * @param _pA Groth16 proof point A
     * @param _pB Groth16 proof point B
     * @param _pC Groth16 proof point C
     * @param _bitcoinMerkleRoots Merkle roots in Bitcoin display format (reversed bytes)
     * @param _nullifier Nullifier derived from secret (prevents double-claim)
     * @param _amount Amount in satoshis
     * @param _recipient Address to receive TeleBTC
     * @param _lockerScriptHash Hash of locker's Bitcoin script
     * @return success True if claim succeeded
     */
    function claimPrivateWithBitcoinRoots(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        bytes32[2] calldata _bitcoinMerkleRoots,
        uint256 _nullifier,
        uint256 _amount,
        address _recipient,
        uint256 _lockerScriptHash
    ) external nonReentrant returns (bool success) {
        // Convert Bitcoin display format to circuit format
        uint256[2] memory convertedRoots;
        for (uint256 i = 0; i < NUM_MERKLE_ROOTS; i++) {
            // 1. Reverse bytes (display → internal/hash order)
            bytes32 internalFormat = _reverseBytes32(_bitcoinMerkleRoots[i]);
            // 2. Take top 254 bits (shift right by 2) to match circuit's Bits2Num(254) logic
            //    Circuit does: in[i] = merkleRootBits[253-i], which takes bits 2-255 of the hash
            //    Then apply BN254 modulo since 254-bit value can exceed field prime
            convertedRoots[i] = (uint256(internalFormat) >> 2) % BN254_PRIME;
        }

        // Delegate to internal claim logic
        return _claimPrivateInternal(
            _pA,
            _pB,
            _pC,
            convertedRoots,
            _nullifier,
            _amount,
            _recipient,
            _lockerScriptHash
        );
    }

    /**
     * @notice Internal claim logic shared by both entry points
     */
    function _claimPrivateInternal(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[2] memory _merkleRoots,
        uint256 _nullifier,
        uint256 _amount,
        address _recipient,
        uint256 _lockerScriptHash
    ) internal returns (bool success) {
        // 1. Validate inputs
        require(_recipient != address(0), "PTC: zero recipient");
        require(_amount > 0, "PTC: zero amount");

        // 2. Check nullifier not used (prevents double-claim)
        require(!nullifierUsed[_nullifier], "PTC: already claimed");

        // 3. Verify locker script hash is registered
        require(isValidLockerHash[_lockerScriptHash], "PTC: invalid locker");

        // 4. Verify Merkle roots (SKIPPED FOR PHASE 1)
        // TODO: When Bitcoin block headers are available on contract:
        // for (uint i = 0; i < NUM_MERKLE_ROOTS; i++) {
        //     require(bitcoinRelay.isMerkleRootValid(_merkleRoots[i]), "invalid merkle");
        // }

        // 5. Prepare public signals for ZK verification
        // Order must match circuit's public inputs:
        // [merkleRoots[0], merkleRoots[1], nullifier, amount, chainId, recipient, lockerScriptHash]
        uint256[7] memory publicSignals = [
            _merkleRoots[0],
            _merkleRoots[1],
            _nullifier,
            _amount,
            claimChainId,
            uint256(uint160(_recipient)),
            _lockerScriptHash
        ];

        // 6. Verify ZK proof
        require(
            IGroth16Verifier(zkVerifier).verifyProof(_pA, _pB, _pC, publicSignals),
            "PTC: invalid proof"
        );

        // 7. Mark nullifier as used
        nullifierUsed[_nullifier] = true;

        // 8. Mint TeleBTC to recipient
        // TODO: Uncomment when ready for production
        // bytes memory lockerScript = lockerScriptFromHash[_lockerScriptHash];
        // (bool mintSuccess, ) = lockersManager.call(
        //     abi.encodeWithSignature(
        //         "mint(bytes,address,uint256)",
        //         lockerScript,
        //         _recipient,
        //         _amount
        //     )
        // );
        // require(mintSuccess, "PTC: mint failed");

        // 9. Update stats and emit event
        totalClaims++;
        totalAmountClaimed += _amount;

        emit PrivateClaim(_nullifier, _recipient, _amount, _merkleRoots[0]);

        return true;
    }

    /**
     * @notice Reverse bytes of a bytes32 value
     * @dev Converts between Bitcoin display format and internal format
     *      Bitcoin displays hashes with bytes reversed (little-endian convention)
     * @param _input The bytes32 to reverse
     * @return The reversed bytes32
     */
    function _reverseBytes32(bytes32 _input) internal pure returns (bytes32) {
        uint256 v = uint256(_input);

        // Swap bytes using bit manipulation
        // This is more gas-efficient than a loop

        // Swap bytes within 16-bit words
        v = ((v & 0xFF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00) >> 8) |
            ((v & 0x00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF) << 8);

        // Swap 16-bit words within 32-bit words
        v = ((v & 0xFFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000) >> 16) |
            ((v & 0x0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF) << 16);

        // Swap 32-bit words within 64-bit words
        v = ((v & 0xFFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000) >> 32) |
            ((v & 0x00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF) << 32);

        // Swap 64-bit words within 128-bit words
        v = ((v & 0xFFFFFFFFFFFFFFFF0000000000000000FFFFFFFFFFFFFFFF0000000000000000) >> 64) |
            ((v & 0x0000000000000000FFFFFFFFFFFFFFFF0000000000000000FFFFFFFFFFFFFFFF) << 64);

        // Swap 128-bit halves
        v = (v >> 128) | (v << 128);

        return bytes32(v);
    }

    // ═══════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Check if a nullifier has been used
     * @param _nullifier The nullifier to check
     * @return True if already claimed
     */
    function isNullifierUsed(uint256 _nullifier) external view returns (bool) {
        return nullifierUsed[_nullifier];
    }

    /**
     * @notice Get locker script from its hash
     * @param _hash The locker script hash
     * @return The locker script bytes
     */
    function getLockerScript(uint256 _hash) external view returns (bytes memory) {
        return lockerScriptFromHash[_hash];
    }

    /**
     * @notice Convert Bitcoin display-format merkle root to circuit format
     * @dev Useful for dApps to preview the conversion before calling claim
     *
     * Example:
     *   Input (Bitcoin display): 0x4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b
     *   Output (circuit format): truncated & reversed for ZK circuit
     *
     * @param _bitcoinMerkleRoot Merkle root in Bitcoin display format
     * @return circuitRoot The converted root for circuit public input
     * @return internalFormat The full 256-bit internal format (before truncation)
     */
    function convertBitcoinMerkleRoot(bytes32 _bitcoinMerkleRoot)
        external
        pure
        returns (uint256 circuitRoot, bytes32 internalFormat)
    {
        internalFormat = _reverseBytes32(_bitcoinMerkleRoot);
        // Take top 254 bits (shift right by 2) to match circuit's Bits2Num(254) logic
        // Then apply BN254 modulo since 254-bit value can exceed field prime
        circuitRoot = (uint256(internalFormat) >> 2) % BN254_PRIME;
    }

    // ═══════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Register a locker's script hash
     * @dev Only owner can register lockers
     * @param _hash The hash of the locker script (as computed in circuit)
     * @param _script The actual locker script bytes
     */
    function registerLockerHash(
        uint256 _hash,
        bytes calldata _script
    ) external onlyOwner {
        require(_script.length > 0, "PTC: empty script");
        require(!isValidLockerHash[_hash], "PTC: already registered");

        isValidLockerHash[_hash] = true;
        lockerScriptFromHash[_hash] = _script;

        emit LockerHashRegistered(_hash, _script);
    }

    /**
     * @notice Remove a locker's script hash
     * @param _hash The hash to remove
     */
    function removeLockerHash(uint256 _hash) external onlyOwner {
        require(isValidLockerHash[_hash], "PTC: not registered");

        isValidLockerHash[_hash] = false;
        delete lockerScriptFromHash[_hash];

        emit LockerHashRemoved(_hash);
    }

    /**
     * @notice Update the ZK verifier contract
     * @param _verifier New verifier address
     */
    function setZkVerifier(address _verifier) external onlyOwner {
        require(_verifier != address(0), "PTC: zero verifier");
        zkVerifier = _verifier;
        emit ZkVerifierSet(_verifier);
    }

    /**
     * @notice Update the LockersManager contract
     * @param _lockersManager New LockersManager address
     */
    function setLockersManager(address _lockersManager) external onlyOwner {
        require(_lockersManager != address(0), "PTC: zero lockers");
        lockersManager = _lockersManager;
        emit LockersManagerSet(_lockersManager);
    }

    /**
     * @notice Update the chain ID
     * @param _chainId New chain ID
     */
    function setChainId(uint256 _chainId) external onlyOwner {
        require(_chainId > 0, "PTC: zero chainId");
        claimChainId = _chainId;
    }
}
