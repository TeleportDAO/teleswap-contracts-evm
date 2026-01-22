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

### 1. Install Bitcoin Dependencies

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
BTC_AMOUNT_SATS=100000               # Amount to send (in satoshis)
EVM_CHAIN_ID=137                     # Chain ID (137 for Polygon)
EVM_RECIPIENT=0x...                  # Address to receive TeleBTC

# Verification (optional)
VERIFY_OPTION=1                      # Set to 1 to verify contracts
```

### 3. Fund Your Wallets

- **EVM Chain**: Need native token for gas (~0.5 MATIC/ETH for deployment + claims)
- **Bitcoin**: Need BTC for the deposit + fees (~0.001 BTC minimum)

---

## Project Structure

```
teleswap-contracts/
├── config/
│   ├── polygon.json           # Network-specific config (chain_id, etc.)
│   └── zk.json                # ZK-specific config (paths, networks)
├── contracts/zk/              # ZK Solidity contracts
│   ├── Groth16Verifier.sol
│   ├── PrivateTransferClaim.sol
│   └── PrivateTransferClaimTest.sol
├── deploy/zk/                 # Hardhat-deploy scripts
│   ├── 001_Groth16Verifier.ts
│   └── 002_PrivateTransferClaimTest.ts
├── scripts/zk/                # Operational scripts
│   ├── register-locker.ts
│   └── submit-claim.ts
└── zkproof/                   # Circuit and proof artifacts
    ├── build/                 # Compiled circuit artifacts
    ├── deposits/              # Deposit data files
    ├── claims/                # Generated claim files
    └── lockers/               # Registered locker info
```

---

## Step 1: Deploy Contracts

Deploy using the standard deploy command with the `zk` tag:

```bash
NETWORK=polygon npm run zk:deploy
```

Or explicitly:

```bash
NODE_ENV=polygon hardhat deploy --tags zk --network polygon
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
  Implementation deployed at: 0x...

╔════════════════════════════════════════════════════════════╗
║                  ZK DEPLOYMENT COMPLETE                    ║
╚════════════════════════════════════════════════════════════╝
```

Deployment info is saved by hardhat-deploy to: `deployments/<network>/`

---

## Step 2: Register Locker Hash

Register the locker's Bitcoin address hash on the contract:

```bash
NETWORK=polygon npm run zk:register-locker
```

**What it does:**
1. Converts `BTC_LOCKER_ADDRESS` to a P2PKH script
2. Computes the script hash (as the circuit does)
3. Registers it on the contract

**Locker info saved to:** `zkproof/lockers/<address>.json`

---

## Step 3: Create Bitcoin Deposit

Send BTC to the locker with a commitment in OP_RETURN:

```bash
npm run zk:create-deposit
```

**What it does:**
1. Generates a random 256-bit secret
2. Computes commitment = SHA256(secret || amount || chainId)
3. Builds a Bitcoin transaction:
   - Output 0: Payment to locker
   - Output 1: OP_RETURN with commitment
4. Signs with your private key
5. Asks for confirmation before broadcasting
6. Saves deposit data to `zkproof/deposits/<txid>.json`

**Wait for confirmations** (6+ blocks recommended for mainnet)

---

## Step 4: Generate ZK Proof

Once the Bitcoin transaction is confirmed, generate the ZK claim proof:

```bash
npm run zk:generate-claim -- --deposit=<txid>.json
```

Or if you have the txid and secret separately:

```bash
npm run zk:generate-claim -- --txid=<txid> --secret=<hex> --lockerScript=<hex> --recipient=<addr>
```

**What it does:**
1. Fetches the Bitcoin transaction from mempool.space
2. Parses the transaction to find locker output and commitment
3. Generates circuit inputs
4. Runs ZK proof generation
5. Verifies the proof locally
6. Exports Solidity calldata
7. Saves claim data to `zkproof/claims/<txid>.json`

---

## Step 5: Submit Claim

Submit the ZK proof to the contract:

```bash
NETWORK=polygon npm run zk:submit-claim -- --claim=<txid>.json
```

**What it does:**
1. Loads the claim data
2. Verifies locker hash is registered
3. Checks nullifier not already used
4. Estimates gas
5. Asks for confirmation
6. Submits the claim transaction
7. Waits for confirmation and checks for PrivateClaim event

---

## Configuration

### Network Config (`config/<network>.json`)

Contains chain-specific settings (used by all contracts):
- `chain_id`: EVM chain ID
- `proxy_admin`: Proxy admin address
- Other network-specific parameters

### ZK Config (`config/zk.json`)

Contains ZK-specific settings:
```json
{
    "circuit": {
        "build_path": "zkproof/build",
        "wasm_path": "zkproof/build/main_js/main.wasm",
        "zkey_path": "zkproof/build/circuit_final.zkey"
    },
    "supported_networks": {
        "polygon": {
            "enabled": true,
            "block_explorer": "https://polygonscan.com"
        }
    },
    "bitcoin": {
        "network": "mainnet",
        "mempool_api": "https://mempool.space/api",
        "confirmation_blocks": 6
    }
}
```

---

## Troubleshooting

### "Insufficient funds" on Bitcoin

- Check your balance: `https://mempool.space/address/<your_address>`
- Ensure UTXOs are confirmed
- Account for fees (~10 sat/vbyte)

### "Locker hash not registered"

Run:
```bash
NETWORK=polygon npm run zk:register-locker
```

### "Invalid proof" on contract

- Ensure chainId matches the network
- Check that amount matches exactly
- Verify locker address is correct

### "Gas estimation failed"

Usually means the proof is invalid. Check:
- Circuit inputs match proof generation
- Public signals order is correct
- No transaction parsing errors

### "Deployment not found"

Make sure you've deployed to the correct network:
```bash
NETWORK=polygon npm run zk:deploy
```

---

## Security Notes

1. **Secret Protection**: Never share your secret. It's the only way to claim.
2. **Test First**: Use small amounts for initial testing.
3. **No Minting**: The test contract doesn't mint tokens - just verifies proofs.
4. **Nullifier Tracking**: Each claim can only be made once.

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `NETWORK=polygon npm run zk:deploy` | Deploy ZK contracts |
| `NETWORK=polygon npm run zk:register-locker` | Register locker hash |
| `npm run zk:create-deposit` | Create Bitcoin deposit TX |
| `npm run zk:generate-claim -- --deposit=<file>` | Generate ZK proof |
| `NETWORK=polygon npm run zk:submit-claim -- --claim=<file>` | Submit claim |

---

## What This Test Proves

If you see the `PrivateClaim` event on the block explorer, you've successfully demonstrated:

1. ZK proof verification works on-chain
2. Real Bitcoin transaction parsing works
3. Commitment scheme is correct
4. Nullifier tracking prevents double-claims
5. Locker verification works
6. Full privacy-preserving flow is functional

**This is production-ready** (minus Merkle verification, which is Phase 2).
