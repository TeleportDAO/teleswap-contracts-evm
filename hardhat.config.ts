import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import '@openzeppelin/hardhat-upgrades';
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "hardhat-deploy";
import "hardhat-contract-sizer";

dotenv.config();

const config: HardhatUserConfig = {
	solidity: {
		compilers: [
			{
				version: "0.5.16",
				settings: {
					optimizer: {
						enabled: true
					},
				},
			},
			{
				version: "0.6.6",
				settings: {
					optimizer: {
						enabled: true
					},
				},
			},
			{
				version: "0.8.4",
				settings: {
					optimizer: {
						enabled: true,
						runs: 1,
					},
				},
			},
			{
				version: "0.8.9",
				settings: {
					optimizer: {
						enabled: true
					},
				},
			}
		],
	},
	networks: {
		ethereum: {
			url: "https://ethereum-rpc.publicnode.com",
			chainId: 1,
			accounts: [process.env.PRIVATE_KEY ?? ""]
		},
		arbitrum: {
			url: "https://arbitrum-one.publicnode.com",
			chainId: 42161,
			accounts: [process.env.PRIVATE_KEY ?? ""]
		},
		optimism: {
			url: "https://optimism-rpc.publicnode.com",
			chainId: 10,
			accounts: [process.env.PRIVATE_KEY ?? ""]
		},
		sepolia: {
			url: "https://ethereum-sepolia-rpc.publicnode.com",
			chainId: 11155111,
			accounts: [process.env.PRIVATE_KEY ?? ""]
		},
		polygon: {
			url: "https://rpc-mainnet.matic.quiknode.pro",
			chainId: 137,
			accounts: [process.env.PRIVATE_KEY ?? ""],
		},
		base: {
			url: "https://developer-access-mainnet.base.org",
			chainId: 8453,
			accounts: [process.env.PRIVATE_KEY ?? ""]
		},
		unichain: {
			url: "https://mainnet.unichain.org",
			chainId: 130,
			accounts: [process.env.PRIVATE_KEY ?? ""]
		},
		worldchain: {
			url: "https://worldchain-mainnet.g.alchemy.com/public",
			chainId: 480,
			accounts: [process.env.PRIVATE_KEY ?? ""]
		},
		bsquared: {
			url: "https://rpc.bsquared.network",
			chainId: 223,
			accounts: [process.env.PRIVATE_KEY ?? ""],
		},
		amoy: {
			url: "https://rpc-amoy.polygon.technology",
			chainId: 80002,
			accounts: [process.env.PRIVATE_KEY ?? ""]
		},
		bsc: {
			url: "https://bsc-dataseed.binance.org/",
			chainId: 56,
			accounts: [process.env.PRIVATE_KEY ?? ""]
		},
		bob: {
			url: "https://rpc.gobob.xyz/",
			chainId: 60808,
			accounts: [process.env.PRIVATE_KEY ?? ""],
		},
		plasma: {
			url: "https://rpc.plasma.to",
			chainId: 9745,
			accounts: [process.env.PRIVATE_KEY ?? ""],
		},
		hardhat: {
			allowUnlimitedContractSize: true,
		},
	},	
  	paths: {
		artifacts: "artifacts",
		deploy: "deploy",
		deployments: "deployments",
  	},
  	typechain: {
		outDir: "src/types",
		target: "ethers-v5",
  	},
  	namedAccounts: {
		deployer: {
			default: 0,
		},
  	},
  	gasReporter: {
		enabled: true,
		currency: "USD",
  	},
  	etherscan: {
		enabled: true,
		apiKey: process.env.ETHERSCAN_API_KEY ?? "",
		customChains: [
			{
				network: "ethereum",
				chainId: 1,
				urls: {
					apiURL: "https://api.etherscan.io/v2/api?chainid=1",
					browserURL: "https://etherscan.io/"
				}
			},
			{
				network: "polygon",
				chainId: 137,
				urls: {
					apiURL: "https://api.etherscan.io/v2/api?chainid=137",
					browserURL: "https://polygonscan.com/"
				}
			},
			{
				network: "base",
				chainId: 8453,
				urls: {
					apiURL: "https://api.etherscan.io/v2/api?chainid=8453",
					browserURL: "https://basescan.org/"
				}
			},
			{
				network: "bsc",
				chainId: 56,
				urls: {
					apiURL: "https://api.etherscan.io/v2/api?chainid=56",
					browserURL: "https://bscscan.com/"
				}
			},
			{
				network: "arbitrum",
				chainId: 42161,
				urls: {
					apiURL: "https://api.etherscan.io/v2/api?chainid=42161",
					browserURL: "https://arbiscan.com/"
				}
			},
			{
				network: "optimism",
				chainId: 10,
				urls: {
					apiURL: "https://api.etherscan.io/v2/api?chainid=10",
					browserURL: "https://optimism.etherscan.io/"
				}
			},
			{
				network: "unichain",
				chainId: 130,
				urls: {
					apiURL: "https://api.etherscan.io/v2/api?chainid=130",
					browserURL: "https://uniscan.xyz/"
				}
			},
			{
				network: "worldchain",
				chainId: 480,
				urls: {
					apiURL: "https://api.worldscan.org/api",
					browserURL: "https://worldscan.org/"
				}
			},
			{
				network: "bsquared",
				chainId: 223,
				urls: {
					apiURL: "https://explorer.bsquared.network/api",
					browserURL: "https://explorer.bsquared.network"
				}
			},
			{
				network: "bob",
				chainId: 60808,
				urls: {
					apiURL: "https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/BOB",
					browserURL: "https://www.oklink.com/bob"
				}
			},
			{
				network: "plasma",
				chainId: 9745,
				urls: {
					apiURL: "https://api.routescan.io/v2/network/mainnet/evm/9745/etherscan",
					browserURL: "https://plasmascan.to/"
				}
			},
			{
				network: "amoy",
				chainId: 80002,
				urls: {
					apiURL: "https://api-amoy.polygonscan.com/api",
					browserURL: "https://amoy.polygonscan.com/"
				}
			},
			{
				network: "sepolia",
				chainId: 11155111,
				urls: {
					apiURL: "https://api-sepolia.etherscan.io/api",
					browserURL: "https://sepolia.etherscan.io/"
				}
			}
		]
  	},
  	sourcify: {
		enabled: false
  	}
};

export default config;
