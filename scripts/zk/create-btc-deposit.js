#!/usr/bin/env node

/**
 * Create Bitcoin Transaction for Private Transfer
 *
 * This script:
 * 1. Generates a secret and commitment
 * 2. Builds a Bitcoin transaction with:
 *    - Output 0: Payment to locker (P2PKH)
 *    - Output 1: OP_RETURN with commitment
 * 3. Signs and broadcasts the transaction
 *
 * Prerequisites:
 *   npm install bitcoinjs-lib @mempool/mempool.js ecpair tiny-secp256k1 bip32
 *
 * Usage:
 *   node scripts/zk/create-btc-deposit.js
 *
 * Environment Variables (in .env):
 *   BTC_PRIVATE_KEY_WIF  - Bitcoin private key in WIF format
 *   BTC_LOCKER_ADDRESS   - Locker's P2PKH Bitcoin address
 *   BTC_AMOUNT_SATS      - Amount to send in satoshis
 *   EVM_CHAIN_ID         - Target EVM chain ID (137 for Polygon)
 *   EVM_RECIPIENT        - Ethereum address to receive TeleBTC
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Check for required dependencies
let bitcoin, ECPairFactory, ecc;
try {
    bitcoin = require('bitcoinjs-lib');
    ECPairFactory = require('ecpair').default;
    ecc = require('tiny-secp256k1');
} catch (e) {
    console.error('\n❌ Missing dependencies. Please install:');
    console.error('   npm install bitcoinjs-lib ecpair tiny-secp256k1\n');
    process.exit(1);
}

require('dotenv').config();

const ECPair = ECPairFactory(ecc);

// Configuration from environment
const CONFIG = {
    privateKeyWIF: process.env.BTC_PRIVATE_KEY_WIF,
    lockerAddress: process.env.BTC_LOCKER_ADDRESS,
    amountSats: parseInt(process.env.BTC_AMOUNT_SATS || '100000'),  // Default: 0.001 BTC
    chainId: parseInt(process.env.EVM_CHAIN_ID || '137'),           // Default: Polygon
    recipient: process.env.EVM_RECIPIENT,
    network: bitcoin.networks.bitcoin,  // Mainnet
    feeRate: 2,  // sats/vbyte (adjust based on mempool)
    autoBroadcast: true,  // Skip confirmation prompt
};

/**
 * SHA256 hash
 */
function sha256(data) {
    return crypto.createHash('sha256').update(data).digest();
}

/**
 * Convert Buffer to bit array (big-endian)
 */
function bufferToBitsBE(buffer) {
    const bits = [];
    for (let i = 0; i < buffer.length; i++) {
        for (let j = 7; j >= 0; j--) {
            bits.push((buffer[i] >> j) & 1);
        }
    }
    return bits;
}

/**
 * Convert bits to BigInt
 */
function bitsToBigInt(bits) {
    let result = BigInt(0);
    for (let i = 0; i < bits.length; i++) {
        result = (result << BigInt(1)) | BigInt(bits[i]);
    }
    return result;
}

/**
 * Fetch UTXOs from mempool.space API
 */
async function fetchUTXOs(address) {
    const fetch = (await import('node-fetch')).default;
    const url = `https://mempool.space/api/address/${address}/utxo`;

    console.log(`\nFetching UTXOs for ${address}...`);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch UTXOs: ${response.status}`);
    }

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

    const txid = await response.text();
    return txid;
}

/**
 * Get locker script from P2PKH address
 */
function getLockerScript(address) {
    const decoded = bitcoin.address.toOutputScript(address, CONFIG.network);
    return decoded;
}

/**
 * Compute locker script hash (as circuit expects - padded to 65 bytes)
 */
function computeLockerScriptHash(lockerScript) {
    const padded = Buffer.alloc(65);
    lockerScript.copy(padded);
    const hash = sha256(padded);
    const bits = bufferToBitsBE(hash);
    return bitsToBigInt(bits.slice(0, 254));
}

/**
 * Main function
 */
async function main() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║       Create Bitcoin Deposit for Private Transfer          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // ═══════════════════════════════════════════════════════════════════
    // Validate configuration
    // ═══════════════════════════════════════════════════════════════════
    if (!CONFIG.privateKeyWIF) {
        console.error('❌ BTC_PRIVATE_KEY_WIF not set in .env');
        console.error('   Add: BTC_PRIVATE_KEY_WIF=your_wif_private_key');
        process.exit(1);
    }

    if (!CONFIG.lockerAddress) {
        console.error('❌ BTC_LOCKER_ADDRESS not set in .env');
        console.error('   Add: BTC_LOCKER_ADDRESS=locker_p2pkh_address');
        process.exit(1);
    }

    if (!CONFIG.recipient) {
        console.error('❌ EVM_RECIPIENT not set in .env');
        console.error('   Add: EVM_RECIPIENT=0x_your_ethereum_address');
        process.exit(1);
    }

    console.log('Configuration:');
    console.log(`  Locker Address: ${CONFIG.lockerAddress}`);
    console.log(`  Amount:         ${CONFIG.amountSats} satoshis (${CONFIG.amountSats / 100000000} BTC)`);
    console.log(`  Chain ID:       ${CONFIG.chainId}`);
    console.log(`  Recipient:      ${CONFIG.recipient}`);

    // ═══════════════════════════════════════════════════════════════════
    // Step 1: Generate secret and commitment
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('Step 1: Generate Secret and Commitment');
    console.log('─────────────────────────────────────────────────────────────');

    const secret = crypto.randomBytes(32);
    console.log(`  Secret: ${secret.toString('hex')}`);

    // commitment = SHA256(secret || amount || chainId || recipient)
    // Total: 32 + 8 + 2 + 20 = 62 bytes (496 bits) - matches circuit
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64BE(BigInt(CONFIG.amountSats));

    const chainIdBuffer = Buffer.alloc(2);
    chainIdBuffer.writeUInt16BE(CONFIG.chainId);

    // Convert recipient address to bytes (remove 0x prefix)
    const recipientBytes = Buffer.from(CONFIG.recipient.slice(2), 'hex');

    const commitmentInput = Buffer.concat([secret, amountBuffer, chainIdBuffer, recipientBytes]);
    const commitment = sha256(commitmentInput);
    console.log(`  Commitment: ${commitment.toString('hex')}`);

    // nullifier = SHA256(secret || 0x01)
    const nullifierInput = Buffer.concat([secret, Buffer.from([0x01])]);
    const nullifierHash = sha256(nullifierInput);
    const nullifierBits = bufferToBitsBE(nullifierHash);
    const nullifier = bitsToBigInt(nullifierBits.slice(0, 254));
    console.log(`  Nullifier: ${nullifier.toString().substring(0, 40)}...`);

    // ═══════════════════════════════════════════════════════════════════
    // Step 2: Prepare key pair and get sender address
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('Step 2: Prepare Wallet');
    console.log('─────────────────────────────────────────────────────────────');

    const keyPair = ECPair.fromWIF(CONFIG.privateKeyWIF, CONFIG.network);
    // Use P2WPKH (native SegWit) for bc1 addresses
    const p2wpkh = bitcoin.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network: CONFIG.network,
    });
    const senderAddress = p2wpkh.address;
    console.log(`  Sender Address: ${senderAddress}`);

    // ═══════════════════════════════════════════════════════════════════
    // Step 3: Fetch UTXOs
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('Step 3: Fetch UTXOs');
    console.log('─────────────────────────────────────────────────────────────');

    const utxos = await fetchUTXOs(senderAddress);

    if (utxos.length === 0) {
        console.error('\n❌ No UTXOs found. Please fund the address first.');
        console.error(`   Address: ${senderAddress}`);
        process.exit(1);
    }

    // Calculate total available
    const totalAvailable = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
    console.log(`  Total Available: ${totalAvailable} satoshis`);

    // Estimate fee (2 inputs, 3 outputs worst case)
    const estimatedVsize = 250;  // Conservative estimate
    const estimatedFee = estimatedVsize * CONFIG.feeRate;

    const requiredAmount = CONFIG.amountSats + estimatedFee;
    console.log(`  Required Amount: ${requiredAmount} satoshis (including fee)`);

    if (totalAvailable < requiredAmount) {
        console.error(`\n❌ Insufficient funds. Need ${requiredAmount} sats, have ${totalAvailable} sats`);
        process.exit(1);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Step 4: Build Transaction
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('Step 4: Build Transaction');
    console.log('─────────────────────────────────────────────────────────────');

    const psbt = new bitcoin.Psbt({ network: CONFIG.network });

    // Add inputs
    let inputTotal = 0;
    for (const utxo of utxos) {
        // For SegWit (P2WPKH) inputs, use witnessUtxo
        psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            witnessUtxo: {
                script: p2wpkh.output,
                value: utxo.value,
            },
        });

        inputTotal += utxo.value;
        console.log(`  Added input: ${utxo.txid}:${utxo.vout} (${utxo.value} sats)`);

        if (inputTotal >= requiredAmount) break;
    }

    // Output 0: Payment to locker
    const lockerScript = getLockerScript(CONFIG.lockerAddress);
    psbt.addOutput({
        address: CONFIG.lockerAddress,
        value: CONFIG.amountSats,
    });
    console.log(`  Output 0: ${CONFIG.amountSats} sats to locker`);

    // Output 1: OP_RETURN with commitment
    const opReturnScript = bitcoin.script.compile([
        bitcoin.opcodes.OP_RETURN,
        commitment,
    ]);
    psbt.addOutput({
        script: opReturnScript,
        value: 0,
    });
    console.log(`  Output 1: OP_RETURN with commitment`);

    // Output 2: Change (if needed)
    const changeAmount = inputTotal - CONFIG.amountSats - estimatedFee;
    if (changeAmount > 546) {  // Dust threshold
        psbt.addOutput({
            address: senderAddress,
            value: changeAmount,
        });
        console.log(`  Output 2: ${changeAmount} sats change`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Step 5: Sign Transaction
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('Step 5: Sign Transaction');
    console.log('─────────────────────────────────────────────────────────────');

    // Sign all inputs
    for (let i = 0; i < psbt.inputCount; i++) {
        psbt.signInput(i, keyPair);
    }

    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();
    const txid = tx.getId();

    console.log(`  TxId: ${txid}`);
    console.log(`  Size: ${tx.virtualSize()} vbytes`);
    console.log(`  Fee:  ${inputTotal - CONFIG.amountSats - changeAmount} sats`);

    // ═══════════════════════════════════════════════════════════════════
    // Step 6: Save deposit data (BEFORE broadcasting)
    // ═══════════════════════════════════════════════════════════════════
    const lockerScriptHash = computeLockerScriptHash(lockerScript);

    const depositData = {
        // Secret data (KEEP PRIVATE!)
        secret: secret.toString('hex'),
        secretBits: bufferToBitsBE(secret),

        // Public data
        commitment: commitment.toString('hex'),
        nullifier: nullifier.toString(),
        amount: CONFIG.amountSats,
        chainId: CONFIG.chainId,
        recipient: CONFIG.recipient,

        // Bitcoin data
        txid: txid,
        txHex: txHex,
        lockerAddress: CONFIG.lockerAddress,
        lockerScript: lockerScript.toString('hex'),
        lockerScriptHash: lockerScriptHash.toString(),

        // Timestamps
        createdAt: new Date().toISOString(),
    };

    const outputDir = path.join(__dirname, '../../zkproof/deposits');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const depositFile = path.join(outputDir, `${txid}.json`);
    fs.writeFileSync(depositFile, JSON.stringify(depositData, null, 2));
    console.log(`\n  Deposit data saved to: ${depositFile}`);

    // ═══════════════════════════════════════════════════════════════════
    // Step 7: Broadcast Transaction
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('Step 7: Broadcast Transaction');
    console.log('─────────────────────────────────────────────────────────────');

    console.log('\n⚠️  TRANSACTION DETAILS:');
    console.log(`    Amount to locker: ${CONFIG.amountSats} sats (${CONFIG.amountSats / 100000000} BTC)`);
    console.log(`    Locker address:   ${CONFIG.lockerAddress}`);
    console.log(`    Fee:              ${inputTotal - CONFIG.amountSats - (changeAmount > 546 ? changeAmount : 0)} sats`);

    // Skip confirmation if autoBroadcast is enabled
    if (!CONFIG.autoBroadcast) {
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const answer = await new Promise(resolve => {
            rl.question('\nBroadcast transaction? (yes/no): ', resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'yes') {
            console.log('\n❌ Transaction NOT broadcast. Deposit data saved for later use.');
            console.log(`   Raw TX hex saved in: ${depositFile}`);
            console.log('   You can broadcast manually at: https://mempool.space/tx/push');
            process.exit(0);
        }
    } else {
        console.log('\n🚀 Auto-broadcasting enabled...');
    }

    try {
        const broadcastedTxid = await broadcastTransaction(txHex);
        console.log(`\n✓ Transaction broadcast successfully!`);
        console.log(`  TxId: ${broadcastedTxid}`);
        console.log(`  View: https://mempool.space/tx/${broadcastedTxid}`);
    } catch (error) {
        console.error(`\n❌ Broadcast failed: ${error.message}`);
        console.log('   Raw TX hex saved. You can broadcast manually.');
        process.exit(1);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Summary
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║               DEPOSIT CREATED SUCCESSFULLY                 ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('\n⚠️  IMPORTANT: Save your secret! Without it you cannot claim.');
    console.log(`    Secret: ${secret.toString('hex')}`);
    console.log('\nNext Steps:');
    console.log('  1. Wait for Bitcoin confirmation (6+ blocks recommended)');
    console.log('  2. Generate witness and proof:');
    console.log(`     npm run zk:generate-witness -- --txid=${txid}`);
    console.log('  3. Submit proof on Polygon:');
    console.log('     npm run zk:submit-proof --network polygon');
}

main().catch(error => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
});
