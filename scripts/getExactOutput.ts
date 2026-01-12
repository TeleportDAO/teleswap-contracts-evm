import { ethers } from "hardhat";
import { Contract } from "ethers";

async function getExactOutputAmount(
    contract: Contract,
    path: string[],
    amountOut: string
): Promise<{ success: boolean; amountIn: string }> {
    try {
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
    // Get the contract address from environment variables or hardcode it
    const contractAddress = "0x4e3e1807aa17aed8d1FC580dDa552079d9427ece";
    
    // Example path and amount
    const path = [
        "0x3BF668Fe1ec79a84cA8481CEAD5dbb30d61cC685",
        "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
        "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"
    ];
        
    const amountOut = "9002000000000000000";

    console.log("Connecting to contract at:", contractAddress);
    console.log("Path:", path);
    console.log("Desired output amount:", amountOut);

    try {
        // Get the contract instance
        const UniswapV3Connector = await ethers.getContractFactory("UniswapV3Connector");
        const contract = UniswapV3Connector.attach(contractAddress);

        console.log("Calling getExactOutput...");
        const result = await getExactOutputAmount(contract, path, amountOut);
        
        console.log("\nResults:");
        console.log("Success:", result.success);
        console.log("Amount In:", result.amountIn);
    } catch (error) {
        console.error("\nError occurred:");
        if (error instanceof Error) {
            console.error("Message:", error.message);
            if (error.stack) {
                console.error("Stack:", error.stack);
            }
        } else {
            console.error("Unknown error:", error);
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