#!/usr/bin/env node

/**
 * Generate Circuit Input from Bitcoin Transaction
 *
 * This script converts the real Bitcoin transaction data into the format
 * required by the ZK circuit for proof generation.
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
 * @param {number} voutIndex - Which output to prove (0 or 1)
 * @returns {object} Circuit input data
 */
function generateCircuitInput(voutIndex = 0) {
  const { transaction, voutDetails, merkleProof, blockNumber, blockHeader } = sampleData;

  // Build complete raw transaction
  const rawTx = transaction.version + transaction.vin + transaction.vout + transaction.locktime;
  const rawTxBytes = Buffer.from(rawTx, 'hex');

  console.log(`\n📝 Generating circuit input for vout[${voutIndex}]`);
  console.log(`   Transaction size: ${rawTxBytes.length} bytes`);

  // Parse the specific vout
  const voutParsed = parseVout(transaction.vout, voutIndex);
  console.log(`   Vout size: ${voutParsed.size} bytes`);
  console.log(`   Vout value: ${voutDetails.outputs[voutIndex].valueSatoshis}`);

  // Calculate vout offset in full transaction (in bits)
  const voutOffsetBytes = transaction.version.length / 2 + transaction.vin.length / 2 + voutParsed.startOffset;
  const voutOffsetBits = voutOffsetBytes * 8;
  console.log(`   Vout offset: ${voutOffsetBytes} bytes (${voutOffsetBits} bits)`);

  // Convert transaction to bit array (padded to 2048 bits for circuit)
  const transactionBits = hexToBits(rawTx, 2048);

  // Convert vout to bit array (padded to 512 bits for circuit)
  const voutDataBits = hexToBits(voutParsed.data.toString('hex'), 512);

  // Extract Merkle root from block header
  // Block header structure: version(4) + prevBlock(32) + merkleRoot(32) + time(4) + bits(4) + nonce(4)
  const blockHeaderBytes = Buffer.from(blockHeader, 'hex');
  const merkleRootBytes = blockHeaderBytes.slice(36, 68); // Bytes 36-67
  const merkleRootHex = merkleRootBytes.toString('hex');
  const merkleRootField = hexToFieldElement(merkleRootHex);

  console.log(`   Merkle root: ${merkleRootHex}`);

  // Convert Merkle siblings to field elements
  const merkleSiblingsFields = merkleProof.siblings.map(s => hexToFieldElement(s));

  // Verify transaction hash
  const txHash = doubleSHA256(rawTxBytes);
  const txHashHex = txHash.reverse().toString('hex'); // Reverse for little-endian
  console.log(`   Calculated txid: ${txHashHex.toUpperCase()}`);
  console.log(`   Expected txid:   ${transaction.txid}`);

  if (txHashHex.toUpperCase() === transaction.txid) {
    console.log(`   ✅ Transaction hash verified!`);
  } else {
    console.log(`   ❌ Transaction hash mismatch!`);
  }

  // Build circuit input
  const circuitInput = {
    // Public inputs
    merkleRoot: merkleRootField,
    voutData: voutDataBits,
    blockNumber: blockNumber.toString(),

    // Private inputs
    transaction: transactionBits,
    voutOffset: voutOffsetBits.toString(),
    merkleSiblings: merkleSiblingsFields,
    merkleIndex: merkleProof.index.toString()
  };

  return circuitInput;
}

/**
 * Main function
 */
function main() {
  const voutIndex = process.argv[2] ? parseInt(process.argv[2]) : 0;

  console.log('\n🔧 Bitcoin Transaction to Circuit Input Converter');
  console.log('================================================\n');
  console.log(`Block: ${sampleData.blockNumber}`);
  console.log(`Transaction: ${sampleData.transaction.txid}`);
  console.log(`Available outputs: ${sampleData.voutDetails.count}`);

  if (voutIndex < 0 || voutIndex >= sampleData.voutDetails.count) {
    console.error(`\n❌ Error: vout index ${voutIndex} is out of range (0-${sampleData.voutDetails.count - 1})`);
    process.exit(1);
  }

  const circuitInput = generateCircuitInput(voutIndex);

  // Write to file
  const outputFile = __dirname + `/../build/input_vout${voutIndex}.json`;
  fs.writeFileSync(outputFile, JSON.stringify(circuitInput, null, 2));

  console.log(`\n✅ Circuit input generated successfully!`);
  console.log(`   Output file: ${outputFile}`);
  console.log(`\n📊 Input Statistics:`);
  console.log(`   - Public inputs: 3 (merkleRoot, voutData[512], blockNumber)`);
  console.log(`   - Private inputs: 4 (transaction[2048], voutOffset, merkleSiblings[12], merkleIndex)`);
  console.log(`   - Total bits: ${2048 + 512} (public and private transaction data)`);
  console.log(`   - Merkle siblings: ${circuitInput.merkleSiblings.length}`);

  console.log(`\n🚀 Next steps:`);
  console.log(`   1. Compile circuit: npm run circuit:compile`);
  console.log(`   2. Run setup: npm run circuit:setup`);
  console.log(`   3. Generate proof: snarkjs groth16 prove zkproof/build/circuit_final.zkey ${outputFile} zkproof/build/proof.json zkproof/build/public.json`);
  console.log(`   4. Verify proof: npm run zk:verify-proof`);
  console.log('');
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { generateCircuitInput, hexToBits, parseVout };
