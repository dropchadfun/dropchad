# dropchad

Send crypto to anyone on X, just by their username. They sign in with X to claim, with no
wallet connect. Every drop lives on chain on its own, so anyone can check who really paid.

**Testnet only.** Everything runs on Solana devnet and Robinhood Chain testnet, with test coins
that have no value. dropchad has no token.

**Live:** [dropchad.com](https://dropchad.com) · X [@dropchadfun](https://x.com/dropchadfun) ·
[Telegram](https://t.me/dropchad)

## How it works

1. **Make a drop.** Sign in with X, pick the chain, the coin or token, and the people: X
   usernames, or wallet addresses for a multisend.
2. **One contract per drop.** The api builds a merkle tree of who gets what and creates the drop.
   Only that tree decides who can be paid.
3. **Fund it from any wallet.** Send the exact amount to the drop address.
4. **It goes live** once the money is there.
5. **People claim.** A receiver signs in with X, pastes an address, and is paid there. The
   receiver pays no gas.
6. **Leftovers go back** to the sender when the claim time ends.

The money can only go to the people in the tree, or back to the sender. Nobody, not even the
admin, can take it out of a drop.

## Live contracts (testnets)

- **Robinhood Chain testnet (46630):** `DropFactoryV4`
  [`0xEBb4…C9E4`](https://explorer.testnet.chain.robinhood.com/address/0xEBb4847C1E79ab6Ca3B2680E4B18365365F8C9E4),
  verified. Deployment record: `contracts/evm/deployments/46630-v4.json`.
- **Solana devnet:** program
  [`EQat…n5Ft`](https://explorer.solana.com/address/EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft?cluster=devnet).

## Layout

```
contracts/evm      Solidity, Foundry: the drop and factory contracts
contracts/solana   Rust, Anchor: the Solana program
apps/api           Node api, relayer and worker
apps/indexer       Ponder indexer for the EVM chain
apps/web           Next.js site
packages/shared    merkle tree, ABIs, types
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

Solana program (Rust, Anchor 1.1). The tests load the built program, so build it first:

```
cd contracts/solana
anchor build
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
