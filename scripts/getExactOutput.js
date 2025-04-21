const { ethers } = require("ethers");

async function getExactOutputAmount(contract, path, amountOut) {
    try {
        // First check if path is valid
        console.log("Checking if path is valid...");
        const isPathValid = await contract.isPathValid(path);
        if (!isPathValid) {
            throw new Error("Path is not valid. Please check token pairs and fee tiers.");
        }

        // Get fee tiers for each pair
        console.log("Checking fee tiers...");
        for (let i = 0; i < path.length - 1; i++) {
            const feeTier = await contract.feeTier(path[i], path[i + 1]);
            console.log(`Fee tier for ${path[i]} -> ${path[i + 1]}:`, feeTier.toString());
            if (feeTier.toString() === "0") {
                throw new Error(`Fee tier not set for pair ${path[i]} -> ${path[i + 1]}`);
            }
        }

        // Use staticCall to simulate the transaction
        const result = await contract.callStatic.getExactOutput(path, amountOut);
        return {
            success: result[0],
            amountIn: result[1].toString()
        };
    } catch (error) {
        console.error("Error calling getExactOutput:", error);
        throw error;
    }
}

async function main() {
    // Initialize provider - replace with your RPC URL
    const provider = new ethers.providers.JsonRpcProvider("https://polygon-rpc.com");
    
    // Contract ABI from deployments
    const abi = [
        "function getExactOutput(address[] memory _path, uint256 _amountOut) public returns (bool, uint256)",
        "function isPathValid(address[] memory _path) public view returns (bool)",
        "function convertedPath(address[] memory _path) public view returns (bytes memory)",
        "function convertedPathReversed(address[] memory _path) public view returns (bytes memory)",
        "function feeTier(address,address) public view returns (uint24)",
        "function quoterAddress() public view returns (address)",
        "function exchangeRouter() public view returns (address)",
        "function liquidityPoolFactory() public view returns (address)"
    ];
    
    // Contract address
    const contractAddress = "0x4e3e1807aa17aed8d1FC580dDa552079d9427ece";
    
    // Example path and amount - path is in input to output order
    const path = [
        "0x3BF668Fe1ec79a84cA8481CEAD5dbb30d61cC685",  // Token 1 (input)
        "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",  // WBTC
        "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",  // USDC
        "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"   // WMATIC (output)
    ];
    
    const amountOut = "9002000000000000000000";

    console.log("Connecting to contract at:", contractAddress);
    console.log("Path (input to output):", path);
    console.log("Desired output amount:", amountOut);

    try {
        // Create contract instance
        const contract = new ethers.Contract(contractAddress, abi, provider);

        console.log("Calling getExactOutput...");
        const result = await getExactOutputAmount(contract, path, amountOut);
        
        console.log("\nResults:");
        console.log("Success:", result.success);
        console.log("Amount In:", result.amountIn);
    } catch (error) {
        console.error("\nError occurred:");
        console.error("Message:", error.message);
        if (error.stack) {
            console.error("Stack:", error.stack);
        }
        process.exit(1);
    }
}

// Run the script
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 