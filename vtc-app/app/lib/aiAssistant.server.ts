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

  const vehiclesCatalogRaw = Array.isArray(obj.vehiclesCatalog) ? obj.vehiclesCatalog : [];
  const vehiclesCatalog = vehiclesCatalogRaw
    .map((v) => {
      const vv = v && typeof v === "object" ? (v as UnknownRecord) : null;
      if (!vv) return null;
      const id = clampString(vv.id, 48);
      const label = clampString(vv.label, 80);
      const quoteOnly = !!vv.quoteOnly;
      if (!id && !label) return null;
      return { id, label, quoteOnly };
    })
    .filter(Boolean)
    .slice(0, 12);

  const optionsCatalogRaw = Array.isArray(obj.optionsCatalog) ? obj.optionsCatalog : [];
  const optionsCatalog = optionsCatalogRaw
    .map((o) => {
      const oo = o && typeof o === "object" ? (o as UnknownRecord) : null;
      if (!oo) return null;
      const id = clampString(oo.id, 64);
      const label = clampString(oo.label, 100);
      const type = clampString(oo.type, 24);
      const amount = typeof oo.amount === "number" ? oo.amount : null;
      if (!id && !label) return null;
      return { id, label, type, amount };
    })
    .filter(Boolean)
    .slice(0, 20);

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

  const pricingBehavior = clampString(obj.pricingBehavior, 32);
  if (pricingBehavior) extra.pricingBehavior = pricingBehavior;
  const leadTimeThresholdMinutes = typeof obj.leadTimeThresholdMinutes === "number" ? obj.leadTimeThresholdMinutes : null;
  if (typeof leadTimeThresholdMinutes === "number") extra.leadTimeThresholdMinutes = leadTimeThresholdMinutes;
  if (vehiclesCatalog.length) extra.vehiclesCatalog = vehiclesCatalog;
  if (optionsCatalog.length) extra.optionsCatalog = optionsCatalog;

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
    "Tu es l'assistant de réservation du site sur lequel tu es installé (VTC premium).",
    "Objectif: aider l'utilisateur à compléter sa demande et à réserver.",
    "Règles STRICTES:",
    "- Tu ne recalcules JAMAIS un prix. Tu ne modifies pas le devis.",
    "- Tu utilises uniquement les valeurs du contexte (quote) si elles existent.",
    "- Si le devis n'existe pas encore, tu demandes les informations manquantes et tu invites à cliquer sur 'Calculer les tarifs'.",
    "- Tu ne promets jamais la disponibilité ni un prix final garanti.",
    "- Tu respectes la confidentialité: ne demande pas de données inutiles.",
    "- Tu NE PROPOSES JAMAIS d'autres chauffeurs, plateformes, comparateurs ou sites web. Tu restes 100% focalisé sur la réservation via CE site.",
    "- Tu recommandes uniquement des véhicules/options présents dans le contexte (vehiclesCatalog/optionsCatalog). Si une demande ne correspond pas, tu proposes l'alternative la plus proche parmi la liste.",
    "- Si l'utilisateur parle d'un vol/train, tu peux aider à préparer la réservation (marge, terminal/gare).",
    "  - Si des infos web sont fournies dans 'webSearch', tu peux t'en servir pour confirmer l'horaire/retard.",
    "  - Sinon, tu demandes le numéro de vol/train et l'horaire confirmé. N'invente pas.",
    "Méthode (guide):",
    "- Clarifie toujours: nb passagers, nb valises, besoin siège bébé/animal, adresse exacte + point de RDV (terminal/porte/quai), et marge souhaitée.",
    "- Si aéroport/gare: demande terminal/gare + numéro de vol/train + heure d'arrivée; recommande une marge (ex: +30 à +60 min) selon cas.",
    "- Si le client hésite: propose 1 véhicule recommandé (parmi vehiclesCatalog) + 1 alternative, et les options pertinentes (optionsCatalog).",
    "Sortie: format court en français, structuré en 3 sections exactement:",
    "1) Questions manquantes (liste courte)",
    "2) Récap devis (si quote) (liste courte)",
    "3) Prochaine étape (CTA: Calculer les tarifs / Envoyer par email / WhatsApp)",
  ].join("\n");
}

function hasSerperKey() {
  return !!String(process.env.SERPER_API_KEY || "").trim();
}

function looksLikeScheduleQuestion(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("vol") ||
    m.includes("flight") ||
    m.includes("train") ||
    m.includes("tgv") ||
    m.includes("sncf") ||
    m.includes("gare") ||
    m.includes("aéroport") ||
    m.includes("airport") ||
    m.includes("horaire") ||
    m.includes("retard") ||
    m.includes("arrivée") ||
    m.includes("départ")
  );
}

async function webSearchSerper(query: string) {
  const apiKey = String(process.env.SERPER_API_KEY || "").trim();
  if (!apiKey) return { ok: false as const, error: "SERPER_NOT_CONFIGURED" as const };

  const q = query.trim();
  if (!q) return { ok: false as const, error: "EMPTY_QUERY" as const };

  const resp = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q, num: 5 }),
  });

  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    return {
      ok: false as const,
      error: "SERPER_FAILED" as const,
      status: resp.status,
      detail: text ? text.slice(0, 400) : null,
    };
  }

  const data = (() => {
    try {
      return text ? (JSON.parse(text) as UnknownRecord) : null;
    } catch {
      return null;
    }
  })();

  const organic = Array.isArray(data?.organic) ? (data?.organic as UnknownRecord[]) : [];
  const blockedWords = ["vtc", "chauffeur", "taxi", "uber", "bolt", "heetch", "cab", "driver"]; // avoid competitor suggestions

  const results = organic
    .map((r) => {
      const title = typeof r.title === "string" ? r.title.trim() : "";
      const link = typeof r.link === "string" ? r.link.trim() : "";
      const snippet = typeof r.snippet === "string" ? r.snippet.trim() : "";
      if (!title && !snippet) return null;
      const hay = `${title} ${snippet} ${link}`.toLowerCase();
      if (blockedWords.some((w) => hay.includes(w))) return null;
      return { title, link, snippet };
    })
    .filter(Boolean)
    .slice(0, 4);

  return { ok: true as const, results };
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

  const model = (process.env.OPENAI_MODEL || "").trim() || "gpt-5-nano";
  const modelLower = model.toLowerCase();

  // Optional web search context for flight/train schedule questions.
  // Only used when SERPER_API_KEY is configured.
  let webSearch: unknown = null;
  if (hasSerperKey() && looksLikeScheduleQuestion(userMessage)) {
    try {
      const web = await webSearchSerper(userMessage);
      if (web.ok) {
        // Avoid pushing too much content.
        webSearch = web.results;
      }
    } catch {
      webSearch = null;
    }
  }

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content:
        `Contexte (ne pas inventer):\n${JSON.stringify({ ...context, webSearch })}\n\nMessage utilisateur:\n${userMessage}`,
    },
  ];

  async function callChatCompletions() {
    const tokenLimits =
      modelLower.startsWith("gpt-5") || modelLower.startsWith("o1")
        ? { max_completion_tokens: 520 }
        : { max_tokens: 520 };
    const tokenParam = Object.prototype.hasOwnProperty.call(tokenLimits, "max_completion_tokens")
      ? "max_completion_tokens"
      : "max_tokens";

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.25,
        ...tokenLimits,
        messages,
      }),
    });

    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      return {
        ok: false as const,
        status: resp.status,
        detail: text ? text.slice(0, 600) : null,
        api: "chat.completions" as const,
        tokenParam,
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

    return { ok: true as const, reply: content.trim(), api: "chat.completions" as const, tokenParam };
  }

  async function callResponses() {
    const input = `Contexte (ne pas inventer):\n${JSON.stringify({ ...context, webSearch })}\n\nMessage utilisateur:\n${userMessage}`;
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_output_tokens: 520,
        instructions: buildSystemPrompt(),
        input,
      }),
    });

    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      return {
        ok: false as const,
        status: resp.status,
        detail: text ? text.slice(0, 600) : null,
        api: "responses" as const,
        tokenParam: "max_output_tokens" as const,
      };
    }

    const data = (() => {
      try {
        return text ? (JSON.parse(text) as UnknownRecord) : null;
      } catch {
        return null;
      }
    })();

    // Prefer the aggregated field when available.
    const direct = data?.output_text;
    if (typeof direct === "string" && direct.trim()) {
      return { ok: true as const, reply: direct.trim(), api: "responses" as const, tokenParam: "max_output_tokens" as const };
    }

    if (Array.isArray(direct)) {
      const joined = direct.filter((x) => typeof x === "string").join("");
      if (joined.trim()) {
        return { ok: true as const, reply: joined.trim(), api: "responses" as const, tokenParam: "max_output_tokens" as const };
      }
    }

    // Fallback: attempt to extract text from output[].content[].text
    const output = Array.isArray(data?.output) ? (data?.output as UnknownRecord[]) : [];
    let combined = "";
    for (const item of output) {
      const content = Array.isArray(item?.content) ? (item.content as UnknownRecord[]) : [];
      for (const c of content) {
        const textPart = c?.text;
        if (typeof textPart === "string") {
          combined += textPart;
          continue;
        }

        if (textPart && typeof textPart === "object") {
          const maybeValue = (textPart as UnknownRecord).value;
          if (typeof maybeValue === "string") {
            combined += maybeValue;
          }
        }
      }
    }

    const reply = combined.trim();
    if (!reply) {
      // Diagnostics for operators (Render logs). Do not include request content.
      try {
        const keys = data && typeof data === "object" ? Object.keys(data).slice(0, 25) : [];
        const output0 = output[0] && typeof output[0] === "object" ? (output[0] as UnknownRecord) : null;
        const outType = output0 ? String(output0.type || "") : "";
        const content0 = output0 && Array.isArray(output0.content) ? (output0.content[0] as UnknownRecord) : null;
        const cType = content0 ? String(content0.type || "") : "";
        const textField = content0 ? (content0 as UnknownRecord).text : undefined;
        const textType = textField === null ? "null" : Array.isArray(textField) ? "array" : typeof textField;
        console.error("openai responses empty", { model, keys, outType, cType, textType });
      } catch {
        // ignore
      }
    }

    return { ok: true as const, reply, api: "responses" as const, tokenParam: "max_output_tokens" as const };
  }

  // Prefer chat/completions for broad compatibility. Enable Responses API explicitly if needed.
  const useResponses = parseBooleanEnv(process.env.OPENAI_USE_RESPONSES) && modelLower.startsWith("gpt-5");
  const res = useResponses ? await callResponses() : await callChatCompletions();
  if (!res.ok) {
    return {
      ok: false as const,
      error: "OPENAI_FAILED" as const,
      status: res.status,
      detail: res.detail,
      model,
      api: res.api,
      tokenParam: res.tokenParam,
    };
  }

  const reply = res.reply.trim();
  if (!reply) {
    return { ok: false as const, error: "OPENAI_EMPTY" as const };
  }

  return { ok: true as const, reply };
}
