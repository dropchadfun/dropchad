-- 0005_chain_key — one api, two chains.
--
-- Every drop and every relayer transaction says which chain it is on by registry key, not only by
-- chain id. The id is enough to look a chain up (`findChainByChainId`), but 101 and 103 on Solana
-- are a token list convention, and a key is unambiguous and readable in a
-- query. Existing rows are all Robinhood testnet, 46630, and are backfilled as such.
--
-- `drops.salt` becomes nullable: a Solana drop has no CREATE2 salt, its address comes from the
-- PDA seeds, which are the commitment and the nonce already stored on the row.
--
-- `relayer_txs.nonce` becomes nullable: Solana has no account nonce. What bounds a Solana
-- transaction instead is the block height its blockhash stays valid until, kept in the new
-- `last_valid_block_height`. The gas columns hold compute units on that chain, the cost column
-- holds lamports; the unit follows the row's chain and the schema comments say so.

ALTER TABLE drops ADD COLUMN IF NOT EXISTS chain_key TEXT NOT NULL DEFAULT 'robinhood-testnet';
ALTER TABLE drops ALTER COLUMN chain_key DROP DEFAULT;
ALTER TABLE drops ALTER COLUMN salt DROP NOT NULL;
CREATE INDEX IF NOT EXISTS drops_chain_key_created_idx ON drops (chain_key, created_at);

ALTER TABLE relayer_txs ADD COLUMN IF NOT EXISTS chain_key TEXT NOT NULL DEFAULT 'robinhood-testnet';
ALTER TABLE relayer_txs ALTER COLUMN chain_key DROP DEFAULT;
ALTER TABLE relayer_txs ALTER COLUMN nonce DROP NOT NULL;
ALTER TABLE relayer_txs ADD COLUMN IF NOT EXISTS last_valid_block_height BIGINT;
