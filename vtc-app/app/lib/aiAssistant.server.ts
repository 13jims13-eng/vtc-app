type UnknownRecord = Record<string, unknown>;

export type AiAssistantFormUpdate = {
  pickup?: string;
  dropoff?: string;
  pickupDate?: string;
  pickupTime?: string;
  vehicleId?: string;
  optionIds?: string[];
};

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

function parsePositiveIntEnv(value: unknown) {
  if (typeof value !== "string") return null;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
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

  // Widget-side assistant memory flags (safe, non-sensitive).
  if (typeof obj.aiOptionsAskedOnce === "boolean") extra.aiOptionsAskedOnce = obj.aiOptionsAskedOnce;
  const aiOptionsDecision = clampString(obj.aiOptionsDecision, 24);
  if (aiOptionsDecision) extra.aiOptionsDecision = aiOptionsDecision;

  const pricingBehavior = clampString(obj.pricingBehavior, 32);
  if (pricingBehavior) extra.pricingBehavior = pricingBehavior;
  const leadTimeThresholdMinutes = typeof obj.leadTimeThresholdMinutes === "number" ? obj.leadTimeThresholdMinutes : null;
  if (typeof leadTimeThresholdMinutes === "number") extra.leadTimeThresholdMinutes = leadTimeThresholdMinutes;
  if (vehiclesCatalog.length) extra.vehiclesCatalog = vehiclesCatalog;
  if (optionsCatalog.length) extra.optionsCatalog = optionsCatalog;

  // Per-vehicle totals computed by the calculator (not by the AI).
  const vehicleQuotesRaw = Array.isArray(obj.vehicleQuotes) ? (obj.vehicleQuotes as unknown[]) : [];
  const vehicleQuotes = vehicleQuotesRaw
    .map((q) => {
      const qq = q && typeof q === "object" ? (q as UnknownRecord) : null;
      if (!qq) return null;
      const id = clampString(qq.id, 64);
      const label = clampString(qq.label, 80);
      const isQuote = !!qq.isQuote;
      const total = typeof qq.total === "number" && Number.isFinite(qq.total) ? qq.total : null;
      if (!id && !label) return null;
      return { id, label, isQuote, total };
    })
    .filter(Boolean)
    .slice(0, 12);
  if (vehicleQuotes.length) extra.vehicleQuotes = vehicleQuotes;

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
    "- Tu utilises uniquement les valeurs du contexte (quote, vehicleQuotes) si elles existent.",
    "- Si le devis n'existe pas encore, tu demandes les informations manquantes et tu invites à cliquer sur 'Calculer les tarifs'.",
    "- Si vehicleQuotes est présent, tu ANNONCES les tarifs calculés par véhicule dans 'recap' (sans recalcul).",
    "- Tu ne promets jamais la disponibilité ni un prix final garanti.",
    "- Tu respectes la confidentialité: ne demande pas de données inutiles.",
    "- Tu NE PROPOSES JAMAIS d'autres chauffeurs, plateformes, comparateurs ou sites web.",
    "- Tu recommandes uniquement des véhicules/options présents dans le contexte (vehiclesCatalog/optionsCatalog).",
    "- Si optionsCatalog n'est pas vide et que le client n'a pas exprimé de préférence, demande: options ou aucune option.",
    "- Si l'utilisateur parle d'un vol/train, tu peux aider à préparer la réservation (marge, terminal/gare).",
    "  - IMPORTANT: le numéro de vol/train est OPTIONNEL. Ne bloque jamais la réservation dessus.",
    "  - Demande le numéro de vol/train UNIQUEMENT si l'utilisateur veut vérifier un horaire/retard, ou s'il demande un suivi en temps réel.",
    "  - Si des infos web sont fournies dans 'webSearch', tu peux t'en servir pour confirmer un horaire/retard.",
    "IMPORTANT: tu dois aussi proposer des mises à jour de formulaire (auto-remplissage) quand c'est possible.",
    "Tu renvoies UNIQUEMENT un JSON valide (pas de markdown, pas de texte autour).",
    "Schéma JSON attendu:",
    "{",
    '  "questionsMissing": string[],',
    '  "recap": string[],',
    '  "nextStep": string[],',
    '  "formUpdate": {',
    '    "pickup"?: string,',
    '    "dropoff"?: string,',
    '    "pickupDate"?: "YYYY-MM-DD",',
    '    "pickupTime"?: "HH:mm",',
    '    "vehicleId"?: string,',
    '    "optionIds"?: string[]',
    "  }",
    "}",
    "Contraintes formUpdate:",
    "- Ne mets un champ QUE si l'utilisateur l'a fourni clairement.",
    "- pickupDate/pickupTime doivent respecter les formats indiqués.",
    "- vehicleId doit correspondre à un id dans vehiclesCatalog (sinon omet).",
    "- optionIds doit contenir uniquement des ids présents dans optionsCatalog.",
    "  - Si le client ne veut AUCUNE option (ex: 'pas d'options'), tu peux mettre optionIds: [] pour indiquer 'aucune option'.",
    "  - Sinon, si tu n'es pas sûr, n'inclus pas optionIds.",
    "- Ne mets jamais de prix dans formUpdate.",
    "Rappels: réponses courtes, en français, orientées action.",
  ].join("\n");
}

function relaxTransportQuestions({ parsed, userMessage }: { parsed: UnknownRecord; userMessage: string }) {
  const q = Array.isArray(parsed.questionsMissing) ? (parsed.questionsMissing as unknown[]) : null;
  if (!q) return;

  const msg = userMessage.toLowerCase();
  const scheduleIntent =
    msg.includes("retard") ||
    msg.includes("en retard") ||
    msg.includes("horaire") ||
    msg.includes("statut") ||
    msg.includes("status") ||
    msg.includes("sur internet") ||
    msg.includes("suivi") ||
    msg.includes("tracker") ||
    msg.includes("vérifi") ||
    msg.includes("verifi") ||
    msg.includes("chercher") ||
    msg.includes("recherche");

  const noNumber =
    msg.includes("pas de num") || msg.includes("pas de numéro") || msg.includes("sans num") || msg.includes("sans numéro");

  const timesInMessage = Array.from(msg.matchAll(/\b(\d{1,2}h\d{0,2})\b/g))
    .map((m) => String(m[1] || "").trim())
    .filter(Boolean)
    .slice(0, 6);

  const filtered = q
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .filter((question) => {
      const t = question.toLowerCase();

      // If the user isn't asking for a schedule check, don't insist on flight/train numbers.
      const asksForNumber =
        t.includes("numéro de vol") ||
        t.includes("num vol") ||
        t.includes("numéro du vol") ||
        t.includes("numéro de train") ||
        t.includes("num train") ||
        t.includes("numéro du train");

      if (asksForNumber && (!scheduleIntent || noNumber)) return false;

      // Avoid redundant "confirm the time" questions when the time is already explicitly in the user message.
      if (timesInMessage.length && t.includes("confirmer") && (t.includes("heure") || t.includes("horaire"))) {
        const mentionsSameTime = timesInMessage.some((tm) => t.includes(tm));
        if (mentionsSameTime) return false;
      }

      return true;
    })
    .slice(0, 7);

  parsed.questionsMissing = filtered;

  // If user mentions transport but doesn't want/care about the number, keep it as optional context in recap.
  if ((!scheduleIntent || noNumber) && (msg.includes("vol") || msg.includes("train") || msg.includes("tgv") || msg.includes("sncf"))) {
    const recapRaw = Array.isArray(parsed.recap) ? (parsed.recap as unknown[]) : [];
    const recap = recapRaw
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);

    const already = recap.some((s) => s.toLowerCase().includes("num") && (s.toLowerCase().includes("vol") || s.toLowerCase().includes("train")));
    if (!already) {
      parsed.recap = [...recap, "Vol/train: numéro non communiqué (optionnel)."].slice(0, 12);
    }
  }
}

function extractJsonObject(text: string): UnknownRecord | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const tryParse = (s: string) => {
    try {
      const parsed = JSON.parse(s) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as UnknownRecord) : null;
    } catch {
      return null;
    }
  };

  // Direct JSON
  if (raw.startsWith("{") && raw.endsWith("}")) {
    const direct = tryParse(raw);
    if (direct) return direct;
  }

  // Fenced block fallback
  const fenceMatch = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    const fenced = tryParse(fenceMatch[1].trim());
    if (fenced) return fenced;
  }

  // Best-effort: find first { ... }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = raw.slice(start, end + 1);
    const loose = tryParse(slice);
    if (loose) return loose;
  }

  return null;
}

function normalizeIsoDate(value: unknown) {
  const v = clampString(value, 32);
  if (!v) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

function normalizeTimeHHmm(value: unknown) {
  const v = clampString(value, 16);
  if (!v) return "";
  return /^\d{2}:\d{2}$/.test(v) ? v : "";
}

function sanitizeFormUpdate(value: unknown, ctx: UnknownRecord): AiAssistantFormUpdate | null {
  const obj = value && typeof value === "object" ? (value as UnknownRecord) : null;
  if (!obj) return null;

  const pickup = clampString(obj.pickup, 220);
  const dropoff = clampString(obj.dropoff, 220);
  const pickupDate = normalizeIsoDate(obj.pickupDate);
  const pickupTime = normalizeTimeHHmm(obj.pickupTime);

  const vehiclesCatalogRaw = Array.isArray(ctx.vehiclesCatalog) ? (ctx.vehiclesCatalog as unknown[]) : [];
  const allowedVehicleIds = new Set(
    vehiclesCatalogRaw
      .map((v) => (v && typeof v === "object" ? clampString((v as UnknownRecord).id, 64) : ""))
      .filter(Boolean),
  );
  const vehicleIdCandidate = clampString(obj.vehicleId, 64);
  const vehicleId = vehicleIdCandidate && allowedVehicleIds.has(vehicleIdCandidate) ? vehicleIdCandidate : "";

  const optionsCatalogRaw = Array.isArray(ctx.optionsCatalog) ? (ctx.optionsCatalog as unknown[]) : [];
  const allowedOptionIds = new Set(
    optionsCatalogRaw
      .map((o) => (o && typeof o === "object" ? clampString((o as UnknownRecord).id, 64) : ""))
      .filter(Boolean),
  );
  const hasOptionIdsField = Array.isArray(obj.optionIds);
  const optionIdsRaw = hasOptionIdsField ? ((obj.optionIds as unknown[]) ?? []) : [];
  const optionIds = optionIdsRaw
    .map((x) => clampString(x, 64))
    .filter((id) => id && allowedOptionIds.has(id))
    .slice(0, 12);

  const out: AiAssistantFormUpdate = {};
  if (pickup) out.pickup = pickup;
  if (dropoff) out.dropoff = dropoff;
  if (pickupDate) out.pickupDate = pickupDate;
  if (pickupTime) out.pickupTime = pickupTime;
  if (vehicleId) out.vehicleId = vehicleId;
  // If the model explicitly provided optionIds: [] we treat it as an explicit choice of "no options".
  if (hasOptionIdsField) out.optionIds = optionIds;

  return Object.keys(out).length ? out : null;
}

function formatReplyFromModelJson(obj: UnknownRecord): string {
  const q = Array.isArray(obj.questionsMissing) ? obj.questionsMissing : [];
  const r = Array.isArray(obj.recap) ? obj.recap : [];
  const n = Array.isArray(obj.nextStep) ? obj.nextStep : [];

  const questionsMissing = q
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, 7);
  const recap = r
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, 7);
  const nextStep = n
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, 7);

  const lines: string[] = [];
  lines.push("1) Questions manquantes");
  lines.push(...(questionsMissing.length ? questionsMissing.map((s) => `- ${s}`) : ["- (aucune)"]));
  lines.push("");
  lines.push("2) Récap devis (si quote)");
  lines.push(...(recap.length ? recap.map((s) => `- ${s}`) : ["- (pas encore de devis)" ]));
  lines.push("");
  lines.push("3) Prochaine étape");
  lines.push(
    ...(nextStep.length
      ? nextStep.map((s) => `- ${s}`)
      : ["- Remplissez le calculateur, cliquez sur 'Calculer les tarifs', choisissez un véhicule, puis cliquez sur 'Réserver'."]),
  );
  return lines.join("\n").trim();
}

function ensureOptionsQuestion({ parsed, context }: { parsed: UnknownRecord; context: UnknownRecord }) {
  const optionsCatalogRaw = Array.isArray(context.optionsCatalog) ? (context.optionsCatalog as unknown[]) : [];
  if (!optionsCatalogRaw.length) return;

  // The widget tracks whether we already asked about options once.
  // Requirement: ask only once, then continue with the rest of the form.
  if (context.aiOptionsAskedOnce === true) return;

  // If the widget already has an explicit decision, don't ask.
  const decision = typeof context.aiOptionsDecision === "string" ? context.aiOptionsDecision.trim() : "";
  if (decision && decision !== "unknown") return;

  // If the user already selected options in the calculator context, don't ask.
  const currentOptions = Array.isArray(context.options) ? (context.options as unknown[]) : [];
  const hasSelectedOptionLabels = currentOptions.some((x) => typeof x === "string" && x.trim());
  if (hasSelectedOptionLabels) return;

  // If the model already provided optionIds (including []), don't ask.
  const fu = parsed.formUpdate && typeof parsed.formUpdate === "object" ? (parsed.formUpdate as UnknownRecord) : null;
  if (fu && Array.isArray(fu.optionIds)) return;

  const labels = optionsCatalogRaw
    .map((o) => (o && typeof o === "object" ? clampString((o as UnknownRecord).label, 60) : ""))
    .filter(Boolean)
    .slice(0, 3);

  const examples = labels.length ? ` (ex: ${labels.join(" · ")})` : "";
  const question = `Souhaitez-vous des options${examples}, ou aucune option ?`;

  const existing = Array.isArray(parsed.questionsMissing) ? (parsed.questionsMissing as unknown[]) : [];
  const normalized = existing
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);

  const alreadyAsks = normalized.some((s) => {
    const t = s.toLowerCase();
    return t.includes("aucune option") || t.includes("souhaitez-vous") && t.includes("option");
  });
  if (alreadyAsks) return;

  parsed.questionsMissing = [question, ...normalized].slice(0, 7);
}

function ensureVehicleQuotesInRecap({ parsed, context }: { parsed: UnknownRecord; context: UnknownRecord }) {
  const vehicleQuotesRaw = Array.isArray(context.vehicleQuotes) ? (context.vehicleQuotes as unknown[]) : [];
  if (!vehicleQuotesRaw.length) return;

  const currency = typeof context.currency === "string" && context.currency.trim() ? context.currency.trim() : "EUR";

  const rows = vehicleQuotesRaw
    .map((q) => {
      const qq = q && typeof q === "object" ? (q as UnknownRecord) : null;
      if (!qq) return "";
      const label = clampString(qq.label, 80) || clampString(qq.id, 64);
      const isQuote = !!qq.isQuote;
      const total = typeof qq.total === "number" && Number.isFinite(qq.total) ? qq.total : null;
      if (!label) return "";
      if (isQuote) return `- ${label}: sur devis`;
      if (typeof total === "number") return `- ${label}: ${total.toFixed(2)} ${currency}`;
      return "";
    })
    .filter(Boolean)
    .slice(0, 12);

  if (!rows.length) return;

  const existingRaw = Array.isArray(parsed.recap) ? (parsed.recap as unknown[]) : [];
  const existing = existingRaw
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);

  const alreadyHasTariffs = existing.some((s) => {
    const t = s.toLowerCase();
    return t.includes(":") && (t.includes(currency.toLowerCase()) || t.includes("sur devis"));
  });
  if (alreadyHasTariffs) return;

  parsed.recap = [...existing, "Tarifs calculés (par véhicule):", ...rows].slice(0, 14);
}

function hasSerperKey() {
  return !!String(process.env.SERPER_API_KEY || "").trim();
}

function looksLikeScheduleQuestion(message: string) {
  const m = message.toLowerCase();

  const mentionsTransport =
    m.includes("vol") || m.includes("flight") || m.includes("train") || m.includes("tgv") || m.includes("sncf");
  if (!mentionsTransport) return false;

  // Only treat it as a "schedule" question when the user explicitly asks for a check/verification/status.
  return (
    m.includes("retard") ||
    m.includes("en retard") ||
    m.includes("horaire") ||
    m.includes("statut") ||
    m.includes("status") ||
    m.includes("suivi") ||
    m.includes("tracker") ||
    m.includes("sur internet") ||
    m.includes("vérifi") ||
    m.includes("verifi") ||
    m.includes("chercher") ||
    m.includes("recherche")
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
  const fallbackModel = (process.env.OPENAI_FALLBACK_MODEL || "").trim() || "gpt-4o-mini";
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

  const todayIso = new Date().toISOString().slice(0, 10);
  const messages = [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content:
        `Aujourd'hui (ISO): ${todayIso}\nFuseau: Europe/Paris\n\nContexte (ne pas inventer):\n${JSON.stringify({ ...context, webSearch })}\n\nMessage utilisateur:\n${userMessage}`,
    },
  ];

  async function callChatCompletions(modelToUse: string) {
    const ml = modelToUse.toLowerCase();

    const defaultMaxCompletionTokens = ml.startsWith("gpt-5") || ml.startsWith("o1") ? 1500 : 520;
    const maxTokensOverride = parsePositiveIntEnv(process.env.OPENAI_MAX_COMPLETION_TOKENS);
    const maxCompletionTokens = maxTokensOverride ?? defaultMaxCompletionTokens;

    const tokenLimits =
      ml.startsWith("gpt-5") || ml.startsWith("o1")
        ? { max_completion_tokens: maxCompletionTokens }
        : { max_tokens: 520 };
    const tokenParam = Object.prototype.hasOwnProperty.call(tokenLimits, "max_completion_tokens")
      ? "max_completion_tokens"
      : "max_tokens";

    const sampling = ml.startsWith("gpt-5") || ml.startsWith("o1") ? {} : { temperature: 0.25 };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelToUse,
        ...sampling,
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

      if (typeof c === "string") {
        content = c;
      } else if (Array.isArray(c)) {
        // Some models return structured content parts.
        let combined = "";
        for (const part of c) {
          if (typeof part === "string") {
            combined += part;
            continue;
          }
          if (part && typeof part === "object") {
            const p = part as UnknownRecord;
            const t = p.text;
            if (typeof t === "string") {
              combined += t;
              continue;
            }
            if (t && typeof t === "object") {
              const v = (t as UnknownRecord).value;
              if (typeof v === "string") combined += v;
            }
          }
        }
        content = combined;
      }
    }

    const reply = content.trim();
    if (!reply) {
      // Diagnostics for operators (Render logs). Do not include request content.
      try {
        const keys = data && typeof data === "object" ? Object.keys(data).slice(0, 25) : [];
        const first = Array.isArray(choices) && choices.length ? (choices[0] as UnknownRecord) : null;
        const msg = first?.message && typeof first.message === "object" ? (first.message as UnknownRecord) : null;
        const msgKeys = msg ? Object.keys(msg).slice(0, 25) : [];
        const contentType = msg && "content" in msg ? (Array.isArray(msg.content) ? "array" : typeof msg.content) : "missing";
        const preview = text ? text.slice(0, 600) : null;
        console.error("openai chat empty", { model: modelToUse, tokenParam, keys, msgKeys, contentType, preview });
      } catch {
        // ignore
      }
    }

    return { ok: true as const, reply, api: "chat.completions" as const, tokenParam };
  }

  async function callResponses(modelToUse: string) {
    const input = `Contexte (ne pas inventer):\n${JSON.stringify({ ...context, webSearch })}\n\nMessage utilisateur:\n${userMessage}`;
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelToUse,
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
        console.error("openai responses empty", { model: modelToUse, keys, outType, cType, textType });
      } catch {
        // ignore
      }
    }

    return { ok: true as const, reply, api: "responses" as const, tokenParam: "max_output_tokens" as const };
  }

  // Prefer chat/completions for broad compatibility. Enable Responses API explicitly if needed.
  const useResponses = parseBooleanEnv(process.env.OPENAI_USE_RESPONSES) && modelLower.startsWith("gpt-5");
  const res = useResponses ? await callResponses(model) : await callChatCompletions(model);
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

  const replyRaw = res.reply.trim();
  if (!replyRaw) {
    // Some GPT-5 configs can consume all tokens in reasoning and produce no visible text.
    // Fallback to a text-reliable model to keep the widget functional.
    if (modelLower.startsWith("gpt-5") && fallbackModel && fallbackModel !== model) {
      const retry = await callChatCompletions(fallbackModel);
      if (retry.ok) {
        const fb = retry.reply.trim();
        if (fb) {
          return { ok: true as const, reply: fb };
        }
      } else {
        console.error("ai-assistant fallback failed", { prevModel: model, fallbackModel, status: retry.status, detail: retry.detail });
      }
    }

    return { ok: false as const, error: "OPENAI_EMPTY" as const };
  }

  // Prefer structured output when possible.
  const parsed = extractJsonObject(replyRaw);
  if (parsed) {
    relaxTransportQuestions({ parsed, userMessage });
    ensureOptionsQuestion({ parsed, context });
    ensureVehicleQuotesInRecap({ parsed, context });
    const formUpdate = sanitizeFormUpdate(parsed.formUpdate, context);
    const reply = formatReplyFromModelJson(parsed);
    return { ok: true as const, reply, formUpdate };
  }

  // Fallback: treat as plain text.
  return { ok: true as const, reply: replyRaw };
}
