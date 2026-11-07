// Security headers of the pages of the browser app.
//
// The Content-Security-Policy names what a page may load and where its scripts may
// connect. Everything comes from the origin of alcyone: the images of a board come
// through the Worker, and the WebSocket of a board connects to the same host.

/** Headers that every page of the browser app carries. */
export function pageHeaders(requestUrl: string): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(new URL(requestUrl).host),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-Content-Type-Options": "nosniff",
  };
}

export function contentSecurityPolicy(host: string): string {
  const directives: string[][] = [
    ["default-src", "'self'"],
    // Cloudflare Web Analytics, when the zone turns it on, adds its script to every page.
    ["script-src", "'self'", "https://static.cloudflareinsights.com"],
    // The components add style elements and style attributes.
    ["style-src", "'self'", "'unsafe-inline'"],
    // blob: and data: are pictures that the browser makes from a chosen or pasted file.
    ["img-src", "'self'", "data:", "blob:"],
    // Older browsers do not count the WebSocket of the same host as 'self'.
    ["connect-src", "'self'", `wss://${host}`],
    ["font-src", "'self'", "data:"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  return directives.map((directive) => directive.join(" ")).join("; ");
}

/**
 * Headers of an image of a board. The sandbox keeps a file that someone opens by its URL
 * from running anything on the origin of alcyone, whatever it holds.
 */
export const ASSET_HEADERS: Record<string, string> = {
  "Cache-Control": "private, max-age=31536000, immutable",
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  "X-Content-Type-Options": "nosniff",
};
