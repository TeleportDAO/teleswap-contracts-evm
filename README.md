# TeleSwap protocol v1

This repository contains the smart contracts for the TeleSwap protocol. The repository uses Hardhat as a development environment for compilation, testing, and deployment tasks.

## What is TeleSwap?

TeleSwap is a fully decentralized protocol for bridging and exchanging BTC between Bitcoin and EVM chains securely.

## Private Transfer (ZK Privacy Feature)

We're developing a privacy-preserving bridge using zero-knowledge proofs. See documentation:

- [PRIVATE_TRANSFER.md](./PRIVATE_TRANSFER.md) - What it is, how it works, benefits
- [PRIVATE_TRANSFER_PLAN.md](./PRIVATE_TRANSFER_PLAN.md) - Implementation roadmap and checklist

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
