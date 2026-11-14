// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {DropFactoryV4} from "../src/DropFactoryV4.sol";
import {DropV3} from "../src/DropV3.sol";

/// @title DeployV4Script
/// @notice Deploys `DropFactoryV4`, the fee on Robinhood, cloning the **live** `DropV3`
///         implementation.
/// @dev **No private key appears in this file, and none ever will.** The deployer signs with a forge
///      keystore account, `--account <name>`.
///      Run it without `--broadcast` first: forge then only simulates.
///      The `DropV3` implementation is **reused, never redeployed**: V4 drops are clones
///      of the same code as V3 drops, and it reads the live `BinderRegistry`. It deploys the
///      factory only. It does **not** pause `DropFactoryV3`: that stops the live server's drop
///      creation, so it is `PauseFactory.s.sol`, run later inside the switch-over window. The
///      older `deployments/<chainid>*.json` files are not touched; this run writes
///      `deployments/<chainid>-v4.json`.
///      | env | unset means | goes to |
///      |---|---|---|
///      | `DEPLOY_DROP_IMPLEMENTATION`  | **refused** | factory `implementation_`, the live `DropV3` |
///      | `DEPLOY_ADMIN`                | deployer    | owner of the factory, the timelock on mainnet |
///      | `DEPLOY_FEE_RECIPIENT`        | deployer    | factory `feeRecipient_` |
///      | `DEPLOY_ALLOWED_CREATOR`      | deployer    | `setCreatorAllowed(..., true)`, the relayer |
///      | `DEPLOY_DEFAULT_FEE_BPS`      | `0`         | `setDefaultFeeBps`, only called when non zero |
///      | `DEPLOY_MIN_FEE_AMOUNT`       | `0`         | `setMinFeeAmount` in wei, only called when non zero |
///      | `DEPLOY_MIN_FEE_PER_RECEIVER` | `0`         | `setMinFeePerReceiver` in wei, only called when non zero |
///      | `DEPLOY_MAX_FEE_AMOUNT`       | `0`         | `setMaxFeeAmount` in wei, only called when non zero |
///      | `DEPLOY_ALLOWED_TOKENS`       | none        | `setTokenAllowed(..., true)` for each, comma separated |
///      The admin calls are `onlyOwner`. When the admin is not the deployer, the mainnet shape,
///      the script makes none of them and logs what the admin still has to do.
contract DeployV4Script is Script {
    /// @notice The settings. See the table above for what zero means.
    struct Settings {
        address dropImplementation;
        address admin;
        address feeRecipient;
        address allowedCreator;
        uint16 defaultFeeBps;
        uint256 minFeeAmount;
        uint256 minFeePerReceiver;
        uint256 maxFeeAmount;
        address[] allowedTokens;
    }

    /// @notice What the run produced.
    struct Deployment {
        address registry;
        address implementation;
        address factory;
        address deployer;
        address admin;
        address feeRecipient;
        address allowedCreator;
        uint16 defaultFeeBps;
        uint256 minFeeAmount;
        uint256 minFeePerReceiver;
        uint256 maxFeeAmount;
        address[] allowedTokens;
        /// @dev **The L1 block on Arbitrum Nitro**, as in `Deploy.s.sol`. Correct it from the receipt.
        uint256 blockNumber;
        uint256 timestamp;
        uint256 chainId;
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
        s.dropImplementation = vm.envOr("DEPLOY_DROP_IMPLEMENTATION", address(0));
        s.admin = vm.envOr("DEPLOY_ADMIN", address(0));
        s.feeRecipient = vm.envOr("DEPLOY_FEE_RECIPIENT", address(0));
        s.allowedCreator = vm.envOr("DEPLOY_ALLOWED_CREATOR", address(0));

        uint256 feeBps = vm.envOr("DEPLOY_DEFAULT_FEE_BPS", uint256(0));
        // Checked against `MAX_FEE_BPS` in `_run`. This only keeps the cast from truncating.
        require(feeBps <= type(uint16).max, "DeployV4Script: DEPLOY_DEFAULT_FEE_BPS does not fit uint16");
        // forge-lint: disable-next-line(unsafe-typecast)
        s.defaultFeeBps = uint16(feeBps);

        s.minFeeAmount = vm.envOr("DEPLOY_MIN_FEE_AMOUNT", uint256(0));
        s.minFeePerReceiver = vm.envOr("DEPLOY_MIN_FEE_PER_RECEIVER", uint256(0));
        s.maxFeeAmount = vm.envOr("DEPLOY_MAX_FEE_AMOUNT", uint256(0));
        s.allowedTokens = vm.envOr("DEPLOY_ALLOWED_TOKENS", ",", new address[](0));
    }

    // -----------------------------------------------------------------------
    // the deploy itself
    // -----------------------------------------------------------------------

    function _run(Settings memory s) private returns (Deployment memory d) {
        // The live DropV3, never a new one: V4 drops are the same code as V3 drops.
        require(
            s.dropImplementation != address(0),
            "DeployV4Script: DEPLOY_DROP_IMPLEMENTATION is not set, use the live DropV3"
        );
        require(
            s.dropImplementation.code.length > 0, "DeployV4Script: DEPLOY_DROP_IMPLEMENTATION has no code on this chain"
        );
        // A `DropV3` answers this; anything else reverts here, before anything is sent.
        address registry = address(DropV3(payable(s.dropImplementation)).BINDER_REGISTRY());

        vm.startBroadcast();

        // The broadcast sender. See `Deploy.s.sol` for why this is not `msg.sender`.
        // forge-lint: disable-next-line(unused-return)
        (, address broadcaster,) = vm.readCallers();

        d.deployer = broadcaster;
        d.admin = s.admin == address(0) ? broadcaster : s.admin;
        d.feeRecipient = s.feeRecipient == address(0) ? broadcaster : s.feeRecipient;
        d.allowedCreator = s.allowedCreator == address(0) ? broadcaster : s.allowedCreator;

        DropFactoryV4 factory = new DropFactoryV4(d.admin, s.dropImplementation, d.feeRecipient);

        // The caps are the new factory's own constants, never retyped here. forge simulates the
        // whole script before it broadcasts anything, so a revert here sends nothing at all.
        require(
            s.defaultFeeBps <= factory.MAX_FEE_BPS(),
            "DeployV4Script: DEPLOY_DEFAULT_FEE_BPS is above MAX_FEE_BPS"
        );
        require(
            s.minFeeAmount <= factory.MAX_MIN_FEE_AMOUNT(),
            "DeployV4Script: DEPLOY_MIN_FEE_AMOUNT is above MAX_MIN_FEE_AMOUNT"
        );
        require(
            s.minFeePerReceiver <= factory.MAX_MIN_FEE_PER_RECEIVER(),
            "DeployV4Script: DEPLOY_MIN_FEE_PER_RECEIVER is above MAX_MIN_FEE_PER_RECEIVER"
        );
        require(
            s.maxFeeAmount <= factory.MAX_NATIVE_FEE(),
            "DeployV4Script: DEPLOY_MAX_FEE_AMOUNT is above MAX_NATIVE_FEE"
        );

        // `onlyOwner`. Only reachable in the testnet shape.
        if (d.admin == d.deployer) {
            factory.setCreatorAllowed(d.allowedCreator, true);
            if (s.defaultFeeBps != 0) factory.setDefaultFeeBps(s.defaultFeeBps);
            if (s.minFeeAmount != 0) factory.setMinFeeAmount(s.minFeeAmount);
            if (s.minFeePerReceiver != 0) factory.setMinFeePerReceiver(s.minFeePerReceiver);
            if (s.maxFeeAmount != 0) factory.setMaxFeeAmount(s.maxFeeAmount);
            // Only addresses whose source is read and written.
            for (uint256 i = 0; i < s.allowedTokens.length; i++) {
                factory.setTokenAllowed(s.allowedTokens[i], true);
            }

            d.defaultFeeBps = s.defaultFeeBps;
            d.minFeeAmount = s.minFeeAmount;
            d.minFeePerReceiver = s.minFeePerReceiver;
            d.maxFeeAmount = s.maxFeeAmount;
            d.allowedTokens = s.allowedTokens;
        }

        vm.stopBroadcast();

        d.registry = registry;
        d.implementation = s.dropImplementation;
        d.factory = address(factory);
        d.blockNumber = block.number;
        d.timestamp = block.timestamp;
        d.chainId = block.chainid;

        _log(d, s);
        _writeJson(d);
    }

    // -----------------------------------------------------------------------
    // output
    // -----------------------------------------------------------------------

    function _log(Deployment memory d, Settings memory s) private pure {
        console2.log("--- dropchad V4 deploy, the fee on Robinhood ---");
        console2.log("chainId              ", d.chainId);
        console2.log("block                ", d.blockNumber);
        console2.log("deployer             ", d.deployer);
        console2.log("registry (live)      ", d.registry);
        console2.log("implementation (live)", d.implementation);
        console2.log("factory              ", d.factory);
        console2.log("admin (owner)        ", d.admin);
        console2.log("feeRecipient         ", d.feeRecipient);
        console2.log("allowedCreator       ", d.allowedCreator);
        console2.log("defaultFeeBps        ", d.defaultFeeBps);
        console2.log("minFeeAmount         ", d.minFeeAmount);
        console2.log("minFeePerReceiver    ", d.minFeePerReceiver);
        console2.log("maxFeeAmount         ", d.maxFeeAmount);
        for (uint256 i = 0; i < d.allowedTokens.length; i++) {
            console2.log("allowedToken         ", d.allowedTokens[i]);
        }

        console2.log("");
        console2.log("WARNING: `block` is the L1 block on Arbitrum Nitro. Read the L2 block from");
        console2.log("         the receipt and correct deployments/<chainid>-v4.json.");
        console2.log("NOT DONE HERE: DropFactoryV3 is still open. Pause it with PauseFactory.s.sol");
        console2.log("         (DROP_FACTORY = the V3 factory) inside the switch-over window.");

        if (d.admin != d.deployer) {
            console2.log("");
            console2.log("NOTE: admin is not the deployer, so no admin call was made. The admin must");
            console2.log("      call setCreatorAllowed, and as wanted setDefaultFeeBps, setMinFeeAmount,");
            console2.log("      setMinFeePerReceiver, setMaxFeeAmount and setTokenAllowed for each token.");
            if (s.allowedTokens.length > 0) {
                console2.log("      Tokens asked for and NOT allowed:", s.allowedTokens.length);
            }
        }
    }

    /// @dev Addresses, numbers and the block only. Never a key, never an RPC URL.
    function _writeJson(Deployment memory d) private {
        string memory obj = "dropchad-deployment-v4";

        string memory out = vm.serializeUint(obj, "chainId", d.chainId);
        out = vm.serializeAddress(obj, "registry", d.registry);
        out = vm.serializeAddress(obj, "implementation", d.implementation);
        out = vm.serializeAddress(obj, "factory", d.factory);
        out = vm.serializeAddress(obj, "deployer", d.deployer);
        out = vm.serializeAddress(obj, "admin", d.admin);
        out = vm.serializeAddress(obj, "feeRecipient", d.feeRecipient);
        out = vm.serializeAddress(obj, "allowedCreator", d.allowedCreator);
        out = vm.serializeUint(obj, "defaultFeeBps", d.defaultFeeBps);
        out = vm.serializeUint(obj, "minFeeAmount", d.minFeeAmount);
        out = vm.serializeUint(obj, "minFeePerReceiver", d.minFeePerReceiver);
        out = vm.serializeUint(obj, "maxFeeAmount", d.maxFeeAmount);
        out = vm.serializeAddress(obj, "allowedTokens", d.allowedTokens);
        out = vm.serializeUint(obj, "block", d.blockNumber);
        out = vm.serializeUint(obj, "timestamp", d.timestamp);

        vm.writeJson(out, outputPath(d.chainId));
        console2.log("wrote", outputPath(d.chainId));
    }

    /// @notice Where the V4 record for a chain lives. Never an older file.
    function outputPath(uint256 chainId) public pure returns (string memory) {
        return string.concat("deployments/", vm.toString(chainId), "-v4.json");
    }
}
