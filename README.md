# TeleSwap protocol v1

This repository contains the smart contracts for the TeleSwap protocol. The repository uses Hardhat as a development environment for compilation, testing, and deployment tasks.

## What is TeleSwap?

TeleSwap is a fully decentralized protocol for bridging and exchanging BTC between Bitcoin and EVM chains securely.

## Documentation

- [TeleSwap Docs](https://docs.teleswap.xyz)
- [TeleBTC Technical Paper](https://arxiv.org/abs/2307.13848)

## Audits

- [Quantstamp Report](https://github.com/TeleportDAO/audits/blob/main/reports/Quantstamp-Bitcoin-EVM.pdf) (Feb 2023)

## Community

- Follow us on [X](https://x.com/tele_swap)
- Join our [Discord](https://discord.com/invite/6RSsgfQgcb)

## Install dependencies

To start, clone the codes and install the required packages using:

`yarn`

## Compile contracts

`yarn build`

## Run tests

`yarn test`

## Deploy contracts

Supported networks: polygon, bsc, ethereum, arbitrum, base, optimism, unichain, bob, bsquared, worldchain

`NETWORK=<network> TAG=<tag> yarn deploy`

## Config contracts

`NETWORK=<network> TAG=<tag> yarn config`
