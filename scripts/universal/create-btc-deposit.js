#!/usr/bin/env node

/**
 * Create Bitcoin Transaction for Universal Exchange (BTC -> any token on any chain)
 *
 * This script:
 * 1. Builds a Bitcoin transaction with payment to locker + OP_RETURN with 77-byte exchange request
 * 2. Signs and broadcasts the transaction
 *
 * The 77-byte OP_RETURN structure:
 *   [destAssignedChainId:2][appId:1][recipientAddress:32][networkFee:3][speed:1]
 *   [thirdPartyID:1][destTokenID:8][minDestTokenAmount:13][minIntermediaryTokenAmount:13]
 *   [bridgePercentageFee:3]
 *
 * Prerequisites:
 *   npm install bitcoinjs-lib ecpair tiny-secp256k1 node-fetch dotenv
 *
 * Usage:
 *   node scripts/universal/create-btc-deposit.js
 *
 * Environment Variables (in .env):
 *   BTC_PRIVATE_KEY_WIF      - Bitcoin private key in WIF format
 *   BTC_LOCKER_ADDRESS       - Locker's Bitcoin address
 *   BTC_AMOUNT_SATS          - Amount to send in satoshis
 *
 * Config (edit CONFIG object below or use env vars):
 *   DEST_ASSIGNED_CHAIN_ID   - Assigned chain ID (2 bytes, mapped on-chain to real chain ID)
 *   APP_ID                   - DEX connector app ID on Polygon
 *   RECIPIENT_ADDRESS        - 32-byte recipient (zero-padded EVM address or Solana address)
 *   NETWORK_FEE_SATS         - Teleporter fee in satoshis
 *   SPEED                    - 0 = normal, 1 = instant (filler)
 *   THIRD_PARTY_ID           - Third party ID (0 = none)
 *   DEST_TOKEN_ID            - 8-byte token ID for the output token
 *   MIN_DEST_TOKEN_AMOUNT    - Minimum output token amount (13 bytes max)
 *   MIN_INTERMEDIARY_AMOUNT  - Minimum intermediary token amount on Polygon (13 bytes max)
 *   BRIDGE_FEE_PERCENTAGE    - Bridge fee (3 bytes, multiplied by 10^11 on-chain)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let bitcoin, ECPairFactory, ecc;
try {
    bitcoin = require('bitcoinjs-lib');
    ECPairFactory = require('ecpair').default;
    ecc = require('tiny-secp256k1');
} catch (e) {
    console.error('\nMissing dependencies. Please install:');
    console.error('   npm install bitcoinjs-lib ecpair tiny-secp256k1\n');
    process.exit(1);
}

require('dotenv').config();

const ECPair = ECPairFactory(ecc);

// ════════════════════════════════════════════════════════════════════════
// CONFIGURATION - Edit these for your scenario
// ════════════════════════════════════════════════════════════════════════

const CONFIG = {
    // Bitcoin
    privateKeyWIF: process.env.BTC_PRIVATE_KEY_WIF,
    lockerAddress: process.env.BTC_LOCKER_ADDRESS,
    amountSats: parseInt(process.env.BTC_AMOUNT_SATS || '100000'),  // 0.001 BTC
    network: bitcoin.networks.bitcoin,
    feeRate: parseInt(process.env.BTC_FEE_RATE || '5'),  // sats/vbyte

    // OP_RETURN fields (77 bytes total)
    destAssignedChainId: parseInt(process.env.DEST_ASSIGNED_CHAIN_ID || '8453'),  // Base chain ID
    appId: parseInt(process.env.APP_ID || '20'),  // DEX connector app ID
    recipientAddress: process.env.RECIPIENT_ADDRESS || '0x2D3E4AeB9347C224DAe7F1dc1213bE082F6FddEC',  // 0x... EVM address (will be zero-padded to 32 bytes)
    networkFeeSats: parseInt(process.env.NETWORK_FEE_SATS || '0'),  // Teleporter fee
    speed: parseInt(process.env.SPEED || '0'),  // 0=normal, 1=instant
    thirdPartyId: parseInt(process.env.THIRD_PARTY_ID || '0'),
    destTokenId: process.env.DEST_TOKEN_ID || '9ef808440eed33bf',  // 8-byte hex token ID (last 8 bytes of cbBTC on Base)
    minDestTokenAmount: process.env.MIN_DEST_TOKEN_AMOUNT || '0',  // In dest token decimals
    minIntermediaryAmount: process.env.MIN_INTERMEDIARY_AMOUNT || '0',  // In intermediary token decimals
    bridgeFeePercentage: parseInt(process.env.BRIDGE_FEE_PERCENTAGE || '24505'),  // Raw 3-byte value; 0.24505% (on-chain: value * 10^11)

    autoBroadcast: process.env.AUTO_BROADCAST !== 'false',
};

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

/**
 * Encode a BigInt/number into a fixed-size big-endian buffer
 */
function encodeUintBE(value, byteLength) {
    const buf = Buffer.alloc(byteLength);
    let v = BigInt(value);
    for (let i = byteLength - 1; i >= 0; i--) {
        buf[i] = Number(v & 0xFFn);
        v >>= 8n;
    }
    return buf;
}

/**
 * Build the 77-byte OP_RETURN payload for universal exchange requests
 */
function buildOpReturnPayload(cfg) {
    const parts = [];

    // 1) destAssignedChainId - 2 bytes
    parts.push(encodeUintBE(cfg.destAssignedChainId, 2));

    // 2) appId - 1 byte
    parts.push(encodeUintBE(cfg.appId, 1));

    // 3) recipientDestAddress - 32 bytes (zero-padded EVM address)
    let recipientBuf;
    if (cfg.recipientAddress.startsWith('0x')) {
        // EVM address: left-pad with zeros to 32 bytes
        const addrBytes = Buffer.from(cfg.recipientAddress.slice(2), 'hex');
        recipientBuf = Buffer.alloc(32);
        addrBytes.copy(recipientBuf, 32 - addrBytes.length);
    } else {
        // Raw 32-byte hex
        recipientBuf = Buffer.from(cfg.recipientAddress, 'hex');
    }
    if (recipientBuf.length !== 32) {
        throw new Error(`Recipient must be 32 bytes, got ${recipientBuf.length}`);
    }
    parts.push(recipientBuf);

    // 4) networkFee - 3 bytes
    parts.push(encodeUintBE(cfg.networkFeeSats, 3));

    // 5) speed - 1 byte
    parts.push(encodeUintBE(cfg.speed, 1));

    // 6) thirdPartyID - 1 byte
    parts.push(encodeUintBE(cfg.thirdPartyId, 1));

    // 7) destTokenID - 8 bytes
    const tokenIdBuf = Buffer.from(cfg.destTokenId.padStart(16, '0'), 'hex');
    if (tokenIdBuf.length !== 8) {
        throw new Error(`destTokenId must be 8 bytes hex, got ${tokenIdBuf.length}`);
    }
    parts.push(tokenIdBuf);

    // 8) minDestTokenAmount - 13 bytes
    parts.push(encodeUintBE(cfg.minDestTokenAmount, 13));

    // 9) minIntermediaryTokenAmount - 13 bytes
    parts.push(encodeUintBE(cfg.minIntermediaryAmount, 13));

    // 10) bridgePercentageFee - 3 bytes (on-chain multiplied by 10^11)
    parts.push(encodeUintBE(cfg.bridgeFeePercentage, 3));

    const payload = Buffer.concat(parts);
    if (payload.length !== 77) {
        throw new Error(`OP_RETURN payload must be 77 bytes, got ${payload.length}`);
    }
    return payload;
}

/**
 * Fetch UTXOs from mempool.space API
 */
async function fetchUTXOs(address) {
    const fetch = (await import('node-fetch')).default;
    const url = `https://mempool.space/api/address/${address}/utxo`;
    console.log(`\nFetching UTXOs for ${address}...`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch UTXOs: ${response.status}`);
    const utxos = await response.json();
    console.log(`Found ${utxos.length} UTXOs`);
    return utxos;
}

/**
 * Broadcast transaction via mempool.space API
 */
async function broadcastTransaction(txHex) {
    const fetch = (await import('node-fetch')).default;
    const url = 'https://mempool.space/api/tx';
    console.log('\nBroadcasting transaction...');
    const response = await fetch(url, {
        method: 'POST',
        body: txHex,
        headers: { 'Content-Type': 'text/plain' },
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Broadcast failed: ${error}`);
    }
    return await response.text();
}

// ════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════

async function main() {
    console.log('\n========================================================');
    console.log('  Create BTC Deposit for Universal Exchange');
    console.log('========================================================\n');

    // Validate
    if (!CONFIG.privateKeyWIF) {
        console.error('BTC_PRIVATE_KEY_WIF not set in .env');
        process.exit(1);
    }
    if (!CONFIG.lockerAddress) {
        console.error('BTC_LOCKER_ADDRESS not set in .env');
        process.exit(1);
    }
    if (!CONFIG.recipientAddress) {
        console.error('RECIPIENT_ADDRESS not set in .env');
        process.exit(1);
    }

    // Build OP_RETURN payload
    console.log('OP_RETURN fields:');
    console.log(`  destAssignedChainId: ${CONFIG.destAssignedChainId}`);
    console.log(`  appId:               ${CONFIG.appId}`);
    console.log(`  recipient:           ${CONFIG.recipientAddress}`);
    console.log(`  networkFee:          ${CONFIG.networkFeeSats} sats`);
    console.log(`  speed:               ${CONFIG.speed}`);
    console.log(`  thirdPartyId:        ${CONFIG.thirdPartyId}`);
    console.log(`  destTokenId:         ${CONFIG.destTokenId}`);
    console.log(`  minDestTokenAmount:  ${CONFIG.minDestTokenAmount}`);
    console.log(`  minIntermediary:     ${CONFIG.minIntermediaryAmount}`);
    console.log(`  bridgeFee:           ${CONFIG.bridgeFeePercentage} (raw, *10^11 on-chain)`);

    const opReturnPayload = buildOpReturnPayload(CONFIG);
    console.log(`\n  OP_RETURN payload (${opReturnPayload.length} bytes): ${opReturnPayload.toString('hex')}`);

    // Prepare wallet
    const keyPair = ECPair.fromWIF(CONFIG.privateKeyWIF, CONFIG.network);
    const p2wpkh = bitcoin.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network: CONFIG.network,
    });
    const senderAddress = p2wpkh.address;
    console.log(`\n  Sender: ${senderAddress}`);
    console.log(`  Locker: ${CONFIG.lockerAddress}`);
    console.log(`  Amount: ${CONFIG.amountSats} sats (${CONFIG.amountSats / 1e8} BTC)`);

    // Fetch UTXOs
    const utxos = await fetchUTXOs(senderAddress);
    if (utxos.length === 0) {
        console.error(`\nNo UTXOs found. Fund address: ${senderAddress}`);
        process.exit(1);
    }

    const totalAvailable = utxos.reduce((sum, u) => sum + u.value, 0);
    const estimatedFee = 250 * CONFIG.feeRate;
    const required = CONFIG.amountSats + estimatedFee;

    console.log(`  Available: ${totalAvailable} sats, Required: ${required} sats`);
    if (totalAvailable < required) {
        console.error(`Insufficient funds. Need ${required}, have ${totalAvailable}`);
        process.exit(1);
    }

    // Build transaction
    const psbt = new bitcoin.Psbt({ network: CONFIG.network });
    let inputTotal = 0;

    for (const utxo of utxos) {
        psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            witnessUtxo: {
                script: p2wpkh.output,
                value: utxo.value,
            },
        });
        inputTotal += utxo.value;
        console.log(`  Input: ${utxo.txid}:${utxo.vout} (${utxo.value} sats)`);
        if (inputTotal >= required) break;
    }

    // Output 0: Payment to locker
    psbt.addOutput({
        address: CONFIG.lockerAddress,
        value: CONFIG.amountSats,
    });

    // Output 1: OP_RETURN with 77-byte exchange request
    const opReturnScript = bitcoin.script.compile([
        bitcoin.opcodes.OP_RETURN,
        opReturnPayload,
    ]);
    psbt.addOutput({
        script: opReturnScript,
        value: 0,
    });

    // Output 2: Change
    const changeAmount = inputTotal - CONFIG.amountSats - estimatedFee;
    if (changeAmount > 546) {
        psbt.addOutput({
            address: senderAddress,
            value: changeAmount,
        });
    }

    // Sign
    for (let i = 0; i < psbt.inputCount; i++) {
        psbt.signInput(i, keyPair);
    }
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();
    const txid = tx.getId();

    console.log(`\n  TxId: ${txid}`);
    console.log(`  Size: ${tx.virtualSize()} vbytes`);
    console.log(`  Fee:  ${inputTotal - CONFIG.amountSats - (changeAmount > 546 ? changeAmount : 0)} sats`);

    // Save deposit data
    const depositData = {
        txid,
        txHex,
        opReturnHex: opReturnPayload.toString('hex'),
        amountSats: CONFIG.amountSats,
        lockerAddress: CONFIG.lockerAddress,
        senderAddress,
        // OP_RETURN fields
        destAssignedChainId: CONFIG.destAssignedChainId,
        appId: CONFIG.appId,
        recipientAddress: CONFIG.recipientAddress,
        networkFeeSats: CONFIG.networkFeeSats,
        speed: CONFIG.speed,
        thirdPartyId: CONFIG.thirdPartyId,
        destTokenId: CONFIG.destTokenId,
        minDestTokenAmount: CONFIG.minDestTokenAmount,
        minIntermediaryAmount: CONFIG.minIntermediaryAmount,
        bridgeFeePercentage: CONFIG.bridgeFeePercentage,
        createdAt: new Date().toISOString(),
    };

    const outputDir = path.join(__dirname, '../../data/universal-deposits');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const depositFile = path.join(outputDir, `${txid}.json`);
    fs.writeFileSync(depositFile, JSON.stringify(depositData, null, 2));
    console.log(`\n  Deposit data saved: ${depositFile}`);

    // Broadcast
    if (!CONFIG.autoBroadcast) {
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise(resolve => {
            rl.question('\nBroadcast? (yes/no): ', resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== 'yes') {
            console.log('\nNot broadcast. You can broadcast manually at: https://mempool.space/tx/push');
            console.log(`Raw hex in: ${depositFile}`);
            process.exit(0);
        }
    }

    try {
        const broadcastedTxid = await broadcastTransaction(txHex);
        console.log(`\nBroadcast successful!`);
        console.log(`  TxId: ${broadcastedTxid}`);
        console.log(`  View: https://mempool.space/tx/${broadcastedTxid}`);
    } catch (error) {
        console.error(`\nBroadcast failed: ${error.message}`);
        console.log('Raw TX hex saved. Broadcast manually.');
        process.exit(1);
    }

    console.log('\n========================================================');
    console.log('  DEPOSIT CREATED');
    console.log('========================================================');
    console.log('\nNext steps:');
    console.log('  1. Wait for Bitcoin confirmation');
    console.log('  2. Submit proof on Polygon:');
    console.log(`     npx hardhat run scripts/universal/submit-proof.ts --network polygon`);
    console.log(`     (set DEPOSIT_FILE=${txid}.json)`);
}

main().catch(error => {
    console.error('\nError:', error.message);
    process.exit(1);
});
