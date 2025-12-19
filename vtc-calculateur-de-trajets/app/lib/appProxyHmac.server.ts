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
 * - Sort by key
 * - Concatenate as `key=value` with NO separators
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

  const pairs: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    if (key === "signature" || key === "hmac") return;
    pairs.push([key, value]);
  });

  pairs.sort(([a], [b]) => a.localeCompare(b));

  const message = pairs.map(([k, v]) => `${k}=${v}`).join("");
  const computed = crypto.createHmac("sha256", secret).update(message).digest("hex");

  if (!safeEqualHex(computed, signature)) {
    return { ok: false, status: 401, error: "APP_PROXY_SIGNATURE_INVALID" };
  }

  return { ok: true, shop };
}
