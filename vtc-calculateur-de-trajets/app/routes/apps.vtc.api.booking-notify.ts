import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { action as bookingNotifyAction } from "./api.booking-notify";

export const action = async (args: ActionFunctionArgs) => {
  const requestUrl = new URL(args.request.url);
  console.log("notify hit", {
    method: args.request.method,
    path: requestUrl.pathname,
    shop: requestUrl.searchParams.get("shop"),
    hasSignature: requestUrl.searchParams.has("signature"),
    hasTimestamp: requestUrl.searchParams.has("timestamp"),
  });

  try {
    await authenticate.public.appProxy(args.request);
  } catch (err) {
    if (err instanceof Response) return err;

    const stack = err instanceof Error ? err.stack : String(err);
    console.error("notify auth error", stack);
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return bookingNotifyAction(args);
};
