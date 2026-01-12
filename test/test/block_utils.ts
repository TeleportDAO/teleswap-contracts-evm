const advanceBlockWithTime = async (provider: any, seconds: number) => {
    await provider.send("evm_increaseTime", [seconds])
    await provider.send("evm_mine")
}

const takeSnapshot = async (provider: any) => {
    return await provider.send("evm_snapshot")
}

const revertProvider = async (provider: any, snapshotId: any) => {
    await provider.send("evm_revert", [snapshotId])
}

export {
    advanceBlockWithTime,
    takeSnapshot,
    revertProvider,
}