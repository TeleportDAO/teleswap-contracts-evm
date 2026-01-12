
const advanceBlockWithTime = async (provider, seconds) => {
    await provider.send("evm_increaseTime", [seconds])
    await provider.send("evm_mine")
}

const takeSnapshot = async (provider) => {
    return await provider.send("evm_snapshot")
}

const revertProvider = async (provider, snapshotId) => {
    await provider.send("evm_revert", [snapshotId])
}

module.exports = {
    advanceBlockWithTime,
    takeSnapshot,
    revertProvider,
}
