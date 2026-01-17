import type { ActionFunctionArgs } from "react-router";
import { isValidSingleEmail } from "../lib/bookingNotify.server";
import { getShopConfig } from "../lib/shopConfig.server";
import {
  sendAiAssistantLeadEmailTo,
  validateAiAssistantEmailBody,
} from "../lib/aiAssistantEmail.server";

function jsonResponse(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function maskEmail(value: string) {
  const v = String(value || "").trim();
  const at = v.indexOf("@");
  if (at <= 0) return "";
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  const localMasked = local.length <= 2 ? `${local[0] || ""}*` : `${local.slice(0, 2)}***`;
  const domainParts = domain.split(".");
  const domainName = domainParts[0] || "";
  const domainMasked = domainName ? `${domainName[0]}***` : "***";
  const tld = domainParts.length > 1 ? domainParts.slice(1).join(".") : "";
  return `${localMasked}@${domainMasked}${tld ? "." + tld : ""}`;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const validated = validateAiAssistantEmailBody(raw);
  if (!validated.ok) {
    return jsonResponse({ ok: false, error: validated.error }, { status: 400 });
  }

  const requestUrl = new URL(request.url);
  const shop = String(requestUrl.searchParams.get("shop") || "").trim() || null;

  // Resolve destination email: widget override first, then tenant config (per shop).
  const widgetTo = String(validated.value.bookingEmailTo || "").trim();

  let resolvedTo: string | null = null;
  let toSource: "widget" | "tenant" | "skip" = "skip";

  if (shop) {
    const config = await getShopConfig(shop);
    const tenantTo = String(config?.bookingEmailTo || "").trim();

    resolvedTo = isValidSingleEmail(widgetTo) ? widgetTo : isValidSingleEmail(tenantTo) ? tenantTo : null;
    toSource = isValidSingleEmail(widgetTo) ? "widget" : isValidSingleEmail(tenantTo) ? "tenant" : "skip";
  } else {
    // Non-Shopify legacy calls require widgetTo (no server-side tenant lookup).
    resolvedTo = isValidSingleEmail(widgetTo) ? widgetTo : null;
    toSource = resolvedTo ? "widget" : "skip";
  }

  if (!resolvedTo) {
    return jsonResponse(
      {
        ok: false,
        error: "EMAIL_NOT_CONFIGURED",
        reason: "NO_DESTINATION_EMAIL",
      },
      { status: 400 },
    );
  }

  try {
    const res = await sendAiAssistantLeadEmailTo(resolvedTo, validated.value);
    if (!res.ok) {
      const status = res.error === "EMAIL_NOT_CONFIGURED" ? 500 : 400;
      return jsonResponse({ ok: false, error: res.error }, { status });
    }

    return jsonResponse(
      {
        ok: true,
        email: {
          sent: true,
          toSource,
          toMasked: maskEmail(resolvedTo),
        },
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("ai-assistant-email failed", message.slice(0, 500));
    return jsonResponse({ ok: false, error: "EMAIL_FAILED" }, { status: 500 });
  }
};
