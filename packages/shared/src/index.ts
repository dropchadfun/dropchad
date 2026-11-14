/**
 * `@dropchad/shared` — types, the merkle generator, and the generated contract ABIs.
 *
 * Nothing here talks to a network, a database or a wallet. It is pure data and pure functions, so
 * `apps/api`, `apps/indexer` and `apps/web` can all depend on it without dragging anything along.
 */
export * from "./types.js";
export * from "./merkle/index.js";
export * from "./binding.js";
export * from "./abi/index.js";
export * from "./idl/index.js";
