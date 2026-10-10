/**
 * A script that runs while the browser parses the page, before the first paint. From the Next
 * guide "preventing flash before hydration" (`node_modules/next/dist/docs`, 16.3.5): a real
 * script on the server, `text/plain` in the browser so React does not warn, and the type
 * difference is the one mismatch it accepts.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
