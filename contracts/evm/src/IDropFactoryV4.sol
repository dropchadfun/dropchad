// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IDropFactoryV3} from "./IDropFactoryV3.sol";

/// @title IDropFactoryV4
/// @notice The factory with the R8.20 fee on Robinhood. `docs/SPEC.md` R7.57.
/// @dev `IDropFactoryV3` plus two admin set fields, their setters and their events. It inherits
///      `IDropFactoryV3` whole: `createDrop` takes the same `CreateParams`, so its selector, and
///      `DropCreated` and every other event and error, are the V3 ones, one ABI for all factories.
interface IDropFactoryV4 is IDropFactoryV3 {
    // ---------------------------------------------------------------------
    // events, SPEC 11.2 and R7.57
    // ---------------------------------------------------------------------

    event MinFeePerReceiverSet(uint256 oldAmount, uint256 newAmount);
    event MaxFeeAmountSet(uint256 oldAmount, uint256 newAmount);

    // ---------------------------------------------------------------------
    // functions
    // ---------------------------------------------------------------------

    /// @notice Owner only. R8.20, new native drops only. `FeeTooHigh()` above
    ///         `MAX_MIN_FEE_PER_RECEIVER`. Zero turns it off.
    function setMinFeePerReceiver(uint256 amount) external;

    /// @notice Owner only. R8.20, new native drops only. `FeeTooHigh()` above `MAX_NATIVE_FEE`.
    ///         Zero is no cap.
    function setMaxFeeAmount(uint256 amount) external;

    function minFeePerReceiver() external view returns (uint256);

    function maxFeeAmount() external view returns (uint256);
}
