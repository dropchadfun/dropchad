import type { headlineParts } from "@/components/drops/drop-lines";

/**
 * The headline's text: the words, which may wrap on the phone,
 * then the amount and the unit in one unbroken piece, so `21,000 $TEST` always shows in full.
 * A long ticker, 7 letters and more, is one size smaller, `type-h2` inside the `type-h1` line.
 */
export function Headline({
  parts,
  first,
}: {
  parts: ReturnType<typeof headlineParts>;
  first: string;
}) {
  if (parts.amount === null || parts.unit === null) return <>{first}</>;
  return (
    <>
      {parts.lead}
      <span className="whitespace-nowrap">
        {parts.amount}{" "}
        {parts.small ? <span className="type-h2 font-semibold">{parts.unit}</span> : parts.unit}
      </span>
    </>
  );
}
