// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {DeployV4Script} from "../script/DeployV4.s.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {DropFactoryV4} from "../src/DropFactoryV4.sol";
import {DropV3} from "../src/DropV3.sol";
import {IDropFactoryV3} from "../src/IDropFactoryV3.sol";
import {MerkleHelper} from "./MerkleHelper.sol";

/// @title DeployV4ScriptTest
/// @notice Runs `script/DeployV4.s.sol` for real and checks what it deployed and wrote.
///         V4 clones the **live** `DropV3` implementation, it never deploys
///         a new one. Each test owns a chain id, so it owns its `deployments/<id>-v4.json`, and
///         deletes it again.
contract DeployV4ScriptTest is Test {
    DeployV4Script internal script;
    BinderRegistry internal registry;
    DropV3 internal liveImplementation;

    function setUp() public {
        script = new DeployV4Script();
        // The live registry and the live DropV3: here fresh ones stand in for them.
        registry = new BinderRegistry(address(this));
        liveImplementation = new DropV3(address(registry));
    }

    function _defaults() private view returns (DeployV4Script.Settings memory s) {
        s.dropImplementation = address(liveImplementation);
    }

    // -----------------------------------------------------------------------
    // wiring
    // -----------------------------------------------------------------------

    function test_DeployV4_DefaultsWireEverythingToTheDeployer() public {
        vm.chainId(31_490);
        DeployV4Script.Deployment memory d = script.runWith(_defaults());
        DropFactoryV4 factory = DropFactoryV4(d.factory);

        assertGt(d.factory.code.length, 0, "factory has no code");
        assertEq(d.implementation, address(liveImplementation), "the live DropV3, not a new one");
        assertEq(factory.implementation(), address(liveImplementation), "the factory clones it");
        assertEq(d.registry, address(registry), "the registry read from the implementation");
        assertEq(factory.owner(), d.deployer);
        assertEq(factory.feeRecipient(), d.deployer);
        assertTrue(factory.allowedCreator(d.deployer));
        assertEq(factory.defaultFeeBps(), 0);
        assertEq(factory.minFeeAmount(), 0);
        assertEq(factory.minFeePerReceiver(), 0, "off until set");
        assertEq(factory.maxFeeAmount(), 0, "no cap until set");
        assertEq(factory.MAX_NATIVE_FEE(), 0.05 ether);
        assertEq(factory.MAX_MIN_FEE_PER_RECEIVER(), 0.0001 ether);
        assertFalse(factory.paused());

        _assertJsonMatches(d);
        _removeJson(d.chainId);
    }

    /// @dev Every setting, the testnet shape: the relayer, 1%, no flat minimum,
    ///      0.00001 ETH per receiver, cap 0.02 ETH, the two test tokens.
    function test_DeployV4_AppliesEverySetting() public {
        vm.chainId(31_491);
        DeployV4Script.Settings memory s = _defaults();
        s.feeRecipient = address(0xFEE);
        s.allowedCreator = address(0xBEEF);
        s.defaultFeeBps = 100;
        s.minFeeAmount = 0.000_01 ether;
        s.minFeePerReceiver = 0.000_01 ether;
        s.maxFeeAmount = 0.02 ether;
        s.allowedTokens = new address[](2);
        s.allowedTokens[0] = address(0x7E57);
        s.allowedTokens[1] = address(0x05DC);
        DeployV4Script.Deployment memory d = script.runWith(s);

        DropFactoryV4 factory = DropFactoryV4(d.factory);
        assertEq(factory.feeRecipient(), address(0xFEE));
        assertTrue(factory.allowedCreator(address(0xBEEF)));
        assertFalse(factory.allowedCreator(d.deployer), "only the named creator");
        assertEq(factory.defaultFeeBps(), 100);
        assertEq(factory.minFeeAmount(), 0.000_01 ether);
        assertEq(factory.minFeePerReceiver(), 0.000_01 ether);
        assertEq(factory.maxFeeAmount(), 0.02 ether);
        assertTrue(factory.allowedToken(address(0x7E57)), "TEST allowed");
        assertTrue(factory.allowedToken(address(0x05DC)), "tUSDC allowed");
        assertEq(d.allowedTokens.length, 2);

        _assertJsonMatches(d);
        _removeJson(d.chainId);
    }

    /// @dev The mainnet shape: the admin is not the deployer, so no admin call is made.
    function test_DeployV4_ExplicitAdmin_MakesNoAdminCall() public {
        vm.chainId(31_492);
        DeployV4Script.Settings memory s = _defaults();
        s.admin = address(0xA11CE);
        s.allowedCreator = address(0xBEEF);
        s.minFeePerReceiver = 0.000_01 ether;
        s.maxFeeAmount = 0.02 ether;
        s.allowedTokens = new address[](1);
        s.allowedTokens[0] = address(0x7E57);
        DeployV4Script.Deployment memory d = script.runWith(s);

        DropFactoryV4 factory = DropFactoryV4(d.factory);
        assertEq(factory.owner(), address(0xA11CE));
        assertFalse(factory.allowedCreator(address(0xBEEF)), "no allowlist call");
        assertFalse(factory.allowedToken(address(0x7E57)), "no token call");
        assertEq(factory.minFeePerReceiver(), 0, "no fee call");
        assertEq(factory.maxFeeAmount(), 0, "no fee call");
        assertEq(d.minFeePerReceiver, 0, "nothing recorded as set");
        assertEq(d.allowedTokens.length, 0, "nothing recorded as allowed");

        _removeJson(d.chainId);
    }

    // -----------------------------------------------------------------------
    // refusals, before anything is sent
    // -----------------------------------------------------------------------

    function test_DeployV4_RefusesNoImplementation() public {
        vm.chainId(31_493);
        DeployV4Script.Settings memory s = _defaults();
        s.dropImplementation = address(0);
        vm.expectRevert(bytes("DeployV4Script: DEPLOY_DROP_IMPLEMENTATION is not set, use the live DropV3"));
        script.runWith(s);
    }

    function test_DeployV4_RefusesAnImplementationWithNoCode() public {
        vm.chainId(31_494);
        DeployV4Script.Settings memory s = _defaults();
        s.dropImplementation = address(0xDEAD);
        vm.expectRevert(bytes("DeployV4Script: DEPLOY_DROP_IMPLEMENTATION has no code on this chain"));
        script.runWith(s);
    }

    function test_DeployV4_RefusesFeeAboveCap() public {
        vm.chainId(31_495);
        DeployV4Script.Settings memory s = _defaults();
        s.defaultFeeBps = 501;
        vm.expectRevert(bytes("DeployV4Script: DEPLOY_DEFAULT_FEE_BPS is above MAX_FEE_BPS"));
        script.runWith(s);
    }

    function test_DeployV4_RefusesMinFeeAboveCap() public {
        vm.chainId(31_496);
        DeployV4Script.Settings memory s = _defaults();
        s.minFeeAmount = 0.001 ether + 1;
        vm.expectRevert(bytes("DeployV4Script: DEPLOY_MIN_FEE_AMOUNT is above MAX_MIN_FEE_AMOUNT"));
        script.runWith(s);
    }

    function test_DeployV4_RefusesPerReceiverAboveCap() public {
        vm.chainId(31_497);
        DeployV4Script.Settings memory s = _defaults();
        s.minFeePerReceiver = 0.0001 ether + 1;
        vm.expectRevert(bytes("DeployV4Script: DEPLOY_MIN_FEE_PER_RECEIVER is above MAX_MIN_FEE_PER_RECEIVER"));
        script.runWith(s);
    }

    function test_DeployV4_RefusesMaxFeeAboveCap() public {
        vm.chainId(31_489);
        DeployV4Script.Settings memory s = _defaults();
        s.maxFeeAmount = 0.05 ether + 1;
        vm.expectRevert(bytes("DeployV4Script: DEPLOY_MAX_FEE_AMOUNT is above MAX_NATIVE_FEE"));
        script.runWith(s);
    }

    function test_DeployV4_WritesItsOwnFile() public view {
        assertEq(script.outputPath(46_630), "deployments/46630-v4.json");
    }

    /// @dev The real entry point, every setting from the environment.
    function test_DeployV4_RunFromEnv_ProducesAWiredSet() public {
        vm.chainId(31_498);
        vm.setEnv("DEPLOY_DROP_IMPLEMENTATION", vm.toString(address(liveImplementation)));
        vm.setEnv("DEPLOY_MIN_FEE_PER_RECEIVER", "10000000000000");
        vm.setEnv("DEPLOY_MAX_FEE_AMOUNT", "20000000000000000");
        DeployV4Script.Deployment memory d = script.run();

        DropFactoryV4 factory = DropFactoryV4(d.factory);
        assertEq(factory.implementation(), address(liveImplementation));
        assertEq(factory.minFeePerReceiver(), 0.000_01 ether);
        assertEq(factory.maxFeeAmount(), 0.02 ether);
        _removeJson(d.chainId);
    }

    // -----------------------------------------------------------------------
    // end to end: the deployed factory charges the fee and the drop pays
    // -----------------------------------------------------------------------

    /// @dev Deploy with the numbers, create a native handle drop of 10 receivers of
    ///      0.0001 ETH, fund, activate, claim one leaf with the binder's signature.
    function test_DeployV4_ThenANativeHandleDropPaysTheNewFee() public {
        vm.chainId(31_499);
        (address binder, uint256 binderKey) = makeAddrAndKey("binder");
        registry.setBinder(binder);
        address relayer = makeAddr("relayer");
        address wallet = makeAddr("alice wallet");
        address feeWallet = makeAddr("fee wallet");

        DeployV4Script.Settings memory s = _defaults();
        s.feeRecipient = feeWallet;
        s.allowedCreator = relayer;
        s.defaultFeeBps = 100;
        s.minFeePerReceiver = 0.000_01 ether;
        s.maxFeeAmount = 0.02 ether;
        DeployV4Script.Deployment memory d = script.runWith(s);

        DropV3 drop = _tenLeafNativeDrop(DropFactoryV4(d.factory), relayer);
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

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    uint256 private constant X_ID = 44_196_397;
    uint256 private constant EACH = 0.0001 ether;
    bytes32[] private _proof0;

    /// @dev Ten handle leaves of `EACH`, x ids `X_ID` to `X_ID + 9`. Keeps the proof of leaf 0.
    function _tenLeafNativeDrop(DropFactoryV4 factory, address relayer) private returns (DropV3) {
        bytes32 commitment = keccak256("creator");
        address predicted = factory.predictDrop(relayer, commitment, 0);
        bytes32[] memory leaves = new bytes32[](10);
        for (uint256 i = 0; i < 10; i++) {
            leaves[i] = MerkleHelper.handleLeafOf(predicted, block.chainid, i, X_ID + i, EACH);
        }
        bytes32 merkleRoot = MerkleHelper.rootOf(leaves);
        bytes32[] memory proof = MerkleHelper.proofOf(leaves, 0);
        for (uint256 i = 0; i < proof.length; i++) {
            _proof0.push(proof[i]);
        }

        IDropFactoryV3.CreateParams memory p = IDropFactoryV3.CreateParams({
            asset: address(0),
            merkleRoot: merkleRoot,
            manifestHash: keccak256("manifest"),
            totalEntitlements: 10 * EACH,
            leafCount: 10,
            refundRecipient: makeAddr("refund"),
            creatorCommitment: commitment,
            nonce: 0,
            fundingPeriod: 1 hours,
            claimPeriod: 1 days,
            tokenFactory: address(0),
            nativeFee: 0
        });
        vm.prank(relayer);
        return DropV3(payable(factory.createDrop(p)));
    }

    function _sign(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _assertJsonMatches(DeployV4Script.Deployment memory d) private view {
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
