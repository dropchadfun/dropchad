# dropchad

Send crypto to anyone on X, just by their username. They sign in with X to claim, with no
wallet connect. Every drop lives on chain on its own, so anyone can check who really paid.

**Status.** Live on Solana mainnet and Robinhood Chain mainnet, in beta. On Solana the program
`EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft` has a 2 of 3 Squads multisig as admin and upgrade
authority. On Robinhood Chain the contracts are owned by a 48 hour timelock that only a 2 of 3
Safe can use. dropchad has no token.

**Live:** [dropchad.com](https://dropchad.com) · X [@dropchadfun](https://x.com/dropchadfun) ·
[Telegram](https://t.me/dropchad)

## How it works

1. **Make a drop.** Sign in with X, pick the chain, the coin or token, and the people: X
   usernames, or wallet addresses for a multisend.
2. **One contract per drop.** The api builds a merkle tree of who gets what and creates the drop.
   Only that tree decides who can be paid.
3. **Fund it from any wallet.** Send the exact amount to the drop address.
4. **It goes live** once the money is there.
5. **People claim.** A receiver signs in with X, pastes an address, and is paid there.
   Claiming is free.
6. **Leftovers go back** to the sender when the claim time ends.

The money can only go to the people in the tree, or back to the sender. The program has no
instruction that lets the admin take money out of a drop. The program can be changed only by an
upgrade, and an upgrade needs 2 of the 3 multisig signers.

On Robinhood Chain a drop contract has no admin function. The factory and the binder registry
change only through the 48 hour timelock. A guardian key can only stop new drops (`pause`) or
switch off the binder (`revoke`); it can never move money.

## Live contracts

- **Solana mainnet:** program
  [`EQat…n5Ft`](https://explorer.solana.com/address/EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft),
  deployed at slot 468,986,468. See "Verify the Solana program" below.
- **Solana devnet:** the same program id, for tests.
- **Robinhood Chain mainnet (4663):** deployed with `contracts/evm/script/DeployV7.s.sol`, source
  verified on Sourcify. The deploy record is `contracts/evm/deployments/4663-v7.json`.
  - `DropFactoryV7`
    [`0x6988AC05CB7cc0e638331CEB9608a728ACf708Af`](https://robinhoodchain.blockscout.com/address/0x6988AC05CB7cc0e638331CEB9608a728ACf708Af)
  - `DropV7`, the drop code each drop clones
    [`0xa4a5A7284a24eD227D548D54dd854db9D8a8950c`](https://robinhoodchain.blockscout.com/address/0xa4a5A7284a24eD227D548D54dd854db9D8a8950c)
  - `BinderRegistryV2`
    [`0xEd6ff4b9c48C924b222D51208dFA6410dEb155C8`](https://robinhoodchain.blockscout.com/address/0xEd6ff4b9c48C924b222D51208dFA6410dEb155C8)
  - `TimelockController`, 48 hours, owner of the factory and the registry
    [`0x8089bc02641DA493EB2e623D7Cde885C64a93427`](https://robinhoodchain.blockscout.com/address/0x8089bc02641DA493EB2e623D7Cde885C64a93427)
- **Robinhood Chain testnet (46630):** the EVM drop and factory contracts, test coins only. Their
  addresses are in `packages/chains/src/chains.json`.

## Verify the Solana program

The program source in `contracts/solana` is exactly the source of the mainnet build.

| What | Value |
|---|---|
| program | `EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft` |
| `ProgramData` | `76JPAERZztsCTSUExJXiAMABnbvJfRcqMM5erCjTnTR` |
| build | 484,528 bytes, SBPF v3, sha256 `88ad098eb02066e26301065f6ad961153c55cee46b09c43ed4bf9180eada5764` |
| `Config` account | `bQjXn4eUvq6rq7pTQHgjdnb5eJ6nQtLxP4uLQCQvZQD` |
| Squads v4 multisig | `GGVW3H1DGL3QVRK2CBv6wFWX7AfUvbeyW5vEHEJqKw2m`, 2 of 3, time lock 0 |
| multisig vault, index 0 | `5ihikK8Yu2m7ehiZyXZsUmbBMm7CuQGD26c928A5KJvy` |

The vault is the program's upgrade authority, the admin in `Config` and the fee wallet. No single
key can upgrade the program or change its settings.

1. **Build** with `cargo build-sbf` 3.1.10 and platform tools v1.57:

   ```
   cd contracts/solana
   cargo build-sbf --tools-version v1.57 --arch v3 --manifest-path programs/dropchad/Cargo.toml
   sha256sum target/deploy/dropchad.so
   ```

2. **Compare with the chain:**

   ```
   solana program dump EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft mainnet.so --url mainnet-beta
   sha256sum mainnet.so
   solana program show EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft --url mainnet-beta
   ```

   Both hashes should be the build hash above, and `Authority` should be the vault.

3. **The admin.** In the `Config` account data, bytes 8 to 40 are the admin key: the vault.
   `packages/shared/src/idl/dropchad.ts` holds the full account layout.

4. **The multisig.** The multisig account is owned by the Squads v4 program
   `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`. Its vault index 0 is the vault above.

## Layout

```
contracts/evm      Solidity, Foundry: the drop and factory contracts
contracts/solana   Rust, Anchor: the Solana program
apps/api           Node api, relayer and worker
apps/indexer       Ponder indexer for the EVM chains
apps/web           Next.js site
packages/shared    merkle tree, ABIs, IDL, types
packages/chains    chain list and deployed addresses
```

## Run the tests

Node 22 or newer:

```
npm ci
npm test
```

EVM contracts (Foundry):

```
git submodule update --init
cd contracts/evm
forge test
```

Solana program (Rust, Anchor 1.2). The tests load the built program, so build it first, as in
"Verify the Solana program":

```
cd contracts/solana
cargo build-sbf --tools-version v1.57 --arch v3 --manifest-path programs/dropchad/Cargo.toml
cargo test
```

## Run it locally

Copy each `.env.example` to `.env` and fill in your own values. The files hold variable names
only, never a value.

## Security

Found a problem? Email hello@dropchad.com. We never DM you first, and we never ask for your seed
phrase or private keys.

## License

MIT, see `LICENSE`.
