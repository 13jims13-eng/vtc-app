import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { action as slackBookingAction } from "./api.slack-booking";

export const loader = async (args: LoaderFunctionArgs) => {
  try {
    await authenticate.public.appProxy(args.request);
  } catch (err) {
    if (err instanceof Response) return err;

    const stack = err instanceof Error ? err.stack : String(err);
    console.error("appProxy auth error (loader)", stack);

    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};

export const action = async (args: ActionFunctionArgs) => {
  const requestUrl = new URL(args.request.url);
  console.log("slack-booking hit", {
    method: args.request.method,
    url: args.request.url,
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
    console.error("appProxy auth error (action)", stack);

    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    return await slackBookingAction(args);
  } catch (err) {
    const stack = err instanceof Error ? err.stack : String(err);
    console.error("slack-booking error", stack);
    return new Response(JSON.stringify({ ok: false, error: "Internal error" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
};
