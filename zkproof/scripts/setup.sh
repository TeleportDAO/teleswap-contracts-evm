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
if [ -f "src/main.circom" ]; then
    # Called from circuits directory (check for actual circom file, not just src/)
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

# Check if powers of tau already exists and verify it
if [ -f "$PTAU_FILE" ]; then
    echo -e "${YELLOW}Checking existing Powers of Tau file...${NC}"
    if snarkjs powersoftau verify "$PTAU_FILE" >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Powers of Tau file exists and is valid${NC}"
        echo "  $PTAU_FILE"
    else
        echo -e "${RED}✗ Powers of Tau file is corrupted, regenerating...${NC}"
        rm -f "$PTAU_DIR/pot${POWER}"*.ptau
        # Fall through to regeneration
    fi
fi

# Regenerate if file doesn't exist or was corrupted
if [ ! -f "$PTAU_FILE" ]; then
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

# Check if zkey already exists (skip verification for faster dev setup)
if [ -f "$BUILD_DIR/circuit_0000.zkey" ] && [ -s "$BUILD_DIR/circuit_0000.zkey" ]; then
    echo -e "${GREEN}✓ zkey file exists${NC}"
    echo "  $BUILD_DIR/circuit_0000.zkey"
    echo -e "${YELLOW}(Skipping verification for faster dev setup)${NC}"
fi

# Regenerate if file doesn't exist or was corrupted
if [ ! -f "$BUILD_DIR/circuit_0000.zkey" ]; then
    echo -e "${YELLOW}Step 2.1: Generating zkey (proving key)...${NC}"
    
    # Estimate time based on constraints (rough estimate: ~1000 constraints per minute)
    ESTIMATED_MINUTES=$((CONSTRAINTS / 1000))
    if [ $ESTIMATED_MINUTES -lt 1 ]; then
        ESTIMATED_MINUTES=1
    fi
    if [ $ESTIMATED_MINUTES -gt 60 ]; then
        ESTIMATED_HOURS=$((ESTIMATED_MINUTES / 60))
        echo -e "${YELLOW}⚠ WARNING: This may take ${ESTIMATED_HOURS}+ hours for ${CONSTRAINTS} constraints${NC}"
        echo -e "${YELLOW}   This is CPU-intensive and will use 100% of one CPU core${NC}"
    else
        echo -e "${YELLOW}Estimated time: ~${ESTIMATED_MINUTES} minutes${NC}"
    fi
    echo -e "${YELLOW}Monitoring progress (file size will grow as it processes)...${NC}"
    echo ""
    
    # Start monitoring file size in background
    (
        while [ ! -f "$BUILD_DIR/circuit_0000.zkey" ] || [ ! -s "$BUILD_DIR/circuit_0000.zkey" ]; do
            sleep 5
        done
        PREV_SIZE=0
        while true; do
            if [ -f "$BUILD_DIR/circuit_0000.zkey" ]; then
                CURRENT_SIZE=$(stat -f%z "$BUILD_DIR/circuit_0000.zkey" 2>/dev/null || stat -c%s "$BUILD_DIR/circuit_0000.zkey" 2>/dev/null || echo 0)
                if [ "$CURRENT_SIZE" -gt "$PREV_SIZE" ]; then
                    SIZE_MB=$((CURRENT_SIZE / 1024 / 1024))
                    echo -e "${GREEN}[Progress] zkey file size: ${SIZE_MB} MB${NC}"
                    PREV_SIZE=$CURRENT_SIZE
                fi
            fi
            sleep 30
        done
    ) &
    MONITOR_PID=$!
    
    # Run the setup command with unbuffered output
    snarkjs groth16 setup $BUILD_DIR/main.r1cs $PTAU_FILE $BUILD_DIR/circuit_0000.zkey -v || SETUP_EXIT=$?
    
    # Stop the monitor
    kill $MONITOR_PID 2>/dev/null || true
    wait $MONITOR_PID 2>/dev/null || true
    
    if [ -n "$SETUP_EXIT" ] && [ "$SETUP_EXIT" -ne 0 ]; then
        echo -e "${RED}✗ zkey generation failed${NC}"
        exit $SETUP_EXIT
    fi
    
    if [ -f "$BUILD_DIR/circuit_0000.zkey" ]; then
        FINAL_SIZE=$(stat -f%z "$BUILD_DIR/circuit_0000.zkey" 2>/dev/null || stat -c%s "$BUILD_DIR/circuit_0000.zkey" 2>/dev/null || echo 0)
        FINAL_SIZE_MB=$((FINAL_SIZE / 1024 / 1024))
        echo -e "${GREEN}✓ zkey generated successfully (${FINAL_SIZE_MB} MB)${NC}"
    fi
fi

echo ""
# Check if final zkey already exists (skip verification for faster dev setup)
if [ -f "$BUILD_DIR/circuit_final.zkey" ] && [ -s "$BUILD_DIR/circuit_final.zkey" ]; then
    echo -e "${GREEN}✓ Final zkey file exists${NC}"
    echo "  $BUILD_DIR/circuit_final.zkey"
    echo -e "${YELLOW}(Skipping verification for faster dev setup)${NC}"
fi

# Regenerate if file doesn't exist or was corrupted
if [ ! -f "$BUILD_DIR/circuit_final.zkey" ]; then
    echo -e "${YELLOW}Step 2.2: Contributing to zkey...${NC}"
    snarkjs zkey contribute $BUILD_DIR/circuit_0000.zkey $BUILD_DIR/circuit_final.zkey \
        --name="1st Contributor" -v -e="random entropy $(date +%s)"
fi

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
if [ -f "src/main.circom" ]; then
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
