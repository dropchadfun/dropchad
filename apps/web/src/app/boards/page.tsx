import type { Metadata } from "next";

import { rangeFromParam, tabFromParam } from "@/components/boards/BoardTabs";
import { BoardsPage } from "@/components/boards/BoardsPage";
import { ApiError, getBoard, type Board } from "@/lib/api";
import { chainPills } from "@/lib/chains";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "top chads" };

/**
 * `/boards?board=fed|project&range=day|week|all&chain=all|robinhood|solana`. Unknown values fall
 * back to the defaults: best dropchad, this week, all chains.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; board?: string; chain?: string }>;
}) {
  const params = await searchParams;
  const range = rangeFromParam(params.range);
  const type = tabFromParam(params.board);
  const pills = chainPills();
  const chain =
    params.chain !== undefined && pills.some((pill) => pill.selectable && pill.key === params.chain)
      ? params.chain
      : "all";

  let board: Board | null;
  try {
    board = await getBoard(range, type, chain);
  } catch (error) {
    if (!(error instanceof ApiError || error instanceof TypeError)) throw error;
    board = null;
  }

  // A new key on every choice, so the live board starts from this answer, not the last one.
  return (
    <BoardsPage
      key={`${range}-${type}-${chain}`}
      range={range}
      type={type}
      chain={chain}
      pills={pills}
      board={board}
    />
  );
}
