type UnknownRecord = Record<string, unknown>;

export type AiAssistantRequestBody = {
  context: UnknownRecord;
  userMessage: string;
};

function parseBooleanEnv(value: unknown) {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return false;
}

export function isAiAssistantEnabled() {
  return parseBooleanEnv(process.env.AI_ASSISTANT_ENABLED);
}

export function getClientIp(request: Request) {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();

  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0];
    if (first) return first.trim();
  }

  return "unknown";
}

const _rateWindowMs = 60_000;
const _rateMax = 12;
const _hitsByIp = new Map<string, number[]>();

export function rateLimitByIp(ip: string) {
  const now = Date.now();
  const times = _hitsByIp.get(ip) || [];
  const filtered = times.filter((t) => now - t < _rateWindowMs);
  if (filtered.length >= _rateMax) {
    return { ok: false as const, retryAfterSeconds: 30 };
  }
  filtered.push(now);
  _hitsByIp.set(ip, filtered);
  return { ok: true as const };
}

function clampString(value: unknown, maxLen: number) {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if (!v) return "";
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function pickContext(raw: unknown) {
  const obj = (raw && typeof raw === "object" ? (raw as UnknownRecord) : {}) as UnknownRecord;

  // Only keep a safe, limited subset.
  // (We explicitly do NOT want contact details here.)
  const pickup = clampString(obj.pickup, 220);
  const dropoff = clampString(obj.dropoff, 220);
  const date = clampString(obj.date, 32);
  const time = clampString(obj.time, 16);
  const vehicle = clampString(obj.vehicle, 80);
  const currency = clampString(obj.currency, 8) || "EUR";

  const optionsRaw = Array.isArray(obj.options) ? obj.options : [];
  const options = optionsRaw
    .map((o) => (typeof o === "string" ? clampString(o, 80) : ""))
    .filter(Boolean)
    .slice(0, 12);

  const quoteRaw = obj.quote && typeof obj.quote === "object" ? (obj.quote as UnknownRecord) : null;
  const quote = quoteRaw
    ? {
        price: typeof quoteRaw.price === "number" ? quoteRaw.price : null,
        isQuote: !!quoteRaw.isQuote,
        distance: typeof quoteRaw.distance === "number" ? quoteRaw.distance : null,
        duration: typeof quoteRaw.duration === "number" ? quoteRaw.duration : null,
      }
    : null;

  const extra: UnknownRecord = {};
  const stopsCount = typeof obj.stopsCount === "number" ? obj.stopsCount : null;
  if (typeof stopsCount === "number") extra.stopsCount = stopsCount;
  const customOption = clampString(obj.customOption, 200);
  if (customOption) extra.customOption = customOption;

  return {
    pickup,
    dropoff,
    date,
    time,
    vehicle,
    currency,
    options,
    quote,
    ...extra,
  };
}

export function validateAiAssistantBody(raw: unknown) {
  const obj = (raw && typeof raw === "object" ? (raw as UnknownRecord) : null) as UnknownRecord | null;
  if (!obj) return { ok: false as const, error: "INVALID_JSON" as const };

  const userMessage = clampString(obj.userMessage, 800);
  if (!userMessage) return { ok: false as const, error: "EMPTY_MESSAGE" as const };

  const context = pickContext(obj.context);

  return {
    ok: true as const,
    value: { userMessage, context },
  };
}

export function buildSystemPrompt() {
  return [
    "Tu es un assistant de réservation VTC premium, basé à Marseille.",
    "Objectif: aider l'utilisateur à compléter sa demande et à réserver.",
    "Règles STRICTES:",
    "- Tu ne recalcules JAMAIS un prix. Tu ne modifies pas le devis.",
    "- Tu utilises uniquement les valeurs du contexte (quote) si elles existent.",
    "- Si le devis n'existe pas encore, tu demandes les informations manquantes et tu invites à cliquer sur 'Calculer les tarifs'.",
    "- Tu ne promets jamais la disponibilité ni un prix final garanti.",
    "- Tu respectes la confidentialité: ne demande pas de données inutiles.",
    "Sortie: format court en français, structuré en 3 sections exactement:",
    "1) Questions manquantes (liste courte)",
    "2) Récap devis (si quote) (liste courte)",
    "3) Prochaine étape (CTA: Réserver / WhatsApp)",
  ].join("\n");
}

export async function callOpenAi({
  userMessage,
  context,
}: {
  userMessage: string;
  context: UnknownRecord;
}) {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return { ok: false as const, error: "OPENAI_NOT_CONFIGURED" as const };
  }

  const model = (process.env.OPENAI_MODEL || "").trim() || "gpt-4o-mini";

  const body = {
    model,
    temperature: 0.25,
    max_tokens: 520,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content:
          `Contexte (ne pas inventer):\n${JSON.stringify(context)}\n\nMessage utilisateur:\n${userMessage}`,
      },
    ],
  };

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    return {
      ok: false as const,
      error: "OPENAI_FAILED" as const,
      status: resp.status,
      detail: text ? text.slice(0, 600) : null,
    };
  }

  const data = (() => {
    try {
      return text ? (JSON.parse(text) as UnknownRecord) : null;
    } catch {
      return null;
    }
  })();

  let content = "";
  const choices = data?.choices;
  if (Array.isArray(choices) && choices.length) {
    const first = choices[0] as UnknownRecord;
    const msg = first?.message && typeof first.message === "object" ? (first.message as UnknownRecord) : null;
    const c = msg?.content;
    if (typeof c === "string") content = c;
  }

  const reply = content.trim();
  if (!reply) {
    return { ok: false as const, error: "OPENAI_EMPTY" as const };
  }

  return { ok: true as const, reply };
}
