import { handleRequest } from "@shopify/shopify-app-remix/server";

export default function (request, status, headers, context) {
  return handleRequest(request, status, headers, context);
}

