#!/usr/bin/env node

/**
 * Generate Circuit Input from Bitcoin Transaction
 *
 * MINIMAL MVP VERSION
 *
 * This script converts the real Bitcoin transaction data into the format
 * required by the simplified ZK circuit for proof generation.
 */

const fs = require('fs');
const crypto = require('crypto');

// Load the sample transaction data
const sampleData = JSON.parse(
  fs.readFileSync(__dirname + '/bitcoin-tx-sample.json', 'utf8')
);

/**
 * Convert hex string to bit array (LSB first for each byte)
 * @param {string} hexString - Hex string (without 0x prefix)
 * @param {number} targetBits - Desired bit array length (will pad with zeros)
 * @returns {number[]} Array of bits
 */
function hexToBits(hexString, targetBits = null) {
  const bytes = Buffer.from(hexString, 'hex');
  const bits = [];

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    // Convert each byte to 8 bits (LSB first)
    for (let j = 0; j < 8; j++) {
      bits.push((byte >> j) & 1);
    }
  }

  // Pad with zeros if target length specified
  if (targetBits && bits.length < targetBits) {
    while (bits.length < targetBits) {
      bits.push(0);
    }
  }

  return bits;
}

/**
 * Convert hex string to field element (big integer)
 * @param {string} hexString - Hex string
 * @returns {string} Field element as string
 */
function hexToFieldElement(hexString) {
  return BigInt('0x' + hexString).toString();
}

/**
 * Double SHA256 hash (Bitcoin style)
 * @param {Buffer} data - Input data
 * @returns {Buffer} Hash result
 */
function doubleSHA256(data) {
  return crypto.createHash('sha256')
    .update(crypto.createHash('sha256').update(data).digest())
    .digest();
}

/**
 * Parse vout to extract a specific output
 * @param {string} voutHex - Hex string of vout section
 * @param {number} index - Output index (0, 1, 2, ...)
 * @returns {object} Output data and offset
 */
function parseVout(voutHex, index) {
  const voutBytes = Buffer.from(voutHex, 'hex');
  let offset = 0;

  // Read number of outputs (varint)
  const outputCount = voutBytes[offset];
  offset += 1;

  // Skip to desired output
  for (let i = 0; i < index; i++) {
    // Skip 8-byte value
    offset += 8;

    // Read script length (varint, simplified for single byte)
    const scriptLen = voutBytes[offset];
    offset += 1;

    // Skip script
    offset += scriptLen;
  }

  // Read the target output
  const startOffset = offset;

  // Value (8 bytes)
  const value = voutBytes.slice(offset, offset + 8);
  offset += 8;

  // Script length
  const scriptLen = voutBytes[offset];
  offset += 1;

  // Script
  const script = voutBytes.slice(offset, offset + scriptLen);
  offset += scriptLen;

  const endOffset = offset;

  // Combine value + script length + script
  const outputData = Buffer.concat([
    value,
    Buffer.from([scriptLen]),
    script
  ]);

  return {
    data: outputData,
    startOffset: startOffset,
    endOffset: endOffset,
    size: endOffset - startOffset
  };
}

/**
 * Generate circuit input for a specific vout
 * MINIMAL MVP VERSION - for simplified circuit without SHA256/Merkle
 * @param {number} voutIndex - Which output to prove (0 or 1)
 * @returns {object} Circuit input data
 */
function generateCircuitInput(voutIndex = 0) {
  const { transaction, voutDetails, blockHeader } = sampleData;

  // Build complete raw transaction
  const rawTx = transaction.version + transaction.vin + transaction.vout + transaction.locktime;
  const rawTxBytes = Buffer.from(rawTx, 'hex');

  console.log(`\n📝 Generating circuit input for vout[${voutIndex}]`);
  console.log(`   Transaction size: ${rawTxBytes.length} bytes`);

  // Parse the specific vout
  const voutParsed = parseVout(transaction.vout, voutIndex);
  console.log(`   Vout size: ${voutParsed.size} bytes`);
  console.log(`   Vout value: ${voutDetails.outputs[voutIndex].valueSatoshis}`);

  // Calculate vout offset in full transaction (in bytes and bits)
  // version (4) + vin (67) + vout_count (1) + vout[0] position
  const versionLen = transaction.version.length / 2;
  const vinLen = transaction.vin.length / 2;
  const voutOffsetBytes = versionLen + vinLen + voutParsed.startOffset;
  const voutOffsetBits = voutOffsetBytes * 8;

  console.log(`   Vout offset: ${voutOffsetBytes} bytes (${voutOffsetBits} bits)`);
  console.log(`   Circuit expects offset: 70 bytes (560 bits)`);

  if (voutIndex === 0 && voutOffsetBytes === 72) {
    console.log(`   ✅ Offset matches circuit's fixed offset!`);
  } else if (voutIndex !== 0) {
    console.log(`   ⚠️  Warning: MVP circuit only supports vout[0] at offset 72`);
    console.log(`      For vout[${voutIndex}], actual offset is ${voutOffsetBytes}`);
  }

  // Convert transaction to bit array (padded to 1536 bits = 192 bytes for MVP circuit)
  const transactionBits = hexToBits(rawTx, 1536);

  // Convert vout to bit array (padded to 512 bits = 64 bytes for circuit)
  const voutDataBits = hexToBits(voutParsed.data.toString('hex'), 512);

  // Calculate transaction hash (for reference - circuit uses this as public input)
  const txHash = doubleSHA256(rawTxBytes);
  // Use raw hash bytes for the field element (big-endian number)
  const txHashHex = txHash.toString('hex');
  const txHashField = hexToFieldElement(txHashHex);

  // Bitcoin displays txids in little-endian (byte-reversed), so reverse for display comparison
  const txHashDisplayHex = Buffer.from(txHash).reverse().toString('hex').toUpperCase();

  console.log(`   Calculated txid: ${txHashDisplayHex}`);
  console.log(`   Expected txid:   ${transaction.txid}`);

  // Compare in Bitcoin display format (little-endian)
  if (txHashDisplayHex === transaction.txid.toUpperCase()) {
    console.log(`   ✅ Transaction hash verified!`);
  } else {
    console.log(`   ❌ Transaction hash mismatch!`);
  }

  // Build circuit input for MINIMAL MVP
  const circuitInput = {
    // Public inputs
    voutData: voutDataBits,
    txHash: txHashField,

    // Private inputs
    transaction: transactionBits
  };

  return circuitInput;
}

/**
 * Main function
 */
function main() {
  const voutIndex = process.argv[2] ? parseInt(process.argv[2]) : 0;

  console.log('\n🔧 Bitcoin Transaction to Circuit Input Converter');
  console.log('================================================');
  console.log('   MINIMAL MVP VERSION (no SHA256/Merkle)\n');
  console.log(`Block: ${sampleData.blockNumber}`);
  console.log(`Transaction: ${sampleData.transaction.txid}`);
  console.log(`Available outputs: ${sampleData.voutDetails.count}`);

  if (voutIndex !== 0) {
    console.log(`\n⚠️  Warning: MVP circuit uses fixed offset for vout[0] only`);
    console.log(`   Generating input for vout[${voutIndex}] anyway for reference`);
  }

  const circuitInput = generateCircuitInput(voutIndex);

  // Write to file
  const outputFile = __dirname + `/../build/input.json`;
  fs.writeFileSync(outputFile, JSON.stringify(circuitInput, null, 2));

  console.log(`\n✅ Circuit input generated successfully!`);
  console.log(`   Output file: ${outputFile}`);
  console.log(`\n📊 Input Statistics (MINIMAL MVP):`);
  console.log(`   - Public inputs: voutData[512 bits], txHash`);
  console.log(`   - Private inputs: transaction[1536 bits]`);
  console.log(`   - Estimated constraints: ~500`);

  console.log(`\n🚀 Next steps:`);
  console.log(`   1. Compile circuit:  npm run circuit:compile`);
  console.log(`   2. Run setup:        npm run circuit:setup`);
  console.log(`   3. Generate proof:   snarkjs groth16 prove zkproof/build/circuit_final.zkey zkproof/build/input.json zkproof/build/proof.json zkproof/build/public.json`);
  console.log(`   4. Verify proof:     snarkjs groth16 verify zkproof/build/verification_key.json zkproof/build/public.json zkproof/build/proof.json`);
  console.log('');
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { generateCircuitInput, hexToBits, parseVout };
