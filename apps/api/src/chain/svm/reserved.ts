/**
 * The Solana runtime's reserved account keys: `agave-reserved-account-keys` 4.3.2,
 * `RESERVED_ACCOUNTS`, each id as `solana-sdk-ids` 3.1.0 declares it. No transaction can write
 * one of these, so a drop with one as its refund address could never refund or close.
 */
import { pubkeyToBase58, type Pubkey } from "./pubkey.js";

export const RESERVED_ACCOUNT_KEYS: readonly { readonly name: string; readonly address: string }[] =
  [
    // builtin and precompile programs
    {
      name: "address lookup table program",
      address: "AddressLookupTab1e1111111111111111111111111",
    },
    { name: "BPF loader", address: "BPFLoader2111111111111111111111111111111111" },
    { name: "deprecated BPF loader", address: "BPFLoader1111111111111111111111111111111111" },
    { name: "upgradeable BPF loader", address: "BPFLoaderUpgradeab1e11111111111111111111111" },
    { name: "compute budget program", address: "ComputeBudget111111111111111111111111111111" },
    { name: "config program", address: "Config1111111111111111111111111111111111111" },
    { name: "ed25519 program", address: "Ed25519SigVerify111111111111111111111111111" },
    { name: "feature program", address: "Feature111111111111111111111111111111111111" },
    { name: "loader v4", address: "LoaderV411111111111111111111111111111111111" },
    { name: "secp256k1 program", address: "KeccakSecp256k11111111111111111111111111111" },
    { name: "secp256r1 program", address: "Secp256r1SigVerify1111111111111111111111111" },
    { name: "stake config", address: "StakeConfig11111111111111111111111111111111" },
    { name: "stake program", address: "Stake11111111111111111111111111111111111111" },
    { name: "system program", address: "11111111111111111111111111111111" },
    { name: "vote program", address: "Vote111111111111111111111111111111111111111" },
    { name: "zk elgamal proof program", address: "ZkE1Gama1Proof11111111111111111111111111111" },
    { name: "zk token proof program", address: "ZkTokenProof1111111111111111111111111111111" },
    // sysvars
    { name: "clock sysvar", address: "SysvarC1ock11111111111111111111111111111111" },
    { name: "epoch rewards sysvar", address: "SysvarEpochRewards1111111111111111111111111" },
    { name: "epoch schedule sysvar", address: "SysvarEpochSchedu1e111111111111111111111111" },
    { name: "fees sysvar", address: "SysvarFees111111111111111111111111111111111" },
    { name: "instructions sysvar", address: "Sysvar1nstructions1111111111111111111111111" },
    { name: "last restart slot sysvar", address: "SysvarLastRestartS1ot1111111111111111111111" },
    { name: "recent blockhashes sysvar", address: "SysvarRecentB1ockHashes11111111111111111111" },
    { name: "rent sysvar", address: "SysvarRent111111111111111111111111111111111" },
    { name: "rewards sysvar", address: "SysvarRewards111111111111111111111111111111" },
    { name: "slot hashes sysvar", address: "SysvarS1otHashes111111111111111111111111111" },
    { name: "slot history sysvar", address: "SysvarS1otHistory11111111111111111111111111" },
    { name: "stake history sysvar", address: "SysvarStakeHistory1111111111111111111111111" },
    // other
    { name: "native loader", address: "NativeLoader1111111111111111111111111111111" },
    { name: "sysvar owner", address: "Sysvar1111111111111111111111111111111111111" },
  ];

/** The name of a reserved account key, or `null` for any other key. */
export function reservedAccountName(key: string | Pubkey): string | null {
  const address = typeof key === "string" ? key : pubkeyToBase58(key);
  return RESERVED_ACCOUNT_KEYS.find((entry) => entry.address === address)?.name ?? null;
}

/** True for a key no transaction can write to or sign for. */
export function isReservedAccountKey(key: string | Pubkey): boolean {
  return reservedAccountName(key) !== null;
}
