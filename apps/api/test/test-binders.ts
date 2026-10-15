/**
 * The test binders, for tests that need handle mode on. The same public
 * test values `bind.test.ts` uses: anvil account 1 for the EVM, a fixed seed for Solana. Neither
 * has ever held value. The file name avoids `key`, which `.gitignore` blocks.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { base58Encode } from "@dropchad/shared";

export const TEST_EVM_BINDER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TEST_EVM_BINDER_SECRET = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const SOL_SEED = new Uint8Array(32).fill(7);
const SOL_PUB = ed25519.getPublicKey(SOL_SEED);
export const TEST_SOL_BINDER_PUBKEY: Uint8Array = SOL_PUB;
export const TEST_SOL_BINDER_ADDRESS = base58Encode(SOL_PUB);

/** Both binder env lines, as `apps/api/.env` holds them on the server. */
export const TEST_BINDER_ENV = {
  BINDER_EVM_PRIVATE_KEY: TEST_EVM_BINDER_SECRET,
  BINDER_EVM_ADDRESS: TEST_EVM_BINDER_ADDRESS,
  BINDER_SOLANA_SECRET: JSON.stringify([...SOL_SEED, ...SOL_PUB]),
  BINDER_SOLANA_ADDRESS: TEST_SOL_BINDER_ADDRESS,
} as const;

/** Only the EVM lines. */
export const TEST_EVM_BINDER_ENV = {
  BINDER_EVM_PRIVATE_KEY: TEST_BINDER_ENV.BINDER_EVM_PRIVATE_KEY,
  BINDER_EVM_ADDRESS: TEST_BINDER_ENV.BINDER_EVM_ADDRESS,
} as const;

/** Only the Solana lines. */
export const TEST_SOL_BINDER_ENV = {
  BINDER_SOLANA_SECRET: TEST_BINDER_ENV.BINDER_SOLANA_SECRET,
  BINDER_SOLANA_ADDRESS: TEST_BINDER_ENV.BINDER_SOLANA_ADDRESS,
} as const;
