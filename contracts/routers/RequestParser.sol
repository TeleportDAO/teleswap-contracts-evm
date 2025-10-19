// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

/// @notice Library for parsing cc transfer and cc exchange requests
library RequestParser {
    /// @notice Returns chain id of the request
    /// @param _arbitraryData Data written in Bitcoin tx
    function parseChainId(
        bytes memory _arbitraryData
    ) internal pure returns (uint16 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 0, 1);
        assembly {
            parsedValue := mload(add(slicedBytes, 2))
        }
    }

    /// @notice Returns app id of the request
    /// @dev Determines the app that request belongs to (e.g. cc transfer app id is 0)
    function parseAppId(
        bytes memory _arbitraryData
    ) internal pure returns (uint8 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 2, 2);
        assembly {
            parsedValue := mload(add(slicedBytes, 1))
        }
    }

    /// @notice Returns recipient address
    /// @dev Minted TeleBTC or exchanged tokens will be sent to this address
    function parseRecipientAddress(
        bytes memory _arbitraryData
    ) internal pure returns (address parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 3, 22);
        assembly {
            parsedValue := mload(add(slicedBytes, 20))
        }
    }

    /// @notice Returns network fee
    /// @dev This fee goes to Teleporter who submitted the request
    function parseNetworkFee(
        bytes memory _arbitraryData
    ) internal pure returns (uint24 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 23, 25);
        assembly {
            parsedValue := mload(add(slicedBytes, 3))
        }
    }

    /// @notice Determines type of the request
    /// @dev 0 for normal requests, 1 for fixed-rate requests
    function parseSpeed(
        bytes memory _arbitraryData
    ) internal pure returns (uint8 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 26, 26);
        assembly {
            parsedValue := mload(add(slicedBytes, 1))
        }
    }

    /// @notice Returns id of third party
    /// @dev 0 for no third party
    function parseThirdPartyId(
        bytes memory _arbitraryData
    ) internal pure returns (uint8 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 27, 27);
        assembly {
            parsedValue := mload(add(slicedBytes, 1))
        }
    }

    /// @notice Returns address of exchange token
    /// @dev Minted TeleBTC will be exchanged for this token
    function parseExchangeToken(
        bytes memory _arbitraryData
    ) internal pure returns (address parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 28, 47);
        assembly {
            parsedValue := mload(add(slicedBytes, 20))
        }
    }

    /// @notice Returns min expected output (exchange) amount
    function parseExchangeOutputAmount(
        bytes memory _arbitraryData
    ) internal pure returns (uint112 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 48, 61);
        assembly {
            parsedValue := mload(add(slicedBytes, 14))
        }
    }

    /// @notice Returns across percentage fee
    /// @dev This fee goes to across relayers
    function parseArossFeePercentage(
        bytes memory _arbitraryData
    ) internal pure returns (uint24 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 62, 64);
        assembly {
            parsedValue := mload(add(slicedBytes, 3))
        }
    }

    /// @notice Returns the sliced bytes
    /// @param _data Slicing data
    /// @param _start index of slicing
    /// @param _end index of slicing
    function sliceBytes(
        bytes memory _data,
        uint _start,
        uint _end
    ) internal pure returns (bytes memory _result) {
        bytes1 temp;
        for (uint i = _start; i < _end + 1; i++) {
            temp = _data[i];
            _result = abi.encodePacked(_result, temp);
        }
    }

    /// @notice Returns recipient address
    /// @dev Minted TeleBTC or exchanged tokens will be sent to this address
    function parseRecipientDestAddress(
        bytes memory _arbitraryData
    ) internal pure returns (bytes32 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 3, 34);
        assembly {
            parsedValue := mload(add(slicedBytes, 32))
        }
    }

    /// @notice Returns network fee
    /// @dev This fee goes to Teleporter who submitted the request
    function parseNetworkFeeNew(
        bytes memory _arbitraryData
    ) internal pure returns (uint24 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 35, 37);
        assembly {
            parsedValue := mload(add(slicedBytes, 3))
        }
    }

    /// @notice Determines type of the request
    /// @dev 0 for normal requests, 1 for fixed-rate requests
    function parseSpeedNew(
        bytes memory _arbitraryData
    ) internal pure returns (uint8 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 38, 38);
        assembly {
            parsedValue := mload(add(slicedBytes, 1))
        }
    }

    /// @notice Returns id of third party
    /// @dev 0 for no third party
    function parseThirdPartyID(
        bytes memory _arbitraryData
    ) internal pure returns (uint8 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 39, 39);
        assembly {
            parsedValue := mload(add(slicedBytes, 1))
        }
    }

    /// @notice Returns token ticker of the destination token
    /// @dev Minted TeleBTC will be exchanged for this token
    function parseDestTokenTicker(
        bytes memory _arbitraryData
    ) internal pure returns (uint64 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 40, 47);
        assembly {
            parsedValue := mload(add(slicedBytes, 8))
        }
    }

    /// @notice Returns min expected output (exchange) amount
    function parseMinDestTokenAmount(
        bytes memory _arbitraryData
    ) internal pure returns (uint104 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 48, 60);
        assembly {
            parsedValue := mload(add(slicedBytes, 13))
        }
    }

    /// @notice Returns min expected output (exchange) amount
    function parseMinIntermediaryTokenAmount(
        bytes memory _arbitraryData
    ) internal pure returns (uint104 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 61, 73);
        assembly {
            parsedValue := mload(add(slicedBytes, 13))
        }
    }

    /// @notice Returns across percentage fee
    /// @dev This fee goes to across relayers
    function parseBridgeFeePercentage(
        bytes memory _arbitraryData
    ) internal pure returns (uint24 parsedValue) {
        bytes memory slicedBytes = sliceBytes(_arbitraryData, 74, 76);
        assembly {
            parsedValue := mload(add(slicedBytes, 3))
        }
    }
}
