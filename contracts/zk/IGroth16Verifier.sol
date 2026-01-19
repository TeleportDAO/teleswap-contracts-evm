// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IGroth16Verifier
 * @notice Interface for the Groth16 ZK proof verifier
 */
interface IGroth16Verifier {
    /**
     * @notice Verify a Groth16 proof
     * @param _pA Proof point A (2 elements)
     * @param _pB Proof point B (2x2 elements)
     * @param _pC Proof point C (2 elements)
     * @param _pubSignals Public signals (6 elements for PrivateTransfer)
     * @return True if the proof is valid
     */
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[6] calldata _pubSignals
    ) external view returns (bool);
}
