#!/bin/bash

# Trusted Setup Script for Groth16
# Generates proving and verification keys

set -e

echo "================================================"
echo "   ZK-SNARK Trusted Setup (Groth16)"
echo "================================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if snarkjs is installed
if ! command -v snarkjs &> /dev/null; then
    echo -e "${RED}Error: snarkjs is not installed${NC}"
    echo "Install with: npm install -g snarkjs"
    exit 1
fi

echo -e "${GREEN}✓ snarkjs found: $(snarkjs --version)${NC}"
echo ""

# Paths (work from circuits directory or project root)
if [ -d "src" ]; then
    # Called from circuits directory
    BUILD_DIR="../zkproof/build"
else
    # Called from project root
    BUILD_DIR="zkproof/build"
fi
PTAU_DIR="$BUILD_DIR/ptau"

# Check if circuit is compiled
if [ ! -f "$BUILD_DIR/main.r1cs" ]; then
    echo -e "${RED}Error: Circuit not compiled${NC}"
    echo "Run: npm run circuit:compile"
    exit 1
fi

# Create ptau directory
mkdir -p $PTAU_DIR

echo -e "${YELLOW}This is a DEVELOPMENT setup - NOT for production use${NC}"
echo "For production, use a multi-party ceremony with proper security"
echo ""
read -p "Continue with development setup? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Setup cancelled"
    exit 0
fi

echo ""
echo "================================================"
echo "   Phase 1: Powers of Tau Ceremony"
echo "================================================"
echo ""

# Determine circuit size (number of constraints)
CONSTRAINTS=$(snarkjs r1cs info $BUILD_DIR/main.r1cs 2>/dev/null | grep "# of Constraints" | awk '{print $NF}')
echo "Circuit has $CONSTRAINTS constraints"

# Calculate required power (next power of 2)
POWER=12  # Default to 2^12 = 4096 constraints
if [ $CONSTRAINTS -gt 4096 ]; then
    POWER=14  # 2^14 = 16384
fi
if [ $CONSTRAINTS -gt 16384 ]; then
    POWER=16  # 2^16 = 65536
fi
if [ $CONSTRAINTS -gt 65536 ]; then
    POWER=18  # 2^18 = 262144
fi

echo "Using power of tau: $POWER (supports up to $((2**POWER)) constraints)"
echo ""

PTAU_FILE="$PTAU_DIR/pot${POWER}_final.ptau"

# Check if powers of tau already exists
if [ -f "$PTAU_FILE" ]; then
    echo -e "${GREEN}✓ Powers of Tau file already exists${NC}"
    echo "  $PTAU_FILE"
else
    echo -e "${YELLOW}Step 1.1: Starting new Powers of Tau ceremony...${NC}"
    snarkjs powersoftau new bn128 $POWER $PTAU_DIR/pot${POWER}_0000.ptau -v

    echo ""
    echo -e "${YELLOW}Step 1.2: Contributing to the ceremony...${NC}"
    snarkjs powersoftau contribute $PTAU_DIR/pot${POWER}_0000.ptau $PTAU_DIR/pot${POWER}_0001.ptau \
        --name="First contribution" -v -e="random entropy $(date +%s)"

    echo ""
    echo -e "${YELLOW}Step 1.3: Applying random beacon...${NC}"
    snarkjs powersoftau beacon $PTAU_DIR/pot${POWER}_0001.ptau $PTAU_DIR/pot${POWER}_beacon.ptau \
        0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 -n="Final Beacon"

    echo ""
    echo -e "${YELLOW}Step 1.4: Preparing phase 2...${NC}"
    snarkjs powersoftau prepare phase2 $PTAU_DIR/pot${POWER}_beacon.ptau $PTAU_FILE -v

    echo -e "${GREEN}✓ Powers of Tau ceremony complete${NC}"
fi

echo ""
echo "================================================"
echo "   Phase 2: Circuit-Specific Setup"
echo "================================================"
echo ""

echo -e "${YELLOW}Step 2.1: Generating zkey (proving key)...${NC}"
snarkjs groth16 setup $BUILD_DIR/main.r1cs $PTAU_FILE $BUILD_DIR/circuit_0000.zkey

echo ""
echo -e "${YELLOW}Step 2.2: Contributing to zkey...${NC}"
snarkjs zkey contribute $BUILD_DIR/circuit_0000.zkey $BUILD_DIR/circuit_final.zkey \
    --name="1st Contributor" -v -e="random entropy $(date +%s)"

echo ""
echo -e "${YELLOW}Step 2.3: Exporting verification key...${NC}"
snarkjs zkey export verificationkey $BUILD_DIR/circuit_final.zkey $BUILD_DIR/verification_key.json

echo -e "${GREEN}✓ Verification key exported${NC}"

echo ""
echo "================================================"
echo "   Phase 3: Generating Solidity Verifier"
echo "================================================"
echo ""

echo -e "${YELLOW}Step 3.1: Generating Solidity verifier contract...${NC}"
if [ -d "src" ]; then
    VERIFIER_PATH="../contracts/zk/Groth16Verifier.sol"
else
    VERIFIER_PATH="contracts/zk/Groth16Verifier.sol"
fi
snarkjs zkey export solidityverifier $BUILD_DIR/circuit_final.zkey $VERIFIER_PATH

echo -e "${GREEN}✓ Solidity verifier generated${NC}"

echo ""
echo "================================================"
echo "   Setup Summary"
echo "================================================"
echo "Generated files:"
echo "  - $BUILD_DIR/circuit_final.zkey       (Proving key)"
echo "  - $BUILD_DIR/verification_key.json    (Verification key)"
echo "  - $VERIFIER_PATH    (Solidity verifier)"
echo ""
echo -e "${GREEN}✓ Trusted setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Generate a proof: npm run zk:generate-proof"
echo "  2. Verify the proof: npm run zk:verify-proof"
echo "  3. Test on-chain: npx hardhat test test/zk/*.test.js"
echo ""
echo -e "${YELLOW}⚠ WARNING: This setup is for DEVELOPMENT only${NC}"
echo "For production, conduct a proper multi-party ceremony"
echo ""
