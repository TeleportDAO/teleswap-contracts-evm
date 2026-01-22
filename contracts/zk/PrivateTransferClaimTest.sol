// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./IGroth16Verifier.sol";

/**
 * @title PrivateTransferClaimTest
 * @notice TEST VERSION - Same as PrivateTransferClaim but WITHOUT minting
 * @dev Used for testing ZK proof verification on mainnet without financial risk
 *
 * Differences from production contract:
 * - No LockersManager dependency
 * - No actual minting - just emits event
 * - Safe to deploy on mainnet for testing
 *
 * v1.5 Security enhancements:
 * - Hidden root selection: merkleRoots[2] array instead of single merkleRoot
 * - Front-running protection: recipient is bound in commitment
 */
contract PrivateTransferClaimTest is
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
        uint256 merkleRoot,
        uint256 lockerScriptHash
    );

    event LockerHashRegistered(uint256 indexed lockerScriptHash, bytes lockerScript);
    event LockerHashRemoved(uint256 indexed lockerScriptHash);
    event ZkVerifierSet(address indexed verifier);

    // ═══════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Number of merkle roots for hidden selection (matches circuit)
    uint256 public constant NUM_MERKLE_ROOTS = 2;

    // ═══════════════════════════════════════════════════════════════════
    // STORAGE
    // ═══════════════════════════════════════════════════════════════════

    /// @notice ZK verifier contract (Groth16)
    address public zkVerifier;

    /// @notice Chain ID (for cross-chain replay protection)
    uint256 public claimChainId;

    /// @notice Nullifier tracking - prevents double-claiming
    mapping(uint256 => bool) public nullifierUsed;

    /// @notice Valid locker script hashes
    mapping(uint256 => bool) public isValidLockerHash;

    /// @notice Locker script hash to actual script
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
     * @param _chainId Chain ID for this deployment
     */
    function initialize(
        address _zkVerifier,
        uint256 _chainId
    ) public initializer {
        __Ownable_init();
        __ReentrancyGuard_init();

        require(_zkVerifier != address(0), "PTC: zero verifier");
        require(_chainId > 0, "PTC: zero chainId");

        zkVerifier = _zkVerifier;
        claimChainId = _chainId;
    }

    // ═══════════════════════════════════════════════════════════════════
    // MAIN CLAIM FUNCTION (TEST VERSION - NO MINTING)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Test private claim with a ZK proof
     * @dev TEST VERSION: Verifies proof but does NOT mint tokens
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
        uint256[NUM_MERKLE_ROOTS] calldata _merkleRoots,
        uint256 _nullifier,
        uint256 _amount,
        address _recipient,
        uint256 _lockerScriptHash
    ) external nonReentrant returns (bool success) {
        // ─────────────────────────────────────────────────────────────────
        // 1. Validate inputs
        // ─────────────────────────────────────────────────────────────────
        require(_recipient != address(0), "PTC: zero recipient");
        require(_amount > 0, "PTC: zero amount");

        // ─────────────────────────────────────────────────────────────────
        // 2. Check nullifier not used (prevents double-claim)
        // ─────────────────────────────────────────────────────────────────
        require(!nullifierUsed[_nullifier], "PTC: already claimed");

        // ─────────────────────────────────────────────────────────────────
        // 3. Verify locker script hash is registered
        // ─────────────────────────────────────────────────────────────────
        require(isValidLockerHash[_lockerScriptHash], "PTC: invalid locker");

        // ─────────────────────────────────────────────────────────────────
        // 4. Prepare public signals for ZK verification
        // Order must match circuit's public inputs:
        // [merkleRoots[0], merkleRoots[1], nullifier, amount, chainId, recipient, lockerScriptHash]
        // Note: merkleRoots array provides privacy through hidden root selection
        // Note: recipient is verified against commitment (front-running protection)
        // ─────────────────────────────────────────────────────────────────
        uint256[7] memory publicSignals = [
            _merkleRoots[0],
            _merkleRoots[1],
            _nullifier,
            _amount,
            claimChainId,
            uint256(uint160(_recipient)),
            _lockerScriptHash
        ];

        // ─────────────────────────────────────────────────────────────────
        // 5. Verify ZK proof
        // ─────────────────────────────────────────────────────────────────
        require(
            IGroth16Verifier(zkVerifier).verifyProof(_pA, _pB, _pC, publicSignals),
            "PTC: invalid proof"
        );

        // ─────────────────────────────────────────────────────────────────
        // 6. Mark nullifier as used
        // ─────────────────────────────────────────────────────────────────
        nullifierUsed[_nullifier] = true;

        // ─────────────────────────────────────────────────────────────────
        // 7. TEST MODE: Skip minting, just update stats
        // In production, this would call LockersManager.mint()
        // ─────────────────────────────────────────────────────────────────
        totalClaims++;
        totalAmountClaimed += _amount;

        // ─────────────────────────────────────────────────────────────────
        // 8. Emit event (this is what we're testing for!)
        // ─────────────────────────────────────────────────────────────────
        emit PrivateClaim(_nullifier, _recipient, _amount, _merkleRoots[0], _lockerScriptHash);

        return true;
    }

    // ═══════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    function isNullifierUsed(uint256 _nullifier) external view returns (bool) {
        return nullifierUsed[_nullifier];
    }

    function getLockerScript(uint256 _hash) external view returns (bytes memory) {
        return lockerScriptFromHash[_hash];
    }

    // ═══════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

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

    function removeLockerHash(uint256 _hash) external onlyOwner {
        require(isValidLockerHash[_hash], "PTC: not registered");

        isValidLockerHash[_hash] = false;
        delete lockerScriptFromHash[_hash];

        emit LockerHashRemoved(_hash);
    }

    function setZkVerifier(address _verifier) external onlyOwner {
        require(_verifier != address(0), "PTC: zero verifier");
        zkVerifier = _verifier;
        emit ZkVerifierSet(_verifier);
    }

    function setChainId(uint256 _chainId) external onlyOwner {
        require(_chainId > 0, "PTC: zero chainId");
        claimChainId = _chainId;
    }
}
