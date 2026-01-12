import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers } from "hardhat";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments } = hre;

    const yieldFarmingLogic = await deployments.get("YieldFarmingLogic")
    const yieldFarmingProxy = await deployments.get("YieldFarmingProxy")
    const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

    const yieldFarmingLogicFactory = await ethers.getContractFactory(
        "YieldFarmingLogic"
    );

    const yieldFarmingLogicInstance = await yieldFarmingLogicFactory.attach(
        yieldFarmingLogic.address
    );

    const yieldFarmingProxyInstance = await yieldFarmingLogicFactory.attach(
        yieldFarmingProxy.address
    );

    const _owner = await yieldFarmingProxyInstance.owner();
    if (_owner == ZERO_ADDR) {
        const initializeTxProxy = await yieldFarmingProxyInstance.initialize()
        await initializeTxProxy.wait(1);
        console.log("Initialize YieldFarmingProxy: ", initializeTxProxy.hash);
    } else {
        console.log("YieldFarmingProxy already initialized");
    }

    const _owner_2 = await yieldFarmingLogicInstance.owner();
    if (_owner_2 == ZERO_ADDR) {
        const initializeTxProxy = await yieldFarmingLogicInstance.initialize()
        await initializeTxProxy.wait(1);
        console.log("Initialize YieldFarmingLogic: ", initializeTxProxy.hash);
    } else {
        console.log("YieldFarmingLogic already initialized");
    }
};

export default func;
