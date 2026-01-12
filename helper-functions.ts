import { run } from "hardhat"

const verify = async (contractAddress: string, args: any[], codePath: string) => {
  console.log(`\n========================================`)
  console.log(`Verifying contract at ${contractAddress}...`)
  console.log(`Contract: ${codePath}`)
  console.log(`Constructor args: ${JSON.stringify(args)}`)
  console.log(`========================================`)
  try {
    const result = await run("verify:verify", {
      address: contractAddress,
      constructorArguments: args,
      contract: codePath,
    })
    console.log("✓ Successfully verified!")
    console.log("Result:", result)
  } catch (e: any) {
    console.log("\n✗ Verification failed!")
    console.log("Error message:", e.message)
  }
  console.log(`========================================\n`)
}

export default verify