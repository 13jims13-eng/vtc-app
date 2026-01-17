import type { ActionFunctionArgs } from "react-router";
import {
  callOpenAi,
  getClientIp,
  isAiAssistantEnabled,
  rateLimitByIp,
  validateAiAssistantBody,
} from "../lib/aiAssistant.server";

function jsonResponse(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }

  if (!isAiAssistantEnabled()) {
    return jsonResponse({ ok: false, error: "AI_DISABLED" }, { status: 404 });
  }

  const ip = getClientIp(request);
  const rl = rateLimitByIp(ip);
  if (!rl.ok) {
    return jsonResponse(
      { ok: false, error: "RATE_LIMITED", retryAfterSeconds: rl.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const validated = validateAiAssistantBody(raw);
  if (!validated.ok) {
    return jsonResponse({ ok: false, error: validated.error }, { status: 400 });
  }

  const res = await callOpenAi(validated.value);
  if (!res.ok) {
    // Log for operators (Render logs). Do not leak user content.
    const maybe = res as unknown as { status?: unknown; detail?: unknown; model?: unknown; api?: unknown; tokenParam?: unknown };
    const openAiStatus = typeof maybe.status === "number" ? maybe.status : undefined;
    const detail = typeof maybe.detail === "string" ? maybe.detail.slice(0, 500) : null;
    const model = typeof maybe.model === "string" ? maybe.model : undefined;
    const api = typeof maybe.api === "string" ? maybe.api : undefined;
    const tokenParam = typeof maybe.tokenParam === "string" ? maybe.tokenParam : undefined;
    console.error("ai-assistant ko", { error: res.error, openAiStatus, model, api, tokenParam, detail });

    // Do not leak request content; keep error minimal.
    const httpStatus = res.error === "OPENAI_NOT_CONFIGURED" ? 500 : 502;
    return jsonResponse({ ok: false, error: res.error }, { status: httpStatus });
  }

  return jsonResponse({ ok: true, reply: res.reply });
};
