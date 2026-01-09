# Test Data for ZK Proof-of-Concept

This directory contains real Bitcoin transaction data for testing the ZK proof system.

## Sample Transaction (Block 931456)

**Transaction ID:** `027CAB460A55430817E43416DFB002CCFF72CA654811E7464DB70C0129EFAAA8` (little-endian)

### Transaction Details

**Size:** 138 bytes (well within the circuit's 256-byte limit)

**Structure:**
```
Version:  02000000 (4 bytes)
Inputs:   01bf54b7... (67 bytes, 1 input)
Outputs:  024e4a00... (63 bytes, 2 outputs)
Locktime: 00000000 (4 bytes)
```

**Complete Raw Transaction:**
```
0200000001bf54b76b6298e30af69661b0bbd625854f47be8229610bb32a46eacecaca3dc80000000017160014ff18ae8049173713c509ad3046a970bf2f452a10fdffffff024e4a0000000000001600144a80adba4391c3d4784e9e34c0206cca7e6dffd2f95307000000000017a91472df0f82c4bcfe01a274bd521e5d4c66586b7a5b8700000000
```

### Outputs (Vouts)

#### Output 0 (P2WPKH)
- **Value:** 19,022 satoshis (0.00019022 BTC)
- **Script:** `1600144a80adba4391c3d4784e9e34c0206cca7e6dffd2`
- **Type:** Pay-to-Witness-PubKey-Hash
- **Size:** 30 bytes ✓ (fits in 64-byte circuit limit)

#### Output 1 (P2SH)
- **Value:** 480,249 satoshis (0.00480249 BTC)
- **Script:** `17a91472df0f82c4bcfe01a274bd521e5d4c66586b7a5b87`
- **Type:** Pay-to-Script-Hash
- **Size:** 31 bytes ✓ (fits in 64-byte circuit limit)

### Block Information

- **Block Number:** 931456
- **Block Header:**
  ```
  00000020f23ea983401c2ca5c3b2ea22037982bfcd9f82aa5ead010000000000000000008e53d6a40c6d09916dfb91ac0c0e52cad4d9543420ab241d6e430531a1149f4e95066069f2eb0117f423f669
  ```
- **Merkle Root (from header):** `8e53d6a40c6d09916dfb91ac0c0e52cad4d9543420ab241d6e430531a1149f4e`

### Merkle Proof

- **Transaction Index:** 2582 (out of ~4096 transactions)
- **Index Binary:** `101000010110` (12 bits, matching the circuit's 12-level Merkle tree)
- **Number of Siblings:** 12 (one for each level)

**Merkle Siblings (in order from leaf to root):**
1. `c381149836df2b3e64bc2ad3f8fef3cbf2930ee187580aacb75b944eae114d3a`
2. `a4fe52387e7afa254fa4ecf669c4ae6ed5f5d6b5def36abb52da6f39054882aa`
3. `b29f7ae9270cf01db09a8a68d721e87aa4c5f7c98e6a59f15b20c1ad3e513b16`
4. `35cd4119b09d2349cbd8487f377050562c1fc08407989735e4e77675c91f1475`
5. `af18bbe406f439a2507ae9e66ed914d35bba290a8f4ececc8f8b89fb53eafff4`
6. `35e8507db4d427095d7bf4f74d2e79e7f57a910465bd4d218f2fb6bee728b9c8`
7. `db9a29e1a89fbb56c5ca3340675f6e66481a18986842c14e36635ab929d1ef92`
8. `5674d07611ed56347cfbc28b1c12840620fbcd98ebd4c119403830421899d25c`
9. `47a7a7c9e979b256f1e7c20e3fcd4249a8db3638cb7685b808694a375958e245`
10. `232ff649ca9f180aba958624bb85e6a6db4a048d2453372bb383782bb50904f2`
11. `6980a548983149d81268f47f2f5da071e862f66ae77ee44394aa0aba34410de7`
12. `8835345b562596f5d8e1d2404847070d8619b01f78a0f43d8cdc5b13c6c502ee`

## Circuit Input Format

To use this transaction with the ZK circuit, you need to convert it to the circuit's input format:

### Public Inputs

```javascript
{
  "merkleRoot": "<field element from block header>",
  "voutData": [/* 512-bit array representing vout bytes */],
  "blockNumber": "931456"
}
```

### Private Inputs

```javascript
{
  "transaction": [/* 2048-bit array representing full tx */],
  "voutOffset": "<bit offset where vout starts in transaction>",
  "merkleSiblings": [/* array of 12 field elements, one per sibling */],
  "merkleIndex": "2582"
}
```

## Vout Offset Calculation

For **Output 0** (first vout):
- Starts after: version (4 bytes) + vin (67 bytes) + vout_count (1 byte)
- Offset: 72 bytes = 576 bits
- Vout data: 30 bytes starting at offset 72

For **Output 1** (second vout):
- Starts after: version (4 bytes) + vin (67 bytes) + vout_count (1 byte) + vout[0] (30 bytes)
- Offset: 102 bytes = 816 bits
- Vout data: 31 bytes starting at offset 102

## Usage Examples

### Test Case 1: Prove Output 0 (P2WPKH)

```bash
node zkproof/scripts/generate_proof.js \
  --tx-file zkproof/test-data/bitcoin-tx-sample.json \
  --vout-index 0 \
  --block 931456
```

**Expected Circuit Inputs:**
- `voutData`: First 30 bytes of vout section (the P2WPKH output)
- `voutOffset`: 576 (bits)
- `merkleIndex`: 2582

### Test Case 2: Prove Output 1 (P2SH)

```bash
node zkproof/scripts/generate_proof.js \
  --tx-file zkproof/test-data/bitcoin-tx-sample.json \
  --vout-index 1 \
  --block 931456
```

**Expected Circuit Inputs:**
- `voutData`: Second output (31 bytes, the P2SH output)
- `voutOffset`: 816 (bits)
- `merkleIndex`: 2582

## Verification Checklist

When testing with this transaction, verify:

- ✅ Transaction size (138 bytes) fits in circuit (256 bytes max)
- ✅ Vout sizes (30, 31 bytes) fit in circuit (64 bytes max)
- ✅ Merkle proof has exactly 12 siblings (matches circuit depth)
- ✅ Transaction index (2582) is within range (0-4095 for 12 levels)
- ✅ Double SHA256 of raw transaction equals txid
- ✅ Merkle proof verification leads to correct Merkle root

## Data Source

This is a real Bitcoin transaction from block 931456. You can verify it on any Bitcoin block explorer:

- Block: 931456
- Txid: `027cab460a55430817e43416dfb002ccff72ca654811e7464db70c0129efaaa8`

## Future Enhancements

For a production version, you would need to handle:
- SegWit transactions (witness data)
- Variable transaction sizes (up to 100KB+)
- Multiple vout proofs in a single ZK proof
- Batch verification of multiple transactions

## Files

- `bitcoin-tx-sample.json` - Complete transaction data in JSON format
- `README.md` - This file
- `generate_input.js` - (TODO) Script to convert JSON to circuit input format
