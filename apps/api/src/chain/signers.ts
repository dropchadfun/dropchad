/**
 * The four signers at start: the EVM relayer, the Solana
 * relayer and the two binders, each from its KMS key id or, on a testnet, its raw key. The config
 * already refused a raw key on a mainnet chain and both sources for one role.
 *
 * What this refuses, at start:
 * - a key that is not the one its `*_ADDRESS` names
 * - a KMS key with the wrong spec or usage (`KmsKeyError`)
 * - a binder that is the relayer, whatever the source of each. Two keys, two powers
 *
 * A KMS key that cannot be read only turns that role off, with the env name in `notes`, as a
 * missing RPC does. Nothing here logs, returns or stores key material; a KMS error is named by
 * its type only.
 */
import { base58Encode } from "@dropchad/shared";
import { getAddress, type Address, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { evmBinderFromAccount, svmBinderFromSigner, type Binders } from "../binder/binders.js";
import type { Config } from "../config.js";
import { kmsEvmAccount } from "./evm/kms-account.js";
import { KmsKeyError, type KmsClient } from "./kms.js";
import { signerFromSecret, type Signer } from "./svm/keypair.js";
import { kmsSolanaSigner } from "./svm/kms-signer.js";

export class SignerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignerConfigError";
  }
}

export interface ResolvedSigners {
  readonly evmRelayer?: LocalAccount;
  readonly svmRelayer?: Signer;
  readonly binders: Binders;
  /** One line per role that is off because its KMS key could not be read. */
  readonly notes: readonly string[];
}

/** The error's type, never its message: a KMS message may carry an account id. */
function kindOf(error: unknown): string {
  return error instanceof Error ? error.name : "unknown error";
}

export async function resolveSigners(
  config: Config,
  kms: KmsClient | null,
): Promise<ResolvedSigners> {
  const keyIds = [
    config.RELAYER_KMS_KEY_ID,
    config.BINDER_EVM_KMS_KEY_ID,
    config.SOLANA_RELAYER_KMS_KEY_ID,
    config.BINDER_SOLANA_KMS_KEY_ID,
  ];
  if (kms === null && keyIds.some((id) => id !== undefined)) {
    throw new SignerConfigError("a *_KMS_KEY_ID is set, but no KMS client was built");
  }
  const notes: string[] = [];

  /** A KMS read: a wrong key stops the start, an unreachable KMS turns the role off. */
  async function fromKms<T>(
    name: string,
    keyId: string,
    build: (client: KmsClient, id: string) => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await build(kms as KmsClient, keyId);
    } catch (error) {
      if (error instanceof KmsKeyError) throw error;
      notes.push(`${name}: KMS not readable (${kindOf(error)}), this role is off`);
      return undefined;
    }
  }

  function sameEvm(name: string, source: string, stated: string | undefined, actual: Address) {
    if (stated !== undefined && getAddress(stated) !== actual) {
      throw new SignerConfigError(
        `${source} belongs to ${actual}, but ${name} says ${getAddress(stated)}. Refusing to start.`,
      );
    }
  }

  function sameSvm(name: string, source: string, stated: string | undefined, actual: string) {
    if (stated !== undefined && stated !== actual) {
      throw new SignerConfigError(
        `${source} belongs to ${actual}, but ${name} says ${stated}. Refusing to start.`,
      );
    }
  }

  // --- the EVM relayer ----------------------------------------------------------------------
  let evmRelayer: LocalAccount | undefined;
  if (config.RELAYER_KMS_KEY_ID !== undefined) {
    evmRelayer = await fromKms("RELAYER_KMS_KEY_ID", config.RELAYER_KMS_KEY_ID, kmsEvmAccount);
  } else if (config.RELAYER_PRIVATE_KEY !== undefined) {
    evmRelayer = privateKeyToAccount(config.RELAYER_PRIVATE_KEY as Hex);
  }
  if (evmRelayer !== undefined) {
    const source = config.RELAYER_KMS_KEY_ID ? "RELAYER_KMS_KEY_ID" : "RELAYER_PRIVATE_KEY";
    sameEvm("RELAYER_ADDRESS", source, config.RELAYER_ADDRESS, evmRelayer.address);
  }

  // --- the Solana relayer -------------------------------------------------------------------
  let svmRelayer: Signer | undefined;
  if (config.SOLANA_RELAYER_KMS_KEY_ID !== undefined) {
    svmRelayer = await fromKms(
      "SOLANA_RELAYER_KMS_KEY_ID",
      config.SOLANA_RELAYER_KMS_KEY_ID,
      kmsSolanaSigner,
    );
  } else if (config.SOLANA_RELAYER_SECRET !== undefined) {
    svmRelayer = signerFromSecret(config.SOLANA_RELAYER_SECRET);
  }
  if (svmRelayer !== undefined) {
    const source = config.SOLANA_RELAYER_KMS_KEY_ID
      ? "SOLANA_RELAYER_KMS_KEY_ID"
      : "SOLANA_RELAYER_SECRET";
    sameSvm(
      "SOLANA_RELAYER_ADDRESS",
      source,
      config.SOLANA_RELAYER_ADDRESS,
      base58Encode(svmRelayer.publicKey),
    );
  }

  // --- the EVM binder -----------------------------------------------------------------------
  let evmBinder: LocalAccount | undefined;
  if (config.BINDER_EVM_KMS_KEY_ID !== undefined) {
    evmBinder = await fromKms("BINDER_EVM_KMS_KEY_ID", config.BINDER_EVM_KMS_KEY_ID, kmsEvmAccount);
  } else if (config.BINDER_EVM_PRIVATE_KEY !== undefined) {
    evmBinder = privateKeyToAccount(config.BINDER_EVM_PRIVATE_KEY as Hex);
  }
  if (evmBinder !== undefined) {
    const source = config.BINDER_EVM_KMS_KEY_ID
      ? "BINDER_EVM_KMS_KEY_ID"
      : "BINDER_EVM_PRIVATE_KEY";
    sameEvm("BINDER_EVM_ADDRESS", source, config.BINDER_EVM_ADDRESS, evmBinder.address);
    const relayer =
      evmRelayer?.address ??
      (config.RELAYER_ADDRESS === undefined ? undefined : getAddress(config.RELAYER_ADDRESS));
    if (relayer === evmBinder.address) {
      throw new SignerConfigError(`${source} is the relayer key. The binder is its own key.`);
    }
  }

  // --- the Solana binder --------------------------------------------------------------------
  let svmBinder: Signer | undefined;
  if (config.BINDER_SOLANA_KMS_KEY_ID !== undefined) {
    svmBinder = await fromKms(
      "BINDER_SOLANA_KMS_KEY_ID",
      config.BINDER_SOLANA_KMS_KEY_ID,
      kmsSolanaSigner,
    );
  } else if (config.BINDER_SOLANA_SECRET !== undefined) {
    svmBinder = signerFromSecret(config.BINDER_SOLANA_SECRET, "BINDER_SOLANA_SECRET");
  }
  if (svmBinder !== undefined) {
    const source = config.BINDER_SOLANA_KMS_KEY_ID
      ? "BINDER_SOLANA_KMS_KEY_ID"
      : "BINDER_SOLANA_SECRET";
    const publicKey = base58Encode(svmBinder.publicKey);
    sameSvm("BINDER_SOLANA_ADDRESS", source, config.BINDER_SOLANA_ADDRESS, publicKey);
    const relayer =
      svmRelayer === undefined ? config.SOLANA_RELAYER_ADDRESS : base58Encode(svmRelayer.publicKey);
    if (relayer === publicKey) {
      throw new SignerConfigError(`${source} is the relayer key. The binder is its own key.`);
    }
  }

  return {
    ...(evmRelayer === undefined ? {} : { evmRelayer }),
    ...(svmRelayer === undefined ? {} : { svmRelayer }),
    binders: {
      ...(evmBinder === undefined ? {} : { evm: evmBinderFromAccount(evmBinder) }),
      ...(svmBinder === undefined ? {} : { svm: svmBinderFromSigner(svmBinder) }),
    },
    notes,
  };
}
