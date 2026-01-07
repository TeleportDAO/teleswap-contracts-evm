#!/bin/bash

# Circuit Compilation Script
# Compiles circom circuits to R1CS, WASM, and symbols

set -e

echo "================================================"
echo "   Bitcoin ZK Circuit Compilation"
echo "================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if circom is installed
if ! command -v circom &> /dev/null; then
    echo -e "${RED}Error: circom is not installed${NC}"
    echo "Please install circom from: https://docs.circom.io/getting-started/installation/"
    echo ""
    echo "Quick install:"
    echo "  git clone https://github.com/iden3/circom.git"
    echo "  cd circom"
    echo "  cargo build --release"
    echo "  cargo install --path circom"
    exit 1
fi

echo -e "${GREEN}✓ circom found: $(circom --version)${NC}"
echo ""

# Paths (work from circuits directory or project root)
if [ -d "src" ]; then
    # Called from circuits directory
    CIRCUIT_DIR="src"
    BUILD_DIR="../zkproof/build"
else
    # Called from project root
    CIRCUIT_DIR="circuits/src"
    BUILD_DIR="zkproof/build"
fi
MAIN_CIRCUIT="main.circom"

# Create build directory
mkdir -p $BUILD_DIR

echo "Compiling circuit: $MAIN_CIRCUIT"
echo "Output directory: $BUILD_DIR"
echo ""

# Compile the circuit
echo -e "${YELLOW}Step 1: Compiling circuit to R1CS, WASM, and symbols...${NC}"

circom $CIRCUIT_DIR/$MAIN_CIRCUIT \
    --r1cs \
    --wasm \
    --sym \
    --output $BUILD_DIR \
    --verbose

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Circuit compiled successfully${NC}"
else
    echo -e "${RED}✗ Circuit compilation failed${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Step 2: Checking circuit info...${NC}"

# Print circuit info
if command -v snarkjs &> /dev/null; then
    snarkjs r1cs info $BUILD_DIR/main.r1cs
    echo ""
    echo -e "${GREEN}✓ Circuit info displayed${NC}"
else
    echo -e "${YELLOW}! snarkjs not found, skipping info display${NC}"
    echo "Install snarkjs: npm install -g snarkjs"
fi

echo ""
echo "================================================"
echo "   Compilation Summary"
echo "================================================"
echo "Generated files:"
echo "  - $BUILD_DIR/main.r1cs       (Constraint system)"
echo "  - $BUILD_DIR/main.wasm       (Witness generator)"
echo "  - $BUILD_DIR/main.sym        (Symbols file)"
echo ""
echo -e "${GREEN}✓ Compilation complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Run trusted setup: ./zkproof/scripts/setup.sh"
echo "  2. Generate a proof: npm run zk:generate-proof"
echo ""
