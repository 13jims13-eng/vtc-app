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

  try {
    await authenticate.public.appProxy(args.request);
  } catch (err) {
    if (err instanceof Response) {
      return jsonResponse(
        {
          ok: false,
          error: "Accès refusé (App Proxy)",
          reason: "APP_PROXY_AUTH_RESPONSE",
          requestId,
        },
        { status: err.status || 401 },
      );
    }

    const stack = err instanceof Error ? err.stack : String(err);
    console.error("public-config auth error", stack);

    return jsonResponse(
      {
        ok: false,
        error: "Accès refusé (App Proxy)",
        reason: "APP_PROXY_AUTH_FAILED",
        requestId,
      },
      { status: 401 },
    );
  }

  const googleMapsApiKey = getGoogleMapsApiKeyFromEnv();

  return jsonResponse({
    ok: true,
    requestId,
    googleMapsApiKey,
    warnings: googleMapsApiKey ? [] : ["GOOGLE_MAPS_API_KEY_NOT_CONFIGURED"],
  });
};
