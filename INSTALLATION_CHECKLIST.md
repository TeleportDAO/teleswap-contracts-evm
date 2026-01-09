# ZK Proof-of-Concept Installation Checklist

Follow these steps to set up and run the ZK proof-of-concept.

## ✅ Checklist

### 1. Install Prerequisites

- [ ] **Node.js v16+** installed
  ```bash
  node --version  # Should output v16.x.x or higher
  ```

- [ ] **Rust and Cargo** installed (for Circom)
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```

- [ ] **Circom** installed
  ```bash
  git clone https://github.com/iden3/circom.git
  cd circom
  cargo build --release
  cargo install --path circom
  cd ..
  circom --version  # Should output 2.1.x or higher
  ```

- [ ] **SnarkJS** installed globally
  ```bash
  npm install -g snarkjs
  snarkjs --version  # Should output 0.7.x or higher
  ```

### 2. Install Project Dependencies

- [ ] Install npm packages
  ```bash
  npm install
  ```

  This installs:
  - circomlib (circuit library)
  - snarkjs (proof generation)
  - ffjavascript (finite field math)

### 3. Compile the Circuit

- [ ] Run circuit compilation
  ```bash
  npm run circuit:compile
  ```

  **Expected output:**
  ```
  ✓ Circuit compiled successfully
  Generated files:
    - zkproof/build/main.r1cs
    - zkproof/build/main.wasm
    - zkproof/build/main.sym
  ```

  **Time:** ~30 seconds

### 4. Run Trusted Setup

- [ ] Run the trusted setup ceremony
  ```bash
  npm run circuit:setup
  ```

  **Confirm when prompted:**
  ```
  Continue with development setup? (y/n) y
  ```

  **Expected output:**
  ```
  ✓ Trusted setup complete!
  Generated files:
    - zkproof/build/circuit_final.zkey
    - zkproof/build/verification_key.json
    - contracts/zk/Groth16Verifier.sol
  ```

  **Time:** 2-5 minutes

### 5. Generate a Test Proof

- [ ] Generate your first proof
  ```bash
  npm run zk:generate-proof
  ```

  **Expected output:**
  ```
  ✓ Witness calculated
  ✓ Proof generated
  ✓ Calldata exported

  Generated files:
    - zkproof/build/proof.json
    - zkproof/build/public.json
    - zkproof/build/calldata.txt
  ```

  **Time:** 5-15 seconds

### 6. Verify the Proof

- [ ] Verify the generated proof
  ```bash
  npm run zk:verify-proof
  ```

  **Expected output:**
  ```
  ✓ PROOF IS VALID

  The proof successfully demonstrates:
    1. Bitcoin transaction exists and is valid
    2. Transaction is included in the specified Merkle root
    3. The vout hash matches the transaction output
    4. Verification done off-chain with only 128-byte proof on-chain
    5. ~90% reduction in on-chain data vs traditional approach
  ```

  **Time:** <1 second

### 7. Optional: Test with Hardhat

- [ ] Compile Solidity contracts (including verifier)
  ```bash
  npx hardhat compile
  ```

- [ ] Run integration tests (when available)
  ```bash
  npx hardhat test test/zk/*.test.js
  ```

## 🎉 Success Criteria

You've successfully set up the ZK proof-of-concept if:

1. ✅ All commands completed without errors
2. ✅ Proof verification shows "PROOF IS VALID"
3. ✅ All expected files are in `zkproof/build/`
4. ✅ Solidity verifier exists at `contracts/zk/Groth16Verifier.sol`

## 🐛 Troubleshooting

### Common Issues

**Problem:** `circom: command not found`
```bash
# Solution: Add cargo bin to PATH
export PATH="$HOME/.cargo/bin:$PATH"
# Add to ~/.bashrc or ~/.zshrc for permanence
```

**Problem:** `Circuit compilation failed`
```bash
# Solution: Check circom version and syntax
circom --version  # Must be 2.0.0+
# Check circuit syntax in circuits/src/main.circom
```

**Problem:** `Module 'circomlib' not found`
```bash
# Solution: Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

**Problem:** `Trusted setup takes forever`
```bash
# This is normal for first run
# Phase 1 (Powers of Tau): ~2 min
# Phase 2 (Circuit setup): ~1-2 min
# Total: ~3-5 min
```

**Problem:** `Proof generation fails`
```bash
# Solution: Check that setup completed successfully
ls -lh zkproof/build/circuit_final.zkey  # Should be ~40 MB

# If missing, re-run setup
npm run circuit:setup
```

**Problem:** `Out of memory during compilation`
```bash
# Solution: Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=8192" npm run circuit:compile
```

## 📁 Expected File Structure

After successful setup:

```
zkproof/build/
├── main.r1cs                    (~5 MB)   ✅ Constraint system
├── main.wasm                    (~10 MB)  ✅ Witness generator
├── main.sym                     (~1 MB)   ✅ Symbols
├── circuit_final.zkey           (~40 MB)  ✅ Proving key
├── verification_key.json        (~1 KB)   ✅ Verification key
├── proof.json                   (~1 KB)   ✅ Generated proof
├── public.json                  (~200 B)  ✅ Public signals
├── calldata.txt                 (~500 B)  ✅ Solidity calldata
└── ptau/                        (~50 MB)  ✅ Powers of Tau files

contracts/zk/
└── Groth16Verifier.sol          (~10 KB)  ✅ Solidity verifier
```

## 🔍 Verification Commands

Check everything is working:

```bash
# 1. Check circuit was compiled
ls -lh zkproof/build/main.r1cs zkproof/build/main.wasm

# 2. Check trusted setup completed
ls -lh zkproof/build/circuit_final.zkey zkproof/build/verification_key.json

# 3. Check proof was generated
ls -lh zkproof/build/proof.json zkproof/build/public.json

# 4. Check Solidity verifier exists
ls -lh contracts/zk/Groth16Verifier.sol

# 5. Verify proof again
npm run zk:verify-proof
```

## 📊 Performance Benchmarks

Expected timings on modern hardware:

| Task | Time | Resource |
|------|------|----------|
| Circuit compile | 20-40s | CPU intensive |
| Trusted setup (Phase 1) | 1-3 min | CPU + Memory |
| Trusted setup (Phase 2) | 1-2 min | CPU + Memory |
| Proof generation | 5-15s | CPU intensive |
| Proof verification | <1s | Minimal |
| Memory usage | ~4-8 GB | Peak during setup |

## 🎯 Next Steps

After successful installation:

1. **Read the documentation**
   - `circuits/README.md` - Circuit architecture
   - `ZK_PROOF_OF_CONCEPT.md` - Complete guide

2. **Explore the code**
   - `circuits/src/main.circom` - Main circuit
   - `circuits/src/merkle_proof.circom` - Merkle verifier
   - `zkproof/scripts/` - Proof generation scripts

3. **Experiment**
   - Modify circuit parameters
   - Try different input values
   - Understand constraint satisfaction

4. **Integrate**
   - Study Solidity verifier contract
   - Plan integration with CcExchangeRouter
   - Design production architecture

## ✉️ Get Help

If you're stuck:

1. Check the troubleshooting section above
2. Review error messages carefully
3. Open an issue on GitHub
4. Contact the development team

---

**Ready to dive deeper? Read `ZK_PROOF_OF_CONCEPT.md` for the complete guide!**
