import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers } from "hardhat";
import config from 'config';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments } = hre;
    const tstAddress = config.get("TST");
    const tstStakingLogic = await deployments.get("TstStakingLogic")
    const tstStakingProxy = await deployments.get("TstStakingProxy")
    const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

    const tstStakingLogicFactory = await ethers.getContractFactory(
        "TstStakingLogic"
    );

    const tstStakingLogicInstance = await tstStakingLogicFactory.attach(
        tstStakingLogic.address
    );

    const tstStakingProxyInstance = await tstStakingLogicFactory.attach(
        tstStakingProxy.address
    );

    const _owner = await tstStakingProxyInstance.owner();
    if (_owner == ZERO_ADDR) {
        const initializeTxProxy = await tstStakingProxyInstance.initialize(
            tstAddress
        )
        await initializeTxProxy.wait(1);
        console.log("Initialize TstStakingProxy: ", initializeTxProxy.hash);
    } else {
        console.log("TstStakingProxy already initialized");
    }

    const _owner_2 = await tstStakingLogicInstance.owner();
    if (_owner_2 == ZERO_ADDR) {
        const initializeTxProxy = await tstStakingLogicInstance.initialize(
            tstAddress
        )
        await initializeTxProxy.wait(1);
        console.log("Initialize TstStakingLogic: ", initializeTxProxy.hash);
    } else {
        console.log("TstStakingLogic already initialized");
    }
};

export default func;
