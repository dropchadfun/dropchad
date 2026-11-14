// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DropTestBase} from "./DropTestBase.sol";
import {MockERC20} from "./MockERC20.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {DropFactoryV3} from "../src/DropFactoryV3.sol";
import {DropV3} from "../src/DropV3.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {IDropFactoryV3} from "../src/IDropFactoryV3.sol";

/// @title V3Params
/// @notice The V1 `CreateParams` the shared suites build, as `DropFactoryV3` takes them.
library V3Params {
    function from(IDropFactoryV1.CreateParams memory p, uint256 nativeFee)
        internal
        pure
        returns (IDropFactoryV3.CreateParams memory)
    {
        return IDropFactoryV3.CreateParams({
            asset: p.asset,
            merkleRoot: p.merkleRoot,
            manifestHash: p.manifestHash,
            totalEntitlements: p.totalEntitlements,
            leafCount: p.leafCount,
            refundRecipient: p.refundRecipient,
            creatorCommitment: p.creatorCommitment,
            nonce: p.nonce,
            fundingPeriod: p.fundingPeriod,
            claimPeriod: p.claimPeriod,
            tokenFactory: p.tokenFactory,
            nativeFee: nativeFee
        });
    }
}

/// @title V3TestBase
/// @notice `DropTestBase` on `DropV3` and `DropFactoryV3`, plus token drop helpers.
abstract contract V3TestBase is DropTestBase {
    BinderRegistry internal registry;

    /// @dev The `nativeFee` the next `createDrop` carries. Zero unless a test sets it.
    uint256 internal nativeFeeNext;

    /// @dev 0.002 ETH, a tier fee of a few dollars. A test value only.
    uint256 internal constant ETH_FEE = 0.002 ether;

    function _deployImplementation() internal virtual override returns (address) {
        registry = new BinderRegistry(owner);
        return address(new DropV3(address(registry)));
    }

    function _deployFactory() internal virtual override returns (address) {
        return address(new DropFactoryV3(owner, address(implementation), feeRecipient));
    }

    function _sendCreateDrop(IDropFactoryV1.CreateParams memory p) internal virtual override returns (address) {
        return IDropFactoryV3(address(factory)).createDrop(V3Params.from(p, nativeFeeNext));
    }

    function _v3() internal view returns (DropFactoryV3) {
        return DropFactoryV3(address(factory));
    }

    /// @dev Allows `token` by its exact address.
    function _allowTokenByAddress(address token) internal {
        vm.prank(owner);
        _v3().setTokenAllowed(token, true);
    }

    /// @notice A token drop on V3 over `n` default recipients, the token allowed by exact
    ///         address, `fee` the ETH fee.
    function _createTokenDrop(uint256 n, uint256 fee) internal returns (DropV3 drop, MockERC20 token) {
        token = new MockERC20("Test Coin", "TEST", 18);
        _allowTokenByAddress(address(token));
        (address[] memory r, uint256[] memory a) = _defaultCrowd(n);
        nativeFeeNext = fee;
        drop = DropV3(payable(address(_createDrop(address(token), address(0), 0, r, a))));
        nativeFeeNext = 0;
    }

    /// @dev ETH to a drop, from any wallet, exactly as a real funder would send it.
    function _fundEth(address drop, uint256 amount) internal {
        vm.deal(funder, funder.balance + amount);
        vm.prank(funder);
        (bool ok,) = drop.call{value: amount}("");
        require(ok, "eth funding failed");
    }

    /// @dev Both parts of a token drop, then `activate`.
    function _activateTokenDrop(DropV3 drop, MockERC20 token) internal {
        token.mint(address(drop), drop.grossRequired());
        _fundEth(address(drop), drop.nativeFee());
        drop.activate();
    }
}
