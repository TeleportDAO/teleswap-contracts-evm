# Private Transfer - ZK Privacy for TeleSwap

## What is Private Transfer?

Private Transfer is a **privacy-preserving bridge** feature that allows users to move BTC from Bitcoin to EVM chains without revealing the connection between their Bitcoin address and EVM address.

In the standard TeleSwap bridge, anyone can see which Bitcoin address funded which EVM address. With Private Transfer, this link is broken using **zero-knowledge proofs**.

---

## The Problem

### Current Bridge Flow (Transparent)

```
BITCOIN TRANSACTION
├── Input:  User's Bitcoin address
├── Output: Locker address (receives BTC)
└── OP_RETURN: [chainId][appId][RECIPIENT_ADDRESS][fee][speed]
                              ↑
                              └── Visible to everyone!

EVM TRANSACTION
└── Teleporter calls wrap() → teleBTC minted to RECIPIENT_ADDRESS
```

**Anyone observing the blockchain can determine:**
- Which Bitcoin address sent the funds
- Which EVM address received the tokens
- The exact amount transferred
- The timing of the transfer

This creates a **permanent, public link** between a user's Bitcoin and EVM identities.

---

## The Solution

### Private Transfer Flow

```
STEP 1: USER GENERATES SECRET (locally, never shared)
────────────────────────────────────────────────────
secret = random 256 bits
commitment = SHA256(secret || amount || chainId)
nullifier = SHA256(secret || 0x01)  ← save for claiming later

STEP 2: BITCOIN DEPOSIT
────────────────────────────────────────────────────
BITCOIN TRANSACTION
├── Input:  User's Bitcoin address
├── Output: Locker address (receives BTC) ← amount must match commitment!
└── OP_RETURN: [COMMITMENT]  ← just 32 bytes

STEP 3: PRIVATE CLAIM (user calls contract directly)
────────────────────────────────────────────────────
User generates ZK proof locally, then calls claimPrivate() with:
├── ZK Proof
├── Nullifier
├── Recipient address
├── Amount
├── Locker script (public - for verification)
└── Merkle root + proof data

Contract verifies:
├── ZK proof is valid
├── Merkle root is valid (via Bitcoin relay - future)
├── Nullifier not used before
└── Mints teleBTC to recipient
```

**Key points:**
- OP_RETURN is just the commitment (32 bytes)
- Locker script is PUBLIC - circuit verifies TX sent BTC to this locker
- Amount in commitment MUST match actual BTC sent to locker
- No registration step - user claims directly

---

## What the ZK Proof Verifies

The ZK proof proves ALL of the following:

| # | Verification | What it prevents | Status |
|---|--------------|------------------|--------|
| 1 | User knows secret for commitment | Theft - only secret holder can claim | ✓ Implemented |
| 2 | Commitment matches computed value | Fake commitment attacks | ✓ Implemented |
| 3 | TX sends `amount` BTC to `lockerScript` | Claiming more than deposited | ✓ Implemented |
| 4 | Amount in TX matches amount in commitment | Amount manipulation | ✓ Implemented |
| 5 | Nullifier correctly derived from secret | Double-claim attacks | ✓ Implemented |
| 6 | Locker script hash matches public input | Fake locker attacks | ✓ Implemented |
| 7 | TX is in Merkle tree | Fake transaction attacks | Phase 2 |

---

## Key Benefits

### 1. Privacy
- No on-chain link between Bitcoin sender and EVM recipient
- Observers cannot determine which deposit funded which claim
- Users can use completely fresh EVM addresses

### 2. Self-Custody & Decentralization
- Users claim tokens themselves - no intermediary
- No need to trust anyone with recipient address
- No teleporter dependency for private transfers

### 3. Security
- Cannot claim without knowing the secret
- Cannot claim more than actually deposited (amount verified)
- Cannot use fake locker (locker script verified)
- Cannot double-claim (nullifier tracking)

### 4. Non-Breaking Add-On
- Existing bridge functionality unchanged
- Standard transfers work exactly as before
- Private transfer is opt-in

---

## Security: Why Only YOU Can Claim

**Question:** If someone sees my commitment on Bitcoin, can they steal my tokens?

**Answer: NO.** Here's why:

```
commitment = SHA256(secret || amount || chainId)
nullifier = SHA256(secret || 0x01)
```

To claim tokens, you must provide a ZK proof that:
1. You know `secret` such that commitment matches
2. The commitment is in a Bitcoin TX that sent `amount` to a valid locker
3. The nullifier is correctly derived

**Without knowing the secret:**
- You cannot create a valid ZK proof (ZK soundness property)
- The secret is 256 bits = 2^256 possible values
- Even seeing the commitment reveals nothing about the secret

---

## How Privacy Works

### The Anonymity Set

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
- Locker script is visible (but same for all users of that locker)
- **Cannot link** which deposit → which claim
- Probability of correct guess: 1/10 = 10%

### Privacy Consideration: Locker Script

The locker script is public in the claim. This means observers know which locker was used. However:
- Locker addresses are already public on Bitcoin
- Many users use the same locker
- The main privacy goal (breaking Bitcoin→EVM link) is preserved

---

## Technical Architecture

### Cryptographic Primitives

| Component | Formula | Purpose |
|-----------|---------|---------|
| **Commitment** | `SHA256(secret \|\| amount \|\| chainId)` | Binds secret to amount and chain |
| **Nullifier** | `SHA256(secret \|\| 0x01)` | Unique identifier, prevents double-claim |
| **ZK Proof** | Groth16 SNARK | Proves all constraints without revealing secret |

**Why nullifier instead of secret?** The contract must track "already claimed" to prevent double-minting. If we revealed the secret on-chain, anyone could compute the commitment and search Bitcoin for the matching OP_RETURN—breaking privacy. The nullifier is a one-way hash: it cannot be reversed to find the secret, so the link to the Bitcoin transaction stays hidden.

### OP_RETURN Format

```
OP_RETURN: [commitment]  (32 bytes)
```

Everything else is embedded in the commitment:
```
commitment = SHA256(secret || amount || chainId)
```

### System Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         BITCOIN SIDE                            │
├─────────────────────────────────────────────────────────────────┤
│  User wallet generates:                                         │
│  - secret (random 256 bits)                                     │
│  - commitment = SHA256(secret || amount || chainId)             │
│                                                                 │
│  Bitcoin TX:                                                    │
│  - Output 0: Send `amount` BTC to locker                        │
│  - Output 1: OP_RETURN with commitment                          │
│                                                                 │
│  User saves: secret, amount, chainId, lockerScript              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │  User waits for confirmations
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ZK PROOF GENERATION (off-chain)            │
├─────────────────────────────────────────────────────────────────┤
│  Circuit proves:                                                │
│  1. I know secret for commitment in TX's OP_RETURN              │
│  2. TX sends `amount` BTC to `lockerScript`                     │
│  3. Nullifier = SHA256(secret || 0x01)                          │
│  4. TX is in Merkle tree (future)                               │
│                                                                 │
│  Public inputs: merkleRoot, nullifier, amount,                  │
│                 chainId, recipient, lockerScriptHash            │
│  Private inputs: secret, full TX, Merkle proof                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │  User submits ONE transaction
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EVM CONTRACT (claimPrivate)                  │
├─────────────────────────────────────────────────────────────────┤
│  function claimPrivate(                                         │
│      proof,              // ZK proof                            │
│      merkleRoot,         // Bitcoin block's Merkle root         │
│      nullifier,          // Prevents double-claim               │
│      recipient,          // Where to send teleBTC               │
│      amount,             // Amount to mint                      │
│      lockerScriptHash    // Hash of locker's Bitcoin script     │
│  )                                                              │
│                                                                 │
│  Contract verifies:                                             │
│  1. ZK proof valid (via Groth16Verifier)                        │
│  2. Merkle root valid (via Bitcoin relay - future)              │
│  3. Locker script hash is valid locker                          │
│  4. Nullifier not used before                                   │
│                                                                 │
│  Then: Mark nullifier used, mint teleBTC to recipient           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

### Directory Layout

```
teleswap-contracts/
│
├── circuits/                           # ZK circuit source code
│   └── src/
│       ├── main.circom                 # Main circuit (PrivateTransferClaim)
│       └── tx_parser.circom            # Bitcoin TX output verification
│
├── contracts/zk/                       # ZK-related smart contracts
│   ├── PrivateTransferClaim.sol        # Main claim contract
│   ├── IGroth16Verifier.sol            # Verifier interface
│   ├── Groth16Verifier.sol             # Auto-generated verifier
│   └── mocks/
│       └── MockLockersManager.sol      # Test mock
│
├── zkproof/                            # ZK build artifacts & scripts
│   ├── build/                          # Compiled outputs (wasm, zkey, etc.)
│   ├── scripts/
│   │   ├── setup.sh                    # Trusted setup script
│   │   ├── compile.sh                  # Circuit compilation
│   │   ├── generate_proof.js           # Proof generation
│   │   └── verify_proof.js             # Proof verification
│   └── test-data/
│       ├── generate_input.js           # Test input generator
│       └── test_real_btc_tx.js         # Realistic TX test
│
├── test/zk/
│   └── privateTransferClaim.test.ts    # Smart contract tests (10 passing)
│
├── PRIVATE_TRANSFER.md                 # This file
└── PRIVATE_TRANSFER_PLAN.md            # Implementation plan
```

---

## Prerequisites

### Required Software

1. **Node.js** (v16+)
2. **Circom Compiler** (v2.1.0+)
3. **SnarkJS** (v0.7.0+)

See [PRIVATE_TRANSFER_PLAN.md](./PRIVATE_TRANSFER_PLAN.md) for detailed setup instructions.

---

## Performance Metrics

### Circuit Constraints

| Component | Constraints | Phase |
|-----------|-------------|-------|
| Commitment hash (SHA256) | ~25,000 | ✓ Implemented |
| Nullifier hash (SHA256) | ~25,000 | ✓ Implemented |
| Locker script hash (SHA256) | ~25,000 | ✓ Implemented |
| Bit conversions | ~43,000 | ✓ Implemented |
| TX output verification | ~7,500 | ✓ Implemented |
| TxId (double SHA256 on 1KB) | ~500,000 | Phase 2 |
| Merkle proof (12 levels) | ~300,000 | Phase 2 |
| **Total Phase 1** | **125,554** | ✓ Complete |
| **Total Phase 2** | **~925,000** | |

| Metric | Phase 1 (Current) | Phase 2 |
|--------|-------------------|---------|
| Proof generation | **~7 seconds** | ~3-5 minutes |
| Proof size | 128 bytes | 128 bytes |
| On-chain verification gas | ~395,000 | ~395,000 |
| Powers of Tau | 2^17 (131,072) | 2^20 (1,048,576) |

---

## Security Considerations

### Attack Prevention

| Attack | Prevention |
|--------|------------|
| **Theft** | Only secret holder can create valid proof |
| **Claim more than deposited** | Circuit verifies TX output amount = committed amount |
| **Fake locker** | Circuit verifies TX sent to lockerScript, contract verifies locker is valid |
| **Double-mint** | Nullifier tracking on-chain |
| **Cross-chain replay** | ChainId bound in commitment |
| **Fake TX** | Merkle proof verification (future) |

### Current Limitations

1. **Merkle verification not yet implemented** - Will be added when block headers available on contract
2. **Development trusted setup** - NOT secure for production (use proper ceremony for mainnet)
3. **Fixed TX sizes** - Circuit supports up to 1KB transactions
4. **P2PKH scripts only** - TX parser assumes 25-byte P2PKH locker scripts

---

## Comparison with Similar Systems

| Feature | Tornado Cash | Private Transfer |
|---------|--------------|------------------|
| Privacy model | Deposit/withdraw pool | Cross-chain bridge |
| Amount verification | Fixed denominations | Any amount (verified in circuit) |
| Locker verification | N/A | Yes (circuit verifies TX output) |
| Cross-chain | No | Yes (BTC → EVM) |
| Registration step | Yes (deposit) | No |

---

## Status

**Phase 1 Complete** ✅

| Component | Status |
|-----------|--------|
| ZK Circuit (`main.circom`) | ✓ Implemented |
| TX Parser (`tx_parser.circom`) | ✓ Implemented |
| Smart Contract (`PrivateTransferClaim.sol`) | ✓ Implemented |
| Groth16 Verifier | ✓ Deployed |
| Trusted Setup (Power 17) | ✓ Complete |
| Test Suite | ✓ 10 tests passing |
| Realistic TX Test | ✓ Working |

### Available Commands

```bash
# Generate proof with test data
npm run zk:generate-proof

# Verify generated proof
npm run zk:verify-proof

# Test with realistic Bitcoin TX
npm run zk:test-realistic

# Run smart contract tests
npx hardhat test test/zk/privateTransferClaim.test.ts
```

### What's Working

1. **ZK Proof Generation** - Proofs generated in ~7 seconds
2. **On-chain Verification** - Groth16 verifier deployed and working
3. **Private Claims** - Full claim flow with nullifier tracking
4. **TX Parsing** - Circuit verifies BTC amount and locker script

### Phase 2 (Future)

- [ ] TxId computation (double SHA256)
- [ ] Merkle proof verification
- [ ] Block header validation on contract

See [PRIVATE_TRANSFER_PLAN.md](./PRIVATE_TRANSFER_PLAN.md) for detailed implementation roadmap.

---

*Last updated: 2026-01-16*
