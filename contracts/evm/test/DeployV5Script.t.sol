// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {DeployV5Script} from "../script/DeployV5.s.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {DropFactoryV5} from "../src/DropFactoryV5.sol";
import {DropV5} from "../src/DropV5.sol";
import {IDropFactoryV3} from "../src/IDropFactoryV3.sol";
import {MerkleHelper} from "./MerkleHelper.sol";

/// @title DeployV5ScriptTest
/// @notice Runs `script/DeployV5.s.sol` for real and checks what it deployed and wrote.
///         V5 deploys a **new** `DropV5` implementation that reads the
///         **live** `BinderRegistry`, then `DropFactoryV5` cloning it. Each test owns a chain
///         id, so it owns its `deployments/<id>-v5.json`, and deletes it again.
contract DeployV5ScriptTest is Test {
    DeployV5Script internal script;
    BinderRegistry internal registry;

    function setUp() public {
        script = new DeployV5Script();
        // The live registry: here a fresh one stands in for it.
        registry = new BinderRegistry(address(this));
    }

    function _defaults() private view returns (DeployV5Script.Settings memory s) {
        s.binderRegistry = address(registry);
    }

    // -----------------------------------------------------------------------
    // wiring
    // -----------------------------------------------------------------------

    function test_DeployV5_DefaultsWireEverythingToTheDeployer() public {
        vm.chainId(31_500);
        DeployV5Script.Deployment memory d = script.runWith(_defaults());
        DropFactoryV5 factory = DropFactoryV5(d.factory);

        assertGt(d.implementation.code.length, 0, "implementation has no code");
        assertGt(d.factory.code.length, 0, "factory has no code");
        assertEq(address(DropV5(payable(d.implementation)).BINDER_REGISTRY()), address(registry), "the live registry");
        assertTrue(DropV5(payable(d.implementation)).initialized(), "the implementation is locked");
        assertEq(factory.implementation(), d.implementation, "the factory clones the new DropV5");
        assertEq(d.registry, address(registry));
        assertEq(factory.owner(), d.deployer);
        assertEq(factory.pendingOwner(), address(0), "no transfer pending");
        assertEq(factory.feeRecipient(), d.deployer);
        assertTrue(factory.allowedCreator(d.deployer));
        assertEq(factory.defaultFeeBps(), 0);
        assertEq(factory.minFeeAmount(), 0);
        assertEq(factory.minFeePerReceiver(), 0, "off until set");
        assertEq(factory.maxFeeAmount(), 0, "no cap until set");
        assertFalse(factory.paused());

        _assertJsonMatches(d);
        _removeJson(d.chainId);
    }

    /// @dev Every setting, the testnet shape: the relayer, 1%, 0.00001 ETH per
    ///      receiver, cap 0.02 ETH, the two test tokens.
    function test_DeployV5_AppliesEverySetting() public {
        vm.chainId(31_501);
        DeployV5Script.Settings memory s = _defaults();
        s.feeRecipient = address(0xFEE);
        s.allowedCreator = address(0xBEEF);
        s.defaultFeeBps = 100;
        s.minFeePerReceiver = 0.000_01 ether;
        s.maxFeeAmount = 0.02 ether;
        s.allowedTokens = new address[](2);
        s.allowedTokens[0] = address(0x7E57);
        s.allowedTokens[1] = address(0x05DC);
        DeployV5Script.Deployment memory d = script.runWith(s);

        DropFactoryV5 factory = DropFactoryV5(d.factory);
        assertEq(factory.feeRecipient(), address(0xFEE));
        assertTrue(factory.allowedCreator(address(0xBEEF)));
        assertFalse(factory.allowedCreator(d.deployer), "only the named creator");
        assertEq(factory.defaultFeeBps(), 100);
        assertEq(factory.minFeeAmount(), 0);
        assertEq(factory.minFeePerReceiver(), 0.000_01 ether);
        assertEq(factory.maxFeeAmount(), 0.02 ether);
        assertTrue(factory.allowedToken(address(0x7E57)), "TEST allowed");
        assertTrue(factory.allowedToken(address(0x05DC)), "tUSDC allowed");
        assertEq(d.allowedTokens.length, 2);

        _assertJsonMatches(d);
        _removeJson(d.chainId);
    }

    /// @dev The mainnet shape: the admin is not the deployer, so no admin call is made, and the
    ///      admin is the owner at once (the constructor sets it, no accept needed).
    function test_DeployV5_ExplicitAdmin_MakesNoAdminCall() public {
        vm.chainId(31_502);
        DeployV5Script.Settings memory s = _defaults();
        s.admin = address(0xA11CE);
        s.allowedCreator = address(0xBEEF);
        s.minFeePerReceiver = 0.000_01 ether;
        s.allowedTokens = new address[](1);
        s.allowedTokens[0] = address(0x7E57);
        DeployV5Script.Deployment memory d = script.runWith(s);

        DropFactoryV5 factory = DropFactoryV5(d.factory);
        assertEq(factory.owner(), address(0xA11CE));
        assertEq(factory.pendingOwner(), address(0));
        assertFalse(factory.allowedCreator(address(0xBEEF)), "no allowlist call");
        assertFalse(factory.allowedToken(address(0x7E57)), "no token call");
        assertEq(factory.minFeePerReceiver(), 0, "no fee call");
        assertEq(d.allowedTokens.length, 0, "nothing recorded as allowed");

        _removeJson(d.chainId);
    }

    // -----------------------------------------------------------------------
    // refusals, before anything is sent
    // -----------------------------------------------------------------------

    function test_DeployV5_RefusesNoRegistry() public {
        vm.chainId(31_503);
        DeployV5Script.Settings memory s = _defaults();
        s.binderRegistry = address(0);
        vm.expectRevert(bytes("DeployV5Script: DEPLOY_BINDER_REGISTRY is not set, use the live BinderRegistry"));
        script.runWith(s);
    }

    function test_DeployV5_RefusesARegistryWithNoCode() public {
        vm.chainId(31_504);
        DeployV5Script.Settings memory s = _defaults();
        s.binderRegistry = address(0xDEAD);
        vm.expectRevert(bytes("DeployV5Script: DEPLOY_BINDER_REGISTRY has no code on this chain"));
        script.runWith(s);
    }

    function test_DeployV5_RefusesFeeAboveCap() public {
        vm.chainId(31_505);
        DeployV5Script.Settings memory s = _defaults();
        s.defaultFeeBps = 501;
        vm.expectRevert(bytes("DeployV5Script: DEPLOY_DEFAULT_FEE_BPS is above MAX_FEE_BPS"));
        script.runWith(s);
    }

    function test_DeployV5_RefusesMinFeeAboveCap() public {
        vm.chainId(31_506);
        DeployV5Script.Settings memory s = _defaults();
        s.minFeeAmount = 0.001 ether + 1;
        vm.expectRevert(bytes("DeployV5Script: DEPLOY_MIN_FEE_AMOUNT is above MAX_MIN_FEE_AMOUNT"));
        script.runWith(s);
    }

    function test_DeployV5_RefusesPerReceiverAboveCap() public {
        vm.chainId(31_507);
        DeployV5Script.Settings memory s = _defaults();
        s.minFeePerReceiver = 0.0001 ether + 1;
        vm.expectRevert(bytes("DeployV5Script: DEPLOY_MIN_FEE_PER_RECEIVER is above MAX_MIN_FEE_PER_RECEIVER"));
        script.runWith(s);
    }

    function test_DeployV5_RefusesMaxFeeAboveCap() public {
        vm.chainId(31_508);
        DeployV5Script.Settings memory s = _defaults();
        s.maxFeeAmount = 0.05 ether + 1;
        vm.expectRevert(bytes("DeployV5Script: DEPLOY_MAX_FEE_AMOUNT is above MAX_NATIVE_FEE"));
        script.runWith(s);
    }

    function test_DeployV5_WritesItsOwnFile() public view {
        assertEq(script.outputPath(46_630), "deployments/46630-v5.json");
    }

    /// @dev The real entry point, every setting from the environment.
    function test_DeployV5_RunFromEnv_ProducesAWiredSet() public {
        vm.chainId(31_509);
        vm.setEnv("DEPLOY_BINDER_REGISTRY", vm.toString(address(registry)));
        vm.setEnv("DEPLOY_MIN_FEE_PER_RECEIVER", "10000000000000");
        vm.setEnv("DEPLOY_MAX_FEE_AMOUNT", "20000000000000000");
        DeployV5Script.Deployment memory d = script.run();

        DropFactoryV5 factory = DropFactoryV5(d.factory);
        assertEq(address(DropV5(payable(factory.implementation())).BINDER_REGISTRY()), address(registry));
        assertEq(factory.minFeePerReceiver(), 0.000_01 ether);
        assertEq(factory.maxFeeAmount(), 0.02 ether);
        _removeJson(d.chainId);
    }

    // -----------------------------------------------------------------------
    // end to end
    // -----------------------------------------------------------------------

    /// @dev Deploy with the numbers, create a native handle drop of 10 receivers of
    ///      0.0001 ETH, fund, activate, claim one leaf with the binder's signature.
    function test_DeployV5_ThenANativeHandleDropPays() public {
        vm.chainId(31_510);
        (address binder, uint256 binderKey) = makeAddrAndKey("binder");
        registry.setBinder(binder);
        address relayer = makeAddr("relayer");
        address wallet = makeAddr("alice wallet");
        address feeWallet = makeAddr("fee wallet");

        DeployV5Script.Settings memory s = _defaults();
        s.feeRecipient = feeWallet;
        s.allowedCreator = relayer;
        s.defaultFeeBps = 100;
        s.minFeePerReceiver = 0.000_01 ether;
        s.maxFeeAmount = 0.02 ether;
        DeployV5Script.Deployment memory d = script.runWith(s);

        DropV5 drop = _tenLeafNativeDrop(DropFactoryV5(d.factory), relayer, makeAddr("refund"));
        assertEq(drop.feeAmount(), 0.0001 ether, "10 x 0.00001, above 1 percent of 0.001");

        vm.deal(address(this), drop.grossRequired());
        (bool ok,) = address(drop).call{value: drop.grossRequired()}("");
        assertTrue(ok);
        drop.activate();
        assertEq(feeWallet.balance, 0.0001 ether, "the fee reached the fee wallet");

        bytes memory sig = _sign(binderKey, drop.bindingDigest(0, X_ID, wallet));
        vm.prank(relayer);
        drop.claimHandle(0, X_ID, EACH, wallet, _proof0, sig);
        assertEq(wallet.balance, EACH, "the bound wallet got its share");

        _removeJson(d.chainId);
    }

    /// @dev The deployed factory refuses itself as the refund address.
    function test_DeployV5_ThenTheFactoryRefusesItselfAsRefund() public {
        vm.chainId(31_511);
        address relayer = makeAddr("relayer");
        DeployV5Script.Settings memory s = _defaults();
        s.allowedCreator = relayer;
        DeployV5Script.Deployment memory d = script.runWith(s);

        vm.expectRevert(DropFactoryV5.RefundRecipientRefused.selector);
        this.createTenLeafNativeDrop(DropFactoryV5(d.factory), relayer, d.factory);

        _removeJson(d.chainId);
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    uint256 private constant X_ID = 44_196_397;
    uint256 private constant EACH = 0.0001 ether;
    bytes32[] private _proof0;

    /// @dev External, so `expectRevert` lands on the one create call inside.
    function createTenLeafNativeDrop(DropFactoryV5 factory, address relayer, address refund)
        external
        returns (DropV5)
    {
        return _tenLeafNativeDrop(factory, relayer, refund);
    }

    /// @dev Ten handle leaves of `EACH`, x ids `X_ID` to `X_ID + 9`. Keeps the proof of leaf 0.
    function _tenLeafNativeDrop(DropFactoryV5 factory, address relayer, address refund) private returns (DropV5) {
        bytes32 commitment = keccak256("creator");
        address predicted = factory.predictDrop(relayer, commitment, 0);
        bytes32[] memory leaves = new bytes32[](10);
        for (uint256 i = 0; i < 10; i++) {
            leaves[i] = MerkleHelper.handleLeafOf(predicted, block.chainid, i, X_ID + i, EACH);
        }
        bytes32 merkleRoot = MerkleHelper.rootOf(leaves);
        bytes32[] memory proof = MerkleHelper.proofOf(leaves, 0);
        delete _proof0;
        for (uint256 i = 0; i < proof.length; i++) {
            _proof0.push(proof[i]);
        }

        IDropFactoryV3.CreateParams memory p = IDropFactoryV3.CreateParams({
            asset: address(0),
            merkleRoot: merkleRoot,
            manifestHash: keccak256("manifest"),
            totalEntitlements: 10 * EACH,
            leafCount: 10,
            refundRecipient: refund,
            creatorCommitment: commitment,
            nonce: 0,
            fundingPeriod: 1 hours,
            claimPeriod: 1 days,
            tokenFactory: address(0),
            nativeFee: 0
        });
        vm.prank(relayer);
        return DropV5(payable(factory.createDrop(p)));
    }

    function _sign(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _assertJsonMatches(DeployV5Script.Deployment memory d) private view {
        string memory json = vm.readFile(script.outputPath(d.chainId));
        assertEq(vm.parseJsonUint(json, ".chainId"), d.chainId, "json chainId");
        assertEq(vm.parseJsonAddress(json, ".registry"), d.registry, "json registry");
        assertEq(vm.parseJsonAddress(json, ".implementation"), d.implementation, "json implementation");
        assertEq(vm.parseJsonAddress(json, ".factory"), d.factory, "json factory");
        assertEq(vm.parseJsonAddress(json, ".deployer"), d.deployer, "json deployer");
        assertEq(vm.parseJsonAddress(json, ".admin"), d.admin, "json admin");
        assertEq(vm.parseJsonAddress(json, ".feeRecipient"), d.feeRecipient, "json feeRecipient");
        assertEq(vm.parseJsonAddress(json, ".allowedCreator"), d.allowedCreator, "json allowedCreator");
        assertEq(vm.parseJsonUint(json, ".defaultFeeBps"), d.defaultFeeBps, "json defaultFeeBps");
        assertEq(vm.parseJsonUint(json, ".minFeeAmount"), d.minFeeAmount, "json minFeeAmount");
        assertEq(vm.parseJsonUint(json, ".minFeePerReceiver"), d.minFeePerReceiver, "json minFeePerReceiver");
        assertEq(vm.parseJsonUint(json, ".maxFeeAmount"), d.maxFeeAmount, "json maxFeeAmount");
        address[] memory tokens = vm.parseJsonAddressArray(json, ".allowedTokens");
        assertEq(tokens.length, d.allowedTokens.length, "json allowedTokens");
        for (uint256 i = 0; i < tokens.length; i++) {
            assertEq(tokens[i], d.allowedTokens[i], "json allowedTokens item");
        }
        assertEq(vm.parseJsonUint(json, ".block"), d.blockNumber, "json block");
    }

    function _removeJson(uint256 chainId) private {
        string memory path = script.outputPath(chainId);
        if (vm.exists(path)) vm.removeFile(path);
    }
}
