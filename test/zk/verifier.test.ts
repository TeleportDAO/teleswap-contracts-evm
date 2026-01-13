import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

describe("Groth16Verifier", function () {
    let verifier: any;

    before(async function () {
        // Deploy the verifier contract
        const Verifier = await ethers.getContractFactory("Groth16Verifier");
        verifier = await Verifier.deploy();
        await verifier.deployed();
        console.log("Verifier deployed to:", verifier.address);
    });

    it("should verify a valid proof", async function () {
        // Load the proof and public signals
        const proofPath = path.join(__dirname, "../../zkproof/build/proof.json");
        const publicPath = path.join(__dirname, "../../zkproof/build/public.json");

        if (!fs.existsSync(proofPath) || !fs.existsSync(publicPath)) {
            console.log("Proof files not found. Run: npm run zk:generate-proof");
            this.skip();
            return;
        }

        const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
        const publicSignals = JSON.parse(fs.readFileSync(publicPath, "utf8"));

        // Format proof for Solidity
        const pA = [proof.pi_a[0], proof.pi_a[1]];
        const pB = [
            [proof.pi_b[0][1], proof.pi_b[0][0]],
            [proof.pi_b[1][1], proof.pi_b[1][0]]
        ];
        const pC = [proof.pi_c[0], proof.pi_c[1]];

        console.log("Verifying proof with", publicSignals.length, "public signals");

        // Verify the proof
        const result = await verifier.verifyProof(pA, pB, pC, publicSignals);
        expect(result).to.be.true;
        console.log("✓ Proof verified on-chain!");
    });

    it("should reject an invalid proof", async function () {
        // Load the proof and public signals
        const proofPath = path.join(__dirname, "../../zkproof/build/proof.json");
        const publicPath = path.join(__dirname, "../../zkproof/build/public.json");

        if (!fs.existsSync(proofPath) || !fs.existsSync(publicPath)) {
            this.skip();
            return;
        }

        const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
        const publicSignals = JSON.parse(fs.readFileSync(publicPath, "utf8"));

        // Format proof for Solidity
        const pA = [proof.pi_a[0], proof.pi_a[1]];
        const pB = [
            [proof.pi_b[0][1], proof.pi_b[0][0]],
            [proof.pi_b[1][1], proof.pi_b[1][0]]
        ];
        const pC = [proof.pi_c[0], proof.pi_c[1]];

        // Tamper with public signals
        const tamperedSignals = [...publicSignals];
        tamperedSignals[0] = "1"; // Change first signal

        // Verify should fail with tampered signals
        const result = await verifier.verifyProof(pA, pB, pC, tamperedSignals);
        expect(result).to.be.false;
        console.log("✓ Invalid proof correctly rejected!");
    });
});
