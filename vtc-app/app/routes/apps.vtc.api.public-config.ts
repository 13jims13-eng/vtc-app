import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

function jsonResponse(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function getGoogleMapsApiKeyFromEnv(): string {
  const candidates = [
    process.env.VTC_GOOGLE_MAPS_API_KEY,
    process.env.GOOGLE_MAPS_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.PUBLIC_GOOGLE_MAPS_API_KEY,
  ];

  for (const value of candidates) {
    const key = String(value || "").trim();
    if (key) return key;
  }

  return "";
}

export const loader = async (args: LoaderFunctionArgs) => {
  const requestUrl = new URL(args.request.url);
  const requestId = args.request.headers.get("X-Request-Id") || null;

  console.log("public-config hit", {
    method: args.request.method,
    path: requestUrl.pathname,
    shop: requestUrl.searchParams.get("shop"),
    hasSignature: requestUrl.searchParams.has("signature"),
    hasTimestamp: requestUrl.searchParams.has("timestamp"),
    requestId,
  });

  // NOTE: This endpoint only returns a Google Maps API key (which is used client-side anyway).
  // We try to validate App Proxy auth, but we do NOT hard-fail if auth is misconfigured.
  // This avoids breaking the widget on storefront pages when the app proxy is temporarily unhealthy.
  let authOk = false;
  let authError: string | null = null;
  try {
    await authenticate.public.appProxy(args.request);
    authOk = true;
  } catch (err) {
    if (err instanceof Response) {
      authError = `APP_PROXY_AUTH_RESPONSE_${err.status}`;
    } else {
      authError = "APP_PROXY_AUTH_FAILED";
      const stack = err instanceof Error ? err.stack : String(err);
      console.error("public-config auth error", stack);
    }
  }

  const googleMapsApiKey = getGoogleMapsApiKeyFromEnv();

  const warnings: string[] = [];
  if (!googleMapsApiKey) warnings.push("GOOGLE_MAPS_API_KEY_NOT_CONFIGURED");
  if (!authOk) warnings.push(authError || "APP_PROXY_AUTH_FAILED");

  return jsonResponse(
    {
      ok: authOk,
      requestId,
      googleMapsApiKey,
      warnings,
    },
    { status: 200 },
  );
};
