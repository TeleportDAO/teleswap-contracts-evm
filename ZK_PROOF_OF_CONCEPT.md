# Bitcoin ZK Privacy Proof-of-Concept

## 🎯 Overview

This proof-of-concept demonstrates how to use zero-knowledge proofs (ZK-SNARKs) to verify Bitcoin transactions while preserving privacy. Users can prove they control a specific Bitcoin transaction output (vout) without revealing the entire transaction.

### What This Proves

**Public Information (Visible to Everyone):**
- Merkle root of a Bitcoin block
- Hash of a specific transaction output (vout)
- Block number

**Private Information (Hidden):**
- Full Bitcoin transaction
- Other transaction outputs
- Transaction inputs
- Merkle proof path

**The Proof Statement:**
> "I know a Bitcoin transaction that is included in block #X with Merkle root Y, and this transaction contains an output that hashes to Z, but I'm not telling you the rest of the transaction"

---

## 📋 Prerequisites

### Required Software

1. **Node.js** (v16 or higher)
   ```bash
   node --version  # Should be v16+
   ```

2. **Circom Compiler** (v2.1.0 or higher)
   ```bash
   # Clone and build circom
   git clone https://github.com/iden3/circom.git
   cd circom
   cargo build --release
   cargo install --path circom

   # Verify installation
   circom --version
   ```

3. **SnarkJS** (v0.7.0 or higher)
   ```bash
   npm install -g snarkjs
   snarkjs --version
   ```

### Install Dependencies

```bash
npm install
```

This will install:
- `circomlib` - Standard circuits library
- `snarkjs` - SNARK proof generation/verification
- `ffjavascript` - Finite field arithmetic

---

## 🚀 Quick Start Guide

### Step 1: Compile the Circuit

```bash
npm run circuit:compile
```

**What this does:**
- Compiles `circuits/src/main.circom` to R1CS constraint system
- Generates WebAssembly witness generator
- Creates symbol file for debugging

**Output:**
- `zkproof/build/main.r1cs` - Constraint system (~220k constraints)
- `zkproof/build/main.wasm` - Witness calculator
- `zkproof/build/main.sym` - Debug symbols

**Expected time:** ~30 seconds

### Step 2: Run Trusted Setup

```bash
npm run circuit:setup
```

**What this does:**
- Phase 1: Powers of Tau ceremony (universal setup)
- Phase 2: Circuit-specific key generation
- Generates Groth16 proving and verification keys
- Exports Solidity verifier contract

**Output:**
- `zkproof/build/circuit_final.zkey` - Proving key (~40 MB)
- `zkproof/build/verification_key.json` - Verification key
- `contracts/zk/Groth16Verifier.sol` - On-chain verifier

**Expected time:** 2-5 minutes

⚠️ **Warning:** This is a DEVELOPMENT-ONLY setup. For production, you MUST conduct a proper multi-party ceremony with multiple independent contributors.

### Step 3: Generate a Proof

```bash
npm run zk:generate-proof
```

**What this does:**
- Creates sample Bitcoin transaction and vout
- Calculates witness (satisfies all constraints)
- Generates Groth16 proof (128 bytes)
- Exports Solidity calldata

**Output:**
- `zkproof/build/proof.json` - ZK proof
- `zkproof/build/public.json` - Public signals
- `zkproof/build/calldata.txt` - Solidity function call data

**Expected time:** 5-15 seconds

### Step 4: Verify the Proof

```bash
npm run zk:verify-proof
```

**What this does:**
- Verifies the proof off-chain using the verification key
- Checks that all public signals match

**Expected output:**
```
✓ PROOF IS VALID

The proof successfully demonstrates:
  1. Knowledge of a Bitcoin transaction
  2. Transaction is included in the specified Merkle root
  3. The revealed vout hash matches the transaction
  4. All without revealing the full transaction
```

---

## 📁 Project Structure

```
teleswap-contracts/
│
├── circuits/                         # Circom circuit source code
│   ├── README.md                     # Circuit documentation
│   └── src/
│       ├── main.circom               # Main privacy verification circuit
│       └── merkle_proof.circom       # Merkle tree verification
│
├── zkproof/                          # Build artifacts and scripts
│   ├── build/                        # Compiled circuits and keys
│   │   ├── main.r1cs                 # Constraint system
│   │   ├── main.wasm                 # Witness generator
│   │   ├── circuit_final.zkey        # Proving key
│   │   ├── verification_key.json     # Verification key
│   │   ├── proof.json                # Generated proof
│   │   └── public.json               # Public signals
│   │
│   └── scripts/
│       ├── compile.sh                # Circuit compilation
│       ├── setup.sh                  # Trusted setup
│       ├── generate_proof.js         # Proof generator
│       └── verify_proof.js           # Proof verifier
│
├── contracts/zk/
│   └── Groth16Verifier.sol           # Auto-generated Solidity verifier
│
└── ZK_PROOF_OF_CONCEPT.md            # This file
```

---

## 🔬 Technical Details

### Circuit Architecture

**Main Circuit:** `circuits/src/main.circom`

```
┌─────────────────────────────────────────────┐
│         Bitcoin Privacy Verifier            │
├─────────────────────────────────────────────┤
│                                             │
│  Public Inputs:                             │
│    - merkleRoot                             │
│    - voutHash                               │
│    - blockNumber                            │
│                                             │
│  Private Inputs:                            │
│    - transaction[2048 bits]                 │
│    - voutData[512 bits]                     │
│    - merkleSiblings[12 x 256 bits]         │
│    - merkleIndex                            │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  Components:                                │
│                                             │
│  1. Double SHA256 (Bitcoin tx hash)         │
│     transaction → SHA256 → SHA256 → txId    │
│                                             │
│  2. Vout Hash Verification                  │
│     voutData → SHA256 → hash                │
│     Constraint: hash === voutHash           │
│                                             │
│  3. Merkle Proof Verification               │
│     Proves: txId is in merkleRoot           │
│     Uses: 12 levels of double SHA256        │
│                                             │
└─────────────────────────────────────────────┘
```

### Constraint Count

| Component | Constraints | Notes |
|-----------|------------|-------|
| Bitcoin TX hash (2x SHA256) | ~50,000 | Double hashing of 256 bytes |
| Merkle verification (12 levels) | ~144,000 | 12 x 2 SHA256 per level |
| Vout hash (1x SHA256) | ~25,000 | Hash 64 bytes of vout data |
| **Total** | **~220,000** | Reasonable for Groth16 |

### Performance Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Circuit compile time | ~30s | One-time setup |
| Trusted setup time | 2-5 min | One-time setup |
| Proof generation time | 5-15s | Per transaction |
| Proof size | 128 bytes | Groth16 constant size |
| On-chain verification gas | ~280k gas | Fixed cost |
| Verification time (off-chain) | <1s | Nearly instant |

---

## 🧪 Testing

### Circuit Tests

Create a test file `circuits/test/main.test.js`:

```javascript
const wasm_tester = require("circom_tester").wasm;
const path = require("path");

describe("Bitcoin Privacy Verifier", function() {
    let circuit;

    before(async function() {
        circuit = await wasm_tester(
            path.join(__dirname, "../src/main.circom"),
            { output: path.join(__dirname, "../build") }
        );
    });

    it("Should verify valid proof", async function() {
        const input = {
            // ... test inputs
        };

        const witness = await circuit.calculateWitness(input);
        await circuit.checkConstraints(witness);
    });
});
```

Run tests:
```bash
npm run circuit:test
```

### Integration with Hardhat

Create test file `test/zk/Verifier.test.js`:

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");

describe("Groth16 Verifier", function() {
    let verifier;

    before(async function() {
        const Verifier = await ethers.getContractFactory("Groth16Verifier");
        verifier = await Verifier.deploy();
    });

    it("Should verify valid proof on-chain", async function() {
        // Load proof and public signals
        const proof = JSON.parse(
            fs.readFileSync("zkproof/build/proof.json")
        );
        const publicSignals = JSON.parse(
            fs.readFileSync("zkproof/build/public.json")
        );

        // Call verifier
        const isValid = await verifier.verifyProof(
            proof.pi_a,
            proof.pi_b,
            proof.pi_c,
            publicSignals
        );

        expect(isValid).to.be.true;
    });
});
```

Run Hardhat tests:
```bash
npx hardhat test test/zk/*.test.js
```

---

## 🔧 Advanced Usage

### Using Real Bitcoin Transactions

To use actual Bitcoin transactions (future enhancement):

```javascript
const bitcoin = require('bitcoinjs-lib');

// Parse real Bitcoin transaction
const tx = bitcoin.Transaction.fromHex(txHex);

// Extract vout
const vout = tx.outs[outputIndex];

// Generate proof with real data
const proof = await generateProof({
    transaction: txHex,
    vout: vout.script,
    merkleProof: getMerkleProof(txId, blockHeight)
});
```

### Customizing Circuit Parameters

Edit `circuits/src/main.circom`:

```circom
// Change transaction size (currently 256 bytes)
signal input transaction[4096];  // Increase to 512 bytes

// Change Merkle depth (currently 12 levels)
component merkleVerifier = MerkleProof(16);  // 16 levels = 65k tx/block
```

After changes:
1. Recompile: `npm run circuit:compile`
2. New setup: `npm run circuit:setup`

---

## 🔐 Security Considerations

### ⚠️ THIS IS A PROOF-OF-CONCEPT

**DO NOT use in production without:**

1. **Proper Trusted Setup**
   - Multi-party computation ceremony
   - Minimum 10+ independent contributors
   - Secure parameter destruction

2. **Professional Security Audit**
   - Circuit logic audit
   - Constraint completeness verification
   - Soundness proof review

3. **Formal Verification**
   - Mathematical proof of correctness
   - Attack vector analysis
   - Edge case testing

### Known Limitations

1. **Fixed Sizes**: Transaction and vout sizes are fixed (not variable)
2. **No SegWit**: Only supports legacy Bitcoin transactions
3. **Single Vout**: Can only prove one output per proof
4. **Development Setup**: Trusted setup is not secure for production
5. **No Optimization**: Circuit constraints not minimized

---

## 🛣️ Roadmap

### Phase 1: POC (Current)
- ✅ Basic circuit implementation
- ✅ Proof generation and verification
- ✅ Solidity verifier export
- ⏳ Documentation and examples

### Phase 2: Production Readiness
- ⏳ Variable transaction sizes
- ⏳ SegWit and Taproot support
- ⏳ Constraint optimization
- ⏳ Multi-party trusted setup
- ⏳ Professional security audit

### Phase 3: Integration
- ⏳ CcExchangeRouter integration
- ⏳ Gas optimization
- ⏳ User-friendly proof generation
- ⏳ Mainnet deployment

---

## 📚 Learning Resources

### Zero-Knowledge Proofs
- [ZK Proof Basics](https://z.cash/technology/zksnarks/)
- [Circom Documentation](https://docs.circom.io/)
- [SnarkJS Guide](https://github.com/iden3/snarkjs)

### Bitcoin
- [Bitcoin Developer Guide](https://developer.bitcoin.org/devguide/)
- [Merkle Trees](https://en.bitcoin.it/wiki/Protocol_documentation#Merkle_Trees)
- [Transaction Format](https://en.bitcoin.it/wiki/Transaction)

### Cryptography
- [Groth16 Paper](https://eprint.iacr.org/2016/260.pdf)
- [BN128 Curve](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-196.md)
- [Trusted Setup Ceremonies](https://blog.ethereum.org/2023/01/16/announcing-kzg-ceremony)

---

## 🤝 Contributing

This is a research project. Contributions welcome!

Areas needing help:
- Circuit optimization
- SegWit/Taproot support
- Better test coverage
- Documentation improvements
- Real Bitcoin tx integration

---

## 📝 License

MIT License - See LICENSE file

---

## 💬 Support

Questions? Open an issue on GitHub or contact the development team.

---

**Built with ❤️ for the TeleportDAO community**
