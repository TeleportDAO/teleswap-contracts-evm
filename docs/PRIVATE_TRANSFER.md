# Feature: ZK Private Transfer

## Table of Contents
- [Problem](#problem)
- [Solution](#solution)
- [Key Design Decisions](#key-design-decisions)
- [Implementation](#implementation)
- [Testing](#testing)
- [Phases](#phases)
- [Limitations](#limitations)
- [Changelog](#changelog)

## Problem

In the standard TeleSwap bridge, anyone observing the blockchain can determine:
- Which Bitcoin address sent the funds
- Which EVM address received the tokens
- The exact amount transferred
- The timing of the transfer

This creates a **permanent, public link** between a user's Bitcoin and EVM identities.

```
CURRENT BRIDGE FLOW (Transparent)
─────────────────────────────────
BITCOIN TX
├── Input:  User's Bitcoin address
├── Output: Locker address (receives BTC)
└── OP_RETURN: [chainId][appId][RECIPIENT_ADDRESS][fee][speed]
                              ↑
                              └── Visible to everyone!

EVM TX
└── Teleporter calls wrap() → teleBTC minted to RECIPIENT_ADDRESS
```

## Solution

Private Transfer uses **zero-knowledge proofs** to break the link between Bitcoin sender and EVM recipient. Users generate a secret locally, commit to it in the Bitcoin transaction, then prove knowledge of the secret to claim tokens without revealing which deposit is theirs.

### Flow

```
STEP 1: Generate Secret (locally, never shared)
───────────────────────────────────────────────
├── Input:  random 256-bit secret, amount, chainId, recipient
├── Output: commitment = SHA256(secret || amount || chainId || recipient)
│           nullifier = SHA256(secret || 0x01)
└── Result: User saves secret for later claiming

STEP 2: Bitcoin Deposit
───────────────────────
├── Input:  BTC from user wallet
├── Output 0: Send `amount` BTC to locker address
├── Output 1: OP_RETURN with commitment (32 bytes only)
└── Result: Deposit visible on Bitcoin, but no recipient revealed

STEP 3: Generate ZK Proof (off-chain)
─────────────────────────────────────
├── Input:  secret, full Bitcoin TX, merkle proof data
├── Circuit proves:
│   ├── User knows secret for the commitment
│   ├── TX sends correct amount to valid locker
│   ├── Nullifier correctly derived from secret
│   ├── Recipient matches what's in commitment
│   ├── TxId = double SHA256 of transaction
│   ├── TX is in Merkle tree (Bitcoin block inclusion)
│   └── TX is in one of N merkle roots (hidden which)
└── Output: Groth16 proof + public signals

STEP 4: Submit Claim (user calls contract directly)
───────────────────────────────────────────────────
├── Input:  ZK proof, nullifier, recipient, amount, locker script hash, merkle roots
├── Contract verifies:
│   ├── ZK proof is valid (via Groth16Verifier)
│   ├── Merkle roots are valid (via Bitcoin relay - future)
│   ├── Locker script hash is registered
│   └── Nullifier not used before
└── Result: teleBTC minted to recipient, nullifier marked used
```

### Privacy Model

Privacy comes from **mixing** with other users who made similar deposits:

```
TIME    EVENT                           OBSERVER SEES
────────────────────────────────────────────────────────────
T1      Alice deposits 0.1 BTC          Commitment A + locker output
T2      Bob deposits 0.1 BTC            Commitment B + locker output
T3      Carol deposits 0.1 BTC          Commitment C + locker output
...
T10     10 users deposit 0.1 BTC        10 commitments visible

T20     Someone claims to address X      Nullifier N1 + locker script
T21     Someone claims to address Y      Nullifier N2 + locker script
...
```

**Observer's view:**
- 10 deposits of 0.1 BTC each (on Bitcoin)
- 10 claims to 10 different addresses (on EVM)
- **Cannot link** which deposit → which claim
- Probability of correct guess: 1/10 = 10%

## Key Design Decisions

| Decision | Choice | Rationale | Prevents |
|----------|--------|-----------|----------|
| OP_RETURN format | Just commitment (32 bytes) | Minimal on-chain footprint | Data bloat |
| Locker verification | In circuit (public input) | Contract verifies hash is registered | Fake locker attacks |
| Amount verification | In circuit | TX output must match committed amount | Over-claiming |
| Hash function | SHA256 | Bitcoin native, EVM precompile available | Compatibility issues |
| TxId verification | Double SHA256 in circuit | Ensures transaction data integrity | TX manipulation |
| Merkle proof | In circuit with hidden root | Proves block inclusion, hides which block | Fake TX, privacy leakage |
| Hidden root selection | Array of N roots, private index | Expands anonymity set to all deposits in N blocks | TX-claim linkage |
| Recipient in commitment | SHA256(secret \|\| amount \|\| chainId \|\| **recipient**) | Only intended recipient can claim | Front-running attacks |
| Nullifier instead of secret | SHA256(secret \|\| 0x01) on-chain | Prevents searching Bitcoin for matching OP_RETURN | Privacy leakage |

### Security Properties

| # | Verification | What It Prevents | Status |
|---|--------------|------------------|--------|
| 1 | User knows secret for commitment | Theft - only secret holder can claim | Done |
| 2 | Commitment matches computed value | Fake commitment attacks | Done |
| 3 | TX sends `amount` BTC to `lockerScript` | Claiming more than deposited | Done |
| 4 | Amount in TX matches amount in commitment | Amount manipulation | Done |
| 5 | Nullifier correctly derived from secret | Double-claim attacks | Done |
| 6 | Locker script hash matches public input | Fake locker attacks | Done |
| 7 | Recipient matches commitment | Front-running attacks | Done |
| 8 | TxId = double SHA256(transaction) | Transaction data manipulation | Done |
| 9 | TX is in Merkle tree with valid root | Fake transaction attacks | Done |
| 10 | Hidden root selection (one of N roots) | Transaction-claim linkage | Done |
| 11 | Merkle roots validated via Bitcoin relay | Invalid block headers | Pending |

## Implementation

### Files

```
teleswap-contracts/
├── circuits/src/
│   ├── main.circom                    # Main circuit (PrivateTransferClaim)
│   ├── tx_parser.circom               # Bitcoin TX output verification
│   ├── merkle_proof.circom            # Bitcoin Merkle tree verification
│   └── sha256_variable.circom         # Variable-length SHA256 for TxId
│
├── contracts/zk/
│   ├── PrivateTransferClaim.sol       # Main claim contract (upgradeable)
│   ├── IGroth16Verifier.sol           # Verifier interface
│   ├── Groth16Verifier.sol            # Auto-generated Groth16 verifier
│   └── mocks/MockLockersManager.sol   # Test mock
│
├── deploy/zk/
│   ├── 001_Groth16Verifier.ts         # Verifier deployment
│   └── 002_PrivateTransferClaimTest.ts # Claim contract deployment
│
├── scripts/zk/
│   ├── create-btc-deposit.js          # Create Bitcoin deposit with commitment
│   ├── generate-witness.js            # Generate ZK proof from deposit
│   ├── submit-proof.ts                # Submit claim on-chain
│   └── register-locker.ts             # Register locker hash
│
├── zkproof/
│   ├── build/                         # Compiled circuit artifacts (wasm, zkey)
│   ├── deposits/                      # Saved deposit data files
│   ├── claims/                        # Generated claim proof files
│   └── scripts/
│       ├── setup.sh                   # Trusted setup script
│       └── compile.sh                 # Circuit compilation
│
└── test/zk/
    └── privateTransferClaim.test.ts   # Smart contract tests
```

### Types

**Commitment Structure**
```
commitment = SHA256(secret || amount || chainId || recipient)

Where:
- secret:    256 bits (32 bytes) - random, user keeps private
- amount:    64 bits (8 bytes)   - satoshis sent to locker (big-endian)
- chainId:   16 bits (2 bytes)   - target EVM chain ID (big-endian)
- recipient: 160 bits (20 bytes) - EVM address to receive teleBTC

Total input to SHA256: 62 bytes (496 bits)
```

**Circuit Public Inputs (7 signals)**
```circom
signal input merkleRoots[2];      // Array of valid merkle roots (254-bit field elements)
signal input nullifier;           // Prevents double claiming (254-bit)
signal input amount;              // Satoshis (must match TX + commitment)
signal input chainId;             // Target EVM chain ID
signal input recipient;           // EVM address (must match commitment)
signal input lockerScriptHash;    // Hash of locker's Bitcoin script (254-bit)
```

**Circuit Private Inputs**
```circom
signal input secret[256];                  // User's secret (big-endian bits)
signal input lockerScript[520];            // Locker script (65 bytes max, zero-padded)
signal input lockerScriptLength;           // Actual script length (22-25 bytes)
signal input lockerOutputIndex;            // Output index in TX
signal input lockerOutputByteOffset;       // Byte offset of locker output
signal input commitmentByteOffset;         // Byte offset of commitment in OP_RETURN
signal input rootIndex;                    // Which merkle root (0 or 1) - PRIVATE
signal input merkleProof[12][256];         // Sibling hashes for Merkle proof
signal input merklePathIndices[12];        // Path directions (0=left, 1=right)
signal input merkleDepth;                  // Actual tree depth (1-12)
signal input merkleRootBits[2][256];       // Full 256-bit merkle roots
signal input paddedTransaction[maxPaddedBits]; // SHA256-padded transaction
signal input numBlocks;                    // Number of 512-bit blocks
signal input txId[256];                    // Transaction ID (double SHA256)
```

**Contract Interface**
```solidity
// Standard claim with pre-converted merkle roots
function claimPrivate(
    uint256[2] calldata _pA,
    uint256[2][2] calldata _pB,
    uint256[2] calldata _pC,
    uint256[2] calldata _merkleRoots,    // Circuit-format (254-bit field elements)
    uint256 _nullifier,
    uint256 _amount,
    address _recipient,
    uint256 _lockerScriptHash
) external returns (bool);

// Convenience function with Bitcoin-format merkle roots
function claimPrivateWithBitcoinRoots(
    uint256[2] calldata _pA,
    uint256[2][2] calldata _pB,
    uint256[2] calldata _pC,
    bytes32[2] calldata _bitcoinMerkleRoots,  // Bitcoin display format (reversed bytes)
    uint256 _nullifier,
    uint256 _amount,
    address _recipient,
    uint256 _lockerScriptHash
) external returns (bool);
```

### Commands

```bash
# Deploy contracts
npm run zk:deploy
# Or with explicit network:
NETWORK=polygon npm run zk:deploy

# Register locker hash (required before claiming)
npx hardhat run scripts/zk/register-locker.ts --network polygon

# Create Bitcoin deposit
node scripts/zk/create-btc-deposit.js --amount=1000 --recipient=0xYourAddress

# Generate ZK proof from deposit
node scripts/zk/generate-witness.js --deposit=<txid>.json

# Submit claim on-chain
CLAIM_FILE=<txid>.json npx hardhat run scripts/zk/submit-proof.ts --network polygon

# Run contract tests
npx hardhat test test/zk/privateTransferClaim.test.ts
```

### Circuit Verification Summary

The circuit verifies all of the following in a single proof:

| Constraint | Description |
|------------|-------------|
| **Commitment** | SHA256(secret \|\| amount \|\| chainId \|\| recipient) matches TX OP_RETURN |
| **Nullifier** | SHA256(secret \|\| 0x01) matches public input |
| **Locker Hash** | SHA256(lockerScript padded to 65 bytes) matches public input |
| **TX Output** | Extracted value and script match expected amount and locker |
| **TxId** | Double SHA256 of padded transaction matches provided txId |
| **Merkle Proof** | txId is in Merkle tree, computed root matches selected root |
| **Root Selection** | Selected root (via private index) matches one of public merkleRoots |

### Performance Metrics

| Metric | Value |
|--------|-------|
| Max TX size | 512 bytes |
| Merkle tree depth | Up to 12 levels (~4096 TXs/block) |
| Proof generation | ~35 seconds |
| Proof size | 128 bytes |
| On-chain verification gas | ~350,000 |

## Testing

### Prerequisites

**Required Software**
- Node.js v16+
- Circom Compiler v2.1.0+
- SnarkJS v0.7.0+

**Environment Variables** (`.env`)
```env
# EVM Configuration
PRIVATE_KEY=0x...                    # EVM deployer private key
POLYGON_API_KEY=...                  # For contract verification (optional)

# Bitcoin Configuration
BTC_PRIVATE_KEY_WIF=...              # Bitcoin private key in WIF format
BTC_LOCKER_ADDRESS=...               # Locker's P2PKH Bitcoin address
```

### Unit Tests

```bash
# Run smart contract tests
npx hardhat test test/zk/privateTransferClaim.test.ts

# Run with gas reporting
REPORT_GAS=true npx hardhat test test/zk/privateTransferClaim.test.ts
```

### Integration Tests (E2E)

Full end-to-end flow with real Bitcoin transactions:

```bash
# 1. Deploy contracts
npm run zk:deploy

# 2. Register locker
npx hardhat run scripts/zk/register-locker.ts --network polygon

# 3. Create Bitcoin deposit (wait for confirmations)
node scripts/zk/create-btc-deposit.js --amount=1000 --recipient=0xYourAddress

# 4. Generate ZK proof
node scripts/zk/generate-witness.js --deposit=<txid>.json

# 5. Submit claim
CLAIM_FILE=<txid>.json npx hardhat run scripts/zk/submit-proof.ts --network polygon
```

### Security Tests

**Front-Running Protection**
- Create deposit with recipient A, try to generate proof with recipient B
- Result: Proof generation fails (commitment mismatch)

**Double-Claim Prevention**
- Submit valid claim, try to submit same proof again
- Result: Contract reverts with "PTC: already claimed"

**Fake Transaction Prevention**
- Generate proof with invalid merkle proof data
- Result: Proof verification fails (computed root doesn't match)

## Phases

### Phase 1: Core Circuit [done]
- [x] Commitment verification (SHA256 of secret + amount + chainId + recipient)
- [x] Nullifier verification (SHA256 of secret + 0x01)
- [x] Locker script hash verification
- [x] TX output verification (amount + script matching)
- [x] Front-running protection (recipient in commitment)
- [x] Hidden root selection (privacy enhancement)

### Phase 2A: Full Cryptographic Verification [done]
- [x] TxId computation (double SHA256 with variable-length support)
- [x] Merkle proof verification in circuit
- [x] Bitcoin Merkle tree structure (double SHA256 per level)
- [x] Hidden root selection with full 256-bit comparison
- [x] Binary constraints on all bit array inputs

### Phase 2B: Bitcoin Relay Integration [pending]
- [ ] Validate merkle roots against Bitcoin block headers on-chain
- [ ] Integration with Bitcoin relay contract
- [ ] Block header verification

### Phase 3: Smart Contract [done]
- [x] PrivateTransferClaim contract (upgradeable)
- [x] claimPrivate() with ZK proof verification
- [x] claimPrivateWithBitcoinRoots() convenience function
- [x] Nullifier tracking (prevents double-claim)
- [x] Locker hash registry
- [x] Bitcoin merkle root format conversion

### Phase 4: Trusted Setup [done]
- [x] Compile circuit (circom 2.0.0)
- [x] Run Powers of Tau ceremony
- [x] Generate proving/verification keys
- [x] Export Solidity verifier (Groth16Verifier.sol)

### Phase 5: Client SDK [done]
- [x] Secret generation
- [x] Commitment calculation
- [x] Nullifier calculation
- [x] Merkle proof generation
- [x] Proof generation wrapper
- [x] Bitcoin TX parsing (SegWit stripping)

### Phase 6: Testing [done]
- [x] Unit tests for circuit
- [x] Integration tests (hardhat)
- [x] Test with realistic Bitcoin TX structure
- [x] E2E test with real Bitcoin + EVM mainnet

### Phase 7: Production [pending]
- [ ] Production trusted setup ceremony
- [ ] Mainnet deployment
- [ ] TeleBTC minting integration (currently commented out)
- [ ] Bitcoin relay integration for merkle root validation

## Limitations

- **Bitcoin relay integration pending** - Merkle roots are accepted but not validated against Bitcoin block headers on-chain; this requires integration with a Bitcoin relay contract
- **Development trusted setup** - Current setup is NOT secure for production; proper multi-party ceremony required for mainnet
- **Fixed TX size** - Circuit supports max 512-byte Bitcoin transactions
- **Standard scripts only** - TX parser supports P2PKH (25 bytes), P2SH (23 bytes), P2WPKH (22 bytes) scripts
- **Two merkle roots** - Privacy set limited to 2 blocks (configurable in circuit)
- **TeleBTC minting disabled** - Minting call is commented out pending production deployment

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-14 | 0.1.0 | Initial design |
| 2026-01-14 | 0.2.0 | Simplified to single-step claim |
| 2026-01-14 | 0.3.0 | Added locker + amount verification |
| 2026-01-15 | 0.4.0 | Implemented circuit, trusted setup, proof generation |
| 2026-01-16 | 1.0.0 | Phase 1 complete: TX parsing, smart contracts, tests |
| 2026-01-20 | 1.5.0 | Security enhancements: hidden root selection, recipient in commitment |
| 2026-01-23 | 2.0.0 | Full cryptographic verification: TxId, Merkle proof in circuit |
| 2026-01-27 | 2.1.0 | Documentation consolidated, phases updated |
