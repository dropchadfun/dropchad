// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Takes ETH and answers with `SIZE` bytes of return data, or with none. Both answers
///         touch the same memory first, so the receiver itself costs the same either way; only
///         a caller that copies the return data pays more, I-02.
contract ReturnBombEthReceiver {
    uint256 public immutable SIZE;
    bool public immutable ANSWER;

    constructor(uint256 size, bool answer) {
        require(size >= 32, "size");
        SIZE = size;
        ANSWER = answer;
    }

    receive() external payable {
        uint256 size = SIZE;
        bool answer = ANSWER;
        assembly ("memory-safe") {
            mstore(sub(size, 32), 1)
            if answer { return(0, size) }
            return(0, 0)
        }
    }
}
