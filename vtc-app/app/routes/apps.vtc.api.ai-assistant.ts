import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { action as aiAssistantAction } from "./api.ai-assistant";

function jsonResponse(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export const action = async (args: ActionFunctionArgs) => {
  const requestUrl = new URL(args.request.url);
  const requestId = args.request.headers.get("X-Request-Id") || null;

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
    console.error("ai-assistant auth error", {
      path: requestUrl.pathname,
      requestId,
      stack,
    });

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

  return aiAssistantAction(args);
};
