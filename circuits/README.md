# ZK Bitcoin Transaction Verification - Proof of Concept

## Overview

This proof-of-concept implements zero-knowledge proofs for Bitcoin transaction verification, allowing users to prove transaction inclusion in a Bitcoin block without revealing the entire transaction details.

## What We're Proving

**Public Inputs:**
- `merkleRoot`: The Merkle root from a Bitcoin block header
- `blockNumber`: The Bitcoin block number
- `voutHash`: Hash of the specific vout we want to reveal
- `outputIndex`: Which output position in the transaction

**Private Inputs:**
- Full Bitcoin transaction (version, vin, vout, locktime)
- Merkle proof siblings
- Transaction index in the Merkle tree

**Proof Statement:**
```
"I know a Bitcoin transaction tx such that:
  1. SHA256(SHA256(tx)) is included in the merkleRoot at the given index
  2. SHA256(tx.vout[outputIndex]) == voutHash
  3. All other transaction details remain private"
```

## Directory Structure

```
circuits/
├── README.md                          # This file
├── src/                               # Circuit source files
│   ├── main.circom                    # Main circuit entry point
│   ├── bitcoin_tx_hasher.circom       # Bitcoin transaction hasher
│   ├── merkle_proof.circom            # Merkle tree verification
│   └── utils.circom                   # Utility circuits
├── test/                              # Circuit tests
│   └── main.test.js                   # Test suite
└── input.json                         # Sample input for testing

zkproof/
├── build/                             # Compiled circuits and keys
│   ├── main.r1cs                      # Constraint system
│   ├── main.wasm                      # WebAssembly witness generator
│   ├── main.sym                       # Symbols file
│   ├── circuit_final.zkey             # Proving key
│   └── verification_key.json          # Verification key
└── scripts/                           # Helper scripts
    ├── compile.sh                     # Compile circuits
    ├── setup.sh                       # Trusted setup
    ├── generate_proof.js              # Generate proofs
    └── verify_proof.js                # Verify proofs

contracts/zk/
└── Verifier.sol                       # Auto-generated Groth16 verifier
```

## Prerequisites

### Install Circom and SnarkJS

```bash
# Install circom compiler
git clone https://github.com/iden3/circom.git
cd circom
cargo build --release
cargo install --path circom
cd ..

# Install snarkjs
npm install -g snarkjs@latest

# Verify installation
circom --version  # Should show v2.1.0 or higher
snarkjs --version # Should show 0.7.0 or higher
```

### Install Dependencies

```bash
npm install --save-dev circomlib snarkjs ffjavascript
```

## Quick Start

### 1. Compile the Circuit

```bash
cd circuits
./zkproof/scripts/compile.sh
```

### 2. Run Trusted Setup

```bash
./zkproof/scripts/setup.sh
```

This will:
- Generate Powers of Tau ceremony files
- Create circuit-specific proving/verification keys
- Export Solidity verifier contract

### 3. Generate a Proof

```bash
node zkproof/scripts/generate_proof.js \
  --tx "01000000..." \
  --merkle-proof "[sibling1, sibling2, ...]" \
  --output-index 0
```

### 4. Verify the Proof

```bash
# Off-chain verification
node zkproof/scripts/verify_proof.js --proof proof.json --public public.json

# On-chain verification (via Hardhat)
npx hardhat test test/zk/verifier.test.js
```

## Circuit Complexity

### Simplified POC Version

For the proof-of-concept, we're using a **simplified version** to validate the approach:

- **Fixed transaction size**: Max 1KB
- **Fixed Merkle depth**: 12 levels (supports 4096 transactions/block)
- **Single vout extraction**: Only one output revealed

**Estimated Constraints:**
- Double SHA256 (txId): ~50,000 constraints
- Merkle verification (12 levels): ~144,000 constraints
- Vout hash: ~25,000 constraints
- **Total: ~220,000 constraints**

**Performance:**
- Proof generation time: ~5-10 seconds
- Proof size: 128 bytes (Groth16)
- Verification gas: ~280,000 gas

### Production Version (Future)

The production version would include:
- Variable transaction sizes (up to 100KB)
- Dynamic Merkle depth (up to 20 levels)
- Multiple vout extraction
- SegWit support
- Taproot support

## Testing Strategy

### Phase 1: Circuit Testing
1. Test individual components (SHA256, Merkle, etc.)
2. Test with real Bitcoin transactions from testnet
3. Verify constraint satisfiability

### Phase 2: Integration Testing
1. Generate proofs for various Bitcoin transactions
2. Verify proofs on-chain via Hardhat tests
3. Test gas consumption

### Phase 3: End-to-End Testing
1. Integrate with CcExchangeRouter
2. Test full wrapAndSwap flow with ZK proofs
3. Compare with existing implementation

## Known Limitations (POC)

1. **Fixed Sizes**: Transaction and Merkle tree sizes are fixed
2. **No SegWit**: Only supports legacy transactions
3. **Single Output**: Can only prove one vout at a time
4. **Trusted Setup**: Requires ceremony (using Groth16)
5. **Gas Cost**: Higher than current implementation (~230k extra gas)

## Next Steps

After POC validation:

1. **Optimize Circuits**: Reduce constraint count
2. **Dynamic Sizing**: Support variable transaction sizes
3. **SegWit Support**: Add witness data handling
4. **PLONK Migration**: Consider PLONK to avoid trusted setup
5. **Security Audit**: Comprehensive circuit audit
6. **Production Deployment**: Integrate with mainnet

## Resources

- [Circom Documentation](https://docs.circom.io/)
- [SnarkJS Documentation](https://github.com/iden3/snarkjs)
- [Bitcoin Developer Guide](https://developer.bitcoin.org/devguide/)
- [Groth16 Paper](https://eprint.iacr.org/2016/260.pdf)

## Security Considerations

⚠️ **WARNING: This is a proof-of-concept and NOT production-ready**

- Circuits have not been audited
- Trusted setup has not been performed securely
- No formal verification has been done
- Use only for testing and evaluation

## Support

For questions or issues, please open an issue on GitHub or contact the development team.
