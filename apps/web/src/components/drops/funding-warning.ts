/**
 * The funding warnings come from the api as plain text, `apps/api/src/drops/payment.ts`, with the
 * part that must stand out between `**`. The card shows that part bold and red, never the stars.
 */
export interface WarningPart {
  readonly text: string;
  readonly strong: boolean;
}

/** The line cut at each closed `**` pair. Stars that never close stay as they are. */
export function warningParts(line: string): WarningPart[] {
  const pieces = line.split("**");
  // An even count of pieces means one `**` has no partner: show the line untouched.
  if (pieces.length % 2 === 0) return [{ text: line, strong: false }];
  return pieces
    .map((text, i) => ({ text, strong: i % 2 === 1 }))
    .filter((part) => part.text.length > 0);
}
