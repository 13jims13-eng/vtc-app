import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { action as slackBookingAction } from "./api.slack-booking";

export const loader = async (args: LoaderFunctionArgs) => {
  // Validate that this request really comes via the Shopify App Proxy
  await authenticate.public.appProxy(args.request);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};

export const action = async (args: ActionFunctionArgs) => {
  // Validate that this request really comes via the Shopify App Proxy
  await authenticate.public.appProxy(args.request);

  return slackBookingAction(args);
};
