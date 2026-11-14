/**
 * A script that runs while the browser parses the page, before the first paint. From the Next
 * guide "preventing flash before hydration" (`node_modules/next/dist/docs`, 16.3.5): a real
 * script on the server, `text/plain` in the browser so React does not warn, and the type
 * difference is the one mismatch it accepts. `nonce` is the request's CSP nonce, so the strict
 * CSP lets it run.
 */
export function InlineScript({ html, nonce }: { html: string; nonce?: string | undefined }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
