// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {Vm} from "forge-std/Vm.sol";

import {V3TestBase} from "./V3TestBase.sol";
import {MockERC20} from "./MockERC20.sol";

import {DropV1} from "../src/DropV1.sol";
import {DropV3} from "../src/DropV3.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {IDropFactoryV3} from "../src/IDropFactoryV3.sol";
import {IDropV1} from "../src/IDropV1.sol";

/// @title DropFactoryV3Test
/// @notice What `DropFactoryV3` adds: the ETH fee of a token drop and the exact address token
///         allowlist. `DropV3Parity.t.sol` runs the whole
///         V1 and V2 factory suites against it.
contract DropFactoryV3Test is V3TestBase {
    /// @dev The non indexed tail of `DropCreated`, in declaration order.
    struct DropCreatedTail {
        bytes32 merkleRoot;
        bytes32 manifestHash;
        uint256 totalEntitlements;
        uint256 feeAmount;
        uint256 grossRequired;
        address feeRecipient;
        address refundRecipient;
        uint64 fundingDeadline;
        uint32 claimPeriod;
        uint32 leafCount;
        address implementation;
        bytes32 salt;
        bytes32 configHash;
    }

    function _setBps(uint16 bps) internal {
        vm.prank(owner);
        factory.setDefaultFeeBps(bps);
    }

    /// @dev Token params against an address-allowed token, for revert tests.
    function _tokenParams(uint256 nonce) internal returns (IDropFactoryV3.CreateParams memory, MockERC20) {
        MockERC20 token = new MockERC20("Test Coin", "TEST", 18);
        _allowTokenByAddress(address(token));
        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        IDropFactoryV1.CreateParams memory p = _validParams(address(token), address(0), nonce, r, a);
        return (_withFee(p, ETH_FEE), token);
    }

    function _withFee(IDropFactoryV1.CreateParams memory p, uint256 fee)
        internal
        pure
        returns (IDropFactoryV3.CreateParams memory q)
    {
        q = IDropFactoryV3.CreateParams({
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
            nativeFee: fee
        });
    }

    // -----------------------------------------------------------------------
    // the ETH fee
    // -----------------------------------------------------------------------

    /// @dev 6.12. The cap itself, so a change to it is a visible test change.
    function test_V3F_MaxNativeFeeValue() public view {
        assertEq(_v3().MAX_NATIVE_FEE(), 0.05 ether);
    }

    /// @dev The cap is inclusive.
    function test_V3F_NativeFeeAtTheCapPasses() public {
        (IDropFactoryV3.CreateParams memory q,) = _tokenParams(0);
        q.nativeFee = 0.05 ether;
        vm.prank(relayer);
        DropV3 drop = DropV3(payable(_v3().createDrop(q)));
        assertEq(drop.nativeFee(), 0.05 ether);
    }

    /// @dev One wei above the cap is refused.
    function test_V3F_RevertWhen_NativeFeeAboveTheCap() public {
        (IDropFactoryV3.CreateParams memory q,) = _tokenParams(0);
        q.nativeFee = 0.05 ether + 1;
        vm.prank(relayer);
        vm.expectRevert(IDropFactoryV3.NativeFeeTooHigh.selector);
        _v3().createDrop(q);
    }

    /// @dev A native drop must carry a zero ETH fee.
    function test_V3F_RevertWhen_NativeFeeOnANativeDrop() public {
        IDropFactoryV3.CreateParams memory q = _withFee(_validNativeParams(), 1);
        vm.prank(relayer);
        vm.expectRevert(IDropFactoryV3.NativeFeeOnNativeDrop.selector);
        _v3().createDrop(q);
    }

    /// @dev A zero ETH fee on a token drop is accepted by the contract.
    function test_V3F_ZeroNativeFeeOnATokenDropPasses() public {
        (IDropFactoryV3.CreateParams memory q,) = _tokenParams(0);
        q.nativeFee = 0;
        vm.prank(relayer);
        DropV3 drop = DropV3(payable(_v3().createDrop(q)));
        assertEq(drop.nativeFee(), 0);
    }

    /// @dev A token drop never pays a percent of the token, whatever the bps and
    ///      the minimum say.
    function testFuzz_V3F_TokenDropFeeIsAlwaysZero(uint16 bps, uint256 minFee) public {
        _setBps(uint16(bound(bps, 0, factory.MAX_FEE_BPS())));
        // Bound first: a view call inside the arguments would use up the prank.
        uint256 minimum = bound(minFee, 0, _v3().MAX_MIN_FEE_AMOUNT());
        vm.prank(owner);
        _v3().setMinFeeAmount(minimum);

        (DropV3 drop,) = _createTokenDrop(3, ETH_FEE);
        assertEq(drop.feeAmount(), 0, "no token fee");
        assertEq(drop.grossRequired(), drop.totalEntitlements(), "I7");
    }

    /// @dev A native drop keeps the V2 fee: the bigger of the bps and the minimum.
    function test_V3F_NativeDropKeepsTheV2Fee() public {
        _setBps(100);
        vm.prank(owner);
        _v3().setMinFeeAmount(0.0001 ether);

        DropV1 drop = _createNativeDrop(3); // 6 ether, 1 percent is 0.06 ether
        assertEq(drop.feeAmount(), 0.06 ether);
    }

    // -----------------------------------------------------------------------
    // the exact address token allowlist
    // -----------------------------------------------------------------------

    /// @dev The owner allows and removes; the event says which.
    function test_V3F_SetTokenAllowed_SetsAndEmits() public {
        address token = makeAddr("token");

        vm.expectEmit(true, false, false, true, address(factory));
        emit IDropFactoryV3.TokenAllowed(token, true);
        vm.prank(owner);
        _v3().setTokenAllowed(token, true);
        assertTrue(_v3().allowedToken(token));

        vm.expectEmit(true, false, false, true, address(factory));
        emit IDropFactoryV3.TokenAllowed(token, false);
        vm.prank(owner);
        _v3().setTokenAllowed(token, false);
        assertFalse(_v3().allowedToken(token));
    }

    /// @dev Owner only.
    function test_V3F_RevertWhen_SetTokenAllowed_Stranger() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        _v3().setTokenAllowed(makeAddr("token"), true);
    }

    /// @dev Zero cannot be allowed; removing it is harmless.
    function test_V3F_RevertWhen_AllowingTheZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(IDropFactoryV3.ZeroAddress.selector);
        _v3().setTokenAllowed(address(0), true);

        vm.prank(owner);
        _v3().setTokenAllowed(address(0), false);
    }

    /// @dev on V3. A token on no list is refused, default deny.
    function test_V3F_RevertWhen_TokenOnNoList() public {
        MockERC20 token = new MockERC20("Nope", "NOPE", 18);
        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        IDropFactoryV3.CreateParams memory q = _withFee(_validParams(address(token), address(0), 0, r, a), ETH_FEE);

        vm.prank(relayer);
        vm.expectRevert(IDropFactoryV3.FactoryNotAllowed.selector);
        _v3().createDrop(q);
    }

    /// @dev A removed token is refused for new drops; a drop that exists keeps
    ///      working.
    function test_V3F_RemovedToken_NewDropsRefused_OldDropsWork() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        vm.prank(owner);
        _v3().setTokenAllowed(address(token), false);

        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        IDropFactoryV3.CreateParams memory q = _withFee(_validParams(address(token), address(0), 1, r, a), ETH_FEE);
        vm.prank(relayer);
        vm.expectRevert(IDropFactoryV3.FactoryNotAllowed.selector);
        _v3().createDrop(q);

        _activateTokenDrop(drop, token);
        _assertStatus(DropV1(payable(address(drop))), IDropV1.Status.Active);
    }

    /// @dev An address-allowed token ignores `tokenFactory`, whatever it says.
    function test_V3F_AllowedTokenIgnoresTokenFactory() public {
        (IDropFactoryV3.CreateParams memory q,) = _tokenParams(0);
        q.tokenFactory = makeAddr("some launchpad nobody allowed");
        vm.prank(relayer);
        _v3().createDrop(q);
    }

    /// @dev The launchpad path still works on V3, and still takes no token fee.
    function test_V3F_LaunchpadPathStillWorks() public {
        _setBps(100);
        MockERC20 token = new MockERC20("Pons", "PONS", 18);
        address tokenFactory = _allowToken(address(token));
        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        nativeFeeNext = ETH_FEE;
        DropV3 drop = DropV3(payable(address(_createDrop(address(token), tokenFactory, 0, r, a))));
        nativeFeeNext = 0;

        assertEq(drop.feeAmount(), 0, "no token fee on the launchpad path either");
        assertEq(drop.nativeFee(), ETH_FEE);
    }

    // -----------------------------------------------------------------------
    // events
    // -----------------------------------------------------------------------

    /// @dev A token drop: `DropCreated` with a zero fee, then `NativeFeeSet`.
    function test_V3F_TokenDrop_EmitsDropCreatedThenNativeFeeSet() public {
        (IDropFactoryV3.CreateParams memory q,) = _tokenParams(0);

        vm.recordLogs();
        vm.prank(relayer);
        address created = _v3().createDrop(q);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        int256 createdAt = -1;
        int256 feeSetAt = -1;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(factory)) continue;
            if (logs[i].topics[0] == IDropFactoryV1.DropCreated.selector) {
                createdAt = int256(i);
                DropCreatedTail memory t = abi.decode(logs[i].data, (DropCreatedTail));
                assertEq(t.feeAmount, 0, "DropCreated feeAmount");
                assertEq(t.grossRequired, q.totalEntitlements, "DropCreated grossRequired");
            }
            if (logs[i].topics[0] == IDropFactoryV3.NativeFeeSet.selector) {
                feeSetAt = int256(i);
                assertEq(logs[i].topics[1], bytes32(uint256(uint160(created))), "NativeFeeSet drop");
                assertEq(abi.decode(logs[i].data, (uint256)), ETH_FEE, "NativeFeeSet fee");
            }
        }
        assertGe(createdAt, 0, "DropCreated emitted");
        assertGt(feeSetAt, createdAt, "NativeFeeSet right after DropCreated");
        assertEq(
            IDropFactoryV3.DropCreated.selector, IDropFactoryV1.DropCreated.selector, "one ABI for all three factories"
        );
    }

    /// @dev A native drop emits no `NativeFeeSet`.
    function test_V3F_NativeDrop_NoNativeFeeSet() public {
        IDropFactoryV3.CreateParams memory q = _withFee(_validNativeParams(), 0);

        vm.recordLogs();
        vm.prank(relayer);
        _v3().createDrop(q);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != IDropFactoryV3.NativeFeeSet.selector, "no ETH fee on a native drop");
        }
    }
}
