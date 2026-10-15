import { type CardLines, UNKNOWN_SENDER } from "@/components/drops/drop-lines";

/**
 * Line two of a row or a card: `@samplechad`, or `unknown sender`. The sender's main tag is a pill
 * next to it, placed by the row; no grey kind word.
 */
export function SenderLine({ sender }: { sender: CardLines["sender"] }) {
  if (sender === null) return <>{UNKNOWN_SENDER}</>;
  return <>@{sender.handle}</>;
}
