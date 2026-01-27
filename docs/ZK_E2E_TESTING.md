# ZK Private Transfer - End-to-End Testing Guide

This guide walks you through testing the ZK Private Transfer system with **real Bitcoin transactions** and **EVM mainnet**.

## Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   1. Deploy     │────▶│  2. Create BTC  │────▶│  3. Generate    │────▶│  4. Submit      │
│   Contracts     │     │     Deposit     │     │     ZK Proof    │     │     Claim       │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
    EVM Chain              Bitcoin                Off-chain              EVM Chain
```

## Prerequisites

### 1. Install Dependencies

```bash
npm install
```

Bitcoin-specific packages (should already be installed):
```bash
npm install bitcoinjs-lib ecpair tiny-secp256k1 node-fetch
```

### 2. Configure Environment

Add to your `.env` file:

```env
# EVM Configuration
PRIVATE_KEY=0x...                    # EVM deployer private key
POLYGON_API_KEY=...                  # For contract verification (optional)

# Bitcoin Configuration
BTC_PRIVATE_KEY_WIF=...              # Bitcoin private key in WIF format
BTC_LOCKER_ADDRESS=...               # Locker's P2PKH Bitcoin address
```

### 3. Fund Your Wallets

- **EVM Chain**: Need native token for gas (~0.5 MATIC for deployment + claims)
- **Bitcoin**: Need BTC for the deposit + fees (~0.001 BTC minimum)

---

## Project Structure

```
teleswap-contracts/
├── config/
│   ├── polygon.json           # Network-specific config
│   └── zk.json                # ZK-specific config
├── contracts/zk/              # ZK Solidity contracts
│   ├── Groth16Verifier.sol
│   ├── PrivateTransferClaim.sol
│   └── PrivateTransferClaimTest.sol
├── deploy/zk/                 # Hardhat-deploy scripts
│   ├── 001_Groth16Verifier.ts
│   └── 002_PrivateTransferClaimTest.ts
├── scripts/zk/                # Operational scripts
│   ├── create-btc-deposit.js  # Create Bitcoin deposit
│   ├── generate-witness.js    # Generate ZK proof
│   ├── submit-proof.ts        # Submit proof on-chain
│   └── register-locker.ts     # Register locker hash
└── zkproof/                   # Circuit and proof artifacts
    ├── build/                 # Compiled circuit artifacts
    ├── deposits/              # Deposit data files
    └── claims/                # Generated claim files
```

---

## Step 1: Deploy Contracts

Deploy using the zk deploy command:

```bash
npm run zk:deploy
```

Or explicitly with network:

```bash
NETWORK=polygon npm run zk:deploy
```

**Output:**
```
╔════════════════════════════════════════════════════════════╗
║   Deploying Groth16Verifier                                 ║
╚════════════════════════════════════════════════════════════╝

  Groth16Verifier deployed at: 0x...

╔════════════════════════════════════════════════════════════╗
║   Deploying PrivateTransferClaimTest (Upgradeable)          ║
╚════════════════════════════════════════════════════════════╝

  Chain ID: 137
  Verifier Address: 0x...
  PrivateTransferClaimTest Proxy deployed at: 0x...
```

Deployment info is saved by hardhat-deploy to: `deployments/<network>/`

---

## Step 2: Create Bitcoin Deposit

Create a deposit with commitment:

```bash
node scripts/zk/create-btc-deposit.js --amount=1000 --recipient=0xYourEVMAddress
```

**What it does:**
1. Generates a random 256-bit secret
2. Computes commitment = SHA256(secret || amount || chainId || recipient)
3. Builds a Bitcoin transaction:
   - Output 0: Payment to locker
   - Output 1: OP_RETURN with commitment
4. Broadcasts to Bitcoin network
5. Saves deposit data to `zkproof/deposits/<txid>.json`

**Example output:**
```
╔════════════════════════════════════════════════════════════╗
║            Create Bitcoin Deposit for Private Claim         ║
╚════════════════════════════════════════════════════════════╝

Generated Secret: 06fba6b58da1620c731dc693f94328a3...
Commitment: 48133692f840fbc4523d4d90d43fdee5...

Bitcoin TX built:
  Output 0: 1000 sats to 1NtQASBBziad6x5dST3jgoFqWv1eMAAnWY
  Output 1: OP_RETURN with commitment

TX broadcast! TxId: b56e47e06548d5c057b06db2325502630de6c910...
Deposit saved to: zkproof/deposits/b56e47e0....json
```

**Wait for confirmations** (1-6 blocks depending on your needs)

---

## Step 3: Register Locker Hash

Before claiming, the locker's script hash must be registered on the contract. The hash is computed by the circuit, so you need to run proof generation first to get it, or use the register script:

```bash
npx hardhat run scripts/zk/register-locker.ts --network polygon
```

**Note:** The locker hash computed by JavaScript now matches the circuit output exactly (using BN254 field modulo).

---

## Step 4: Generate ZK Proof

Once the Bitcoin transaction is confirmed, generate the ZK claim proof:

```bash
node scripts/zk/generate-witness.js --deposit=<txid>.json
```

**What it does:**
1. Fetches the Bitcoin transaction from mempool.space
2. Strips SegWit witness data (for txId calculation)
3. Parses the transaction to find locker output and commitment
4. Generates circuit inputs (paddedTransaction, offsets, etc.)
5. Runs ZK proof generation (~35 seconds)
6. Verifies the proof locally
7. Exports Solidity calldata
8. Saves claim data to `zkproof/claims/<txid>.json`

**Example output:**
```
╔════════════════════════════════════════════════════════════╗
║        Generate ZK Claim from Bitcoin Transaction          ║
╚════════════════════════════════════════════════════════════╝

Loaded deposit from: zkproof/deposits/b56e47e0....json

Fetching transaction b56e47e06548d5c057b06db2325502630de6c910...
  SegWit TX detected - stripped to 159 bytes
  Found locker output at index 0
  Found commitment at output 1

Generating ZK proof...
  ✓ Witness calculated
  ✓ Proof generated (35.19s)
  ✓ Proof verified

╔════════════════════════════════════════════════════════════╗
║              CLAIM PROOF GENERATED SUCCESSFULLY            ║
╚════════════════════════════════════════════════════════════╝
```

---

## Step 5: Submit Claim

Submit the ZK proof to the contract:

```bash
CLAIM_FILE=<txid>.json npx hardhat run scripts/zk/submit-proof.ts --network polygon
```

**What it does:**
1. Loads the claim data
2. Verifies locker hash is registered (using hash from proof's public signals)
3. Checks nullifier not already used
4. Estimates gas
5. Asks for confirmation
6. Submits the claim transaction
7. Waits for confirmation and checks for PrivateClaim event

**Example output:**
```
╔════════════════════════════════════════════════════════════╗
║           Submit ZK Claim on matic                          ║
╚════════════════════════════════════════════════════════════╝

Claim Data:
  TxId:     b56e47e06548d5c057b06db2325502630de6c910...
  Amount:   1000 satoshis
  Recipient: 0x2D3E4AeB9347C224DAe7F1dc1213bE082F6FddEC

✓ Locker hash is registered
✓ Nullifier not yet used

Estimating gas...
  Estimated gas: 356969

Submit claim? (yes/no): yes

Submitting claim...
  TX Hash: 0x5b4484fe5759a4714d8f1f501d4bf9d738502a9c...
  ✓ Confirmed in block 82004470
  Gas used: 346292

✓ PrivateClaim event emitted!

╔════════════════════════════════════════════════════════════╗
║                  CLAIM SUCCESSFUL!                         ║
╚════════════════════════════════════════════════════════════╝
```

---

## Verified E2E Test

The following claim was successfully processed:

| Field | Value |
|-------|-------|
| Bitcoin TxId | `b56e47e06548d5c057b06db2325502630de6c910df7f20e8f826bff33884b8f9` |
| Amount | 1000 satoshis |
| Recipient | `0x2D3E4AeB9347C224DAe7F1dc1213bE082F6FddEC` |
| EVM Network | Polygon Mainnet |
| EVM TX | `0x5b4484fe5759a4714d8f1f501d4bf9d738502a9c8f0c860c980d7b09c4201e61` |
| Block | 82004470 |
| Gas Used | 346,292 |

View on Polygonscan: https://polygonscan.com/tx/0x5b4484fe5759a4714d8f1f501d4bf9d738502a9c8f0c860c980d7b09c4201e61

---

## Troubleshooting

### "Insufficient funds" on Bitcoin

- Check your balance: `https://mempool.space/address/<your_address>`
- Ensure UTXOs are confirmed
- Account for fees (~10 sat/vbyte)

### "Locker hash not registered"

The locker hash must be registered before submitting a claim:

```bash
npx hardhat run scripts/zk/register-locker.ts --network polygon
```

### "Invalid proof" on contract

- Ensure chainId matches the network (137 for Polygon)
- Check that amount matches exactly
- Verify locker address is correct
- Ensure you're using the stripped transaction (no witness data)

### "Gas estimation failed"

Usually means the proof is invalid. Check:
- Circuit inputs match proof generation
- Public signals order is correct
- Locker hash is registered (using hash from proof, not local computation)

### "Assert Failed. Error in template line 214"

This is the commitment verification constraint. It means:
- The computed commitment doesn't match what's in the Bitcoin TX
- Usually caused by wrong recipient, amount, chainId, or secret
- This is the front-running protection working correctly

### "Deployment not found"

Make sure you've deployed to the correct network:
```bash
npm run zk:deploy
```

---

## Security Testing

### Front-Running Protection Test

We verified that submitting a proof with the wrong recipient fails:

1. Create deposit with recipient A
2. Try to generate proof with recipient B
3. **Result:** Proof generation fails at constraint line 214

The commitment includes the recipient, so only the intended recipient can claim.

### Double-Claim Prevention

After a successful claim:
1. Try to submit the same proof again
2. **Result:** Contract reverts with "PTC: already claimed"

The nullifier is marked as used after the first claim.

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `npm run zk:deploy` | Deploy ZK contracts |
| `node scripts/zk/create-btc-deposit.js --amount=1000 --recipient=0x...` | Create Bitcoin deposit |
| `node scripts/zk/generate-witness.js --deposit=<txid>.json` | Generate ZK proof |
| `CLAIM_FILE=<file> npx hardhat run scripts/zk/submit-proof.ts --network polygon` | Submit proof |
| `npx hardhat run scripts/zk/register-locker.ts --network polygon` | Register locker hash |

---

## What This Test Proves

If you see the `PrivateClaim` event on the block explorer, you've successfully demonstrated:

1. ✅ ZK proof verification works on-chain (Groth16)
2. ✅ Real Bitcoin transaction parsing works (SegWit stripping)
3. ✅ Commitment scheme is correct (SHA256 with recipient)
4. ✅ TxId verification works (double SHA256 in circuit)
5. ✅ Nullifier tracking prevents double-claims
6. ✅ Locker verification works
7. ✅ Front-running protection is effective
8. ✅ Full privacy-preserving flow is functional

**Remaining for production:** Merkle proof verification (Phase 2B)

---

*Last updated: 2026-01-23*
