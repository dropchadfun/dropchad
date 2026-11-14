/**
 * The binder keys, parsed once and then only able to sign a binding.
 * and 7.
 *
 * One role, two keys: a secp256k1 key for the EVM, an ed25519 key for Solana. Each is optional;
 * without it that chain answers `503 binder_not_configured` to a bind, and nothing else changes.
 *
 * What this refuses, at start:
 * - a key that does not derive to its stated address, the same guard as the relayer's
 * - **the relayer key as the binder key**. Two keys, two powers, two rotations
 *
 * The keys live inside closures. Nothing here returns, logs or stores them, and every error
 * message names the variable, never any part of the value.
 */
import {
  bindingTypedData,
  bindingTypedDataV2,
  base58Encode,
  svmBindingMessage,
  svmBindingMessageV2,
  type EvmBindingArgs,
  type EvmBindingArgsV2,
  type SvmBindingArgs,
  type SvmBindingArgsV2,
} from "@dropchad/shared";
import { getAddress, type Address, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { signerFromSecret, type Signer } from "../chain/svm/keypair.js";
import type { Config } from "../config.js";

export interface EvmBinder {
  readonly address: Address;
  /** The EIP 712 signature, 65 bytes. */
  sign(args: EvmBindingArgs): Promise<Hex>;
  /** Binding v2: the same key over the v2 typed data with `validUntil`. */
  signV2(args: EvmBindingArgsV2): Promise<Hex>;
}

export interface SvmBinder {
  /** Base58. */
  readonly publicKey: string;
  /** The raw ed25519 signature over the message, 64 bytes. */
  sign(args: SvmBindingArgs): Promise<Uint8Array>;
  /** Binding v2: the same key over the 200 byte v2 message. */
  signV2(args: SvmBindingArgsV2): Promise<Uint8Array>;
}

export interface Binders {
  readonly evm?: EvmBinder;
  readonly svm?: SvmBinder;
}

export class BinderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinderConfigError";
  }
}

export function buildBinders(config: Config): Binders {
  return { ...evmBinder(config), ...svmBinder(config) };
}

function evmBinder(config: Config): { evm?: EvmBinder } {
  if (config.BINDER_EVM_PRIVATE_KEY === undefined) return {};
  const account = privateKeyToAccount(config.BINDER_EVM_PRIVATE_KEY as Hex);

  if (
    config.BINDER_EVM_ADDRESS !== undefined &&
    getAddress(config.BINDER_EVM_ADDRESS) !== account.address
  ) {
    throw new BinderConfigError(
      `BINDER_EVM_PRIVATE_KEY belongs to ${account.address}, but BINDER_EVM_ADDRESS says ` +
        `${getAddress(config.BINDER_EVM_ADDRESS)}. Refusing to start.`,
    );
  }
  const relayer =
    config.RELAYER_PRIVATE_KEY !== undefined
      ? privateKeyToAccount(config.RELAYER_PRIVATE_KEY as Hex).address
      : config.RELAYER_ADDRESS !== undefined
        ? getAddress(config.RELAYER_ADDRESS)
        : undefined;
  if (relayer === account.address) {
    throw new BinderConfigError(
      "BINDER_EVM_PRIVATE_KEY is the relayer key. The binder is its own key.",
    );
  }

  return { evm: evmBinderFromAccount(account) };
}

/**
 * The EVM binder over any account: the raw key one above, or a KMS account
 * It signs the binding and nothing else.
 */
export function evmBinderFromAccount(account: LocalAccount): EvmBinder {
  return {
    address: account.address,
    sign: (args) => account.signTypedData(bindingTypedData(args)),
    signV2: (args) => account.signTypedData(bindingTypedDataV2(args)),
  };
}

function svmBinder(config: Config): { svm?: SvmBinder } {
  if (config.BINDER_SOLANA_SECRET === undefined) return {};
  const signer = signerFromSecret(config.BINDER_SOLANA_SECRET, "BINDER_SOLANA_SECRET");
  const publicKey = base58Encode(signer.publicKey);

  if (config.BINDER_SOLANA_ADDRESS !== undefined && config.BINDER_SOLANA_ADDRESS !== publicKey) {
    throw new BinderConfigError(
      `BINDER_SOLANA_SECRET belongs to ${publicKey}, but BINDER_SOLANA_ADDRESS says ` +
        `${config.BINDER_SOLANA_ADDRESS}. Refusing to start.`,
    );
  }
  const relayer =
    config.SOLANA_RELAYER_SECRET !== undefined
      ? base58Encode(signerFromSecret(config.SOLANA_RELAYER_SECRET).publicKey)
      : config.SOLANA_RELAYER_ADDRESS;
  if (relayer === publicKey) {
    throw new BinderConfigError(
      "BINDER_SOLANA_SECRET is the relayer key. The binder is its own key.",
    );
  }

  return { svm: svmBinderFromSigner(signer) };
}

/**
 * The Solana binder over any signer: the raw key one above, or a KMS signer
 * It signs the message and nothing else.
 */
export function svmBinderFromSigner(signer: Signer): SvmBinder {
  return {
    publicKey: base58Encode(signer.publicKey),
    sign: (args) => signer.sign(svmBindingMessage(args)),
    signV2: (args) => signer.sign(svmBindingMessageV2(args)),
  };
}
