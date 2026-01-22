import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import * as fs from "fs";
import * as path from "path";
import { BigNumber } from "ethers";

describe("PrivateTransferClaim", function () {
    let owner: SignerWithAddress;
    let user: SignerWithAddress;
    let recipient: SignerWithAddress;

    let verifier: any;
    let privateTransferClaim: any;
    let mockLockersManager: any;

    // Test data from proof generation
    let proof: any;
    let publicSignals: string[];
    let input: any;

    const CHAIN_ID = 1; // Ethereum mainnet

    before(async function () {
        [owner, user, recipient] = await ethers.getSigners();

        // Load proof and public signals
        const buildDir = path.join(__dirname, "../../zkproof/build");

        const proofPath = path.join(buildDir, "proof.json");
        const publicPath = path.join(buildDir, "public.json");
        const inputPath = path.join(buildDir, "input.json");

        if (!fs.existsSync(proofPath)) {
            console.log("Proof not found. Run: npm run zk:generate-proof");
            this.skip();
        }

        proof = JSON.parse(fs.readFileSync(proofPath, "utf-8"));
        publicSignals = JSON.parse(fs.readFileSync(publicPath, "utf-8"));
        input = JSON.parse(fs.readFileSync(inputPath, "utf-8"));

        console.log("Loaded proof with", publicSignals.length, "public signals");
    });

    beforeEach(async function () {
        // Deploy Groth16Verifier
        const Verifier = await ethers.getContractFactory("Groth16Verifier");
        verifier = await Verifier.deploy();
        await verifier.deployed();
        console.log("Verifier deployed to:", verifier.address);

        // Deploy mock LockersManager
        const MockLockersManager = await ethers.getContractFactory("MockLockersManager");
        mockLockersManager = await MockLockersManager.deploy();
        await mockLockersManager.deployed();
        console.log("MockLockersManager deployed to:", mockLockersManager.address);

        // Deploy PrivateTransferClaim (upgradeable)
        const PrivateTransferClaim = await ethers.getContractFactory("PrivateTransferClaim");
        privateTransferClaim = await upgrades.deployProxy(
            PrivateTransferClaim,
            [verifier.address, mockLockersManager.address, CHAIN_ID],
            { initializer: "initialize" }
        );
        await privateTransferClaim.deployed();
        console.log("PrivateTransferClaim deployed to:", privateTransferClaim.address);

        // Register the locker hash from the proof
        // Public signals order: [merkleRoots[0], merkleRoots[1], nullifier, amount, chainId, recipient, lockerScriptHash]
        const lockerScriptHash = publicSignals[6];

        // Get locker script from input (convert bits to bytes)
        const lockerScriptBits = input.lockerScript;
        const lockerScriptLength = input.lockerScriptLength;
        const lockerScriptBytes = bitsToBytes(lockerScriptBits.slice(0, lockerScriptLength * 8));

        await privateTransferClaim.registerLockerHash(lockerScriptHash, lockerScriptBytes);
        console.log("Registered locker hash:", lockerScriptHash.substring(0, 20) + "...");
    });

    function bitsToBytes(bits: number[]): string {
        const bytes: number[] = [];
        for (let i = 0; i < bits.length; i += 8) {
            let byte = 0;
            for (let j = 0; j < 8 && i + j < bits.length; j++) {
                byte = (byte << 1) | bits[i + j];
            }
            bytes.push(byte);
        }
        return "0x" + bytes.map(b => b.toString(16).padStart(2, "0")).join("");
    }

    describe("Initialization", function () {
        it("should initialize with correct values", async function () {
            expect(await privateTransferClaim.zkVerifier()).to.equal(verifier.address);
            expect(await privateTransferClaim.lockersManager()).to.equal(mockLockersManager.address);
            expect((await privateTransferClaim.claimChainId()).toNumber()).to.equal(CHAIN_ID);
            expect((await privateTransferClaim.totalClaims()).toNumber()).to.equal(0);
        });

        it("should have locker hash registered", async function () {
            const lockerScriptHash = publicSignals[6];
            expect(await privateTransferClaim.isValidLockerHash(lockerScriptHash)).to.be.true;
        });
    });

    describe("claimPrivate", function () {
        it("should verify and process a valid private claim", async function () {
            // Public signals: [merkleRoots[0], merkleRoots[1], nullifier, amount, chainId, recipient, lockerScriptHash]
            const merkleRoots = [publicSignals[0], publicSignals[1]];
            const nullifier = publicSignals[2];
            const amount = publicSignals[3];
            const recipientFromProof = publicSignals[5];
            const lockerScriptHash = publicSignals[6];

            // Convert recipient from field element to address
            const recipientAddress = "0x" + BigInt(recipientFromProof).toString(16).padStart(40, "0");

            console.log("Claiming with:");
            console.log("  Amount:", amount, "satoshis");
            console.log("  Recipient:", recipientAddress);

            // Format proof for Solidity
            const pA = [proof.pi_a[0], proof.pi_a[1]];
            const pB = [
                [proof.pi_b[0][1], proof.pi_b[0][0]],
                [proof.pi_b[1][1], proof.pi_b[1][0]]
            ];
            const pC = [proof.pi_c[0], proof.pi_c[1]];

            // Call claimPrivate
            const tx = await privateTransferClaim.connect(user).claimPrivate(
                pA,
                pB,
                pC,
                merkleRoots,
                nullifier,
                amount,
                recipientAddress,
                lockerScriptHash
            );

            const receipt = await tx.wait();
            console.log("Gas used:", receipt.gasUsed.toString());

            // Check nullifier is now used
            expect(await privateTransferClaim.isNullifierUsed(nullifier)).to.be.true;

            // Check stats updated
            expect((await privateTransferClaim.totalClaims()).toNumber()).to.equal(1);
            expect((await privateTransferClaim.totalAmountClaimed()).toString()).to.equal(amount);

            // Check event emitted
            const event = receipt.events?.find((e: any) => e.event === "PrivateClaim");
            expect(event).to.not.be.undefined;
            expect(event?.args?.nullifier.toString()).to.equal(nullifier);
            expect(event?.args?.amount.toString()).to.equal(amount);

            console.log("✓ Private claim successful!");
        });

        it("should reject double-claim with same nullifier", async function () {
            const merkleRoots = [publicSignals[0], publicSignals[1]];
            const nullifier = publicSignals[2];
            const amount = publicSignals[3];
            const recipientFromProof = publicSignals[5];
            const lockerScriptHash = publicSignals[6];
            const recipientAddress = "0x" + BigInt(recipientFromProof).toString(16).padStart(40, "0");

            const pA = [proof.pi_a[0], proof.pi_a[1]];
            const pB = [
                [proof.pi_b[0][1], proof.pi_b[0][0]],
                [proof.pi_b[1][1], proof.pi_b[1][0]]
            ];
            const pC = [proof.pi_c[0], proof.pi_c[1]];

            // First claim should succeed
            await privateTransferClaim.connect(user).claimPrivate(
                pA, pB, pC, merkleRoots, nullifier, amount, recipientAddress, lockerScriptHash
            );

            // Second claim with same nullifier should fail
            try {
                await privateTransferClaim.connect(user).claimPrivate(
                    pA, pB, pC, merkleRoots, nullifier, amount, recipientAddress, lockerScriptHash
                );
                expect.fail("Should have reverted");
            } catch (error: any) {
                expect(error.message).to.include("already claimed");
            }

            console.log("✓ Double-claim correctly rejected!");
        });

        it("should reject invalid locker hash", async function () {
            const merkleRoots = [publicSignals[0], publicSignals[1]];
            const nullifier = publicSignals[2];
            const amount = publicSignals[3];
            const recipientFromProof = publicSignals[5];
            const recipientAddress = "0x" + BigInt(recipientFromProof).toString(16).padStart(40, "0");

            const pA = [proof.pi_a[0], proof.pi_a[1]];
            const pB = [
                [proof.pi_b[0][1], proof.pi_b[0][0]],
                [proof.pi_b[1][1], proof.pi_b[1][0]]
            ];
            const pC = [proof.pi_c[0], proof.pi_c[1]];

            // Use invalid locker hash
            const invalidLockerHash = "12345";

            try {
                await privateTransferClaim.connect(user).claimPrivate(
                    pA, pB, pC, merkleRoots, nullifier, amount, recipientAddress, invalidLockerHash
                );
                expect.fail("Should have reverted");
            } catch (error: any) {
                expect(error.message).to.include("invalid locker");
            }

            console.log("✓ Invalid locker correctly rejected!");
        });

        it("should reject invalid proof", async function () {
            const merkleRoots = [publicSignals[0], publicSignals[1]];
            const nullifier = publicSignals[2];
            const amount = publicSignals[3];
            const recipientFromProof = publicSignals[5];
            const lockerScriptHash = publicSignals[6];
            const recipientAddress = "0x" + BigInt(recipientFromProof).toString(16).padStart(40, "0");

            // Tampered proof (invalid pA)
            const pA = ["1", "2"]; // Invalid
            const pB = [
                [proof.pi_b[0][1], proof.pi_b[0][0]],
                [proof.pi_b[1][1], proof.pi_b[1][0]]
            ];
            const pC = [proof.pi_c[0], proof.pi_c[1]];

            try {
                await privateTransferClaim.connect(user).claimPrivate(
                    pA, pB, pC, merkleRoots, nullifier, amount, recipientAddress, lockerScriptHash
                );
                expect.fail("Should have reverted");
            } catch (error: any) {
                // Invalid proof should revert
                expect(error).to.exist;
            }

            console.log("✓ Invalid proof correctly rejected!");
        });

        it("should reject mismatched amount", async function () {
            const merkleRoots = [publicSignals[0], publicSignals[1]];
            const nullifier = publicSignals[2];
            const wrongAmount = "999999999"; // Different from proof
            const recipientFromProof = publicSignals[5];
            const lockerScriptHash = publicSignals[6];
            const recipientAddress = "0x" + BigInt(recipientFromProof).toString(16).padStart(40, "0");

            const pA = [proof.pi_a[0], proof.pi_a[1]];
            const pB = [
                [proof.pi_b[0][1], proof.pi_b[0][0]],
                [proof.pi_b[1][1], proof.pi_b[1][0]]
            ];
            const pC = [proof.pi_c[0], proof.pi_c[1]];

            try {
                await privateTransferClaim.connect(user).claimPrivate(
                    pA, pB, pC, merkleRoots, nullifier, wrongAmount, recipientAddress, lockerScriptHash
                );
                expect.fail("Should have reverted");
            } catch (error: any) {
                expect(error.message).to.include("invalid proof");
            }

            console.log("✓ Mismatched amount correctly rejected!");
        });
    });

    describe("Admin functions", function () {
        it("should allow owner to register new locker hash", async function () {
            const newHash = "111222333";
            const newScript = "0x76a914abcd88ac";

            await privateTransferClaim.connect(owner).registerLockerHash(newHash, newScript);

            expect(await privateTransferClaim.isValidLockerHash(newHash)).to.be.true;
            expect(await privateTransferClaim.getLockerScript(newHash)).to.equal(newScript);
        });

        it("should allow owner to remove locker hash", async function () {
            const lockerScriptHash = publicSignals[6];

            await privateTransferClaim.connect(owner).removeLockerHash(lockerScriptHash);

            expect(await privateTransferClaim.isValidLockerHash(lockerScriptHash)).to.be.false;
        });

        it("should prevent non-owner from registering locker", async function () {
            try {
                await privateTransferClaim.connect(user).registerLockerHash("123", "0xaabb");
                expect.fail("Should have reverted");
            } catch (error: any) {
                expect(error.message).to.include("caller is not the owner");
            }
        });
    });
});
