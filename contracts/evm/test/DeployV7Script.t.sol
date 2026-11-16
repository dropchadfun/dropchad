// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

import {DeployV7Script} from "../script/DeployV7.s.sol";

import {BinderRegistryV2} from "../src/BinderRegistryV2.sol";
import {DropFactoryV7} from "../src/DropFactoryV7.sol";
import {DropV7} from "../src/DropV7.sol";
import {IDropFactoryV3} from "../src/IDropFactoryV3.sol";
import {MerkleHelper} from "./MerkleHelper.sol";

/// @dev Stands in for `forge script --broadcast`. The real chain list.
contract DeployV7ScriptBroadcastHarness is DeployV7Script {
    function _isBroadcast() internal pure override returns (bool) {
        return true;
    }
}

/// @dev A broadcast that also takes the local ids 31_970 to 31_979, so a test can run a full
///      broadcast and write record files without touching a 4663 or 46630 name.
contract DeployV7ScriptLocalBroadcastHarness is DeployV7ScriptBroadcastHarness {
    function _broadcastChainAllowed(uint256 id) internal pure override returns (bool) {
        return id == 4663 || id == 46_630 || (id >= 31_970 && id <= 31_979);
    }
}

/// @title DeployV7ScriptTest
/// @notice Runs `script/DeployV7.s.sol` for real and checks what it deployed and wrote.
///         The timelock owns the registry and the factory from the
///         constructor, the script makes no admin call, and the setup is one 48 hour batch for
///         the Safe. Each test owns a chain id, so it owns its `deployments/<id>-v7*-dryrun.json`,
///         and deletes them again.
contract DeployV7ScriptTest is Test {
    DeployV7Script internal script;

    address internal safe;
    address internal guardian;
    address internal binder;
    uint256 internal binderKey;
    address internal relayer;
    address internal feeWallet;

    function setUp() public {
        script = new DeployV7Script();
        safe = makeAddr("safe");
        // The Safe must have code. Any code stands in for the real Safe proxy.
        vm.etch(safe, hex"00");
        guardian = makeAddr("guardian");
        (binder, binderKey) = makeAddrAndKey("binder");
        relayer = makeAddr("relayer");
        feeWallet = makeAddr("fee wallet");
    }

    function _defaults() private view returns (DeployV7Script.Settings memory s) {
        s.safe = safe;
        s.guardian = guardian;
        s.binder = binder;
        s.allowedCreator = relayer;
        s.feeRecipient = feeWallet;
        s.batchSalt = keccak256("dropchad v7 setup");
    }

    /// @dev Every setting, the testnet fee numbers and two tokens.
    function _full() private view returns (DeployV7Script.Settings memory s) {
        s = _defaults();
        s.defaultFeeBps = 100;
        s.minFeeAmount = 0.000_02 ether;
        s.minFeePerReceiver = 0.000_01 ether;
        s.maxFeeAmount = 0.02 ether;
        s.allowedTokens = new address[](2);
        s.allowedTokens[0] = address(0x7E57);
        s.allowedTokens[1] = address(0x05DC);
    }

    // -----------------------------------------------------------------------
    // the timelock
    // -----------------------------------------------------------------------

    function test_DeployV7_DelayIs48Hours() public {
        vm.chainId(31_900);
        DeployV7Script.Deployment memory d = script.runWith(_defaults());

        assertEq(script.TIMELOCK_DELAY(), 172_800, "48 hours");
        assertEq(TimelockController(payable(d.timelock)).getMinDelay(), 172_800, "the timelock's own delay");

        _removeFiles(d.chainId);
    }

    function test_DeployV7_TheSafeHoldsEveryRoleAndNobodyElse() public {
        vm.chainId(31_901);
        DeployV7Script.Deployment memory d = script.runWith(_defaults());
        TimelockController t = TimelockController(payable(d.timelock));

        assertTrue(t.hasRole(t.PROPOSER_ROLE(), safe), "Safe proposes");
        assertTrue(t.hasRole(t.CANCELLER_ROLE(), safe), "Safe cancels");
        assertTrue(t.hasRole(t.EXECUTOR_ROLE(), safe), "Safe executes");
        assertFalse(t.hasRole(t.EXECUTOR_ROLE(), address(0)), "no open executor");
        assertFalse(t.hasRole(t.DEFAULT_ADMIN_ROLE(), safe), "Safe is no admin");

        assertTrue(t.hasRole(t.DEFAULT_ADMIN_ROLE(), d.timelock), "the timelock administers itself");

        bytes32[4] memory roles = [t.DEFAULT_ADMIN_ROLE(), t.PROPOSER_ROLE(), t.CANCELLER_ROLE(), t.EXECUTOR_ROLE()];
        for (uint256 i = 0; i < roles.length; i++) {
            assertFalse(t.hasRole(roles[i], d.deployer), "the deployer holds no role");
            assertFalse(t.hasRole(roles[i], guardian), "the guardian holds no role");
            assertFalse(t.hasRole(roles[i], relayer), "the relayer holds no role");
        }

        _removeFiles(d.chainId);
    }

    // -----------------------------------------------------------------------
    // owners and wiring
    // -----------------------------------------------------------------------

    function test_DeployV7_TheTimelockOwnsBothFromTheConstructor() public {
        vm.chainId(31_902);
        DeployV7Script.Deployment memory d = script.runWith(_defaults());
        BinderRegistryV2 registry = BinderRegistryV2(d.registry);
        DropFactoryV7 factory = DropFactoryV7(d.factory);

        assertEq(registry.owner(), d.timelock, "registry owner");
        assertEq(registry.pendingOwner(), address(0), "registry, nobody pending");
        assertEq(factory.owner(), d.timelock, "factory owner");
        assertEq(factory.pendingOwner(), address(0), "factory, nobody pending");
        assertTrue(d.deployer != d.timelock);

        _removeFiles(d.chainId);
    }

    function test_DeployV7_WiresTheNewTrio() public {
        vm.chainId(31_903);
        DeployV7Script.Deployment memory d = script.runWith(_defaults());
        DropFactoryV7 factory = DropFactoryV7(d.factory);
        DropV7 implementation = DropV7(payable(d.implementation));

        assertGt(d.timelock.code.length, 0, "timelock has no code");
        assertGt(d.registry.code.length, 0, "registry has no code");
        assertGt(d.implementation.code.length, 0, "implementation has no code");
        assertGt(d.factory.code.length, 0, "factory has no code");
        assertEq(factory.implementation(), d.implementation, "the factory clones the new DropV7");
        assertEq(address(implementation.BINDER_REGISTRY()), d.registry, "DropV7 reads the new registry");
        assertEq(implementation.MAX_BINDING_LIFETIME(), 3600, "the binding lifetime");
        assertTrue(implementation.initialized(), "the implementation is locked");
        assertEq(factory.feeRecipient(), feeWallet, "the constructor sets the fee recipient");

        _removeFiles(d.chainId);
    }

    // -----------------------------------------------------------------------
    // no admin call
    // -----------------------------------------------------------------------

    function test_DeployV7_MakesNoAdminCall() public {
        vm.chainId(31_904);
        DeployV7Script.Deployment memory d = script.runWith(_full());
        BinderRegistryV2 registry = BinderRegistryV2(d.registry);
        DropFactoryV7 factory = DropFactoryV7(d.factory);

        assertEq(registry.binder(), address(0), "no binder before the batch");
        assertEq(registry.guardian(), address(0), "no binder guardian before the batch");
        assertFalse(registry.revoked());
        assertEq(factory.pauseGuardian(), address(0), "no pause guardian before the batch");
        assertFalse(factory.allowedCreator(relayer), "no creator before the batch");
        assertFalse(factory.allowedCreator(d.deployer), "never the deployer");
        assertEq(factory.defaultFeeBps(), 0);
        assertEq(factory.minFeeAmount(), 0);
        assertEq(factory.minFeePerReceiver(), 0);
        assertEq(factory.maxFeeAmount(), 0);
        assertFalse(factory.allowedToken(address(0x7E57)));
        assertFalse(factory.allowedToken(address(0x05DC)));
        assertFalse(factory.paused());

        _removeFiles(d.chainId);
    }

    /// @dev Before the batch nobody can make a drop: no creator is allowed.
    function test_DeployV7_BeforeTheBatch_NoDropCanBeMade() public {
        vm.chainId(31_905);
        DeployV7Script.Deployment memory d = script.runWith(_defaults());

        vm.expectRevert(IDropFactoryV3.NotAllowedCreator.selector);
        this.createTenLeafNativeDrop(DropFactoryV7(d.factory), relayer, makeAddr("refund"));

        _removeFiles(d.chainId);
    }

    // -----------------------------------------------------------------------
    // the batch
    // -----------------------------------------------------------------------

    function test_DeployV7_BatchHoldsTheSetupInOrder() public {
        vm.chainId(31_906);
        DeployV7Script.Deployment memory d = script.runWith(_full());
        DeployV7Script.Batch memory b = script.batchOf(d);

        assertEq(b.targets.length, 10, "4 always, 4 fees, 2 tokens");
        assertEq(b.values.length, 10);
        assertEq(b.payloads.length, 10);
        assertEq(b.predecessor, bytes32(0), "no predecessor");
        assertEq(b.salt, keccak256("dropchad v7 setup"), "DEPLOY_V7_BATCH_SALT");

        address r = d.registry;
        address f = d.factory;
        _assertCall(b, 0, r, abi.encodeCall(BinderRegistryV2.setBinder, (binder)));
        _assertCall(b, 1, r, abi.encodeCall(BinderRegistryV2.setGuardian, (guardian)));
        _assertCall(b, 2, f, abi.encodeCall(DropFactoryV7.setPauseGuardian, (guardian)));
        _assertCall(b, 3, f, abi.encodeCall(DropFactoryV7.setCreatorAllowed, (relayer, true)));
        _assertCall(b, 4, f, abi.encodeCall(DropFactoryV7.setDefaultFeeBps, (uint16(100))));
        _assertCall(b, 5, f, abi.encodeCall(DropFactoryV7.setMinFeeAmount, (0.000_02 ether)));
        _assertCall(b, 6, f, abi.encodeCall(DropFactoryV7.setMinFeePerReceiver, (0.000_01 ether)));
        _assertCall(b, 7, f, abi.encodeCall(DropFactoryV7.setMaxFeeAmount, (0.02 ether)));
        _assertCall(b, 8, f, abi.encodeCall(DropFactoryV7.setTokenAllowed, (address(0x7E57), true)));
        _assertCall(b, 9, f, abi.encodeCall(DropFactoryV7.setTokenAllowed, (address(0x05DC), true)));

        _removeFiles(d.chainId);
    }

    function test_DeployV7_BatchSkipsZeroFees() public {
        vm.chainId(31_907);
        DeployV7Script.Settings memory s = _defaults();
        s.minFeePerReceiver = 0.000_01 ether;
        DeployV7Script.Deployment memory d = script.runWith(s);
        DeployV7Script.Batch memory b = script.batchOf(d);

        assertEq(b.targets.length, 5, "4 always, 1 fee");
        _assertCall(b, 3, d.factory, abi.encodeCall(DropFactoryV7.setCreatorAllowed, (relayer, true)));
        _assertCall(b, 4, d.factory, abi.encodeCall(DropFactoryV7.setMinFeePerReceiver, (0.000_01 ether)));

        _removeFiles(d.chainId);
    }

    function test_DeployV7_BatchRunsOnlyAfter48Hours() public {
        vm.chainId(31_908);
        DeployV7Script.Deployment memory d = script.runWith(_full());
        TimelockController t = TimelockController(payable(d.timelock));
        DeployV7Script.Batch memory b = script.batchOf(d);
        bytes32 id = t.hashOperationBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt);

        // Less than 48 hours is refused at schedule.
        vm.prank(safe);
        vm.expectRevert(abi.encodeWithSelector(TimelockController.TimelockInsufficientDelay.selector, 172_799, 172_800));
        t.scheduleBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt, 172_799);

        vm.prank(safe);
        t.scheduleBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt, 172_800);

        // One second early is refused.
        vm.warp(block.timestamp + 172_799);
        vm.prank(safe);
        vm.expectRevert(
            abi.encodeWithSelector(
                TimelockController.TimelockUnexpectedOperationState.selector,
                id,
                bytes32(1 << uint8(TimelockController.OperationState.Ready))
            )
        );
        t.executeBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt);

        vm.warp(block.timestamp + 1);
        vm.prank(safe);
        t.executeBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt);
        assertTrue(t.isOperationDone(id));

        BinderRegistryV2 registry = BinderRegistryV2(d.registry);
        DropFactoryV7 factory = DropFactoryV7(d.factory);
        assertEq(registry.binder(), binder);
        assertEq(registry.guardian(), guardian);
        assertEq(factory.pauseGuardian(), guardian);
        assertTrue(factory.allowedCreator(relayer));
        assertEq(factory.defaultFeeBps(), 100);
        assertEq(factory.minFeeAmount(), 0.000_02 ether);
        assertEq(factory.minFeePerReceiver(), 0.000_01 ether);
        assertEq(factory.maxFeeAmount(), 0.02 ether);
        assertTrue(factory.allowedToken(address(0x7E57)));
        assertTrue(factory.allowedToken(address(0x05DC)));
        assertFalse(factory.paused());
        assertEq(registry.owner(), d.timelock, "the batch moves no owner");
        assertEq(factory.owner(), d.timelock, "the batch moves no owner");

        _removeFiles(d.chainId);
    }

    function test_DeployV7_OnlyTheSafeSchedulesAndExecutes() public {
        vm.chainId(31_909);
        DeployV7Script.Deployment memory d = script.runWith(_defaults());
        TimelockController t = TimelockController(payable(d.timelock));
        DeployV7Script.Batch memory b = script.batchOf(d);

        // Read before `vm.prank`: a view call in between would use up the prank.
        bytes32 proposer = t.PROPOSER_ROLE();
        bytes32 executor = t.EXECUTOR_ROLE();

        address[3] memory others = [d.deployer, guardian, relayer];
        for (uint256 i = 0; i < others.length; i++) {
            vm.prank(others[i]);
            vm.expectRevert(
                abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, others[i], proposer)
            );
            t.scheduleBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt, 172_800);
        }

        vm.prank(safe);
        t.scheduleBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt, 172_800);
        vm.warp(block.timestamp + 172_800);

        for (uint256 i = 0; i < others.length; i++) {
            vm.prank(others[i]);
            vm.expectRevert(
                abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, others[i], executor)
            );
            t.executeBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt);
        }

        _removeFiles(d.chainId);
    }

    /// @dev Neither contract takes an admin call from anyone but the timelock, the deployer included.
    function test_DeployV7_TheDeployerCannotCallTheAdmin() public {
        vm.chainId(31_910);
        DeployV7Script.Deployment memory d = script.runWith(_defaults());

        vm.startPrank(d.deployer);
        vm.expectRevert();
        BinderRegistryV2(d.registry).setBinder(d.deployer);
        vm.expectRevert();
        DropFactoryV7(d.factory).setCreatorAllowed(d.deployer, true);
        vm.expectRevert();
        DropFactoryV7(d.factory).setPauseGuardian(d.deployer);
        vm.stopPrank();

        _removeFiles(d.chainId);
    }

    // -----------------------------------------------------------------------
    // after the batch: the guardian
    // -----------------------------------------------------------------------

    function test_DeployV7_AfterTheBatch_TheGuardianPausesButNeverUnpauses() public {
        vm.chainId(31_911);
        DeployV7Script.Deployment memory d = _deployAndRunBatch(_defaults());
        DropFactoryV7 factory = DropFactoryV7(d.factory);

        vm.prank(guardian);
        factory.pause();
        assertTrue(factory.paused(), "paused at once, no timelock wait");

        vm.prank(guardian);
        vm.expectRevert();
        factory.setPaused(false);
        assertTrue(factory.paused(), "the guardian cannot unpause");

        _removeFiles(d.chainId);
    }

    function test_DeployV7_AfterTheBatch_TheGuardianRevokesTheBinder() public {
        vm.chainId(31_912);
        DeployV7Script.Deployment memory d = _deployAndRunBatch(_defaults());
        BinderRegistryV2 registry = BinderRegistryV2(d.registry);

        vm.prank(guardian);
        registry.revoke();
        assertTrue(registry.revoked(), "revoked at once, no timelock wait");

        vm.prank(guardian);
        vm.expectRevert();
        registry.setBinder(guardian);

        _removeFiles(d.chainId);
    }

    // -----------------------------------------------------------------------
    // the unpause operation
    // -----------------------------------------------------------------------

    function test_DeployV7_Unpause_IsOneCallAfterTheBatch() public {
        vm.chainId(31_980);
        DeployV7Script.Deployment memory d = script.runWith(_full());
        DeployV7Script.Batch memory b = script.batchOf(d);
        DeployV7Script.Unpause memory u = script.unpauseOf(d);
        TimelockController t = TimelockController(payable(d.timelock));

        assertEq(u.target, d.factory, "target the factory");
        assertEq(u.value, 0, "value 0");
        assertEq(u.payload, abi.encodeCall(DropFactoryV7.setPaused, (false)), "setPaused(false)");
        assertEq(
            u.predecessor,
            t.hashOperationBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt),
            "predecessor the setup batch"
        );
        assertEq(u.salt, b.salt, "the batch salt");

        _removeFiles(d.chainId);
    }

    /// @dev The batch file carries the unpause next to the batch, ready for the Safe.
    function test_DeployV7_Unpause_InTheBatchFile() public {
        vm.chainId(31_981);
        DeployV7Script.Deployment memory d = script.runWith(_full());
        DeployV7Script.Unpause memory u = script.unpauseOf(d);
        TimelockController t = TimelockController(payable(d.timelock));
        string memory json = vm.readFile(script.batchPath(d.chainId, false));

        assertEq(vm.parseJsonAddress(json, ".unpause.target"), u.target, "json unpause target");
        assertEq(vm.parseJsonUint(json, ".unpause.value"), 0, "json unpause value");
        assertEq(vm.parseJsonBytes(json, ".unpause.payload"), u.payload, "json unpause payload");
        assertEq(vm.parseJsonBytes32(json, ".unpause.predecessor"), u.predecessor, "json unpause predecessor");
        assertEq(vm.parseJsonBytes32(json, ".unpause.salt"), u.salt, "json unpause salt");
        assertEq(
            vm.parseJsonBytes32(json, ".unpause.id"),
            t.hashOperation(u.target, u.value, u.payload, u.predecessor, u.salt),
            "json unpause id"
        );
        assertEq(
            vm.parseJsonBytes(json, ".unpause.scheduleCalldata"),
            abi.encodeCall(TimelockController.schedule, (u.target, u.value, u.payload, u.predecessor, u.salt, 172_800)),
            "json unpause scheduleCalldata"
        );
        assertEq(
            vm.parseJsonBytes(json, ".unpause.executeCalldata"),
            abi.encodeCall(TimelockController.execute, (u.target, u.value, u.payload, u.predecessor, u.salt)),
            "json unpause executeCalldata"
        );

        _removeFiles(d.chainId);
    }

    /// @dev The day: both scheduled at T0 from the file, the batch after 48 hours, the guardian
    ///      pauses, the Safe unpauses at once.
    function test_DeployV7_Unpause_ThePauseTestFromTheFile() public {
        vm.chainId(31_982);
        DeployV7Script.Deployment memory d = script.runWith(_full());
        DropFactoryV7 factory = DropFactoryV7(d.factory);
        string memory json = vm.readFile(script.batchPath(d.chainId, false));

        _safeCalls(d.timelock, vm.parseJsonBytes(json, ".scheduleCalldata"), "schedule the batch");
        _safeCalls(d.timelock, vm.parseJsonBytes(json, ".unpause.scheduleCalldata"), "schedule the unpause");
        vm.warp(block.timestamp + 172_800);
        _safeCalls(d.timelock, vm.parseJsonBytes(json, ".executeCalldata"), "execute the batch");
        assertFalse(factory.paused(), "not paused after the batch");

        vm.prank(guardian);
        factory.pause();
        assertTrue(factory.paused(), "the guardian paused");

        _safeCalls(d.timelock, vm.parseJsonBytes(json, ".unpause.executeCalldata"), "execute the unpause");
        assertFalse(factory.paused(), "the Safe unpaused at once");
        assertTrue(
            TimelockController(payable(d.timelock)).isOperationDone(vm.parseJsonBytes32(json, ".unpause.id")),
            "the unpause is used up"
        );

        _removeFiles(d.chainId);
    }

    function test_DeployV7_Unpause_NeverBeforeTheBatch() public {
        vm.chainId(31_983);
        DeployV7Script.Deployment memory d = script.runWith(_full());
        DeployV7Script.Unpause memory u = script.unpauseOf(d);
        DeployV7Script.Batch memory b = script.batchOf(d);
        TimelockController t = TimelockController(payable(d.timelock));

        vm.startPrank(safe);
        t.scheduleBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt, 172_800);
        t.schedule(u.target, u.value, u.payload, u.predecessor, u.salt, 172_800);
        vm.warp(block.timestamp + 172_800);
        vm.expectRevert(
            abi.encodeWithSelector(TimelockController.TimelockUnexecutedPredecessor.selector, u.predecessor)
        );
        t.execute(u.target, u.value, u.payload, u.predecessor, u.salt);
        vm.stopPrank();

        _removeFiles(d.chainId);
    }

    function test_DeployV7_Unpause_NeverBefore48Hours() public {
        vm.chainId(31_984);
        DeployV7Script.Deployment memory d = script.runWith(_full());
        DeployV7Script.Unpause memory u = script.unpauseOf(d);
        DeployV7Script.Batch memory b = script.batchOf(d);
        TimelockController t = TimelockController(payable(d.timelock));

        bytes32 id = t.hashOperation(u.target, u.value, u.payload, u.predecessor, u.salt);

        vm.startPrank(safe);
        t.scheduleBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt, 172_800);
        t.schedule(u.target, u.value, u.payload, u.predecessor, u.salt, 172_800);
        vm.stopPrank();
        assertEq(t.getTimestamp(id), block.timestamp + 172_800, "ready exactly 48 hours after T0");

        vm.warp(block.timestamp + 172_799);
        assertFalse(t.isOperationReady(id), "not ready one second before");

        _removeFiles(d.chainId);
    }

    function test_DeployV7_Unpause_OnlyTheSafe() public {
        vm.chainId(31_985);
        DeployV7Script.Deployment memory d = script.runWith(_full());
        DeployV7Script.Unpause memory u = script.unpauseOf(d);
        TimelockController t = TimelockController(payable(d.timelock));

        vm.prank(guardian);
        vm.expectRevert();
        t.schedule(u.target, u.value, u.payload, u.predecessor, u.salt, 172_800);

        vm.prank(safe);
        t.schedule(u.target, u.value, u.payload, u.predecessor, u.salt, 172_800);
        vm.warp(block.timestamp + 172_800);
        vm.prank(guardian);
        vm.expectRevert();
        t.execute(u.target, u.value, u.payload, u.predecessor, u.salt);

        _removeFiles(d.chainId);
    }

    /// @dev The Safe can cancel the scheduled unpause before it runs; the operation is then gone.
    function test_DeployV7_Unpause_TheSafeCancels() public {
        vm.chainId(31_986);
        DeployV7Script.Deployment memory d = script.runWith(_full());
        DeployV7Script.Unpause memory u = script.unpauseOf(d);
        TimelockController t = TimelockController(payable(d.timelock));
        bytes32 id = t.hashOperation(u.target, u.value, u.payload, u.predecessor, u.salt);

        vm.startPrank(safe);
        t.schedule(u.target, u.value, u.payload, u.predecessor, u.salt, 172_800);
        assertTrue(t.isOperationPending(id), "scheduled");
        t.cancel(id);
        vm.stopPrank();
        assertFalse(t.isOperation(id), "cancelled, gone");

        _removeFiles(d.chainId);
    }

    function test_DeployV7_RenounceRevertsOnBoth() public {
        vm.chainId(31_913);
        DeployV7Script.Deployment memory d = script.runWith(_defaults());

        vm.startPrank(d.timelock);
        vm.expectRevert(BinderRegistryV2.RenounceDisabled.selector);
        BinderRegistryV2(d.registry).renounceOwnership();
        vm.expectRevert(DropFactoryV7.RenounceDisabled.selector);
        DropFactoryV7(d.factory).renounceOwnership();
        vm.stopPrank();

        _removeFiles(d.chainId);
    }

    // -----------------------------------------------------------------------
    // refusals
    // -----------------------------------------------------------------------

    function test_DeployV7_RefusesNoSafe() public {
        vm.chainId(31_920);
        DeployV7Script.Settings memory s = _defaults();
        s.safe = address(0);
        vm.expectRevert(bytes("DeployV7Script: DEPLOY_V7_SAFE is not set"));
        script.runWith(s);
    }

    function test_DeployV7_RefusesASafeWithNoCode() public {
        vm.chainId(31_921);
        DeployV7Script.Settings memory s = _defaults();
        s.safe = makeAddr("an eoa");
        vm.expectRevert(bytes("DeployV7Script: DEPLOY_V7_SAFE has no code on this chain"));
        script.runWith(s);
    }

    function test_DeployV7_RefusesNoGuardian() public {
        vm.chainId(31_922);
        DeployV7Script.Settings memory s = _defaults();
        s.guardian = address(0);
        vm.expectRevert(bytes("DeployV7Script: DEPLOY_V7_GUARDIAN is not set"));
        script.runWith(s);
    }

    function test_DeployV7_RefusesNoBinder() public {
        vm.chainId(31_923);
        DeployV7Script.Settings memory s = _defaults();
        s.binder = address(0);
        vm.expectRevert(bytes("DeployV7Script: DEPLOY_V7_BINDER is not set"));
        script.runWith(s);
    }

    function test_DeployV7_RefusesNoRelayer() public {
        vm.chainId(31_924);
        DeployV7Script.Settings memory s = _defaults();
        s.allowedCreator = address(0);
        vm.expectRevert(bytes("DeployV7Script: DEPLOY_V7_ALLOWED_CREATOR is not set"));
        script.runWith(s);
    }

    function test_DeployV7_RefusesNoFeeRecipient() public {
        vm.chainId(31_925);
        DeployV7Script.Settings memory s = _defaults();
        s.feeRecipient = address(0);
        vm.expectRevert(bytes("DeployV7Script: DEPLOY_V7_FEE_RECIPIENT is not set"));
        script.runWith(s);
    }

    function test_DeployV7_RefusesTheBinderAsTheRelayer() public {
        vm.chainId(31_926);
        DeployV7Script.Settings memory s = _defaults();
        s.allowedCreator = binder;
        vm.expectRevert(bytes("DeployV7Script: the binder is the relayer"));
        script.runWith(s);
    }

    function test_DeployV7_RefusesTheBinderAsTheGuardian() public {
        vm.chainId(31_927);
        DeployV7Script.Settings memory s = _defaults();
        s.guardian = binder;
        vm.expectRevert(bytes("DeployV7Script: the binder is the guardian"));
        script.runWith(s);
    }

    function test_DeployV7_RefusesFeeAboveCap() public {
        vm.chainId(31_928);
        DeployV7Script.Settings memory s = _defaults();
        s.defaultFeeBps = 501;
        vm.expectRevert(bytes("DeployV7Script: DEPLOY_V7_DEFAULT_FEE_BPS is above MAX_FEE_BPS"));
        script.runWith(s);
    }

    function test_DeployV7_RefusesMinFeeAboveCap() public {
        vm.chainId(31_929);
        DeployV7Script.Settings memory s = _defaults();
        s.minFeeAmount = 0.001 ether + 1;
        vm.expectRevert(bytes("DeployV7Script: DEPLOY_V7_MIN_FEE_AMOUNT is above MAX_MIN_FEE_AMOUNT"));
        script.runWith(s);
    }

    function test_DeployV7_RefusesPerReceiverAboveCap() public {
        vm.chainId(31_930);
        DeployV7Script.Settings memory s = _defaults();
        s.minFeePerReceiver = 0.0001 ether + 1;
        vm.expectRevert(
            bytes("DeployV7Script: DEPLOY_V7_MIN_FEE_PER_RECEIVER is above MAX_MIN_FEE_PER_RECEIVER")
        );
        script.runWith(s);
    }

    function test_DeployV7_RefusesMaxFeeAboveCap() public {
        vm.chainId(31_931);
        DeployV7Script.Settings memory s = _defaults();
        s.maxFeeAmount = 0.05 ether + 1;
        vm.expectRevert(bytes("DeployV7Script: DEPLOY_V7_MAX_FEE_AMOUNT is above MAX_NATIVE_FEE"));
        script.runWith(s);
    }

    /// @dev The caps at their limit still pass: the refusal is strictly above.
    function test_DeployV7_FeesAtTheCapsPass() public {
        vm.chainId(31_932);
        DeployV7Script.Settings memory s = _defaults();
        s.defaultFeeBps = 500;
        s.minFeeAmount = 0.001 ether;
        s.minFeePerReceiver = 0.0001 ether;
        s.maxFeeAmount = 0.05 ether;
        DeployV7Script.Deployment memory d = script.runWith(s);
        assertEq(script.batchOf(d).targets.length, 8);
        _removeFiles(d.chainId);
    }

    // -----------------------------------------------------------------------
    // a broadcast on 4663 and 46630 only
    // -----------------------------------------------------------------------

    string private constant WRONG_CHAIN = "DeployV7Script: broadcast only on Robinhood 4663 or 46630";

    function test_DeployV7_Broadcast_RefusedOnEveryOtherChain() public {
        uint256[5] memory ids = [uint256(31_940), 31_337, 1, 46_631, 4664];
        for (uint256 i = 0; i < ids.length; i++) {
            vm.chainId(ids[i]);
            DeployV7ScriptBroadcastHarness harness = new DeployV7ScriptBroadcastHarness();
            vm.expectRevert(bytes(WRONG_CHAIN));
            harness.runWith(_defaults());
        }
    }

    function test_DeployV7_Broadcast_RefusedFromEnvToo() public {
        vm.chainId(31_941);
        _setEnv();
        DeployV7ScriptBroadcastHarness harness = new DeployV7ScriptBroadcastHarness();
        vm.expectRevert(bytes(WRONG_CHAIN));
        harness.run();
    }

    /// @dev The chain is checked before the settings: a wrong chain with no Safe is still the
    ///      chain refusal.
    function test_DeployV7_Broadcast_TheChainIsCheckedFirst() public {
        vm.chainId(31_337);
        DeployV7Script.Settings memory s = _defaults();
        s.safe = address(0);
        DeployV7ScriptBroadcastHarness harness = new DeployV7ScriptBroadcastHarness();
        vm.expectRevert(bytes(WRONG_CHAIN));
        harness.runWith(s);
    }

    /// @dev On 4663 and 46630 a broadcast passes the chain guard and meets the next check. No
    ///      Safe, so nothing is deployed and no file is written under a real name.
    function test_DeployV7_Broadcast_On4663And46630_PassesTheGuard() public {
        DeployV7Script.Settings memory s = _defaults();
        s.safe = address(0);

        vm.chainId(4663);
        DeployV7ScriptBroadcastHarness harness = new DeployV7ScriptBroadcastHarness();
        vm.expectRevert(bytes("DeployV7Script: DEPLOY_V7_SAFE is not set"));
        harness.runWith(s);

        vm.chainId(46_630);
        harness = new DeployV7ScriptBroadcastHarness();
        vm.expectRevert(bytes("DeployV7Script: DEPLOY_V7_SAFE is not set"));
        harness.runWith(s);
    }

    // -----------------------------------------------------------------------
    // output
    // -----------------------------------------------------------------------

    function test_DeployV7_FileNames() public view {
        assertEq(script.outputPath(4663, false), "deployments/4663-v7-dryrun.json", "4663 dry run");
        assertEq(script.batchPath(4663, false), "deployments/4663-v7-batch-dryrun.json", "4663 dry run batch");
        assertEq(script.outputPath(4663, true), "deployments/4663-v7.json", "4663 record");
        assertEq(script.batchPath(4663, true), "deployments/4663-v7-batch.json", "4663 batch");
        assertEq(script.outputPath(46_630, false), "deployments/46630-v7-dryrun.json", "46630 dry run");
        assertEq(script.batchPath(46_630, false), "deployments/46630-v7-batch-dryrun.json", "46630 dry run batch");
        assertEq(script.outputPath(46_630, true), "deployments/46630-v7-rehearsal.json", "46630 record");
        assertEq(script.batchPath(46_630, true), "deployments/46630-v7-rehearsal-batch.json", "46630 batch");
    }

    /// @dev The testnet V7 record is never one of this script's names.
    function test_DeployV7_NeverNamesTheTestnetRecord() public view {
        string memory testnetRecord = "deployments/46630-v7.json";
        assertNotEq(script.outputPath(46_630, true), testnetRecord);
        assertNotEq(script.batchPath(46_630, true), testnetRecord);
        assertNotEq(script.outputPath(46_630, false), testnetRecord);
        assertNotEq(script.batchPath(46_630, false), testnetRecord);
    }

    /// @dev A full broadcast run writes the record and the batch under their broadcast names,
    ///      and no dry run file.
    function test_DeployV7_Broadcast_WritesTheRecordFiles() public {
        vm.chainId(31_970);
        DeployV7ScriptLocalBroadcastHarness harness = new DeployV7ScriptLocalBroadcastHarness();
        DeployV7Script.Deployment memory d = harness.runWith(_full());

        string memory record = vm.readFile(harness.outputPath(31_970, true));
        assertEq(vm.parseJsonUint(record, ".chainId"), 31_970, "record chainId");
        assertEq(vm.parseJsonAddress(record, ".factory"), d.factory, "record factory");
        string memory batch = vm.readFile(harness.batchPath(31_970, true));
        assertEq(vm.parseJsonAddress(batch, ".timelock"), d.timelock, "batch timelock");
        assertFalse(vm.exists(harness.outputPath(31_970, false)), "no dry run record");
        assertFalse(vm.exists(harness.batchPath(31_970, false)), "no dry run batch");

        _removeFiles(31_970);
    }

    function test_DeployV7_Broadcast_RefusesAnExistingRecord() public {
        vm.chainId(31_971);
        DeployV7ScriptLocalBroadcastHarness harness = new DeployV7ScriptLocalBroadcastHarness();
        vm.writeFile(harness.outputPath(31_971, true), "{}");
        vm.expectRevert(bytes("DeployV7Script: the record file already exists"));
        harness.runWith(_full());
        assertEq(vm.readFile(harness.outputPath(31_971, true)), "{}", "the old file is untouched");
        _removeFiles(31_971);
    }

    function test_DeployV7_Broadcast_RefusesAnExistingBatch() public {
        vm.chainId(31_972);
        DeployV7ScriptLocalBroadcastHarness harness = new DeployV7ScriptLocalBroadcastHarness();
        vm.writeFile(harness.batchPath(31_972, true), "{}");
        vm.expectRevert(bytes("DeployV7Script: the batch file already exists"));
        harness.runWith(_full());
        assertEq(vm.readFile(harness.batchPath(31_972, true)), "{}", "the old file is untouched");
        _removeFiles(31_972);
    }

    /// @dev A dry run never refuses on old files: its files are scratch and are written again.
    function test_DeployV7_DryRun_WritesOverItsOwnFiles() public {
        vm.chainId(31_973);
        vm.writeFile(script.outputPath(31_973, false), "{}");
        vm.writeFile(script.batchPath(31_973, false), "{}");
        DeployV7Script.Deployment memory d = script.runWith(_full());
        assertEq(vm.parseJsonAddress(vm.readFile(script.outputPath(31_973, false)), ".factory"), d.factory);
        _removeFiles(31_973);
    }

    function test_DeployV7_WritesTheDeployment() public {
        vm.chainId(31_950);
        DeployV7Script.Deployment memory d = script.runWith(_full());
        string memory json = vm.readFile(script.outputPath(d.chainId, false));

        assertEq(vm.parseJsonUint(json, ".chainId"), d.chainId, "json chainId");
        assertEq(vm.parseJsonAddress(json, ".timelock"), d.timelock, "json timelock");
        assertEq(vm.parseJsonUint(json, ".timelockDelay"), 172_800, "json timelockDelay");
        assertEq(vm.parseJsonAddress(json, ".registry"), d.registry, "json registry");
        assertEq(vm.parseJsonAddress(json, ".implementation"), d.implementation, "json implementation");
        assertEq(vm.parseJsonAddress(json, ".factory"), d.factory, "json factory");
        assertEq(vm.parseJsonAddress(json, ".deployer"), d.deployer, "json deployer");
        assertEq(vm.parseJsonAddress(json, ".safe"), safe, "json safe");
        assertEq(vm.parseJsonAddress(json, ".guardian"), guardian, "json guardian");
        assertEq(vm.parseJsonAddress(json, ".binder"), binder, "json binder");
        assertEq(vm.parseJsonAddress(json, ".allowedCreator"), relayer, "json allowedCreator");
        assertEq(vm.parseJsonAddress(json, ".feeRecipient"), feeWallet, "json feeRecipient");
        assertEq(vm.parseJsonUint(json, ".defaultFeeBps"), 100, "json defaultFeeBps");
        assertEq(vm.parseJsonUint(json, ".minFeeAmount"), 0.000_02 ether, "json minFeeAmount");
        assertEq(vm.parseJsonUint(json, ".minFeePerReceiver"), 0.000_01 ether, "json minFeePerReceiver");
        assertEq(vm.parseJsonUint(json, ".maxFeeAmount"), 0.02 ether, "json maxFeeAmount");
        address[] memory tokens = vm.parseJsonAddressArray(json, ".allowedTokens");
        assertEq(tokens.length, 2, "json allowedTokens");
        assertEq(tokens[0], address(0x7E57));
        assertEq(tokens[1], address(0x05DC));
        assertEq(vm.parseJsonUint(json, ".block"), d.blockNumber, "json block");

        _removeFiles(d.chainId);
    }

    /// @dev The batch file decodes back to the same calls, its id is the timelock's own hash,
    ///      and the two Safe transactions are ready to send as they are.
    function test_DeployV7_WritesTheBatch() public {
        vm.chainId(31_951);
        DeployV7Script.Deployment memory d = script.runWith(_full());
        DeployV7Script.Batch memory b = script.batchOf(d);
        TimelockController t = TimelockController(payable(d.timelock));
        string memory json = vm.readFile(script.batchPath(d.chainId, false));

        assertEq(vm.parseJsonAddress(json, ".timelock"), d.timelock, "json timelock");
        assertEq(vm.parseJsonUint(json, ".delay"), 172_800, "json delay");
        assertEq(vm.parseJsonAddressArray(json, ".targets"), b.targets, "json targets");
        assertEq(vm.parseJsonUintArray(json, ".values"), b.values, "json values");
        bytes[] memory payloads = vm.parseJsonBytesArray(json, ".payloads");
        assertEq(payloads.length, b.payloads.length, "json payloads");
        for (uint256 i = 0; i < payloads.length; i++) {
            assertEq(payloads[i], b.payloads[i], "json payload item");
        }
        assertEq(vm.parseJsonBytes32(json, ".predecessor"), bytes32(0), "json predecessor");
        assertEq(vm.parseJsonBytes32(json, ".salt"), b.salt, "json salt");
        assertEq(
            vm.parseJsonBytes32(json, ".id"),
            t.hashOperationBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt),
            "json id"
        );
        assertEq(
            vm.parseJsonBytes(json, ".scheduleCalldata"),
            abi.encodeCall(
                TimelockController.scheduleBatch, (b.targets, b.values, b.payloads, b.predecessor, b.salt, 172_800)
            ),
            "json scheduleCalldata"
        );
        assertEq(
            vm.parseJsonBytes(json, ".executeCalldata"),
            abi.encodeCall(TimelockController.executeBatch, (b.targets, b.values, b.payloads, b.predecessor, b.salt)),
            "json executeCalldata"
        );

        // The calldata in the file works when the Safe sends it to the timelock.
        vm.prank(safe);
        (bool ok,) = d.timelock.call(vm.parseJsonBytes(json, ".scheduleCalldata"));
        assertTrue(ok, "schedule from the file");
        vm.warp(block.timestamp + 172_800);
        vm.prank(safe);
        (ok,) = d.timelock.call(vm.parseJsonBytes(json, ".executeCalldata"));
        assertTrue(ok, "execute from the file");
        assertTrue(DropFactoryV7(d.factory).allowedCreator(relayer));

        _removeFiles(d.chainId);
    }

    /// @dev The real entry point, every setting from the environment.
    function test_DeployV7_RunFromEnv_ProducesAWiredSet() public {
        vm.chainId(31_952);
        _setEnv();
        DeployV7Script.Settings memory s = script.settingsFromEnv();
        assertEq(s.safe, safe);
        assertEq(s.guardian, guardian);
        assertEq(s.binder, binder);
        assertEq(s.allowedCreator, relayer);
        assertEq(s.feeRecipient, feeWallet);
        assertEq(s.defaultFeeBps, 100);
        assertEq(s.minFeePerReceiver, 0.000_01 ether);
        assertEq(s.maxFeeAmount, 0.02 ether);
        assertEq(s.allowedTokens.length, 2);
        assertEq(s.batchSalt, keccak256("dropchad v7 setup"));

        DeployV7Script.Deployment memory d = script.run();
        assertEq(DropFactoryV7(d.factory).owner(), d.timelock);
        assertEq(script.batchOf(d).targets.length, 9, "4 always, 3 fees, 2 tokens");

        _removeFiles(d.chainId);
    }

    // -----------------------------------------------------------------------
    // end to end
    // -----------------------------------------------------------------------

    /// @dev Deploy, run the batch, then a native handle drop of 10 receivers pays one leaf
    ///      with the binder's v2 signature, `validUntil` 10 minutes ahead.
    function test_DeployV7_ThenANativeHandleDropPays() public {
        vm.chainId(31_960);
        DeployV7Script.Settings memory s = _defaults();
        s.defaultFeeBps = 100;
        s.minFeePerReceiver = 0.000_01 ether;
        s.maxFeeAmount = 0.02 ether;
        DeployV7Script.Deployment memory d = _deployAndRunBatch(s);
        address wallet = makeAddr("alice wallet");

        DropV7 drop = _tenLeafNativeDrop(DropFactoryV7(d.factory), relayer, makeAddr("refund"));
        assertEq(drop.feeAmount(), 0.0001 ether, "10 x 0.00001, above 1 percent of 0.001");

        vm.deal(address(this), drop.grossRequired());
        (bool ok,) = address(drop).call{value: drop.grossRequired()}("");
        assertTrue(ok);
        drop.activate();
        assertEq(feeWallet.balance, 0.0001 ether, "the fee reached the fee wallet");

        uint64 validUntil = uint64(block.timestamp + 600);
        bytes memory sig = _sign(binderKey, drop.bindingDigest(0, X_ID, wallet, validUntil));
        vm.prank(relayer);
        drop.claimHandle(0, X_ID, EACH, wallet, validUntil, _proof0, sig);
        assertEq(wallet.balance, EACH, "the bound wallet got its share");

        _removeFiles(d.chainId);
    }

    // -----------------------------------------------------------------------
    // the fork dry run. Skipped without ROBINHOOD_MAINNET_RPC_URL
    // -----------------------------------------------------------------------

    /// @dev Reads only. Forks Robinhood mainnet, deploys, runs the batch as the Safe after 48
    ///      hours, and makes one drop. Nothing is sent to the real chain.
    function test_DeployV7_Fork_Robinhood4663() public {
        string memory rpc = vm.envOr("ROBINHOOD_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 4663, "Robinhood mainnet");

        script = new DeployV7Script();
        vm.etch(safe, hex"00");
        DeployV7Script.Deployment memory d = _deployAndRunBatch(_defaults());
        assertEq(DropFactoryV7(d.factory).owner(), d.timelock);
        assertTrue(DropFactoryV7(d.factory).allowedCreator(relayer));

        DropV7 drop = _tenLeafNativeDrop(DropFactoryV7(d.factory), relayer, makeAddr("refund"));
        assertGt(address(drop).code.length, 0, "a drop on the fork");

        _removeFiles(d.chainId);
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    uint256 private constant X_ID = 44_196_397;
    uint256 private constant EACH = 0.0001 ether;
    bytes32[] private _proof0;

    function _deployAndRunBatch(DeployV7Script.Settings memory s) private returns (DeployV7Script.Deployment memory d) {
        d = script.runWith(s);
        TimelockController t = TimelockController(payable(d.timelock));
        DeployV7Script.Batch memory b = script.batchOf(d);
        vm.prank(safe);
        t.scheduleBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt, 172_800);
        vm.warp(block.timestamp + 172_800);
        vm.prank(safe);
        t.executeBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt);
    }

    function _safeCalls(address timelock, bytes memory data, string memory what) private {
        vm.prank(safe);
        (bool ok,) = timelock.call(data);
        assertTrue(ok, what);
    }

    function _assertCall(DeployV7Script.Batch memory b, uint256 i, address target, bytes memory payload) private pure {
        assertEq(b.targets[i], target, "batch target");
        assertEq(b.values[i], 0, "batch value is 0");
        assertEq(b.payloads[i], payload, "batch payload");
    }

    function _setEnv() private {
        vm.setEnv("DEPLOY_V7_SAFE", vm.toString(safe));
        vm.setEnv("DEPLOY_V7_GUARDIAN", vm.toString(guardian));
        vm.setEnv("DEPLOY_V7_BINDER", vm.toString(binder));
        vm.setEnv("DEPLOY_V7_ALLOWED_CREATOR", vm.toString(relayer));
        vm.setEnv("DEPLOY_V7_FEE_RECIPIENT", vm.toString(feeWallet));
        vm.setEnv("DEPLOY_V7_DEFAULT_FEE_BPS", "100");
        vm.setEnv("DEPLOY_V7_MIN_FEE_PER_RECEIVER", "10000000000000");
        vm.setEnv("DEPLOY_V7_MAX_FEE_AMOUNT", "20000000000000000");
        vm.setEnv(
            "DEPLOY_V7_ALLOWED_TOKENS",
            "0x0000000000000000000000000000000000007E57,0x00000000000000000000000000000000000005DC"
        );
        vm.setEnv("DEPLOY_V7_BATCH_SALT", vm.toString(keccak256("dropchad v7 setup")));
    }

    /// @dev External, so `expectRevert` lands on the one create call inside.
    function createTenLeafNativeDrop(DropFactoryV7 factory, address creator, address refund) external returns (DropV7) {
        return _tenLeafNativeDrop(factory, creator, refund);
    }

    /// @dev Ten handle leaves of `EACH`, x ids `X_ID` to `X_ID + 9`. Keeps the proof of leaf 0.
    function _tenLeafNativeDrop(DropFactoryV7 factory, address creator, address refund) private returns (DropV7) {
        bytes32 commitment = keccak256("creator");
        address predicted = factory.predictDrop(creator, commitment, 0);
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
        vm.prank(creator);
        return DropV7(payable(factory.createDrop(p)));
    }

    function _sign(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Never for 4663 or 46630 with `broadcast`: those are real record names.
    function _removeFiles(uint256 chainId) private {
        // On 4663 and 46630 only the dry run names: the broadcast names are real records.
        bool real = chainId == 4663 || chainId == 46_630;
        for (uint256 k = 0; k < (real ? 1 : 2); k++) {
            bool broadcast = k == 1;
            string memory path = script.outputPath(chainId, broadcast);
            if (bytes(path).length > 0 && vm.exists(path)) vm.removeFile(path);
            path = script.batchPath(chainId, broadcast);
            if (bytes(path).length > 0 && vm.exists(path)) vm.removeFile(path);
        }
    }
}
