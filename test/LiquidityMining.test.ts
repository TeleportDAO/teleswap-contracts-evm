import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, BigNumber } from "ethers";
import { Address } from "hardhat-deploy/types";
import { LiquidityMiningLogic__factory } from "../src/types/factories/LiquidityMiningLogic__factory";
import { LiquidityMiningLogic } from "../src/types/LiquidityMiningLogic";
import { LiquidityMiningProxy__factory } from "../src/types/factories/LiquidityMiningProxy__factory";
import { LiquidityMiningProxy } from "../src/types/LiquidityMiningProxy";
import { LPToken__factory } from "../src/types/factories/LPToken__factory";
import { LPToken } from "../src/types/LPToken"

describe("Staking Pool", function () {
    // Accounts
    let deployer: Signer;
    let signer1: Signer;
    let signer2: Signer;
    let signer3: Signer;
    let proxyAdmin: Signer;
    let proxyAdminAddress: string;
    let deployerAddress: Address;
    let signer1Address: Address;
    let signer2Address: Address;
    let signer3Address: Address;
	
	let liquidityMining: LiquidityMiningLogic;
	let LPToken: LPToken;

    let oneUnit = BigNumber.from(10).pow(18);
    let initializeSupply = BigNumber.from(10).pow(18).mul(10000000);
	let interestPerDay = BigNumber.from(10).pow(18).mul(2000);
    let oneDay = 86400;
    let epsilon = 10;

    const minWaitTime = 7 //in days
    const deadline = 1 //in days

    beforeEach(async () => {
        // Sets accounts
        [deployer, signer1, signer2, signer3, proxyAdmin] = await ethers.getSigners();
        deployerAddress = await deployer.getAddress();
        signer1Address = await signer1.getAddress();
        signer2Address = await signer2.getAddress();
        signer3Address = await signer3.getAddress();
        proxyAdminAddress = await proxyAdmin.getAddress();

		// Deploys erc20 contract
        const LPTokenFactory = new LPToken__factory(deployer);
        LPToken = await LPTokenFactory.deploy(
            "LPToken",
            "LPT",
            initializeSupply,
        );

        const liquidityMiningLogicFactory = new LiquidityMiningLogic__factory(deployer);
        const liquidityMiningLogic = await liquidityMiningLogicFactory.deploy();

        const liquidityMiningProxyFactory = new LiquidityMiningProxy__factory(deployer);
        const liquidityMiningProxy = await liquidityMiningProxyFactory.deploy(
            liquidityMiningLogic.address,    
            proxyAdminAddress,
            "0x"
        );
        
        liquidityMining = await liquidityMiningLogic.attach(
            liquidityMiningProxy.address
        );

        await liquidityMining.initialize();


        await liquidityMining.addLiquidityToken(
            interestPerDay,
            LPToken.address,
            minWaitTime,
            deadline
        )

    });

	describe("#Getters", async () => {
        it("interest in interval works currectly", async function () {
            await expect(
                await liquidityMining.interestInIntervalForToken(LPToken.address, Math.trunc(Date.now() / 1000), Math.trunc((Date.now() / 1000 + oneDay * 1437 + oneDay / 2) ))
            ).to.equal(interestPerDay.mul(1437).add(interestPerDay.div(2)))
        })  

        it("get interest when total supply is zero", async function () {
            await expect(
                await liquidityMining.getInterest(LPToken.address, signer1Address)
            ).to.equal(0)
        })  

        it("check isLiquidityToken", async function () {
            await expect(
                await liquidityMining.isLiquidityToken(LPToken.address)
            ).to.equal(true)

            await expect(
                await liquidityMining.isLiquidityToken(signer1Address)
            ).to.equal(false)
        })

        it("get interest per day amount", async function () {
            await expect(
                await liquidityMining.interestPerDay(LPToken.address)
            ).to.equal(interestPerDay)
        })
    });

    describe("#Setters", async () => {
        it("non owner accounts can't change minimum wait time and request deadline", async function () {
            await expect(
                liquidityMining.connect(signer1).setUnlockRequestDeadline(LPToken.address, 1)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                liquidityMining.connect(signer1).setMinWaitTime(LPToken.address, 1)
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })  

        it("owner can change minimum wait time to unlock tokens", async function () {
            await expect( 
                await liquidityMining.setMinWaitTime(LPToken.address, 2)
            ).to.emit(liquidityMining, "NewWaitTime").withArgs(
                LPToken.address, minWaitTime, 2
            )
            await expect(
                await liquidityMining.minWaitTime(LPToken.address)
            ).to.equal(2)
        })

        it("owner can change unlock request deadline", async function () {
            await expect( 
                await liquidityMining.setUnlockRequestDeadline(LPToken.address, 2)
            ).to.emit(liquidityMining, "NewUnlockRequestDeadline").withArgs(
                LPToken.address, deadline, 2
            )
            await expect(
                await liquidityMining.unlockRequestDeadline(LPToken.address)
            ).to.equal(2)
        })
    });

    describe("#Pause and Unpause", async () => {
        it("non owner accounts can't pause and unpause", async function () {
            await expect(
                liquidityMining.connect(signer1).pause(LPToken.address)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                liquidityMining.connect(signer1).unpause(LPToken.address)
            ).to.be.revertedWith("Ownable: caller is not the owner")
        }) 

        it("can unpause contract after it is paused", async function () {
            await liquidityMining.pause(LPToken.address)
            await expect(
                await liquidityMining.paused(LPToken.address)
            ).to.equal(true)

            await liquidityMining.unpause(LPToken.address)
            await expect(
                await liquidityMining.paused(LPToken.address)
            ).to.equal(false)
        }) 

        it("can't call emergency withdrawal when contract is not paused", async function () {
            await expect(
                liquidityMining.emergencyWithdrawal(LPToken.address, 1)
            ).to.be.revertedWith("Pausable: not paused")
        })

        it("can't call functions when contract is paused", async function () {
            await liquidityMining.pause(LPToken.address)
            await expect(
                liquidityMining.lockToken(LPToken.address, 1)
            ).to.be.revertedWith("Pausable: paused")

            await expect(
                liquidityMining.unlockToken(LPToken.address, 1, 0, "0x0000000000000000000000000000000000000000000000000000000000000000")
            ).to.be.revertedWith("Pausable: paused")
            
            await expect(
                liquidityMining.instantUnlockToken(LPToken.address, 1)
            ).to.be.revertedWith("Pausable: paused")

            await expect(
                liquidityMining.requestToUnlockToken(LPToken.address, 1)
            ).to.be.revertedWith("Pausable: paused")
        })

        it("emergency withdrawal works currectly", async function () {
            let lockAmount1 = oneUnit.mul(10 ** 5)
            await LPToken.transfer(signer1Address, lockAmount1)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount1)
            await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount1)

            let lockAmount2 = oneUnit.mul(10 ** 4)
            await LPToken.transfer(signer2Address, lockAmount2)
            await LPToken.connect(signer2).approve(liquidityMining.address, lockAmount2)
            await liquidityMining.connect(signer2).lockToken(LPToken.address, lockAmount2)

            await liquidityMining.pause(LPToken.address)
            await expect (
                await liquidityMining.connect(signer1).emergencyWithdrawal(LPToken.address, lockAmount1)
            ).to.emit(liquidityMining, "EmergencyWithdrawal").withArgs(
                signer1Address, LPToken.address, lockAmount1
            )

            await expect (
                await LPToken.balanceOf(signer1Address)
            ).to.equal(lockAmount1)

            await expect (
                await liquidityMining.totalSupply(LPToken.address)
            ).to.equal(lockAmount2)
            
            await expect (
                liquidityMining.connect(signer2).emergencyWithdrawal(LPToken.address, lockAmount2.add(1))
            ).to.be.revertedWith("LiquidityMining: transfer amount exceeds balance")

            await liquidityMining.getInterest(LPToken.address, signer2Address)
        })
    });

    describe("#Lock LPToken", async () => {
        it("lock LPToken for one account works currectly", async function () {
            let lockAmount = oneUnit.mul(10 ** 7)
            await LPToken.transfer(signer1Address, lockAmount)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount)
            await expect (
                await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount)
            ).to.emit(liquidityMining, "LockToken").withArgs(
                signer1Address, LPToken.address, lockAmount
            )

            await expect (
                await LPToken.balanceOf(signer1Address)
            ).to.equal(0)

            await expect (
                await liquidityMining.balanceOf(LPToken.address, signer1Address)
            ).to.equal(lockAmount)

            await expect (
                await liquidityMining.totalSupply(LPToken.address)
            ).to.equal(lockAmount)

            await time.increase(419);
            await expect (
                await liquidityMining.getInterest(LPToken.address, signer1Address)
            ).to.equal(interestPerDay.mul(419).div(oneDay))
        }) 
        
        it("lock LPToken for several accounts works currectly", async function () {
            let lockAmount1 = oneUnit.mul(10 ** 5)
            await LPToken.transfer(signer1Address, lockAmount1)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount1)
            await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount1)

            await time.increase(1000);

            let interest1 = interestPerDay.mul(1000).div(oneDay)
            await expect (
                await liquidityMining.getInterest(LPToken.address, signer1Address)
            ).to.equal(interest1)

            let lockAmount2 = oneUnit.mul(10 ** 4)
            await LPToken.transfer(signer2Address, lockAmount2)
            await LPToken.connect(signer2).approve(liquidityMining.address, lockAmount2)
            await liquidityMining.connect(signer2).lockToken(LPToken.address, lockAmount2)

            interest1 = await liquidityMining.getInterest(LPToken.address, signer1Address)
            await time.increase(oneDay);

            interest1 = interest1.add(interestPerDay.mul(lockAmount1).div(lockAmount1.add(lockAmount2)))
            await expect (
                await liquidityMining.getInterest(LPToken.address, signer1Address)
            ).to.equal(interest1)

            let interest2 = interestPerDay.mul(lockAmount2).div(lockAmount1.add(lockAmount2))
            await expect (
                await liquidityMining.getInterest(LPToken.address, signer2Address)
            ).to.equal(interest2)

            let lockAmount3 = oneUnit.mul(10 ** 6)
            await LPToken.transfer(signer3Address, lockAmount3)
            await LPToken.connect(signer3).approve(liquidityMining.address, lockAmount3)
            await liquidityMining.connect(signer3).lockToken(LPToken.address, lockAmount3)

            interest1 = await liquidityMining.getInterest(LPToken.address, signer1Address)
            interest2 = await liquidityMining.getInterest(LPToken.address, signer2Address)
            await time.increase(oneDay);

            interest1 = interest1.add(interestPerDay.mul(lockAmount1).div(lockAmount1.add(lockAmount2).add(lockAmount3)))
            await expect (
                await liquidityMining.getInterest(LPToken.address, signer1Address)
            ).to.equal(interest1)

            interest2 = interest2.add(interestPerDay.mul(lockAmount2).div(lockAmount1.add(lockAmount2).add(lockAmount3)))
            await expect (
                await liquidityMining.getInterest(LPToken.address, signer2Address)
            ).to.equal(interest2)

            let interest3 = interestPerDay.mul(lockAmount3).div(lockAmount1.add(lockAmount2).add(lockAmount3))
            await expect (
                await liquidityMining.getInterest(LPToken.address, signer3Address)
            ).to.equal(interest3)

            await expect (
                await liquidityMining.balanceOf(LPToken.address, signer1Address)
            ).to.equal(lockAmount1)

            await expect (
                await liquidityMining.balanceOf(LPToken.address, signer2Address)
            ).to.equal(lockAmount2)

            await expect (
                await liquidityMining.balanceOf(LPToken.address, signer3Address)
            ).to.equal(lockAmount3)

            await expect (
                await liquidityMining.totalSupply(LPToken.address)
            ).to.equal(lockAmount1.add(lockAmount2).add(lockAmount3))

        }) 
    });

    describe("#Unlock LPToken", async () => {
        it("can't use instant unlock when wait time is non zero", async function () {
            let lockAmount = oneUnit.mul(10 ** 6)
            await LPToken.transfer(signer1Address, lockAmount)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount)
            await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount)

            await expect (
                liquidityMining.instantUnlockToken(LPToken.address, lockAmount)
            ).to.be.revertedWith("LiquidityMining: minimum wait time is not zero")
        }) 

        it("can't unlock LPTokens with wrong tag", async function () {
            let lockAmount = oneUnit.mul(10 ** 6)
            await LPToken.transfer(signer1Address, lockAmount)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount)
            await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount)
            await liquidityMining.connect(signer1).requestToUnlockToken(LPToken.address, lockAmount)

            let blockTime = await time.latest()
            let tag = ethers.utils.solidityKeccak256(["address", "address", "uint", "uint"], [signer2Address, LPToken.address,  lockAmount, blockTime]);

            await expect (
                liquidityMining.connect(signer1).unlockToken(LPToken.address, lockAmount, blockTime, tag)
            ).to.be.revertedWith("LiquidityMining: tag is not currect")
        }) 

        it("can't unlock LPTokens before minimum wait time", async function () {
            let lockAmount = oneUnit.mul(10 ** 6)
            await LPToken.transfer(signer1Address, lockAmount)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount)
            await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount)
            await liquidityMining.connect(signer1).requestToUnlockToken(LPToken.address, lockAmount)

            let blockTime = await time.latest()
            let tag = ethers.utils.solidityKeccak256(["address", "address", "uint", "uint"], [signer1Address, LPToken.address, lockAmount, blockTime]);

            await expect (
                liquidityMining.connect(signer1).unlockToken(LPToken.address, lockAmount, blockTime, tag)
            ).to.be.revertedWith("LiquidityMining: minimum lock time is not passed")
        }) 

        it("can't unlock LPTokens before creating request", async function () {
            let lockAmount = oneUnit.mul(10 ** 4)
            await LPToken.transfer(signer1Address, lockAmount)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount)
            await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount)

            let blockTime = await time.latest()
            let tag = ethers.utils.solidityKeccak256(["address", "address", "uint", "uint"], [signer1Address, LPToken.address, lockAmount, blockTime]);
            await time.increase(oneDay * 7 + 1);

            await expect (
                liquidityMining.connect(signer1).unlockToken(LPToken.address, lockAmount, blockTime, tag)
            ).to.be.revertedWith("LiquidityMining: unlock request is not submitted or is used before")
        }) 

        it("can't unlock LPTokens after deadline", async function () {
            let lockAmount = oneUnit.mul(10 ** 6)
            await LPToken.transfer(signer1Address, lockAmount)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount)
            await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount)
            await liquidityMining.connect(signer1).requestToUnlockToken(LPToken.address, lockAmount)

            let blockTime = await time.latest()
            let tag = ethers.utils.solidityKeccak256(["address", "address", "uint", "uint"], [signer1Address, LPToken.address, lockAmount, blockTime]);
            await time.increase(oneDay * 8 + 1);

            await expect (
                liquidityMining.connect(signer1).unlockToken(LPToken.address, lockAmount, blockTime, tag)
            ).to.be.revertedWith("LiquidityMining: unlock request is expired")
        }) 

        it("can't unlock LPTokens more than lock amount", async function () {
            let lockAmount = oneUnit.mul(10 ** 6)
            await LPToken.transfer(signer1Address, lockAmount)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount)
            await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount)
            await liquidityMining.connect(signer1).requestToUnlockToken(LPToken.address, lockAmount.add(1))

            let blockTime = await time.latest()
            let tag = ethers.utils.solidityKeccak256(["address", "address", "uint", "uint"], [signer1Address, LPToken.address, lockAmount.add(1), blockTime]);
            await time.increase(oneDay * 7 + 1);

            await expect (
                liquidityMining.connect(signer1).unlockToken(LPToken.address, lockAmount.add(1), blockTime, tag)
            ).to.be.revertedWith("LiquidityMining: transfer amount exceeds balance")
        }) 

        it("lock and unlock LP tokens", async function () {
            let lockAmount = oneUnit.mul(10 ** 6)
            await LPToken.transfer(signer1Address, lockAmount)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount)
            await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount)
            await expect (
                await liquidityMining.connect(signer1).requestToUnlockToken(LPToken.address, lockAmount)
            ).to.emit(liquidityMining, "UnlockTokenRequest").withArgs(
                signer1Address, LPToken.address,  lockAmount, lockAmount, anyValue, anyValue
            )

            let blockTime = await time.latest()
            let tag = ethers.utils.solidityKeccak256(["address", "address", "uint", "uint"], [signer1Address, LPToken.address, lockAmount, blockTime]);
            await time.increase(oneDay * 7 + 1);

            await expect (
                await liquidityMining.connect(signer1).unlockToken(LPToken.address, lockAmount, blockTime, tag)
            ).to.emit(liquidityMining, "UnlockToken").withArgs(
                signer1Address, LPToken.address, lockAmount, tag
            )

            await expect (
                await liquidityMining.unlockRequestState(tag)
            ).to.equal(2)
        })  
    });

    describe("#Lock and unlock LPToken scenarios", async () => {
        it("can't unlock more than lock amount", async function () {
            await liquidityMining.setMinWaitTime(LPToken.address, 0)
            let lockAmount = oneUnit.mul(10 ** 6)
            await LPToken.transfer(signer1Address, lockAmount)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount)
            await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount)
            

            await expect (
                liquidityMining.instantUnlockToken(LPToken.address, lockAmount.add(1))
            ).to.be.revertedWith("LiquidityMining: transfer amount exceeds balance")
        }) 

        it("lock and unlock LP token changes interests currectly", async function () {
            await liquidityMining.setMinWaitTime(LPToken.address, 0)
            let lockAmount1 = oneUnit.mul(10 ** 6)
            await LPToken.transfer(signer1Address, lockAmount1)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount1)
            await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount1)

            let lockAmount2 = oneUnit.mul(5 * 10 ** 5)
            await LPToken.transfer(signer2Address, lockAmount2)
            await LPToken.connect(signer2).approve(liquidityMining.address, lockAmount2)
            await liquidityMining.connect(signer2).lockToken(LPToken.address, lockAmount2)

            let interest1 = await liquidityMining.getInterest(LPToken.address, signer1Address)

            await time.increase(12345);
            interest1 = interestPerDay.mul(2).mul(12345).div(oneDay).div(3).add(interest1)
            await expect (
                await liquidityMining.getInterest(LPToken.address, signer1Address)
            ).to.be.closeTo(interest1, epsilon)
                
            
            let unlockAmount = oneUnit.mul(5 * 10 ** 5)
            await expect (
                await liquidityMining.connect(signer1).instantUnlockToken(LPToken.address, unlockAmount)
            ).to.emit(liquidityMining, "InstantUnlockToken").withArgs(
                signer1Address, LPToken.address, unlockAmount
            )

            interest1 = await liquidityMining.getInterest(LPToken.address, signer1Address)
            let interest2 = await liquidityMining.getInterest(LPToken.address, signer2Address)

            await time.increase(54321);
            await expect (
                await liquidityMining.getInterest(LPToken.address, signer1Address)
            ).to.be.closeTo(interestPerDay.mul(54321).div(2 * oneDay).add(interest1), epsilon)

            await expect (
                await liquidityMining.getInterest(LPToken.address, signer2Address)
            ).to.be.closeTo(interestPerDay.mul(54321).div(2 * oneDay).add(interest2), epsilon)
        }) 
    });

    describe("#send back token scenarios", async () => {
        it("only owner can send back tokens", async function () {
            let lockAmount = oneUnit.mul(10 ** 6)
            await LPToken.transfer(signer1Address, lockAmount)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount)
            await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount)

            await expect (
                liquidityMining.connect(signer1).sendBackToken(LPToken.address, signer1Address)
            ).to.be.revertedWith("Ownable: caller is not the owner")
        }) 

        it("owner can send back tokens", async function () {
            let lockAmount = oneUnit.mul(10 ** 6)
            await LPToken.transfer(signer1Address, lockAmount)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount)
            await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount)

            await expect (
                await LPToken.balanceOf(signer1Address)
            ).to.equal(0)

            await expect (
                liquidityMining.sendBackToken(LPToken.address, signer1Address)
            ).to.emit(LPToken, "Transfer").withArgs(
                liquidityMining.address, signer1Address, lockAmount
            )
            
            await expect (
                await LPToken.balanceOf(signer1Address)
            ).to.equal(lockAmount)
        }) 
    });

    describe("#stop senarios", async () => {
        it("only owner can stop", async function () {
            await expect (
                liquidityMining.connect(signer1).stop(LPToken.address)
            ).to.be.revertedWith("Ownable: caller is not the owner")
        }) 

        it("owner can stop tokens and interests stop updating", async function () {
            let lockAmount = oneUnit.mul(10 ** 6)
            await LPToken.transfer(signer1Address, lockAmount)
            await LPToken.connect(signer1).approve(liquidityMining.address, lockAmount)
            await liquidityMining.connect(signer1).lockToken(LPToken.address, lockAmount)

            await time.increase(oneDay * 7 + 1);
            await liquidityMining.stop(LPToken.address)

            let interest =  await liquidityMining.getInterest(LPToken.address, signer1Address)
            await time.increase(oneDay * 7 + 1);

            await expect (
                await liquidityMining.getInterest(LPToken.address, signer1Address)
            ).to.equal(interest)
        }) 
    });

});
