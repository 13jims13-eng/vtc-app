import crypto from "node:crypto";

export type AppProxyValidationResult =
  | { ok: true; shop: string | null }
  | {
      ok: false;
      status: 401 | 500;
      error:
        | "APP_PROXY_SIGNATURE_MISSING"
        | "APP_PROXY_SIGNATURE_INVALID"
        | "SHOPIFY_API_SECRET_MISSING";
    };

function safeEqualHex(a: string, b: string) {
  const aNorm = a.toLowerCase();
  const bNorm = b.toLowerCase();
  const aBuf = Buffer.from(aNorm, "utf8");
  const bBuf = Buffer.from(bNorm, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Validates Shopify App Proxy signature.
 * Shopify sends a `signature` query param (sometimes `hmac` depending on setup/libraries).
 *
 * Algorithm (Shopify App Proxy):
 * - Take all query params except `signature`/`hmac`
 * - If a key appears multiple times, join its values with a comma (in the original order)
 * - Sort by the full `key=value` string (lexicographically)
 * - Concatenate with NO separators
 * - HMAC-SHA256 using SHOPIFY_API_SECRET, hex digest
 */
export function validateAppProxyHmac(request: Request): AppProxyValidationResult {
  const url = new URL(request.url);
  const signature = url.searchParams.get("signature") || url.searchParams.get("hmac");
  const shop = url.searchParams.get("shop");

  if (!signature) {
    return { ok: false, status: 401, error: "APP_PROXY_SIGNATURE_MISSING" };
  }

  const secret = process.env.SHOPIFY_API_SECRET || "";
  if (!secret) {
    return { ok: false, status: 500, error: "SHOPIFY_API_SECRET_MISSING" };
  }

  const valuesByKey = new Map<string, string[]>();
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "signature" || key === "hmac") continue;
    const existing = valuesByKey.get(key);
    if (existing) {
      existing.push(value);
    } else {
      valuesByKey.set(key, [value]);
    }
  }

  const parts = Array.from(valuesByKey.entries()).map(([key, values]) => {
    return `${key}=${values.join(",")}`;
  });
  parts.sort((a, b) => a.localeCompare(b));

  const message = parts.join("");
  const computed = crypto.createHmac("sha256", secret).update(message).digest("hex");

  if (!safeEqualHex(computed, signature)) {
    return { ok: false, status: 401, error: "APP_PROXY_SIGNATURE_INVALID" };
  }

  return { ok: true, shop };
}
