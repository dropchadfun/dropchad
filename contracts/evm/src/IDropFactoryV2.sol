// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IDropFactoryV1} from "./IDropFactoryV1.sol";

/// @title IDropFactoryV2
/// @notice `IDropFactoryV1` plus the flat minimum fee. `docs/SPEC.md` R7.40 and R8.14.
/// @dev Every V1 function, event and error is kept with the same signature, so the indexer and
///      the api decode both factories with one ABI, R7.40.
interface IDropFactoryV2 is IDropFactoryV1 {
    /// @notice SPEC 11.2, `DropFactoryV2` only.
    event MinFeeAmountSet(uint256 oldAmount, uint256 newAmount);

    /// @notice Owner only. Flat minimum fee in wei for **new native** drops. Reverts `FeeTooHigh()`
    ///         above `MAX_MIN_FEE_AMOUNT`. R7.40.
    function setMinFeeAmount(uint256 amount) external;

    /// @notice The flat minimum fee in wei for new native drops. Zero means none. R8.14.
    function minFeeAmount() external view returns (uint256);
}
