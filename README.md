# TeleSwap protocol v1

This repository contains the smart contracts for the TeleSwap protocol. The repository uses Hardhat as a development environment for compilation, testing, and deployment tasks.

## What is TeleSwap?

TeleSwap is a fully decentralized protocol for bridging and exchanging BTC between Bitcoin and EVM chains securely.

## ZK Proof-of-Concept (Cost Optimization)

We've developed a zero-knowledge proof system to **reduce on-chain computation costs and improve scalability** for Bitcoin transaction verification. Instead of submitting full transaction data and Merkle proofs on-chain (1-4 KB), users submit the vout data (64 bytes) + a compact ZK proof (128 bytes) that verifies the transaction off-chain. The vout data is available as a public input for on-chain calculations.

**Key Benefits:**
- 📉 **80-94% reduction** in on-chain data storage (224 bytes vs 1-4 KB)
- ⚡ **Fixed verification cost** regardless of transaction complexity
- 🔄 **Better scalability** for high-volume bridge operations
- 💰 **Merkle proof verification** done off-chain (saves ~384 bytes on-chain)
- 📊 **Vout data available** as public input for on-chain calculations

**Documentation:**
- [ZK Proof-of-Concept Guide](./ZK_PROOF_OF_CONCEPT.md) - Complete technical documentation
- [Installation Checklist](./INSTALLATION_CHECKLIST.md) - Setup and testing guide
- [Implementation Summary](./ZK_POC_SUMMARY.md) - Architecture and deliverables
- [Circuit Documentation](./circuits/README.md) - Circuit design details

**Quick Start:**
```bash
# Install and test the ZK POC
npm run circuit:compile  # Compile circuits
npm run circuit:setup    # Trusted setup
npm run zk:generate-proof # Generate proof
npm run zk:verify-proof  # Verify proof
```

**Note:** This is a proof-of-concept for cost optimization and scalability. It demonstrates how ZK proofs can reduce on-chain data and computation, not for privacy purposes.

## Documentation

See the links below: 
- [TeleSwap documentation](https://docs.teleswap.xyz/teleswap/introduction)
- [TeleBTC technical paper](https://arxiv.org/abs/2307.13848) 

## Audits
- [Quantstamp report](https://github.com/TeleportDAO/audits/blob/main/reports/Quantstamp-Bitcoin-EVM.pdf) (Feb 2023)

## Community
- Follow us on [Twitter](https://twitter.com/Teleport_DAO).
- Join our [discord channel](https://discord.com/invite/6RSsgfQgcb).

## Install dependencies

To start, clone the codes and install the required packages using:

`yarn`

## Compile contracts

To compile the codes, use the below command:

`yarn clean` & `yarn build`

## Run tests

You can run the entire test suite with the following command:

`yarn test`

## Deploy contracts

You can deploy contracts on supported networks (mumbai and polygon) with the following command:

`NETWORK= yarn deploy`

## Config contracts

After deployment, some variables need to be set using the following commands:

`NETWORK= yarn init_config`

Run the below command with a different private key to config upgradable contracts:

`NETWORK= yarn config_upgradables`
