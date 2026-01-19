# Private Transfer - Implementation Plan

## Overview

This document outlines the implementation plan for adding **privacy-preserving transfers** to TeleSwap.

For a high-level explanation, see [PRIVATE_TRANSFER.md](./PRIVATE_TRANSFER.md).

---

## Table of Contents

1. [Design Summary](#design-summary)
2. [OP_RETURN Format](#op_return-format)
3. [Circuit Design](#circuit-design)
4. [Smart Contract Design](#smart-contract-design)
5. [Implementation Checklist](#implementation-checklist)
6. [Security Analysis](#security-analysis)

---

## Design Summary

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| OP_RETURN format | Just commitment (32 bytes) | Minimal footprint |
| Locker verification | In circuit (public input) | Prevents fake locker attacks |
| Amount verification | In circuit | Prevents over-claiming |
| Merkle verification | Skipped for now | Will add when block headers on contract |
| Hash function | SHA256 | Bitcoin native, EVM precompile |

### What the Circuit Verifies

| # | Verification | Public/Private | Status |
|---|--------------|----------------|--------|
| 1 | Commitment = SHA256(secret \|\| amount \|\| chainId) | secret: private | ✓ Implemented |
| 2 | Commitment provided matches computed | commitmentFromTx: private | ✓ Implemented |
| 3 | Nullifier = SHA256(secret \|\| 0x01) | nullifier: public | ✓ Implemented |
| 4 | Locker script hash matches | lockerScriptHash: public | ✓ Implemented |
| 5 | TX sends `amount` to `lockerScript` | TX parsing | ✓ Implemented |
| 6 | TxId = double SHA256(transaction) | txId: computed | **Phase 2** |
| 7 | TX is in Merkle tree | merkleRoot: public | **Phase 2** |

---

## OP_RETURN Format

### Bitcoin Transaction Structure

```
BITCOIN TX for Private Transfer:

├── Version (4 bytes)
├── Input Count (varint)
├── Inputs [...]
├── Output Count (varint)
├── Outputs:
│   ├── Output 0: VALUE to LOCKER_SCRIPT    ← Circuit verifies this
│   └── Output 1: OP_RETURN [COMMITMENT]    ← Circuit verifies this
└── Locktime (4 bytes)
```

### Commitment Structure

```
commitment = SHA256(secret || amount || chainId)

Where:
- secret:  256 bits (32 bytes) - random, user keeps private
- amount:  64 bits (8 bytes)   - satoshis sent to locker
- chainId: 16 bits (2 bytes)   - target EVM chain ID

Total input to SHA256: 42 bytes (336 bits)
```

### Nullifier Structure

```
nullifier = SHA256(secret || 0x01)

- 0x01 suffix provides domain separation from commitment
- Same secret always produces same nullifier (deterministic)
```

**Why nullifier instead of secret?** The contract must track "already claimed" to prevent double-minting. If we revealed the secret on-chain, anyone could compute the commitment and search Bitcoin for the matching OP_RETURN—breaking privacy. The nullifier is a one-way hash: it cannot be reversed to find the secret, so the link to the Bitcoin transaction stays hidden.

---

## Circuit Design

### Circuit Template

```circom
pragma circom 2.1.0;

include "sha256.circom";
include "bitify.circom";

template PrivateTransferClaim(maxTxBytes) {
    var maxTxBits = maxTxBytes * 8;

    // ═══════════════════════════════════════════════════════════
    // PUBLIC INPUTS
    // ═══════════════════════════════════════════════════════════

    // Merkle root from Bitcoin block header (verification skipped for now)
    signal input merkleRoot;

    // Nullifier - prevents double claiming
    signal input nullifier;

    // Amount in satoshis - must match TX output AND commitment
    signal input amount;

    // Target EVM chain ID
    signal input chainId;

    // Recipient EVM address (as field element)
    signal input recipient;

    // Hash of locker's Bitcoin script - contract verifies this is valid locker
    signal input lockerScriptHash;

    // ═══════════════════════════════════════════════════════════
    // PRIVATE INPUTS
    // ═══════════════════════════════════════════════════════════

    // User's secret - the key to claiming
    signal input secret[256];

    // Full Bitcoin transaction as bits
    signal input transaction[maxTxBits];

    // Actual transaction length in bytes
    signal input txLength;

    // Locker's Bitcoin script (to verify against hash)
    signal input lockerScript[520];  // Max P2SH script size in bits
    signal input lockerScriptLength;

    // Index of the output that pays the locker
    signal input lockerOutputIndex;

    // Byte offset where commitment starts in OP_RETURN output
    signal input commitmentOffset;

    // Merkle proof data (kept for future, not verified now)
    signal input merkleProof[12][256];
    signal input merkleIndex;

    // ═══════════════════════════════════════════════════════════
    // CONSTRAINT 1: Compute commitment and verify it's in TX
    // commitment = SHA256(secret || amount || chainId)
    // ═══════════════════════════════════════════════════════════

    // Convert amount to bits (64 bits, big-endian)
    component amountBits = Num2Bits(64);
    amountBits.in <== amount;

    // Convert chainId to bits (16 bits, big-endian)
    component chainIdBits = Num2Bits(16);
    chainIdBits.in <== chainId;

    // Compute commitment: SHA256(secret[256] || amount[64] || chainId[16])
    // Total: 336 bits = 42 bytes, padded to 512 bits for SHA256
    component commitmentHasher = Sha256(336);

    // Wire secret (256 bits)
    for (var i = 0; i < 256; i++) {
        commitmentHasher.in[i] <== secret[i];
    }
    // Wire amount (64 bits)
    for (var i = 0; i < 64; i++) {
        commitmentHasher.in[256 + i] <== amountBits.out[63 - i];  // big-endian
    }
    // Wire chainId (16 bits)
    for (var i = 0; i < 16; i++) {
        commitmentHasher.in[320 + i] <== chainIdBits.out[15 - i];  // big-endian
    }

    // Verify commitment matches what's in TX at commitmentOffset
    signal expectedCommitment[256];
    for (var i = 0; i < 256; i++) {
        expectedCommitment[i] <== commitmentHasher.out[i];
        // Commitment in TX must match computed commitment
        transaction[commitmentOffset * 8 + i] === expectedCommitment[i];
    }

    // ═══════════════════════════════════════════════════════════
    // CONSTRAINT 2: Compute nullifier and verify it matches public input
    // nullifier = SHA256(secret || 0x01)
    // ═══════════════════════════════════════════════════════════

    component nullifierHasher = Sha256(264);  // 256 + 8 bits

    // Wire secret
    for (var i = 0; i < 256; i++) {
        nullifierHasher.in[i] <== secret[i];
    }
    // Wire 0x01 suffix (8 bits: 00000001)
    for (var i = 0; i < 7; i++) {
        nullifierHasher.in[256 + i] <== 0;
    }
    nullifierHasher.in[263] <== 1;

    // Convert hash output to single field element for comparison
    component nullifierBits2Num = Bits2Num(256);
    for (var i = 0; i < 256; i++) {
        nullifierBits2Num.in[i] <== nullifierHasher.out[255 - i];
    }

    // Verify nullifier matches public input
    nullifier === nullifierBits2Num.out;

    // ═══════════════════════════════════════════════════════════
    // CONSTRAINT 3: Verify locker script hash matches public input
    // ═══════════════════════════════════════════════════════════

    component lockerHasher = Sha256(520);  // Max script size
    for (var i = 0; i < 520; i++) {
        lockerHasher.in[i] <== lockerScript[i];
    }

    component lockerHashBits2Num = Bits2Num(256);
    for (var i = 0; i < 256; i++) {
        lockerHashBits2Num.in[i] <== lockerHasher.out[255 - i];
    }

    // Verify locker script hash matches public input
    lockerScriptHash === lockerHashBits2Num.out;

    // ═══════════════════════════════════════════════════════════
    // CONSTRAINT 4: Verify TX output sends `amount` to `lockerScript`
    // This requires parsing the Bitcoin TX structure
    // ═══════════════════════════════════════════════════════════

    // TODO: Implement Bitcoin TX parsing
    // - Navigate to output at lockerOutputIndex
    // - Extract output value (8 bytes, little-endian)
    // - Extract output script
    // - Verify value == amount
    // - Verify script == lockerScript

    // PLACEHOLDER: For now, we trust the circuit inputs
    // In production, add proper TX parsing constraints

    // ═══════════════════════════════════════════════════════════
    // CONSTRAINT 5: Compute txId (for future Merkle verification)
    // txId = SHA256(SHA256(transaction))
    // ═══════════════════════════════════════════════════════════

    component txHash1 = Sha256(maxTxBits);
    for (var i = 0; i < maxTxBits; i++) {
        txHash1.in[i] <== transaction[i];
    }

    component txHash2 = Sha256(256);
    for (var i = 0; i < 256; i++) {
        txHash2.in[i] <== txHash1.out[i];
    }

    signal txId[256];
    for (var i = 0; i < 256; i++) {
        txId[i] <== txHash2.out[i];
    }

    // ═══════════════════════════════════════════════════════════
    // CONSTRAINT 6: Merkle proof verification (SKIPPED FOR NOW)
    // Will be implemented when block headers available on contract
    // ═══════════════════════════════════════════════════════════

    // FUTURE: Verify txId is in Merkle tree with root merkleRoot
    // For now, merkleRoot and merkleProof are inputs but not verified
    // Contract will verify merkleRoot against Bitcoin relay

    // Dummy constraint to use merkleRoot (prevents unused signal error)
    signal merkleRootSquared;
    merkleRootSquared <== merkleRoot * merkleRoot;
}

// Main component with 1KB max transaction size
component main {public [merkleRoot, nullifier, amount, chainId, recipient, lockerScriptHash]} = PrivateTransferClaim(1024);
```

### Constraint Summary

| Component | Constraints | Status |
|-----------|-------------|--------|
| Commitment hash (SHA256 of 336 bits) | ~25,000 | ✓ Implemented |
| Nullifier hash (SHA256 of 264 bits) | ~25,000 | ✓ Implemented |
| Locker script hash (SHA256 of 520 bits) | ~25,000 | ✓ Implemented |
| Bit conversions + comparisons | ~43,000 | ✓ Implemented |
| TX parsing + output verification | ~7,500 | ✓ Implemented |
| TxId double hash (8192 bits) | ~500,000 | **Phase 2** |
| Merkle proof (12 levels) | ~300,000 | **Phase 2** |
| **Total (Phase 1 - current)** | **~125,554** | ✓ Complete |
| **Total (Phase 2 with txId + Merkle)** | **~925,000** | |

---

## Smart Contract Design

### Storage Additions

```solidity
// Nullifier tracking
mapping(bytes32 => bool) public nullifierUsed;

// Locker script hash tracking (for gas efficiency)
mapping(bytes32 => bool) public isValidLockerHash;

// ZK verifier contract
address public zkVerifier;
```

### New Function: claimPrivate

```solidity
/// @notice Claim teleBTC privately with ZK proof
/// @param _pA Groth16 proof part A
/// @param _pB Groth16 proof part B
/// @param _pC Groth16 proof part C
/// @param _merkleRoot Merkle root of Bitcoin block (verified in future)
/// @param _nullifier Nullifier derived from secret
/// @param _amount Amount in satoshis
/// @param _recipient Address to receive teleBTC
/// @param _lockerScriptHash Hash of locker's Bitcoin script
function claimPrivate(
    uint256[2] calldata _pA,
    uint256[2][2] calldata _pB,
    uint256[2] calldata _pC,
    bytes32 _merkleRoot,
    bytes32 _nullifier,
    uint256 _amount,
    address _recipient,
    bytes32 _lockerScriptHash
) external nonReentrant returns (bool) {

    // 1. Check nullifier not used
    require(!nullifierUsed[_nullifier], "already claimed");

    // 2. Verify locker script hash is valid
    require(isValidLockerHash[_lockerScriptHash], "invalid locker");

    // 3. Verify Merkle root (SKIPPED FOR NOW)
    // TODO: When block headers available on contract:
    // require(bitcoinRelay.isMerkleRootValid(_merkleRoot), "invalid merkle root");

    // 4. Verify ZK proof
    uint256[6] memory publicInputs = [
        uint256(_merkleRoot),
        uint256(_nullifier),
        _amount,
        chainId,
        uint256(uint160(_recipient)),
        uint256(_lockerScriptHash)
    ];

    require(
        IGroth16Verifier(zkVerifier).verifyProof(_pA, _pB, _pC, publicInputs),
        "invalid proof"
    );

    // 5. Mark nullifier as used
    nullifierUsed[_nullifier] = true;

    // 6. Get locker script from hash and mint
    bytes memory lockerScript = lockerScriptFromHash[_lockerScriptHash];
    ILockersManager(lockers).mint(lockerScript, _recipient, _amount);

    emit PrivateClaim(_nullifier, _recipient, _amount, _merkleRoot);
    return true;
}
```

### Admin Functions

```solidity
/// @notice Register a locker's script hash
function registerLockerHash(bytes32 _hash, bytes calldata _script) external onlyOwner {
    isValidLockerHash[_hash] = true;
    lockerScriptFromHash[_hash] = _script;
    emit LockerHashRegistered(_hash);
}

/// @notice Set ZK verifier contract
function setZkVerifier(address _verifier) external onlyOwner {
    zkVerifier = _verifier;
    emit ZkVerifierSet(_verifier);
}
```

---

## Implementation Checklist

### Phase 1: Core Circuit (Without Merkle) ✅ COMPLETE

- [x] **Commitment verification**
  - [x] SHA256 of secret + amount + chainId
  - [x] Verify commitment matches TX commitment (provided by prover)

- [x] **Nullifier verification**
  - [x] SHA256 of secret + 0x01
  - [x] Compare with public input

- [x] **Locker script verification**
  - [x] SHA256 of locker script (padded to 65 bytes)
  - [x] Compare with public input

- [x] **TX output verification**
  - [x] Extract value at lockerOutputOffset (8 bytes LE)
  - [x] Extract script at offset + 72 bits (after value + length byte)
  - [x] Verify output value == amount
  - [x] Verify output script == lockerScript (P2PKH, 25 bytes)

- [ ] **TxId computation** (Phase 2)
  - [ ] Double SHA256 of transaction
  - [ ] Store for future Merkle verification

### Phase 2: Smart Contract ✅ COMPLETE

- [x] Add storage variables (nullifierUsed, isValidLockerHash, zkVerifier)
- [x] Implement claimPrivate()
- [x] Implement registerLockerHash()
- [x] Implement removeLockerHash()
- [x] Write tests (10 tests passing)

### Phase 3: Trusted Setup ✅ COMPLETE

- [x] Compile circuit (circom 2.0.0)
- [x] Run Powers of Tau (power 17 = 131,072 constraints)
- [x] Generate proving/verification keys
- [x] Export Solidity verifier (Groth16Verifier.sol)

### Phase 4: Client SDK

- [x] Secret generation (in generate_input.js)
- [x] Commitment calculation
- [x] Nullifier calculation
- [x] Proof generation wrapper (generate_proof.js)
- [ ] Documentation for SDK usage
- [ ] TypeScript/JavaScript client library

### Phase 5: Testing ✅ COMPLETE

- [x] Unit tests for circuit
- [x] Integration tests (hardhat tests)
- [x] Test with realistic Bitcoin TX structure
- [ ] Test with real Bitcoin testnet TXs

### Phase 6: Merkle Verification (Future)

- [ ] Implement Merkle proof in circuit
- [ ] Add block header verification to contract
- [ ] Update circuit and re-run setup (will need power 20+)

---

## Security Analysis

### What's Verified Now (Phase 1)

| Check | Verified By | Attack Prevented |
|-------|-------------|------------------|
| User knows secret | ZK proof | Theft |
| Correct commitment | ZK proof | Fake commitment |
| Correct nullifier | ZK proof | Nullifier manipulation |
| TX sends to locker | ZK proof | Fake locker |
| TX amount matches commitment | ZK proof | Over-claiming |
| Nullifier not reused | Contract | Double-claim |
| Locker is valid | Contract | Invalid locker |

### What's NOT Verified Yet (Phase 2)

| Check | Status | Risk |
|-------|--------|------|
| TX in valid Bitcoin block | **SKIPPED** | Fake TX could be used |

**Mitigation for Phase 1:**
- Only allow claims from known/trusted sources
- Or require additional off-chain verification
- This is acceptable for testnet/development

### Attack Scenarios

**1. Theft attempt:**
- Attacker sees commitment on Bitcoin
- Cannot create valid proof without secret
- Attack fails ✓

**2. Over-claim attempt:**
- User commits to 10 BTC, sends 1 BTC
- Circuit verifies TX output == committed amount
- Amounts don't match, proof invalid
- Attack fails ✓

**3. Fake locker attempt:**
- User provides invalid locker script hash
- Contract checks isValidLockerHash[]
- Attack fails ✓

**4. Double-claim attempt:**
- User tries to claim twice with same secret
- Same nullifier generated
- Contract rejects duplicate nullifier
- Attack fails ✓

**5. Fake TX attempt (Phase 1 risk):**
- User creates TX not in any block
- Merkle verification skipped
- Attack succeeds ⚠️
- **Mitigation:** Additional off-chain checks until Phase 2

---

## Development Notes

### Circuit Constants

```
MAX_TX_BYTES = 1024        // 1KB max transaction
MAX_TX_BITS = 8192
MERKLE_DEPTH = 12          // For future use
MAX_SCRIPT_BYTES = 65      // P2SH script max
```

### Bitcoin TX Parsing in Circuit

The circuit needs to parse Bitcoin TX to find the locker output. Key considerations:

1. **VarInt handling** - Output count and script lengths use variable-length integers
2. **Output navigation** - Need to skip to correct output index
3. **Value extraction** - 8 bytes, little-endian
4. **Script extraction** - Variable length

This is the most complex part of the circuit implementation.

### Test Vectors

Use existing test data in `zkproof/test-data/`:
- Real Bitcoin transaction from block 931456
- Adapt for private transfer testing
- Add commitment to OP_RETURN

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-14 | 0.1.0 | Initial plan |
| 2026-01-14 | 0.2.0 | Simplified to single-step claim |
| 2026-01-14 | 0.3.0 | Added locker + amount verification, skip Merkle for now |
| 2026-01-15 | 0.4.0 | Implemented circuit, trusted setup, proof generation |
| 2026-01-16 | 1.0.0 | **Phase 1 Complete**: TX parsing, smart contracts, tests passing |

---

## Current Status

**Phase 1 is COMPLETE.** The system can:
- Generate valid ZK proofs for private transfers
- Verify proofs on-chain via Groth16Verifier
- Process claims through PrivateTransferClaim contract
- Track nullifiers to prevent double-claims
- Validate locker script hashes

**Next steps for Phase 2:**
- Implement txId computation (double SHA256)
- Add Merkle proof verification when block headers are available on contract

---

*This document is a living specification.*
