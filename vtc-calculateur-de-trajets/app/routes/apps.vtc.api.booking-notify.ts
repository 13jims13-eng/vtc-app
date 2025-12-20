import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { validateAppProxyHmac } from "../lib/appProxyHmac.server";
import { action as bookingNotifyAction } from "./api.booking-notify";

function jsonResponse(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export const action = async (args: ActionFunctionArgs) => {
  const requestUrl = new URL(args.request.url);
  const requestId = args.request.headers.get("X-Request-Id") || null;
  const debugAuth = {
    shop: requestUrl.searchParams.get("shop"),
    hasShop: requestUrl.searchParams.has("shop"),
    hasSignature: requestUrl.searchParams.has("signature"),
    hasHmac: requestUrl.searchParams.has("hmac"),
    hasTimestamp: requestUrl.searchParams.has("timestamp"),
    signatureLength: (requestUrl.searchParams.get("signature") || requestUrl.searchParams.get("hmac") || "").length,
    keys: Array.from(new Set(Array.from(requestUrl.searchParams.keys()))).sort(),
  };
  console.log("notify hit", {
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
    const fallback = validateAppProxyHmac(args.request);

    if (err instanceof Response) {
      const detail = await err
        .clone()
        .text()
        .catch(() => "");

      return jsonResponse(
        {
          ok: false,
          error: "Accès refusé (App Proxy)",
          reason: "APP_PROXY_AUTH_RESPONSE",
          status: err.status,
          detail: detail ? detail.slice(0, 800) : null,
          debug: debugAuth,
          fallback,
          requestId,
        },
        { status: err.status || 401 },
      );
    }

    const stack = err instanceof Error ? err.stack : String(err);
    console.error("notify auth error", stack);

    return jsonResponse(
      {
        ok: false,
        error: "Accès refusé (App Proxy)",
        reason: "APP_PROXY_AUTH_FAILED",
        debug: debugAuth,
        fallback,
        requestId,
      },
      { status: 401 },
    );
  }

  return bookingNotifyAction(args);
};
