#!/usr/bin/env node

/**
 * Submit wrapAndSwapUniversal proof on Polygon
 *
 * This script:
 * 1. Fetches the Bitcoin tx from mempool.space
 * 2. Builds the TxAndProof struct (version, vin, vout, locktime, merkle proof)
 * 3. Calls wrapAndSwapUniversal on CcExchangeRouter
 *
 * Usage:
 *   DEPOSIT_FILE=<txid>.json npx hardhat run scripts/universal/submit-proof.js --network polygon
 *
 * Environment Variables (in .env):
 *   DEPOSIT_FILE                       - Deposit JSON file name (from create-btc-deposit.js)
 *   LOCKER_LOCKING_SCRIPT              - Hex-encoded locker locking script
 *   PATH_TELEBTC_TO_INTERMEDIARY       - Comma-separated addresses: teleBTC,WETH (swap path on Polygon)
 *   PATH_INTERMEDIARY_TO_DEST          - Comma-separated bytes32: WETH_Base,cbBTC_Base (swap path on dest chain, empty if no dest swap)
 *   AMOUNTS_INTERMEDIARY_TO_DEST       - Comma-separated amounts for dest chain swap (empty if no dest swap)
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const ethers = hre.ethers;
const deployments = hre.deployments;

// Parse a raw Bitcoin transaction hex into version, vin, vout, locktime components
function parseRawTx(txHex) {
    const buf = Buffer.from(txHex, "hex");
    let offset = 0;

    // Version (4 bytes, little-endian)
    const version = buf.slice(offset, offset + 4);
    offset += 4;

    // Check for witness flag
    let hasWitness = false;
    if (buf[offset] === 0x00 && buf[offset + 1] !== 0x00) {
        hasWitness = true;
        offset += 2; // Skip marker and flag
    }

    // Parse vin
    const vinStart = offset;
    const vinCount = readVarInt(buf, offset);
    offset = vinCount.offset;
    for (let i = 0; i < vinCount.value; i++) {
        offset += 32; // txid
        offset += 4;  // vout
        const scriptLen = readVarInt(buf, offset);
        offset = scriptLen.offset;
        offset += scriptLen.value; // script
        offset += 4; // sequence
    }
    const vinEnd = offset;
    const vin = buf.slice(vinStart, vinEnd);

    // Parse vout
    const voutStart = offset;
    const voutCount = readVarInt(buf, offset);
    offset = voutCount.offset;
    for (let i = 0; i < voutCount.value; i++) {
        offset += 8; // value
        const scriptLen = readVarInt(buf, offset);
        offset = scriptLen.offset;
        offset += scriptLen.value; // script
    }
    const voutEnd = offset;
    const vout = buf.slice(voutStart, voutEnd);

    // Skip witness data if present
    if (hasWitness) {
        for (let i = 0; i < vinCount.value; i++) {
            const witnessCount = readVarInt(buf, offset);
            offset = witnessCount.offset;
            for (let j = 0; j < witnessCount.value; j++) {
                const itemLen = readVarInt(buf, offset);
                offset = itemLen.offset;
                offset += itemLen.value;
            }
        }
    }

    // Locktime (4 bytes, little-endian)
    const locktime = buf.slice(offset, offset + 4);

    return {
        version: "0x" + version.toString("hex"),
        vin: "0x" + vin.toString("hex"),
        vout: "0x" + vout.toString("hex"),
        locktime: "0x" + locktime.toString("hex"),
        hasWitness,
    };
}

function readVarInt(buf, offset) {
    const first = buf[offset];
    if (first < 0xfd) {
        return { value: first, offset: offset + 1 };
    } else if (first === 0xfd) {
        return { value: buf.readUInt16LE(offset + 1), offset: offset + 3 };
    } else if (first === 0xfe) {
        return { value: buf.readUInt32LE(offset + 1), offset: offset + 5 };
    } else {
        return { value: buf.readUInt32LE(offset + 1), offset: offset + 9 };
    }
}

async function fetchJson(url) {
    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.json();
}

async function fetchText(url) {
    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.text();
}

async function main() {
    const network = await ethers.provider.getNetwork();
    console.log("\n========================================================");
    console.log(`  Submit wrapAndSwapUniversal on ${network.name} (chainId: ${network.chainId})`);
    console.log("========================================================\n");

    // ═══════════════════════════════════════════════════════════════════
    // Load deposit data
    // ═══════════════════════════════════════════════════════════════════
    const depositFileName = process.env.DEPOSIT_FILE;
    if (!depositFileName) {
        console.error("Set DEPOSIT_FILE=<txid>.json");
        process.exit(1);
    }

    const depositPath = depositFileName.startsWith("/")
        ? depositFileName
        : path.join(__dirname, "../../data/universal-deposits", depositFileName);

    if (!fs.existsSync(depositPath)) {
        console.error(`Deposit file not found: ${depositPath}`);
        process.exit(1);
    }

    const deposit = JSON.parse(fs.readFileSync(depositPath, "utf8"));
    console.log(`Deposit: ${deposit.txid}`);
    console.log(`  Amount: ${deposit.amountSats} sats`);
    console.log(`  Recipient: ${deposit.recipientAddress}`);

    // ═══════════════════════════════════════════════════════════════════
    // Load environment config
    // ═══════════════════════════════════════════════════════════════════
    const lockerLockingScript = process.env.LOCKER_LOCKING_SCRIPT;
    if (!lockerLockingScript) {
        console.error("Set LOCKER_LOCKING_SCRIPT in .env (hex-encoded locker script)");
        process.exit(1);
    }

    const pathTeleBtcToIntermediaryStr = process.env.PATH_TELEBTC_TO_INTERMEDIARY
        || "0x3BF668Fe1ec79a84cA8481CEAD5dbb30d61cC685,0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6,0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
    const pathTeleBtcToIntermediary = pathTeleBtcToIntermediaryStr.split(",").map(s => s.trim());

    let pathIntermediaryToDest = [];
    const pathIntermediaryToDestStr = process.env.PATH_INTERMEDIARY_TO_DEST
        || "0x4200000000000000000000000000000000000006,0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
    if (pathIntermediaryToDestStr && pathIntermediaryToDestStr.trim() !== "") {
        pathIntermediaryToDest = pathIntermediaryToDestStr.split(",").map(s => s.trim());
    }

    let amountsIntermediaryToDest = [];
    const amountsIntermediaryToDestStr = process.env.AMOUNTS_INTERMEDIARY_TO_DEST;
    if (amountsIntermediaryToDestStr && amountsIntermediaryToDestStr.trim() !== "") {
        amountsIntermediaryToDest = amountsIntermediaryToDestStr.split(",").map(s => s.trim());
    }

    console.log(`\nPaths:`);
    console.log(`  TeleBTC->Intermediary: [${pathTeleBtcToIntermediary.join(", ")}]`);
    console.log(`  Intermediary->Dest:    [${pathIntermediaryToDest.join(", ")}]`);
    console.log(`  Amounts on dest:       [${amountsIntermediaryToDest.join(", ")}]`);

    // ═══════════════════════════════════════════════════════════════════
    // Fetch Bitcoin tx and merkle proof from mempool.space
    // ═══════════════════════════════════════════════════════════════════
    console.log("\nFetching Bitcoin transaction data...");

    const txInfo = await fetchJson(`https://mempool.space/api/tx/${deposit.txid}`);
    if (!txInfo.status.confirmed) {
        console.error("Transaction not yet confirmed. Wait for confirmation and retry.");
        process.exit(1);
    }
    console.log(`  Confirmed in block ${txInfo.status.block_height}`);

    // Fetch raw tx hex
    const rawTxHex = await fetchText(`https://mempool.space/api/tx/${deposit.txid}/hex`);
    console.log(`  Raw tx: ${rawTxHex.length / 2} bytes`);

    // Fetch merkle proof
    const merkleProof = await fetchJson(`https://mempool.space/api/tx/${deposit.txid}/merkle-proof`);
    console.log(`  Merkle position: ${merkleProof.pos}`);
    console.log(`  Merkle nodes: ${merkleProof.merkle.length}`);

    // ═══════════════════════════════════════════════════════════════════
    // Parse raw transaction
    // ═══════════════════════════════════════════════════════════════════
    const parsed = parseRawTx(rawTxHex);
    console.log(`\nParsed tx:`);
    console.log(`  Version:  ${parsed.version}`);
    console.log(`  Vin:      ${(parsed.vin.length - 2) / 2} bytes`);
    console.log(`  Vout:     ${(parsed.vout.length - 2) / 2} bytes`);
    console.log(`  Locktime: ${parsed.locktime}`);
    console.log(`  Witness:  ${parsed.hasWitness}`);

    // Build intermediate nodes (concatenated merkle proof hashes)
    // Each hash needs to be reversed (Bitcoin display -> internal)
    const intermediateNodes = "0x" + merkleProof.merkle
        .map(function (h) {
            const buf = Buffer.from(h, "hex");
            return Buffer.from(buf).reverse().toString("hex");
        })
        .join("");

    // ═══════════════════════════════════════════════════════════════════
    // Load contract
    // ═══════════════════════════════════════════════════════════════════
    const ccExchangeRouterProxy = await deployments.get("CcExchangeRouterProxy");

    console.log(`\nContract: ${ccExchangeRouterProxy.address}`);

    const [signer] = await ethers.getSigners();
    console.log(`Signer:   ${signer.address}`);

    const balance = await signer.getBalance();
    console.log(`Balance:  ${ethers.utils.formatEther(balance)} MATIC`);

    // Check teleporter status
    const router = await ethers.getContractAt(
        "CcExchangeRouterLogicUniversal",
        ccExchangeRouterProxy.address,
        signer
    );

    const isTeleporter = await router.isTeleporter(signer.address);
    if (!isTeleporter) {
        console.error(`\nSigner ${signer.address} is NOT a registered teleporter!`);
        console.error("Register with: router.setTeleporter(address, true)");
        process.exit(1);
    }
    console.log("  Teleporter: registered");

    // Check if request already processed
    const txIdBytes = "0x" + Buffer.from(deposit.txid, "hex").reverse().toString("hex");
    const isUsed = await router.isRequestUsed(txIdBytes);
    if (isUsed) {
        console.error("\nRequest already processed!");
        process.exit(1);
    }
    console.log("  Request: not yet processed");

    // ═══════════════════════════════════════════════════════════════════
    // Build TxAndProof struct
    // ═══════════════════════════════════════════════════════════════════
    const txAndProof = {
        version: parsed.version,
        vin: parsed.vin,
        vout: parsed.vout,
        locktime: parsed.locktime,
        blockNumber: txInfo.status.block_height,
        intermediateNodes: intermediateNodes,
        index: merkleProof.pos,
    };

    console.log("\nTxAndProof:");
    console.log(`  blockNumber: ${txAndProof.blockNumber}`);
    console.log(`  index: ${txAndProof.index}`);
    console.log(`  intermediateNodes: ${(intermediateNodes.length - 2) / 2} bytes`);

    // ═══════════════════════════════════════════════════════════════════
    // Estimate gas
    // ═══════════════════════════════════════════════════════════════════
    console.log("\nEstimating gas...");

    // Pad bytes32 arrays for dest chain path
    const pathBytes32 = pathIntermediaryToDest.map(function (addr) {
        if (addr.length === 66) return addr; // Already bytes32
        return ethers.utils.hexZeroPad(addr, 32);
    });

    const amountsBigNumber = amountsIntermediaryToDest.map(function (a) {
        return ethers.BigNumber.from(a);
    });

    try {
        const gasEstimate = await router.estimateGas.wrapAndSwapUniversal(
            txAndProof,
            lockerLockingScript,
            pathTeleBtcToIntermediary,
            pathBytes32,
            amountsBigNumber,
        );
        console.log(`  Estimated gas: ${gasEstimate.toString()}`);
    } catch (error) {
        console.error(`\nGas estimation failed: ${error.message}`);
        console.error("Check: locker script, paths, amounts, chain mappings, token mappings");

        // Try to get more info
        try {
            await router.callStatic.wrapAndSwapUniversal(
                txAndProof,
                lockerLockingScript,
                pathTeleBtcToIntermediary,
                pathBytes32,
                amountsBigNumber,
            );
        } catch (staticError) {
            console.error(`Static call error: ${staticError.message}`);
        }
        process.exit(1);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Confirm and submit
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n--------------------------------------------------------");
    console.log("REVIEW:");
    console.log(`  Bitcoin TX:  ${deposit.txid}`);
    console.log(`  Amount:      ${deposit.amountSats} sats`);
    console.log(`  Recipient:   ${deposit.recipientAddress}`);
    console.log(`  Contract:    ${ccExchangeRouterProxy.address}`);
    console.log(`  Locker:      ${lockerLockingScript}`);
    console.log("--------------------------------------------------------");

    const readline = require("readline");
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const answer = await new Promise(function (resolve) {
        rl.question("\nSubmit? (yes/no): ", resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== "yes") {
        console.log("\nNot submitted.");
        process.exit(0);
    }

    console.log("\nSubmitting wrapAndSwapUniversal...");

    const tx = await router.wrapAndSwapUniversal(
        txAndProof,
        lockerLockingScript,
        pathTeleBtcToIntermediary,
        pathBytes32,
        amountsBigNumber,
        { gasLimit: 2000000 }
    );

    console.log(`  TX Hash: ${tx.hash}`);
    console.log("  Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt.blockNumber}`);
    console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

    // Check events
    for (const event of receipt.events || []) {
        if (event.event === "NewWrapAndSwapV2" || event.event === "NewWrapAndSwapUniversal") {
            console.log(`\n  Event: ${event.event}`);
        }
        if (event.event === "FailedWrapAndSwapUniversal") {
            console.log(`\n  SWAP FAILED - tokens held in contract for retry/refund`);
        }
    }

    console.log("\n========================================================");
    console.log("  PROOF SUBMITTED SUCCESSFULLY");
    console.log("========================================================");
    console.log(`\nView: https://polygonscan.com/tx/${tx.hash}`);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error("\nError:", error.message);
        process.exit(1);
    });
