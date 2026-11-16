// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

import {BinderRegistryV2} from "../src/BinderRegistryV2.sol";
import {DropFactoryV7} from "../src/DropFactoryV7.sol";
import {DropV7} from "../src/DropV7.sol";

/// @title DeployV7Script
/// @notice Deploys the Robinhood mainnet set: a `TimelockController` of 48 hours with the Safe as
///         proposer and executor, `BinderRegistryV2` and `DropFactoryV7` owned by the timelock
///         from the constructor, and the `DropV7` implementation.
/// @dev **No private key appears in this file, and none ever will.**
///      **A broadcast only on 4663 or 46630**: under `--broadcast` or `--resume`
///      every other chain is refused before anything is sent. 46630 is the rehearsal. A broadcast
///      also refuses when its record or batch file already exists. Without `--broadcast`
///      it is a dry run; the mainnet dry run is an `anvil` fork of 4663.
///      **It makes no admin call**. The deployer never owns a contract and never
///      holds a timelock role. The setup is one timelock batch, written to the batch file.
///      The Safe sends `scheduleCalldata` to the timelock, waits 48 hours, then sends
///      `executeCalldata`. Until then no creator is allowed, so no drop can be made. The same
///      file also holds an unpause operation, scheduled at the same time.
///      Every env input starts with `DEPLOY_V7_`, and no name equals a `DEPLOY_V6_` or
///      `DEPLOY_V7_TESTNET_` name, so no other script reads it.
///      | env | unset means | goes to |
///      |---|---|---|
///      | `DEPLOY_V7_SAFE`                 | **refused** | the timelock's proposer, canceller and executor |
///      | `DEPLOY_V7_GUARDIAN`             | **refused** | the batch: `setGuardian` and `setPauseGuardian`, the guardian key |
///      | `DEPLOY_V7_BINDER`               | **refused** | the batch: `setBinder` |
///      | `DEPLOY_V7_ALLOWED_CREATOR`      | **refused** | the batch: `setCreatorAllowed(..., true)`, the relayer |
///      | `DEPLOY_V7_FEE_RECIPIENT`        | **refused** | the factory constructor, `feeRecipient_` |
///      | `DEPLOY_V7_DEFAULT_FEE_BPS`      | `0`         | the batch: `setDefaultFeeBps`, only when not zero |
///      | `DEPLOY_V7_MIN_FEE_AMOUNT`       | `0`         | the batch: `setMinFeeAmount` in wei, only when not zero |
///      | `DEPLOY_V7_MIN_FEE_PER_RECEIVER` | `0`         | the batch: `setMinFeePerReceiver` in wei, only when not zero |
///      | `DEPLOY_V7_MAX_FEE_AMOUNT`       | `0`         | the batch: `setMaxFeeAmount` in wei, only when not zero |
///      | `DEPLOY_V7_ALLOWED_TOKENS`       | none        | the batch: `setTokenAllowed(..., true)` for each, comma separated |
///      | `DEPLOY_V7_BATCH_SALT`           | zero        | the batch salt |
contract DeployV7Script is Script {
    /// @notice The timelock delay, 48 hours.
    uint256 public constant TIMELOCK_DELAY = 48 hours;

    /// @notice The settings, all from the environment. See the table above.
    struct Settings {
        address safe;
        address guardian;
        address binder;
        address allowedCreator;
        address feeRecipient;
        uint16 defaultFeeBps;
        uint256 minFeeAmount;
        uint256 minFeePerReceiver;
        uint256 maxFeeAmount;
        address[] allowedTokens;
        bytes32 batchSalt;
    }

    /// @notice What the run produced.
    struct Deployment {
        address timelock;
        address registry;
        address implementation;
        address factory;
        address deployer;
        address safe;
        address guardian;
        address binder;
        address allowedCreator;
        address feeRecipient;
        uint16 defaultFeeBps;
        uint256 minFeeAmount;
        uint256 minFeePerReceiver;
        uint256 maxFeeAmount;
        address[] allowedTokens;
        bytes32 batchSalt;
        /// @dev **The L1 block on Arbitrum Nitro**, as in `Deploy.s.sol`.
        uint256 blockNumber;
        uint256 timestamp;
        uint256 chainId;
    }

    /// @notice The setup, one `scheduleBatch` for the Safe.
    struct Batch {
        address[] targets;
        uint256[] values;
        bytes[] payloads;
        bytes32 predecessor;
        bytes32 salt;
    }

    /// @notice The unpause, a second timelock operation.
    struct Unpause {
        address target;
        uint256 value;
        bytes payload;
        bytes32 predecessor;
        bytes32 salt;
    }

    /// @notice The normal entry point. Settings come from the environment.
    function run() external returns (Deployment memory) {
        return _run(settingsFromEnv());
    }

    /// @notice The same deploy with explicit settings and no environment, for the tests.
    function runWith(Settings memory s) external returns (Deployment memory) {
        return _run(s);
    }

    /// @notice Reads the settings. Unset is zero, or an empty list.
    function settingsFromEnv() public view returns (Settings memory s) {
        s.safe = vm.envOr("DEPLOY_V7_SAFE", address(0));
        s.guardian = vm.envOr("DEPLOY_V7_GUARDIAN", address(0));
        s.binder = vm.envOr("DEPLOY_V7_BINDER", address(0));
        s.allowedCreator = vm.envOr("DEPLOY_V7_ALLOWED_CREATOR", address(0));
        s.feeRecipient = vm.envOr("DEPLOY_V7_FEE_RECIPIENT", address(0));

        uint256 feeBps = vm.envOr("DEPLOY_V7_DEFAULT_FEE_BPS", uint256(0));
        // Checked against `MAX_FEE_BPS` in `_run`. This only keeps the cast from truncating.
        require(feeBps <= type(uint16).max, "DeployV7Script: DEPLOY_V7_DEFAULT_FEE_BPS does not fit uint16");
        // forge-lint: disable-next-line(unsafe-typecast)
        s.defaultFeeBps = uint16(feeBps);

        s.minFeeAmount = vm.envOr("DEPLOY_V7_MIN_FEE_AMOUNT", uint256(0));
        s.minFeePerReceiver = vm.envOr("DEPLOY_V7_MIN_FEE_PER_RECEIVER", uint256(0));
        s.maxFeeAmount = vm.envOr("DEPLOY_V7_MAX_FEE_AMOUNT", uint256(0));
        s.allowedTokens = vm.envOr("DEPLOY_V7_ALLOWED_TOKENS", ",", new address[](0));
        s.batchSalt = vm.envOr("DEPLOY_V7_BATCH_SALT", bytes32(0));
    }

    // -----------------------------------------------------------------------
    // the deploy itself
    // -----------------------------------------------------------------------

    function _run(Settings memory s) private returns (Deployment memory d) {
        bool broadcast = _isBroadcast();
        require(
            !broadcast || _broadcastChainAllowed(block.chainid),
            "DeployV7Script: broadcast only on Robinhood 4663 or 46630"
        );
        _checkSettings(s);
        if (broadcast) {
            // A record is never written over.
            require(
                !vm.exists(outputPath(block.chainid, true)),
                "DeployV7Script: the record file already exists"
            );
            require(
                !vm.exists(batchPath(block.chainid, true)),
                "DeployV7Script: the batch file already exists"
            );
        }

        vm.startBroadcast();

        // The broadcast sender. See `Deploy.s.sol` for why this is not `msg.sender`.
        // forge-lint: disable-next-line(unused-return)
        (, address broadcaster,) = vm.readCallers();

        address[] memory safeOnly = new address[](1);
        safeOnly[0] = s.safe;
        // Admin zero: the timelock administers itself, nobody else.
        TimelockController timelock = new TimelockController(TIMELOCK_DELAY, safeOnly, safeOnly, address(0));
        BinderRegistryV2 registry = new BinderRegistryV2(address(timelock));
        DropV7 implementation = new DropV7(address(registry));
        DropFactoryV7 factory = new DropFactoryV7(address(timelock), address(implementation), s.feeRecipient);

        vm.stopBroadcast();

        // The caps are the new factory's own constants, never retyped here. forge simulates the
        // whole script before it broadcasts anything, so a revert here sends nothing at all.
        require(
            s.defaultFeeBps <= factory.MAX_FEE_BPS(),
            "DeployV7Script: DEPLOY_V7_DEFAULT_FEE_BPS is above MAX_FEE_BPS"
        );
        require(
            s.minFeeAmount <= factory.MAX_MIN_FEE_AMOUNT(),
            "DeployV7Script: DEPLOY_V7_MIN_FEE_AMOUNT is above MAX_MIN_FEE_AMOUNT"
        );
        require(
            s.minFeePerReceiver <= factory.MAX_MIN_FEE_PER_RECEIVER(),
            "DeployV7Script: DEPLOY_V7_MIN_FEE_PER_RECEIVER is above MAX_MIN_FEE_PER_RECEIVER"
        );
        require(
            s.maxFeeAmount <= factory.MAX_NATIVE_FEE(),
            "DeployV7Script: DEPLOY_V7_MAX_FEE_AMOUNT is above MAX_NATIVE_FEE"
        );

        d.timelock = address(timelock);
        d.registry = address(registry);
        d.implementation = address(implementation);
        d.factory = address(factory);
        d.deployer = broadcaster;
        d.safe = s.safe;
        d.guardian = s.guardian;
        d.binder = s.binder;
        d.allowedCreator = s.allowedCreator;
        d.feeRecipient = s.feeRecipient;
        d.defaultFeeBps = s.defaultFeeBps;
        d.minFeeAmount = s.minFeeAmount;
        d.minFeePerReceiver = s.minFeePerReceiver;
        d.maxFeeAmount = s.maxFeeAmount;
        d.allowedTokens = s.allowedTokens;
        d.batchSalt = s.batchSalt;
        d.blockNumber = block.number;
        d.timestamp = block.timestamp;
        d.chainId = block.chainid;

        _checkDeployment(d);

        Batch memory b = batchOf(d);
        _log(d, b, broadcast);
        _writeDeployment(d, broadcast);
        _writeBatch(d, b, broadcast);
    }

    /// @dev before anything is deployed.
    function _checkSettings(Settings memory s) private view {
        require(s.safe != address(0), "DeployV7Script: DEPLOY_V7_SAFE is not set");
        require(s.safe.code.length > 0, "DeployV7Script: DEPLOY_V7_SAFE has no code on this chain");
        require(s.guardian != address(0), "DeployV7Script: DEPLOY_V7_GUARDIAN is not set");
        require(s.binder != address(0), "DeployV7Script: DEPLOY_V7_BINDER is not set");
        require(s.allowedCreator != address(0), "DeployV7Script: DEPLOY_V7_ALLOWED_CREATOR is not set");
        require(s.feeRecipient != address(0), "DeployV7Script: DEPLOY_V7_FEE_RECIPIENT is not set");
        // The binder is its own key, never the relayer and never the guardian.
        require(s.binder != s.allowedCreator, "DeployV7Script: the binder is the relayer");
        require(s.binder != s.guardian, "DeployV7Script: the binder is the guardian");
    }

    /// @dev after the deploy. Each line is a property the batch and the Safe rely on.
    function _checkDeployment(Deployment memory d) private view {
        TimelockController t = TimelockController(payable(d.timelock));
        BinderRegistryV2 registry = BinderRegistryV2(d.registry);
        DropFactoryV7 factory = DropFactoryV7(d.factory);

        require(registry.owner() == d.timelock, "DeployV7Script: the registry owner is not the timelock");
        require(registry.pendingOwner() == address(0), "DeployV7Script: the registry has a pending owner");
        require(factory.owner() == d.timelock, "DeployV7Script: the factory owner is not the timelock");
        require(factory.pendingOwner() == address(0), "DeployV7Script: the factory has a pending owner");
        require(t.getMinDelay() == TIMELOCK_DELAY, "DeployV7Script: the timelock delay is not 48 hours");

        require(t.hasRole(t.PROPOSER_ROLE(), d.safe), "DeployV7Script: the Safe is not a proposer");
        require(t.hasRole(t.CANCELLER_ROLE(), d.safe), "DeployV7Script: the Safe is not a canceller");
        require(t.hasRole(t.EXECUTOR_ROLE(), d.safe), "DeployV7Script: the Safe is not an executor");
        require(!t.hasRole(t.EXECUTOR_ROLE(), address(0)), "DeployV7Script: the timelock has an open executor");
        require(!t.hasRole(t.DEFAULT_ADMIN_ROLE(), d.safe), "DeployV7Script: the Safe is a timelock admin");

        require(!t.hasRole(t.DEFAULT_ADMIN_ROLE(), d.deployer), "DeployV7Script: the deployer is a timelock admin");
        require(!t.hasRole(t.PROPOSER_ROLE(), d.deployer), "DeployV7Script: the deployer is a proposer");
        require(!t.hasRole(t.CANCELLER_ROLE(), d.deployer), "DeployV7Script: the deployer is a canceller");
        require(!t.hasRole(t.EXECUTOR_ROLE(), d.deployer), "DeployV7Script: the deployer is an executor");

        require(factory.implementation() == d.implementation, "DeployV7Script: the factory clones the wrong DropV7");
        require(
            address(DropV7(payable(d.implementation)).BINDER_REGISTRY()) == d.registry,
            "DeployV7Script: DropV7 reads the wrong registry"
        );
        require(
            DropV7(payable(d.implementation)).MAX_BINDING_LIFETIME() == 3600,
            "DeployV7Script: DropV7 has the wrong binding lifetime"
        );
    }

    /// @dev forge sets the context. A resumed broadcast sends too, so it is refused as well.
    function _isBroadcast() internal view virtual returns (bool) {
        return vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
    }

    // -----------------------------------------------------------------------
    // the batch
    // -----------------------------------------------------------------------

    /// @notice The setup calls, in the order. Every value is zero, no predecessor.
    function batchOf(Deployment memory d) public pure returns (Batch memory b) {
        uint256 n = 4 + d.allowedTokens.length;
        if (d.defaultFeeBps != 0) n++;
        if (d.minFeeAmount != 0) n++;
        if (d.minFeePerReceiver != 0) n++;
        if (d.maxFeeAmount != 0) n++;

        b.targets = new address[](n);
        b.values = new uint256[](n);
        b.payloads = new bytes[](n);
        b.salt = d.batchSalt;

        uint256 i = 0;
        i = _put(b, i, d.registry, abi.encodeCall(BinderRegistryV2.setBinder, (d.binder)));
        i = _put(b, i, d.registry, abi.encodeCall(BinderRegistryV2.setGuardian, (d.guardian)));
        i = _put(b, i, d.factory, abi.encodeCall(DropFactoryV7.setPauseGuardian, (d.guardian)));
        i = _put(b, i, d.factory, abi.encodeCall(DropFactoryV7.setCreatorAllowed, (d.allowedCreator, true)));
        if (d.defaultFeeBps != 0) {
            i = _put(b, i, d.factory, abi.encodeCall(DropFactoryV7.setDefaultFeeBps, (d.defaultFeeBps)));
        }
        if (d.minFeeAmount != 0) {
            i = _put(b, i, d.factory, abi.encodeCall(DropFactoryV7.setMinFeeAmount, (d.minFeeAmount)));
        }
        if (d.minFeePerReceiver != 0) {
            i = _put(b, i, d.factory, abi.encodeCall(DropFactoryV7.setMinFeePerReceiver, (d.minFeePerReceiver)));
        }
        if (d.maxFeeAmount != 0) {
            i = _put(b, i, d.factory, abi.encodeCall(DropFactoryV7.setMaxFeeAmount, (d.maxFeeAmount)));
        }
        // Only addresses whose source is read and written.
        for (uint256 k = 0; k < d.allowedTokens.length; k++) {
            i = _put(b, i, d.factory, abi.encodeCall(DropFactoryV7.setTokenAllowed, (d.allowedTokens[k], true)));
        }
    }

    /// @notice The unpause: `setPaused(false)` on the factory, value 0, the batch
    ///         salt, its predecessor the setup batch, so it can run only after the batch. The id
    ///         is the timelock's own hash, never computed here.
    function unpauseOf(Deployment memory d) public view returns (Unpause memory u) {
        Batch memory b = batchOf(d);
        u.target = d.factory;
        u.payload = abi.encodeCall(DropFactoryV7.setPaused, (false));
        u.predecessor = TimelockController(payable(d.timelock))
            .hashOperationBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt);
        u.salt = b.salt;
    }

    /// @dev Reads the chain id only, never a chain list.
    function _broadcastChainAllowed(uint256 id) internal pure virtual returns (bool) {
        return id == 4663 || id == 46_630;
    }

    function _put(Batch memory b, uint256 i, address target, bytes memory payload) private pure returns (uint256) {
        b.targets[i] = target;
        b.payloads[i] = payload;
        return i + 1;
    }

    // -----------------------------------------------------------------------
    // output
    // -----------------------------------------------------------------------

    function _log(Deployment memory d, Batch memory b, bool broadcast) private pure {
        if (broadcast) console2.log("--- dropchad V7 deploy, BROADCAST ---");
        else console2.log("--- dropchad V7 deploy, DRY RUN, nothing is sent ---");
        console2.log("chainId              ", d.chainId);
        console2.log("block                ", d.blockNumber);
        console2.log("deployer             ", d.deployer);
        console2.log("timelock (48 hours)  ", d.timelock);
        console2.log("registry             ", d.registry);
        console2.log("implementation       ", d.implementation);
        console2.log("factory              ", d.factory);
        console2.log("safe                 ", d.safe);
        console2.log("guardian             ", d.guardian);
        console2.log("binder               ", d.binder);
        console2.log("allowedCreator       ", d.allowedCreator);
        console2.log("feeRecipient         ", d.feeRecipient);
        console2.log("defaultFeeBps        ", d.defaultFeeBps);
        console2.log("minFeeAmount         ", d.minFeeAmount);
        console2.log("minFeePerReceiver    ", d.minFeePerReceiver);
        console2.log("maxFeeAmount         ", d.maxFeeAmount);
        for (uint256 i = 0; i < d.allowedTokens.length; i++) {
            console2.log("allowedToken         ", d.allowedTokens[i]);
        }
        console2.log("batch calls          ", b.targets.length);

        console2.log("");
        console2.log("NOTE: no admin call was made. Until the Safe runs the batch no creator is");
        console2.log("      allowed, so no drop can be made. The Safe sends scheduleCalldata to the");
        console2.log("      timelock, waits 48 hours, then sends executeCalldata.");
        console2.log("NOTE: the Safe also sends unpause.scheduleCalldata at the same time. After the");
        console2.log("      batch and the guardian pause it sends unpause.executeCalldata; if the pause");
        console2.log("      test does not run, it cancels the unpause.");
        console2.log("WARNING: `block` is the L1 block on Arbitrum Nitro.");
    }

    /// @dev Addresses, numbers and the block only. Never a key, never an RPC URL.
    function _writeDeployment(Deployment memory d, bool broadcast) private {
        string memory obj = "dropchad-deployment-v7";

        string memory out = vm.serializeUint(obj, "chainId", d.chainId);
        out = vm.serializeAddress(obj, "timelock", d.timelock);
        out = vm.serializeUint(obj, "timelockDelay", TIMELOCK_DELAY);
        out = vm.serializeAddress(obj, "registry", d.registry);
        out = vm.serializeAddress(obj, "implementation", d.implementation);
        out = vm.serializeAddress(obj, "factory", d.factory);
        out = vm.serializeAddress(obj, "deployer", d.deployer);
        out = vm.serializeAddress(obj, "safe", d.safe);
        out = vm.serializeAddress(obj, "guardian", d.guardian);
        out = vm.serializeAddress(obj, "binder", d.binder);
        out = vm.serializeAddress(obj, "allowedCreator", d.allowedCreator);
        out = vm.serializeAddress(obj, "feeRecipient", d.feeRecipient);
        out = vm.serializeUint(obj, "defaultFeeBps", d.defaultFeeBps);
        out = vm.serializeUint(obj, "minFeeAmount", d.minFeeAmount);
        out = vm.serializeUint(obj, "minFeePerReceiver", d.minFeePerReceiver);
        out = vm.serializeUint(obj, "maxFeeAmount", d.maxFeeAmount);
        out = vm.serializeAddress(obj, "allowedTokens", d.allowedTokens);
        out = vm.serializeUint(obj, "block", d.blockNumber);
        out = vm.serializeUint(obj, "timestamp", d.timestamp);

        vm.writeJson(out, outputPath(d.chainId, broadcast));
        console2.log("wrote", outputPath(d.chainId, broadcast));
    }

    /// @dev The batch, its id and the two Safe transactions, ready to send as they are, and the
    ///      unpause operation of  under `unpause`.
    function _writeBatch(Deployment memory d, Batch memory b, bool broadcast) private {
        TimelockController t = TimelockController(payable(d.timelock));
        string memory obj = "dropchad-batch-v7";

        string memory out = vm.serializeUint(obj, "chainId", d.chainId);
        out = vm.serializeAddress(obj, "timelock", d.timelock);
        out = vm.serializeUint(obj, "delay", TIMELOCK_DELAY);
        out = vm.serializeAddress(obj, "targets", b.targets);
        out = vm.serializeUint(obj, "values", b.values);
        out = vm.serializeBytes(obj, "payloads", b.payloads);
        out = vm.serializeBytes32(obj, "predecessor", b.predecessor);
        out = vm.serializeBytes32(obj, "salt", b.salt);
        out = vm.serializeBytes32(
            obj, "id", t.hashOperationBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt)
        );
        out = vm.serializeBytes(
            obj,
            "scheduleCalldata",
            abi.encodeCall(
                TimelockController.scheduleBatch,
                (b.targets, b.values, b.payloads, b.predecessor, b.salt, TIMELOCK_DELAY)
            )
        );
        out = vm.serializeBytes(
            obj,
            "executeCalldata",
            abi.encodeCall(TimelockController.executeBatch, (b.targets, b.values, b.payloads, b.predecessor, b.salt))
        );
        out = vm.serializeString(obj, "unpause", _unpauseJson(t, unpauseOf(d)));

        vm.writeJson(out, batchPath(d.chainId, broadcast));
        console2.log("wrote", batchPath(d.chainId, broadcast));
    }

    function _unpauseJson(TimelockController t, Unpause memory u) private returns (string memory out) {
        string memory obj = "dropchad-batch-v7-unpause";
        out = vm.serializeAddress(obj, "target", u.target);
        out = vm.serializeUint(obj, "value", u.value);
        out = vm.serializeBytes(obj, "payload", u.payload);
        out = vm.serializeBytes32(obj, "predecessor", u.predecessor);
        out = vm.serializeBytes32(obj, "salt", u.salt);
        out = vm.serializeBytes32(obj, "id", t.hashOperation(u.target, u.value, u.payload, u.predecessor, u.salt));
        out = vm.serializeBytes(
            obj,
            "scheduleCalldata",
            abi.encodeCall(
                TimelockController.schedule, (u.target, u.value, u.payload, u.predecessor, u.salt, TIMELOCK_DELAY)
            )
        );
        out = vm.serializeBytes(
            obj,
            "executeCalldata",
            abi.encodeCall(TimelockController.execute, (u.target, u.value, u.payload, u.predecessor, u.salt))
        );
    }

    /// @notice Where the V7 record for a chain lives. A broadcast on 46630 is the
    ///         rehearsal and never takes the name of the testnet record `46630-v7.json`.
    function outputPath(uint256 chainId, bool broadcast) public pure returns (string memory) {
        return string.concat("deployments/", vm.toString(chainId), _suffix(chainId, broadcast, ""));
    }

    /// @notice Where the V7 setup batch for a chain lives.
    function batchPath(uint256 chainId, bool broadcast) public pure returns (string memory) {
        return string.concat("deployments/", vm.toString(chainId), _suffix(chainId, broadcast, "-batch"));
    }

    /// @dev `-v7-dryrun.json`, `-v7-batch-dryrun.json`; a broadcast `-v7.json`, `-v7-batch.json`;
    ///      on 46630 `-v7-rehearsal.json`, `-v7-rehearsal-batch.json`.
    function _suffix(uint256 chainId, bool broadcast, string memory kind) private pure returns (string memory) {
        if (!broadcast) return string.concat("-v7", kind, "-dryrun.json");
        if (chainId == 46_630) return string.concat("-v7-rehearsal", kind, ".json");
        return string.concat("-v7", kind, ".json");
    }
}
