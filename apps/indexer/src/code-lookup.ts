/**
 * Reading a clone's deployed bytecode, for the identity check.
 *
 * This uses its own viem client rather than `context.client`, on purpose.
 *
 * `context.client` pins every read to the **event's block**, which is right for indexing: it makes
 * a re-run produce the same answer. But it requires an archive node, and the public Robinhood
 * testnet RPC is not one — `eth_getCode` at the creation block answers `metadata is not found`.
 * Proven against the live chain.
 *
 * A clone's code is immutable, so reading at `latest` gives the same answer as reading at the
 * creation block. `DropV1` has no `selfdestruct` and no `delegatecall` that can install code,
 * CREATE2 fixes what can ever live at that address.
 *
 * One lookup per address per process, cached. A failure is not fatal: it returns `null`, and
 * `verifyClone` records that the check was skipped instead of pretending it passed.
 */
import { createPublicClient, http, type Address, type Hex } from "viem";

const cache = new Map<string, Hex | undefined | null>();

let client: ReturnType<typeof createPublicClient> | undefined;

function getClient(rpcUrl: string): ReturnType<typeof createPublicClient> {
  client ??= createPublicClient({
    transport: http(rpcUrl, {
      // The check is best effort, so it must not sit and retry while indexing waits.
      retryCount: 1,
      timeout: 10_000,
    }),
  });
  return client;
}

/**
 * The bytecode at `address`, at the latest block.
 *
 * - `Hex`       the code
 * - `undefined` the address has no code
 * - `null`      the RPC could not be asked
 */
export async function fetchDeployedCode(
  rpcUrl: string,
  address: Address,
): Promise<Hex | undefined | null> {
  const key = address.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined || cache.has(key)) return cached;

  try {
    const code = await getClient(rpcUrl).getCode({ address });
    cache.set(key, code);
    return code;
  } catch (error) {
    // Recorded, never thrown. A drop must still be indexed when the RPC is having a bad day.
    console.warn(
      `code hash check skipped for ${address}: ${error instanceof Error ? error.message.split("\n")[0] : "rpc error"}`,
    );
    cache.set(key, null);
    return null;
  }
}
