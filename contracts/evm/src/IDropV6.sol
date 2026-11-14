// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IDropV5} from "./IDropV5.sol";

/// @title IDropV6
/// @notice `IDropV5` plus the index check of audit round 3 L-05. `docs/SPEC.md` R7.74.
/// @dev Every V1, V2, V3 and V5 function, event and error keeps its signature.
interface IDropV6 is IDropV5 {
    // ---------------------------------------------------------------------
    // errors, R7.74
    // ---------------------------------------------------------------------

    /// @dev R7.74 item 1 and R6.4.10. `index >= leafCount`: only a bad tree can hold such a leaf.
    error BadIndex();
}
