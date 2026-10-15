/**
 * The Solana write side does not start until the program's `Config` account exists and agrees
 * with us.
 *
 * Three outcomes, each said plainly at boot:
 *
 * - **missing**: `initialize_config` has not been run on this cluster. The Solana write side stays
 *   off, the api keeps serving everything else, and `POST /api/drops` for a Solana chain answers
 *   `503 solana_config_missing`. The log line names the script that fixes it.
 * - **mismatch**: the config exists but its `relayer` is not our key, or its `chain_id` is not the
 *   registry's. Every `create_drop` we sent would fail with `NotRelayer`, or every leaf we built
 *   would carry the wrong chain id, so the process refuses to start rather than run wrong.
 * - **ok**: the decoded config, with `paused` and `defaultFeeBps` for the log line.
 */
import { decodeConfig, type ConfigAccount } from "./accounts.js";
import { configPda } from "./pda.js";
import { pubkeyEquals, pubkeyToBase58, type Pubkey } from "./pubkey.js";
import type { SvmRpc } from "./rpc.js";

export const INIT_CONFIG_SCRIPT = "apps/api/scripts/init-solana-config.ts";

export type SolanaConfigCheck =
  | { readonly kind: "missing"; readonly configAddress: string; readonly hint: string }
  | { readonly kind: "ok"; readonly config: ConfigAccount; readonly configAddress: string };

export class SolanaConfigMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolanaConfigMismatchError";
  }
}

export async function checkSolanaConfig(
  rpc: SvmRpc,
  expected: { readonly relayer: Pubkey; readonly chainId: bigint; readonly chainKey: string },
): Promise<SolanaConfigCheck> {
  const address = configPda().address;
  const configAddress = pubkeyToBase58(address);
  const info = await rpc.getAccountInfo(address, "confirmed");

  if (info === null) {
    return {
      kind: "missing",
      configAddress,
      hint:
        `the dropchad Config account ${configAddress} does not exist on ${expected.chainKey}. ` +
        `Run initialize_config once, signed by the upgrade authority, from WSL: ` +
        `npx tsx ${INIT_CONFIG_SCRIPT}.`,
    };
  }

  const config = decodeConfig(info);

  if (!pubkeyEquals(config.relayer, expected.relayer)) {
    // Both keys are public, so naming both is safe and it is the only useful message here.
    throw new SolanaConfigMismatchError(
      `the on chain Config names relayer ${pubkeyToBase58(config.relayer)}, but SOLANA_RELAYER_SECRET ` +
        `derives to ${pubkeyToBase58(expected.relayer)}. Every create_drop would fail with NotRelayer. ` +
        `Refusing to start. Either paste the right key or have the admin run set_relayer.`,
    );
  }
  if (config.chainId !== expected.chainId) {
    throw new SolanaConfigMismatchError(
      `the on chain Config has chain_id ${config.chainId.toString()}, the registry says ` +
        `${expected.chainId.toString()} for ${expected.chainKey}. Every leaf would bind the wrong ` +
        `cluster. Refusing to start.`,
    );
  }

  return { kind: "ok", config, configAddress };
}
