#!/bin/bash

# Trusted Setup Script for Groth16
# Generates proving and verification keys

set -euo pipefail

# ================================================
# NODE.JS MEMORY CONFIGURATION
# ================================================
# Power 17: ~2GB RAM needed
# Power 18: ~4GB RAM needed
# Power 19: ~8GB RAM needed
# Power 20: ~16GB RAM needed
#
# Set Node.js max heap size based on available memory
# This prevents silent failures on large circuits

AVAILABLE_MEM_GB=$(( $(sysctl -n hw.memsize 2>/dev/null || grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2 * 1024}' || echo 8589934592) / 1024 / 1024 / 1024 ))
NODE_MAX_MEM=$(( AVAILABLE_MEM_GB * 3 / 4 ))  # Use 75% of available RAM
if [ "$NODE_MAX_MEM" -lt 4 ]; then
    NODE_MAX_MEM=4  # Minimum 4GB
fi
if [ "$NODE_MAX_MEM" -gt 16 ]; then
    NODE_MAX_MEM=16  # Cap at 16GB
fi

export NODE_OPTIONS="--max-old-space-size=$((NODE_MAX_MEM * 1024))"
echo "Node.js memory limit set to ${NODE_MAX_MEM}GB (NODE_OPTIONS=$NODE_OPTIONS)"

# ================================================
# LOGGING SETUP
# ================================================
LOG_DIR="zkproof/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/setup_$(date +%Y%m%d_%H%M%S).log"

# Function to log with timestamp
log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo -e "$msg"
    echo -e "$msg" >> "$LOG_FILE"
}

log_cmd() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [CMD] $1"
    echo -e "$msg"
    echo -e "$msg" >> "$LOG_FILE"
}

# Tee all output to log file while also showing on screen
exec > >(tee -a "$LOG_FILE") 2>&1

echo "================================================"
echo "   ZK-SNARK Trusted Setup (Groth16)"
echo "================================================"
echo ""
log "Setup started"
log "Log file: $LOG_FILE"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check if snarkjs is installed
log "Checking snarkjs installation..."
if ! command -v snarkjs &> /dev/null; then
    log "${RED}Error: snarkjs is not installed${NC}"
    echo "Install with: npm install -g snarkjs"
    exit 1
fi

SNARKJS_VERSION=$(snarkjs --version 2>&1 || echo "unknown")
log "${GREEN}✓ snarkjs found: $SNARKJS_VERSION${NC}"
log "snarkjs path: $(which snarkjs)"
echo ""

# Paths (work from circuits directory or project root)
log "Determining paths..."
if [ -f "src/main.circom" ]; then
    # Called from circuits directory
    BUILD_DIR="../zkproof/build"
    log "Running from circuits directory"
else
    # Called from project root
    BUILD_DIR="zkproof/build"
    log "Running from project root"
fi
PTAU_DIR="$BUILD_DIR/ptau"

log "BUILD_DIR: $BUILD_DIR"
log "PTAU_DIR: $PTAU_DIR"

# Check if circuit is compiled
log "Checking for compiled circuit..."
if [ ! -f "$BUILD_DIR/main.r1cs" ]; then
    log "${RED}Error: Circuit not compiled${NC}"
    echo "Expected file: $BUILD_DIR/main.r1cs"
    echo "Run: npm run circuit:compile"
    exit 1
fi

R1CS_SIZE=$(stat -f%z "$BUILD_DIR/main.r1cs" 2>/dev/null || stat -c%s "$BUILD_DIR/main.r1cs" 2>/dev/null || echo "unknown")
log "${GREEN}✓ Circuit found: $BUILD_DIR/main.r1cs (${R1CS_SIZE} bytes)${NC}"

# Create ptau directory
mkdir -p $PTAU_DIR
log "Created/verified PTAU directory: $PTAU_DIR"

echo ""
log "${YELLOW}This is a DEVELOPMENT setup - NOT for production use${NC}"
echo "For production, use a multi-party ceremony with proper security"
echo ""
read -p "Continue with development setup? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log "Setup cancelled by user"
    exit 0
fi

echo ""
echo "================================================"
echo "   Phase 1: Powers of Tau Ceremony"
echo "================================================"
echo ""
log "Phase 1 started"

# Determine circuit size (number of constraints)
log "Getting circuit info..."
log_cmd "snarkjs r1cs info $BUILD_DIR/main.r1cs"

R1CS_INFO=$(snarkjs r1cs info $BUILD_DIR/main.r1cs 2>&1)
echo "$R1CS_INFO"
echo "$R1CS_INFO" >> "$LOG_FILE"

CONSTRAINTS=$(echo "$R1CS_INFO" | grep "# of Constraints" | awk '{print $NF}')
log "Circuit has $CONSTRAINTS constraints"

# Calculate required power (next power of 2)
# CRITICAL: Must include ALL powers, not skip any!
POWER=12  # Default to 2^12 = 4096 constraints
if [ "$CONSTRAINTS" -gt 4096 ]; then
    POWER=13  # 2^13 = 8192
fi
if [ "$CONSTRAINTS" -gt 8192 ]; then
    POWER=14  # 2^14 = 16384
fi
if [ "$CONSTRAINTS" -gt 16384 ]; then
    POWER=15  # 2^15 = 32768
fi
if [ "$CONSTRAINTS" -gt 32768 ]; then
    POWER=16  # 2^16 = 65536
fi
if [ "$CONSTRAINTS" -gt 65536 ]; then
    POWER=17  # 2^17 = 131072 ← THIS WAS MISSING!
fi
if [ "$CONSTRAINTS" -gt 131072 ]; then
    POWER=18  # 2^18 = 262144
fi
if [ "$CONSTRAINTS" -gt 262144 ]; then
    POWER=20  # 2^20 = 1048576
fi

log "Using power of tau: $POWER (supports up to $((2**POWER)) constraints)"

# Memory requirements by power
REQUIRED_MEM=2
if [ "$POWER" -ge 18 ]; then
    REQUIRED_MEM=4
fi
if [ "$POWER" -ge 19 ]; then
    REQUIRED_MEM=8
fi
if [ "$POWER" -ge 20 ]; then
    REQUIRED_MEM=16
fi

log "Estimated memory requirement: ${REQUIRED_MEM}GB"
log "Node.js heap limit: ${NODE_MAX_MEM}GB"

if [ "$NODE_MAX_MEM" -lt "$REQUIRED_MEM" ]; then
    log "${RED}WARNING: Insufficient memory configured!${NC}"
    log "${RED}Power $POWER requires ~${REQUIRED_MEM}GB but only ${NODE_MAX_MEM}GB available${NC}"
    log "${YELLOW}The setup may fail silently or hang. Consider:${NC}"
    log "${YELLOW}  1. Using a machine with more RAM${NC}"
    log "${YELLOW}  2. Reducing circuit size to use a lower power${NC}"
    log "${YELLOW}  3. Manually setting: export NODE_OPTIONS='--max-old-space-size=$((REQUIRED_MEM * 1024))'${NC}"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Setup cancelled due to memory constraints"
        exit 1
    fi
fi

echo ""

PTAU_FILE="$PTAU_DIR/pot${POWER}_final.ptau"
log "PTAU file path: $PTAU_FILE"

# Check if powers of tau already exists and verify it
PTAU_VALID=false
if [ -f "$PTAU_FILE" ]; then
    PTAU_SIZE=$(stat -f%z "$PTAU_FILE" 2>/dev/null || stat -c%s "$PTAU_FILE" 2>/dev/null || echo "0")
    log "${YELLOW}Checking existing Powers of Tau file (${PTAU_SIZE} bytes)...${NC}"
    log_cmd "snarkjs powersoftau verify $PTAU_FILE"

    # Don't use pipe here - check snarkjs exit code directly
    # (exec tee at top already captures all stdout/stderr to log)
    if snarkjs powersoftau verify "$PTAU_FILE"; then
        log "${GREEN}✓ Powers of Tau file exists and is valid${NC}"
        log "  $PTAU_FILE"
        PTAU_VALID=true
    else
        log "${RED}✗ Powers of Tau file is corrupted, regenerating...${NC}"
        rm -f "$PTAU_DIR/pot${POWER}"*.ptau
    fi
else
    log "PTAU file does not exist, will generate"
fi

# Regenerate if file doesn't exist or was corrupted
if [ "$PTAU_VALID" = false ]; then
    log "${YELLOW}Step 1.1: Starting new Powers of Tau ceremony...${NC}"
    log_cmd "snarkjs powersoftau new bn128 $POWER $PTAU_DIR/pot${POWER}_0000.ptau -v"
    snarkjs powersoftau new bn128 $POWER $PTAU_DIR/pot${POWER}_0000.ptau -v 2>&1 | tee -a "$LOG_FILE"
    log "Step 1.1 complete"

    echo ""
    log "${YELLOW}Step 1.2: Contributing to the ceremony...${NC}"
    ENTROPY="random entropy $(date +%s)"
    log "Using entropy: $ENTROPY"
    log_cmd "snarkjs powersoftau contribute $PTAU_DIR/pot${POWER}_0000.ptau $PTAU_DIR/pot${POWER}_0001.ptau --name='First contribution' -v"
    snarkjs powersoftau contribute $PTAU_DIR/pot${POWER}_0000.ptau $PTAU_DIR/pot${POWER}_0001.ptau \
        --name="First contribution" -v -e="$ENTROPY" 2>&1 | tee -a "$LOG_FILE"
    log "Step 1.2 complete"

    echo ""
    log "${YELLOW}Step 1.3: Applying random beacon...${NC}"
    log_cmd "snarkjs powersoftau beacon $PTAU_DIR/pot${POWER}_0001.ptau $PTAU_DIR/pot${POWER}_beacon.ptau 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 -n='Final Beacon'"
    snarkjs powersoftau beacon $PTAU_DIR/pot${POWER}_0001.ptau $PTAU_DIR/pot${POWER}_beacon.ptau \
        0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 -n="Final Beacon" 2>&1 | tee -a "$LOG_FILE"
    log "Step 1.3 complete"

    echo ""
    log "${YELLOW}Step 1.4: Preparing phase 2...${NC}"
    log_cmd "snarkjs powersoftau prepare phase2 $PTAU_DIR/pot${POWER}_beacon.ptau $PTAU_FILE -v"
    snarkjs powersoftau prepare phase2 $PTAU_DIR/pot${POWER}_beacon.ptau $PTAU_FILE -v 2>&1 | tee -a "$LOG_FILE"
    log "Step 1.4 complete"

    log "${GREEN}✓ Powers of Tau ceremony complete${NC}"
fi

log "Phase 1 completed"

echo ""
echo "================================================"
echo "   Phase 2: Circuit-Specific Setup"
echo "================================================"
echo ""
log "Phase 2 started"

# Check if zkey already exists
ZKEY_VALID=false
if [ -f "$BUILD_DIR/circuit_0000.zkey" ]; then
    ZKEY_SIZE=$(stat -f%z "$BUILD_DIR/circuit_0000.zkey" 2>/dev/null || stat -c%s "$BUILD_DIR/circuit_0000.zkey" 2>/dev/null || echo "0")
    if [ "$ZKEY_SIZE" -gt 0 ]; then
        log "${GREEN}✓ zkey file exists (${ZKEY_SIZE} bytes)${NC}"
        log "  $BUILD_DIR/circuit_0000.zkey"
        log "${YELLOW}(Skipping regeneration - delete file to regenerate)${NC}"
        ZKEY_VALID=true
    else
        log "${YELLOW}zkey file exists but is empty, will regenerate${NC}"
        rm -f "$BUILD_DIR/circuit_0000.zkey"
    fi
else
    log "zkey file does not exist, will generate"
fi

# Generate if file doesn't exist
if [ "$ZKEY_VALID" = false ]; then
    log "${YELLOW}Step 2.1: Generating zkey (proving key)...${NC}"

    # Estimate time based on constraints
    ESTIMATED_MINUTES=$((CONSTRAINTS / 1000))
    if [ $ESTIMATED_MINUTES -lt 1 ]; then
        ESTIMATED_MINUTES=1
    fi
    if [ $ESTIMATED_MINUTES -gt 60 ]; then
        ESTIMATED_HOURS=$((ESTIMATED_MINUTES / 60))
        log "${YELLOW}⚠ WARNING: This may take ${ESTIMATED_HOURS}+ hours for ${CONSTRAINTS} constraints${NC}"
        log "${YELLOW}   This is CPU-intensive and will use significant CPU${NC}"
    else
        log "${YELLOW}Estimated time: ~${ESTIMATED_MINUTES} minutes${NC}"
    fi

    log ""
    log "${BLUE}Starting zkey generation process...${NC}"
    log "Output file: $BUILD_DIR/circuit_0000.zkey"
    log "Input R1CS: $BUILD_DIR/main.r1cs"
    log "Input PTAU: $PTAU_FILE"
    log ""

    # Start monitoring in background
    (
        MONITOR_START=$(date +%s)
        log "[MONITOR] File size monitor started at $(date)"

        # Calculate timeout based on power (higher power = longer timeout)
        # Power 17: 10 min, Power 18: 30 min, Power 19+: 60 min
        MAX_WAIT_SECONDS=600  # 10 minutes default
        if [ "$POWER" -ge 18 ]; then
            MAX_WAIT_SECONDS=1800  # 30 minutes
        fi
        if [ "$POWER" -ge 19 ]; then
            MAX_WAIT_SECONDS=3600  # 60 minutes
        fi

        # Wait for file to be created
        WAIT_COUNT=0
        while [ ! -f "$BUILD_DIR/circuit_0000.zkey" ]; do
            sleep 2
            WAIT_COUNT=$((WAIT_COUNT + 1))
            WAIT_SECONDS=$((WAIT_COUNT * 2))

            if [ $((WAIT_COUNT % 15)) -eq 0 ]; then
                log "[MONITOR] Waiting for zkey file... (${WAIT_SECONDS}s elapsed)"

                # Check if snarkjs is still running and using CPU
                if pgrep -f "snarkjs" > /dev/null 2>&1; then
                    SNARKJS_PID=$(pgrep -f "snarkjs" | head -1)
                    CPU_INFO=$(ps -p $SNARKJS_PID -o %cpu= 2>/dev/null || echo "N/A")
                    MEM_INFO=$(ps -p $SNARKJS_PID -o rss= 2>/dev/null || echo "0")
                    MEM_MB=$((MEM_INFO / 1024))
                    log "[MONITOR] snarkjs PID $SNARKJS_PID - CPU: ${CPU_INFO}%, MEM: ${MEM_MB}MB"

                    # Detect potential memory issue: low CPU + low memory = likely stuck
                    CPU_INT=${CPU_INFO%.*}
                    if [ "${CPU_INT:-0}" -lt 5 ] && [ "$MEM_MB" -lt 500 ] && [ "$WAIT_SECONDS" -gt 120 ]; then
                        log "[MONITOR] ${RED}WARNING: Low CPU and memory usage detected!${NC}"
                        log "[MONITOR] ${RED}This may indicate a memory allocation failure.${NC}"
                        log "[MONITOR] ${RED}Try: export NODE_OPTIONS='--max-old-space-size=8192'${NC}"
                    fi
                else
                    log "[MONITOR] ${RED}WARNING: snarkjs process not found!${NC}"
                fi
            fi

            # Timeout check
            if [ "$WAIT_SECONDS" -gt "$MAX_WAIT_SECONDS" ]; then
                log "[MONITOR] ${RED}TIMEOUT: No zkey file created after ${MAX_WAIT_SECONDS}s${NC}"
                log "[MONITOR] ${RED}This usually indicates insufficient memory for power $POWER${NC}"
                log "[MONITOR] ${RED}Required: ~${REQUIRED_MEM}GB RAM${NC}"
                # Don't exit - let the main process handle it
                break
            fi
        done

        log "[MONITOR] File created, monitoring size..."
        PREV_SIZE=0
        STALL_COUNT=0

        while true; do
            if [ -f "$BUILD_DIR/circuit_0000.zkey" ]; then
                CURRENT_SIZE=$(stat -f%z "$BUILD_DIR/circuit_0000.zkey" 2>/dev/null || stat -c%s "$BUILD_DIR/circuit_0000.zkey" 2>/dev/null || echo 0)
                ELAPSED=$(($(date +%s) - MONITOR_START))
                ELAPSED_MIN=$((ELAPSED / 60))
                ELAPSED_SEC=$((ELAPSED % 60))

                SIZE_MB=$((CURRENT_SIZE / 1024 / 1024))
                SIZE_KB=$((CURRENT_SIZE / 1024))

                if [ "$CURRENT_SIZE" -gt "$PREV_SIZE" ]; then
                    DELTA=$((CURRENT_SIZE - PREV_SIZE))
                    DELTA_KB=$((DELTA / 1024))
                    log "[MONITOR] [${ELAPSED_MIN}m ${ELAPSED_SEC}s] Size: ${SIZE_MB} MB (${SIZE_KB} KB) | +${DELTA_KB} KB since last check"
                    PREV_SIZE=$CURRENT_SIZE
                    STALL_COUNT=0
                else
                    STALL_COUNT=$((STALL_COUNT + 1))
                    if [ $((STALL_COUNT % 6)) -eq 0 ]; then
                        log "[MONITOR] [${ELAPSED_MIN}m ${ELAPSED_SEC}s] Size unchanged: ${SIZE_MB} MB (stalled for $((STALL_COUNT * 10))s)"
                        # Show if process is still running
                        if pgrep -f "snarkjs" > /dev/null 2>&1; then
                            SNARKJS_PID=$(pgrep -f "snarkjs" | head -1)
                            CPU_INFO=$(ps -p $SNARKJS_PID -o %cpu= 2>/dev/null || echo "N/A")
                            MEM_INFO=$(ps -p $SNARKJS_PID -o %mem= 2>/dev/null || echo "N/A")
                            log "[MONITOR] snarkjs PID $SNARKJS_PID still running (CPU: ${CPU_INFO}%, MEM: ${MEM_INFO}%)"
                        else
                            log "[MONITOR] WARNING: snarkjs process not found!"
                        fi
                    fi
                fi
            fi
            sleep 10
        done
    ) &
    MONITOR_PID=$!
    log "Started file size monitor (PID: $MONITOR_PID)"

    # Run the setup command with full output
    log_cmd "snarkjs groth16 setup $BUILD_DIR/main.r1cs $PTAU_FILE $BUILD_DIR/circuit_0000.zkey"
    log ""
    log "========== SNARKJS GROTH16 SETUP OUTPUT START =========="
    log ""
    log "IMPORTANT INFO FOR ${CONSTRAINTS} CONSTRAINTS:"
    log "  - Expected time: 30-60 minutes"
    log "  - Expected output file size: ~50-100 MB"
    log "  - Monitor progress: watch -n5 'ls -la $BUILD_DIR/circuit_0000.zkey'"
    log ""
    log "The process will appear to hang with no output - THIS IS NORMAL!"
    log "snarkjs performs heavy computation without intermediate output."
    log ""

    # CRITICAL FIX: Run snarkjs WITHOUT ANY PIPING
    #
    # Previous bug: Piping through 'while read' or 'tee' causes deadlock because:
    # 1. Node.js (snarkjs) buffers stdout internally
    # 2. During heavy FFT computation, no output is produced for long periods
    # 3. Pipe consumers wait for data that never comes
    # 4. This can cause both processes to block on I/O
    #
    # Solution: Run snarkjs directly, redirect output to file, don't pipe
    # The exec tee at script start still captures all output to the main log

    SETUP_OUTPUT_FILE="$LOG_DIR/snarkjs_setup_$(date +%Y%m%d_%H%M%S).log"
    log "snarkjs output file: $SETUP_OUTPUT_FILE"
    log ""
    log "Starting snarkjs now... (no output expected until completion)"
    log ""

    # CRITICAL: Temporarily disable set -e to capture exit code
    # With set -e, if snarkjs fails, script exits BEFORE reaching SETUP_EXIT=$?
    set +e
    snarkjs groth16 setup "$BUILD_DIR/main.r1cs" "$PTAU_FILE" "$BUILD_DIR/circuit_0000.zkey" > "$SETUP_OUTPUT_FILE" 2>&1
    SETUP_EXIT=$?
    set -e

    # Show the output after completion (last 200 lines)
    log ""
    log "snarkjs output (tail):"
    tail -n 200 "$SETUP_OUTPUT_FILE" 2>/dev/null || cat "$SETUP_OUTPUT_FILE" 2>/dev/null || log "(no output captured)"

    log ""
    log "========== SNARKJS GROTH16 SETUP OUTPUT END =========="
    log ""

    # Stop the monitor
    log "Stopping file size monitor..."
    kill $MONITOR_PID 2>/dev/null || true
    wait $MONITOR_PID 2>/dev/null || true
    log "Monitor stopped"

    if [ "$SETUP_EXIT" -ne 0 ]; then
        log "${RED}✗ zkey generation failed with exit code: $SETUP_EXIT${NC}"
        exit $SETUP_EXIT
    fi

    if [ -f "$BUILD_DIR/circuit_0000.zkey" ]; then
        FINAL_SIZE=$(stat -f%z "$BUILD_DIR/circuit_0000.zkey" 2>/dev/null || stat -c%s "$BUILD_DIR/circuit_0000.zkey" 2>/dev/null || echo 0)
        FINAL_SIZE_MB=$((FINAL_SIZE / 1024 / 1024))
        log "${GREEN}✓ zkey generated successfully (${FINAL_SIZE_MB} MB / ${FINAL_SIZE} bytes)${NC}"
    else
        log "${RED}✗ zkey file was not created${NC}"
        exit 1
    fi
fi

log "Step 2.1 complete"

echo ""
# Check if final zkey already exists
FINAL_ZKEY_VALID=false
if [ -f "$BUILD_DIR/circuit_final.zkey" ]; then
    FINAL_ZKEY_SIZE=$(stat -f%z "$BUILD_DIR/circuit_final.zkey" 2>/dev/null || stat -c%s "$BUILD_DIR/circuit_final.zkey" 2>/dev/null || echo "0")
    if [ "$FINAL_ZKEY_SIZE" -gt 0 ]; then
        log "${GREEN}✓ Final zkey file exists (${FINAL_ZKEY_SIZE} bytes)${NC}"
        log "  $BUILD_DIR/circuit_final.zkey"
        log "${YELLOW}(Skipping regeneration - delete file to regenerate)${NC}"
        FINAL_ZKEY_VALID=true
    else
        log "${YELLOW}Final zkey file exists but is empty, will regenerate${NC}"
        rm -f "$BUILD_DIR/circuit_final.zkey"
    fi
else
    log "Final zkey file does not exist, will generate"
fi

# Generate if file doesn't exist
if [ "$FINAL_ZKEY_VALID" = false ]; then
    log "${YELLOW}Step 2.2: Contributing to zkey...${NC}"
    ENTROPY="random entropy $(date +%s)"
    log "Using entropy: $ENTROPY"
    log_cmd "snarkjs zkey contribute $BUILD_DIR/circuit_0000.zkey $BUILD_DIR/circuit_final.zkey --name='1st Contributor' -v"
    snarkjs zkey contribute $BUILD_DIR/circuit_0000.zkey $BUILD_DIR/circuit_final.zkey \
        --name="1st Contributor" -v -e="$ENTROPY" 2>&1 | tee -a "$LOG_FILE"
    log "Step 2.2 complete"
fi

echo ""
log "${YELLOW}Step 2.3: Exporting verification key...${NC}"
log_cmd "snarkjs zkey export verificationkey $BUILD_DIR/circuit_final.zkey $BUILD_DIR/verification_key.json"
snarkjs zkey export verificationkey $BUILD_DIR/circuit_final.zkey $BUILD_DIR/verification_key.json 2>&1 | tee -a "$LOG_FILE"

log "${GREEN}✓ Verification key exported${NC}"
log "Step 2.3 complete"

log "Phase 2 completed"

echo ""
echo "================================================"
echo "   Phase 3: Generating Solidity Verifier"
echo "================================================"
echo ""
log "Phase 3 started"

log "${YELLOW}Step 3.1: Generating Solidity verifier contract...${NC}"
if [ -f "src/main.circom" ]; then
    VERIFIER_PATH="../contracts/zk/Groth16Verifier.sol"
else
    VERIFIER_PATH="contracts/zk/Groth16Verifier.sol"
fi
log "Verifier output path: $VERIFIER_PATH"
log_cmd "snarkjs zkey export solidityverifier $BUILD_DIR/circuit_final.zkey $VERIFIER_PATH"
snarkjs zkey export solidityverifier $BUILD_DIR/circuit_final.zkey $VERIFIER_PATH 2>&1 | tee -a "$LOG_FILE"

log "${GREEN}✓ Solidity verifier generated${NC}"
log "Phase 3 completed"

echo ""
echo "================================================"
echo "   Setup Summary"
echo "================================================"
log "Setup completed successfully"
echo "Generated files:"
echo "  - $BUILD_DIR/circuit_final.zkey       (Proving key)"
echo "  - $BUILD_DIR/verification_key.json    (Verification key)"
echo "  - $VERIFIER_PATH    (Solidity verifier)"
echo ""
echo "File sizes:"
if [ -f "$BUILD_DIR/circuit_final.zkey" ]; then
    FINAL_ZKEY_SIZE=$(stat -f%z "$BUILD_DIR/circuit_final.zkey" 2>/dev/null || stat -c%s "$BUILD_DIR/circuit_final.zkey" 2>/dev/null || echo "0")
    log "  circuit_final.zkey: $((FINAL_ZKEY_SIZE / 1024 / 1024)) MB"
fi
if [ -f "$BUILD_DIR/verification_key.json" ]; then
    VK_SIZE=$(stat -f%z "$BUILD_DIR/verification_key.json" 2>/dev/null || stat -c%s "$BUILD_DIR/verification_key.json" 2>/dev/null || echo "0")
    log "  verification_key.json: $VK_SIZE bytes"
fi
echo ""
log "${GREEN}✓ Trusted setup complete!${NC}"
echo ""
echo "Log file saved to: $LOG_FILE"
echo ""
echo "Next steps:"
echo "  1. Generate a proof: npm run zk:generate-proof"
echo "  2. Verify the proof: npm run zk:verify-proof"
echo "  3. Test on-chain: npx hardhat test test/zk/*.test.js"
echo ""
log "${YELLOW}⚠ WARNING: This setup is for DEVELOPMENT only${NC}"
echo "For production, conduct a proper multi-party ceremony"
echo ""
log "Setup script finished at $(date)"
