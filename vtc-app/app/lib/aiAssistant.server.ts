type UnknownRecord = Record<string, unknown>;

import { computeTariffForVehicle, type TenantPricingConfig } from "./pricing.server";

export type AiAssistantFormUpdate = {
  pickup?: string;
  dropoff?: string;
  pickupDate?: string;
  pickupTime?: string;
  vehicleId?: string;
  optionIds?: string[];
  // UI-only hint for the widget: which vehicles to highlight.
  // IMPORTANT: no prices here; the widget already has vehicleQuotes with totals.
  suggestedVehicleIds?: string[];
};

export type AiAssistantRequestBody = {
  context: UnknownRecord;
  userMessage: string;
  history?: { role: "user" | "assistant"; content: string }[];
};

function sanitizeHistory(raw: unknown) {
  const arr = Array.isArray(raw) ? raw : [];
  const out: { role: "user" | "assistant"; content: string }[] = [];

  for (const item of arr) {
    if (out.length >= 12) break;
    const obj = item && typeof item === "object" ? (item as UnknownRecord) : null;
    if (!obj) continue;
    const roleRaw = typeof obj.role === "string" ? obj.role.trim() : "";
    const role = roleRaw === "assistant" ? "assistant" : roleRaw === "user" ? "user" : "";
    if (!role) continue;
    const content = clampString(obj.content, 900);
    if (!content) continue;
    out.push({ role, content });
  }

  return out;
}

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
  const vehicleId = clampString(obj.vehicleId, 64);
  const currency = clampString(obj.currency, 8) || "EUR";

  const optionsRaw = Array.isArray(obj.options) ? obj.options : [];
  const options = optionsRaw
    .map((o) => (typeof o === "string" ? clampString(o, 80) : ""))
    .filter(Boolean)
    .slice(0, 12);

  const selectedOptionIdsRaw = Array.isArray(obj.selectedOptionIds) ? obj.selectedOptionIds : [];
  const selectedOptionIds = selectedOptionIdsRaw
    .map((x) => clampString(x, 64))
    .filter(Boolean)
    .slice(0, 12);

  const passengersCount = typeof obj.passengersCount === "number" && Number.isFinite(obj.passengersCount) ? obj.passengersCount : null;
  const bagsCount = typeof obj.bagsCount === "number" && Number.isFinite(obj.bagsCount) ? obj.bagsCount : null;

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

  if (typeof obj.aiCountsAskedOnce === "boolean") extra.aiCountsAskedOnce = obj.aiCountsAskedOnce;

  // Internal client hint: allow a second AI pass after the calculator computed vehicleQuotes.
  if (typeof obj.aiSecondPass === "boolean") extra.aiSecondPass = obj.aiSecondPass;

  const pricingBehavior = clampString(obj.pricingBehavior, 32);
  if (pricingBehavior) extra.pricingBehavior = pricingBehavior;
  const leadTimeThresholdMinutes = typeof obj.leadTimeThresholdMinutes === "number" ? obj.leadTimeThresholdMinutes : null;
  if (typeof leadTimeThresholdMinutes === "number") extra.leadTimeThresholdMinutes = leadTimeThresholdMinutes;
  if (vehiclesCatalog.length) extra.vehiclesCatalog = vehiclesCatalog;
  if (optionsCatalog.length) extra.optionsCatalog = optionsCatalog;

  if (selectedOptionIds.length) extra.selectedOptionIds = selectedOptionIds;
  if (typeof passengersCount === "number" && passengersCount > 0 && passengersCount < 50) extra.passengersCount = passengersCount;
  if (typeof bagsCount === "number" && bagsCount >= 0 && bagsCount < 50) extra.bagsCount = bagsCount;

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

  // Full pricing configuration (non-sensitive) used to compute tariffs server-side.
  // Kept bounded and sanitized to prevent payload bloat.
  const pricingCfgRaw = obj.pricingConfig && typeof obj.pricingConfig === "object" ? (obj.pricingConfig as UnknownRecord) : null;
  if (pricingCfgRaw) {
    const stopFee = typeof pricingCfgRaw.stopFee === "number" ? pricingCfgRaw.stopFee : 0;
    const quoteMessage = clampString(pricingCfgRaw.quoteMessage, 180) || "Sur devis — merci de nous contacter.";
    const pricingBehaviorFull = clampString(pricingCfgRaw.pricingBehavior, 32) || "normal_prices";
    const pricingBehavior =
      pricingBehaviorFull === "lead_time_pricing" || pricingBehaviorFull === "all_quote" || pricingBehaviorFull === "normal_prices"
        ? pricingBehaviorFull
        : "normal_prices";
    const leadTimeThresholdMinutes =
      typeof pricingCfgRaw.leadTimeThresholdMinutes === "number" ? pricingCfgRaw.leadTimeThresholdMinutes : 120;

    const immediateSurchargeEnabled = !!pricingCfgRaw.immediateSurchargeEnabled;
    const immediateBaseDeltaAmount = typeof pricingCfgRaw.immediateBaseDeltaAmount === "number" ? pricingCfgRaw.immediateBaseDeltaAmount : 0;
    const immediateBaseDeltaPercent = typeof pricingCfgRaw.immediateBaseDeltaPercent === "number" ? pricingCfgRaw.immediateBaseDeltaPercent : 0;
    const immediateTotalDeltaPercent = typeof pricingCfgRaw.immediateTotalDeltaPercent === "number" ? pricingCfgRaw.immediateTotalDeltaPercent : 0;

    const vehiclesRaw = Array.isArray(pricingCfgRaw.vehicles) ? (pricingCfgRaw.vehicles as unknown[]) : [];
    const vehicles = vehiclesRaw
      .map((v) => {
        const vv = v && typeof v === "object" ? (v as UnknownRecord) : null;
        if (!vv) return null;
        const id = clampString(vv.id, 64);
        const label = clampString(vv.label, 80);
        const baseFare = typeof vv.baseFare === "number" ? vv.baseFare : 0;
        const pricePerKm = typeof vv.pricePerKm === "number" ? vv.pricePerKm : 0;
        const quoteOnly = !!vv.quoteOnly;
        if (!id && !label) return null;
        return { id, label: label || id, baseFare, pricePerKm, quoteOnly };
      })
      .filter(Boolean)
      .slice(0, 12);

    const optionsRaw2 = Array.isArray(pricingCfgRaw.options) ? (pricingCfgRaw.options as unknown[]) : [];
    const options2 = optionsRaw2
      .map((o) => {
        const oo = o && typeof o === "object" ? (o as UnknownRecord) : null;
        if (!oo) return null;
        const id = clampString(oo.id, 64);
        const label = clampString(oo.label, 100);
        const typeRaw = clampString(oo.type, 24);
        const type = typeRaw === "percent" ? "percent" : "fixed";
        const amount = typeof oo.amount === "number" ? oo.amount : 0;
        if (!id && !label) return null;
        return { id, label: label || id, type, amount };
      })
      .filter(Boolean)
      .slice(0, 20);

    extra.pricingConfig = {
      stopFee,
      quoteMessage,
      pricingBehavior,
      leadTimeThresholdMinutes,
      immediateSurchargeEnabled,
      immediateBaseDeltaAmount,
      immediateBaseDeltaPercent,
      immediateTotalDeltaPercent,
      vehicles,
      options: options2,
    };
  }

  return {
    pickup,
    dropoff,
    date,
    time,
    vehicle,
    vehicleId,
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
  const history = sanitizeHistory(obj.history);

  return {
    ok: true as const,
    value: { userMessage, context, history },
  };
}

export function buildSystemPrompt() {
  return [
    "Tu es l'assistant de réservation du site sur lequel tu es installé (VTC premium).",
    "Objectif: aider l'utilisateur à compléter sa demande et à réserver.",
    "Règles STRICTES:",
    "- Tu ne recalcules JAMAIS un prix. Tu ne modifies pas le devis.",
    "- Tu utilises uniquement les valeurs du contexte (quote, vehicleQuotes) si elles existent.",
    "- Confidentialité prix: tu ne révèles JAMAIS la base, le prix/km, les formules, ni les paramètres internes. Tu n'affiches que des totaux.",
    "- Quand tu annonces un tarif: dis toujours que c'est une estimation et que le chauffeur confirmera la demande et le tarif.",
    "- Procédure de réservation: (1) départ + arrivée + date + heure, (2) arrêt(s)/aller-retour si mentionné, (3) options (ou aucune), (4) passagers + bagages, (5) récap + tarifs si disponibles.",
    "- Si les tarifs ne sont pas encore disponibles (vehicleQuotes absent), tu demandes les informations manquantes (départ, arrivée, date, heure, passagers, bagages, options).",
    "- Tu ne mentionnes JAMAIS un calculateur, un bouton, ni une action du type “cliquez sur …”.",
    "- Interprétation: un nombre dans une date/heure (ex: 'le 20', '14h30') n'est PAS un nombre de passagers/bagages sans mots-clés (pax, passagers, bagages, valises, etc.).",
    "- Mots-clés à comprendre: prise en charge/départ/origine, arrivée/destination/dépose, arrêt/stop/escale, retour/aller-retour.",
    "- Si vehicleQuotes est présent, tu ANNONCES les tarifs calculés par véhicule dans 'recap' (sans recalcul).",
    "- Tu ne promets jamais la disponibilité ni un prix final garanti.",
    "- Tu respectes la confidentialité: ne demande pas de données inutiles.",
    "- Tu NE PROPOSES JAMAIS d'autres chauffeurs, plateformes, comparateurs ou sites web.",
    "- Tu recommandes uniquement des véhicules/options présents dans le contexte (vehiclesCatalog/optionsCatalog).",
    "- Si le client choisit un véhicule non adapté (places/bagages), tu l'avertis et tu proposes un véhicule plus adapté; tu peux préciser que le chauffeur pourra adapter le véhicule si nécessaire.",
    "- Si optionsCatalog n'est pas vide et que le client n'a pas exprimé de préférence, demande: options ou aucune option.",
    "- Si l'utilisateur parle d'un vol/train, tu peux aider à préparer la réservation (marge, terminal/gare).",
    "  - IMPORTANT: le numéro de vol/train est OPTIONNEL. Ne bloque jamais la réservation dessus.",
    "  - Demande le numéro de vol/train UNIQUEMENT si l'utilisateur veut vérifier un horaire/retard, ou s'il demande un suivi en temps réel.",
    "  - Si des infos web sont fournies dans 'webSearch', tu peux t'en servir pour confirmer un horaire/retard.",
    "- Langue: réponds naturellement dans la même langue que l'utilisateur (français, anglais, etc.).",
    "- Si context.aiSecondPass === true et vehicleQuotes est présent, réponds directement avec les tarifs et la prochaine action (choisir véhicule / réserver).",
    "IMPORTANT: tu dois aussi proposer des mises à jour de formulaire (auto-remplissage) quand c'est possible.",
    "Tu renvoies UNIQUEMENT un JSON valide (pas de markdown, pas de texte autour).",
    "Schéma JSON attendu:",
    "{",
    '  "answer"?: string,',
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
    "Style: ton premium, clair, orienté action. Réponds naturellement dans la langue de l'utilisateur.",
  ].join("\n");
}

function getGoogleMapsApiKey() {
  const key = String(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  return key || "";
}

async function getDrivingKmAndMinutes(opts: { origin: string; destination: string }) {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) return { ok: false as const, error: "GOOGLE_NOT_CONFIGURED" as const };

  const origin = opts.origin.trim();
  const destination = opts.destination.trim();
  if (!origin || !destination) return { ok: false as const, error: "MISSING_ADDRESSES" as const };

  const url =
    "https://maps.googleapis.com/maps/api/directions/json" +
    `?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}` +
    `&mode=driving` +
    `&language=fr` +
    `&key=${encodeURIComponent(apiKey)}`;

  const resp = await fetch(url, { method: "GET" });
  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    return {
      ok: false as const,
      error: "GOOGLE_DIRECTIONS_FAILED" as const,
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

  const status = typeof data?.status === "string" ? data.status : "";
  if (status && status !== "OK") {
    return {
      ok: false as const,
      error: "GOOGLE_DIRECTIONS_STATUS" as const,
      status,
      detail: typeof data?.error_message === "string" ? data.error_message.slice(0, 260) : null,
    };
  }

  const routes = Array.isArray(data?.routes) ? (data?.routes as UnknownRecord[]) : [];
  const firstRoute = routes[0] && typeof routes[0] === "object" ? (routes[0] as UnknownRecord) : null;
  const legs = Array.isArray(firstRoute?.legs) ? (firstRoute.legs as UnknownRecord[]) : [];
  if (!legs.length) return { ok: false as const, error: "NO_ROUTE" as const };

  let meters = 0;
  let seconds = 0;
  for (const leg of legs) {
    const dVal = (leg?.distance && typeof leg.distance === "object" ? (leg.distance as UnknownRecord).value : null) as unknown;
    const tVal = (leg?.duration && typeof leg.duration === "object" ? (leg.duration as UnknownRecord).value : null) as unknown;
    const m = typeof dVal === "number" ? dVal : 0;
    const s = typeof tVal === "number" ? tVal : 0;
    if (Number.isFinite(m)) meters += m;
    if (Number.isFinite(s)) seconds += s;
  }

  const km = meters / 1000;
  const minutes = seconds / 60;
  if (!Number.isFinite(km) || km <= 0) return { ok: false as const, error: "INVALID_DISTANCE" as const };

  return { ok: true as const, km, minutes: Number.isFinite(minutes) ? minutes : null };
}

function ensureRouteClarification({
  parsed,
  routeError,
  pickup,
  dropoff,
}: {
  parsed: UnknownRecord;
  routeError: { error: string; status?: unknown };
  pickup: string;
  dropoff: string;
}) {
  const existingRaw = Array.isArray(parsed.questionsMissing) ? (parsed.questionsMissing as unknown[]) : [];
  const existing = existingRaw
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);

  const already = existing.some((s) => {
    const t = s.toLowerCase();
    return t.includes("préciser") && (t.includes("adresse") || t.includes("départ") || t.includes("arrivée"));
  });
  if (already) return;

  const isShort = (s: string) => {
    const v = String(s || "").trim();
    if (!v) return true;
    if (v.length < 8) return true;
    // Heuristic: a single token like "CDG" / "Paris" is likely ambiguous.
    const tokens = v.split(/\s+/).filter(Boolean);
    return tokens.length <= 1;
  };

  const needsPickup = isShort(pickup);
  const needsDropoff = isShort(dropoff);

  const base =
    routeError.error === "GOOGLE_NOT_CONFIGURED"
      ? "Je ne peux pas calculer automatiquement l’itinéraire pour le moment (service de calcul indisponible)."
      : "Je n’arrive pas à calculer l’itinéraire avec ces informations.";

  const ask = (() => {
    const parts: string[] = [];
    parts.push(base);
    parts.push(
      "Pouvez-vous préciser les adresses avec au minimum : numéro + rue, ville, code postal (et pays si hors France) ?",
    );

    // Targeted hints
    parts.push(
      "Si c’est un aéroport/gare : indiquez le terminal/porte (ou nom exact), et si vous avez une préférence (dépose minute / arrivée / départ).",
    );

    if (needsPickup || needsDropoff) {
      const which = [
        needsPickup ? "départ" : "",
        needsDropoff ? "arrivée" : "",
      ]
        .filter(Boolean)
        .join(" et ");
      parts.push(`En priorité : précisez l’adresse de ${which}.`);
    }

    // Help the user answer fast.
    parts.push(
      "Exemple : “12 rue de Rivoli, 75004 Paris” → “Terminal 2E, Aéroport CDG, 95700 Roissy-en-France”.",
    );
    return parts.join(" ").trim();
  })();

  parsed.questionsMissing = [ask, ...existing].slice(0, 7);

  // Also keep the next step actionable.
  const nextRaw = Array.isArray(parsed.nextStep) ? (parsed.nextStep as unknown[]) : [];
  const next = nextRaw
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
  const hasNext = next.some((s) => s.toLowerCase().includes("adresse") || s.toLowerCase().includes("précis"));
  if (!hasNext) {
    parsed.nextStep = ["Donnez les adresses complètes (départ/arrivée) pour que je calcule les tarifs.", ...next].slice(0, 7);
  }
}

function sanitizePricingConfig(value: unknown): TenantPricingConfig | null {
  const obj = value && typeof value === "object" ? (value as UnknownRecord) : null;
  if (!obj) return null;

  const pricingBehaviorRaw = typeof obj.pricingBehavior === "string" ? obj.pricingBehavior.trim() : "";
  const pricingBehavior: TenantPricingConfig["pricingBehavior"] =
    pricingBehaviorRaw === "lead_time_pricing" || pricingBehaviorRaw === "all_quote" || pricingBehaviorRaw === "normal_prices"
      ? pricingBehaviorRaw
      : "normal_prices";

  const vehicles: TenantPricingConfig["vehicles"] = [];
  const vehiclesRaw = Array.isArray(obj.vehicles) ? (obj.vehicles as unknown[]) : [];
  for (const v of vehiclesRaw) {
    if (vehicles.length >= 12) break;
    const vv = v && typeof v === "object" ? (v as UnknownRecord) : null;
    if (!vv) continue;
    const id = clampString(vv.id, 64);
    if (!id) continue;
    const label = clampString(vv.label, 80) || id;
    const baseFare = typeof vv.baseFare === "number" && Number.isFinite(vv.baseFare) ? vv.baseFare : 0;
    const pricePerKm = typeof vv.pricePerKm === "number" && Number.isFinite(vv.pricePerKm) ? vv.pricePerKm : 0;
    const quoteOnly = !!vv.quoteOnly;
    vehicles.push({ id, label, baseFare, pricePerKm, quoteOnly });
  }

  const options: TenantPricingConfig["options"] = [];
  const optionsRaw = Array.isArray(obj.options) ? (obj.options as unknown[]) : [];
  for (const o of optionsRaw) {
    if (options.length >= 20) break;
    const oo = o && typeof o === "object" ? (o as UnknownRecord) : null;
    if (!oo) continue;
    const id = clampString(oo.id, 64);
    if (!id) continue;
    const label = clampString(oo.label, 100) || id;
    const typeRaw = clampString(oo.type, 24);
    const type = typeRaw === "percent" ? "percent" : "fixed";
    const amount = typeof oo.amount === "number" && Number.isFinite(oo.amount) ? oo.amount : 0;
    options.push({ id, label, type, amount });
  }

  return {
    stopFee: typeof obj.stopFee === "number" && Number.isFinite(obj.stopFee) ? obj.stopFee : 0,
    quoteMessage: clampString(obj.quoteMessage, 180) || "Sur devis — merci de nous contacter.",
    pricingBehavior,
    leadTimeThresholdMinutes:
      typeof obj.leadTimeThresholdMinutes === "number" && Number.isFinite(obj.leadTimeThresholdMinutes) ? obj.leadTimeThresholdMinutes : 120,
    immediateSurchargeEnabled: !!obj.immediateSurchargeEnabled,
    immediateBaseDeltaAmount:
      typeof obj.immediateBaseDeltaAmount === "number" && Number.isFinite(obj.immediateBaseDeltaAmount) ? obj.immediateBaseDeltaAmount : 0,
    immediateBaseDeltaPercent:
      typeof obj.immediateBaseDeltaPercent === "number" && Number.isFinite(obj.immediateBaseDeltaPercent) ? obj.immediateBaseDeltaPercent : 0,
    immediateTotalDeltaPercent:
      typeof obj.immediateTotalDeltaPercent === "number" && Number.isFinite(obj.immediateTotalDeltaPercent) ? obj.immediateTotalDeltaPercent : 0,
    vehicles,
    options,
  };
}

function formatVehicleQuotesBlock(context: UnknownRecord) {
  const vehicleQuotesRaw = Array.isArray(context.vehicleQuotes) ? (context.vehicleQuotes as unknown[]) : [];
  if (!vehicleQuotesRaw.length) return "";

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

  if (!rows.length) return "";
  return [
    "",
    "Tarifs estimatifs (total par véhicule):",
    ...rows,
    "",
    "NB: Ces prix sont des estimations. Le chauffeur confirmera votre demande et le tarif.",
  ].join("\n");
}

function extractCountsFromText(text: string) {
  const t = String(text || "").toLowerCase();
  const out: { passengers: number | null; bags: number | null } = { passengers: null, bags: null };

  const wordToNumber = (w: string) => {
    const s = String(w || "").trim().toLowerCase();
    const map: Record<string, number> = {
      un: 1,
      une: 1,
      deux: 2,
      trois: 3,
      quatre: 4,
      cinq: 5,
      six: 6,
      sept: 7,
      huit: 8,
      neuf: 9,
      dix: 10,
    };
    return Object.prototype.hasOwnProperty.call(map, s) ? map[s] : null;
  };

  // Passengers (pax/personnes/adultes/enfants)
  const paxMatch = t.match(/\b(\d{1,2}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*(?:pax|passagers?|personnes?|adultes?|enfants?)\b/);
  if (paxMatch && paxMatch[1]) {
    const n = /^\d/.test(paxMatch[1]) ? Number(paxMatch[1]) : wordToNumber(paxMatch[1]);
    if (n !== null && Number.isFinite(n) && n > 0 && n < 50) out.passengers = n;
  }

  // Bags (valises/bagages/sacs)
  const bagMatch = t.match(/\b(\d{1,2}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*(?:valises?|bagages?|sacs?)\b/);
  if (bagMatch && bagMatch[1]) {
    const n = /^\d/.test(bagMatch[1]) ? Number(bagMatch[1]) : wordToNumber(bagMatch[1]);
    if (n !== null && Number.isFinite(n) && n >= 0 && n < 50) out.bags = n;
  }

  // Heuristic: if the user responds with two numbers like "2/3" or "2 3" after being asked.
  // We don't apply it blindly here (caller can decide), but keep a helper pattern.

  return out;
}

function extractCountsFromConversation({ userMessage, history }: { userMessage: string; history?: { role: "user" | "assistant"; content: string }[] }) {
  const allTexts: string[] = [];
  if (Array.isArray(history)) {
    for (const h of history) {
      if (h && typeof h.content === "string") allTexts.push(h.content);
    }
  }
  allTexts.push(userMessage);

  let passengers: number | null = null;
  let bags: number | null = null;

  for (let i = allTexts.length - 1; i >= 0; i -= 1) {
    const { passengers: p, bags: b } = extractCountsFromText(allTexts[i] || "");
    if (passengers === null && typeof p === "number") passengers = p;
    if (bags === null && typeof b === "number") bags = b;
    if (passengers !== null && bags !== null) break;
  }

  // If still missing, apply a small heuristic on the latest user message when the assistant just asked.
  if (passengers === null || bags === null) {
    const lastAssistant = Array.isArray(history)
      ? [...history].reverse().find((h) => h && h.role === "assistant" && typeof h.content === "string")
      : null;
    const askedForCounts = lastAssistant
      ? /passagers?|pax|bagages?|valises?/i.test(String(lastAssistant.content || ""))
      : false;

    if (askedForCounts) {
      const msg = String(userMessage || "").trim();

      // Prefer explicit shorthand first.
      const slash = msg.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
      if (slash && (passengers === null || bags === null)) {
        const p = Number(slash[1]);
        const b = Number(slash[2]);
        if (passengers === null && Number.isFinite(p) && p > 0 && p < 50) passengers = p;
        if (bags === null && Number.isFinite(b) && b >= 0 && b < 50) bags = b;
      }

      const looksLikeDateOrTime = (() => {
        const m = msg.toLowerCase();
        if (/^\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/.test(m)) return false;
        if (/\b(pax|passagers?|personnes?|adultes?|enfants?|bagages?|valises?|sacs?)\b/i.test(m)) return false;

        const month = /(janv|janvier|fevr|févr|fevrier|février|mars|avr|avril|mai|juin|juil|juillet|aout|août|sept|septembre|oct|octobre|nov|novembre|dec|déc|decembre|décembre)/;
        if (month.test(m)) return true;
        if (/\b\d{4}-\d{1,2}-\d{1,2}\b/.test(m)) return true;
        if (/\b\d{1,2}\s*[.-]\s*\d{1,2}\b/.test(m)) return true;
        if (/\b\d{1,2}\s*\/\s*\d{1,2}\b/.test(m)) return true;
        if (/\b\d{1,2}\s*h\s*\d{0,2}\b/.test(m)) return true;
        if (/\b\d{1,2}:\d{2}\b/.test(m)) return true;
        if (/\ble\s+\d{1,2}\b/.test(m)) return true;
        return false;
      })();

      // Avoid misreading date/time like "le 20 à 14h" as pax/bags.
      if (looksLikeDateOrTime) return { passengers, bags };

      const nums = Array.from(msg.matchAll(/\b(\d{1,2})\b/g))
        .map((m) => Number(m[1]))
        .filter((n) => Number.isFinite(n))
        .slice(0, 4);

      const wordMap: Record<string, number> = {
        un: 1,
        une: 1,
        deux: 2,
        trois: 3,
        quatre: 4,
        cinq: 5,
        six: 6,
        sept: 7,
        huit: 8,
        neuf: 9,
        dix: 10,
      };
      const wordNums = Array.from(msg.toLowerCase().matchAll(/\b(un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\b/g))
        .map((m) => wordMap[m[1]] ?? null)
        .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
        .slice(0, 4);

      const seq = nums.length >= 2 ? nums : wordNums;
      // Accept patterns like "2 3" or "2/3" meaning pax/bags.
      if (seq.length >= 2) {
        if (passengers === null && seq[0] > 0) passengers = seq[0];
        if (bags === null && seq[1] >= 0) bags = seq[1];
      }
    }
  }

  return { passengers, bags };
}

function inferOptionsDecisionFromConversation({ userMessage, history, optionsCatalogLabels }: { userMessage: string; history?: { role: "user" | "assistant"; content: string }[]; optionsCatalogLabels: string[] }) {
  const texts: string[] = [];
  if (Array.isArray(history)) {
    for (const h of history) {
      if (h && typeof h.content === "string") texts.push(h.content);
    }
  }
  texts.push(userMessage);
  const t = texts.join("\n").toLowerCase();

  const saysNo =
    t.includes("aucune option") ||
    t.includes("sans option") ||
    t.includes("pas d'option") ||
    t.includes("pas de option") ||
    t.includes("non merci") ||
    t.includes("rien") && t.includes("option");
  if (saysNo) return "none" as const;

  const normalizedLabels = optionsCatalogLabels
    .map((s) => String(s || "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
  const mentionsLabel = normalizedLabels.some((lbl) => lbl.length >= 3 && t.includes(lbl));
  const saysYes = t.includes("oui") && t.includes("option");
  if (mentionsLabel || saysYes) return "some" as const;

  return "" as const;
}

function inferCapacityFromLabel(label: string) {
  const s = String(label || "").toLowerCase();
  const m = s.match(/\b(\d{1,2})\s*(?:pax|places?)\b/);
  if (m && m[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n < 50) return n;
  }
  return null;
}

function isVanLike(label: string) {
  const s = String(label || "").toLowerCase();
  return s.includes("van") || s.includes("minibus") || s.includes("mini bus") || s.includes("minivan");
}

function buildVehicleFitWarning({
  vehicleId,
  vehicleQuotes,
  passengers,
  bags,
}: {
  vehicleId: string;
  vehicleQuotes: { id: string; label: string }[];
  passengers: number;
  bags: number | null;
}) {
  const vid = String(vehicleId || "").trim();
  if (!vid) return "";
  const v = vehicleQuotes.find((q) => q.id === vid);
  if (!v) return "";

  const label = String(v.label || "").trim() || vid;
  const cap = inferCapacityFromLabel(label);
  const vanLike = isVanLike(label);

  const bagsNum = typeof bags === "number" && Number.isFinite(bags) ? bags : null;
  const likelyManyBags = bagsNum !== null && (bagsNum >= 4 || (bagsNum >= 3 && bagsNum >= passengers));

  if (typeof cap === "number" && cap > 0 && passengers > cap) {
    return `Attention: ${label} semble limité à ${cap} place(s). Avec ${passengers} passagers, je recommande un véhicule plus grand (van/minivan). Le chauffeur pourra adapter le véhicule si besoin.`;
  }

  if (!vanLike && likelyManyBags) {
    const bagsTxt = bagsNum !== null ? `${bagsNum} bagage(s)` : "plusieurs bagages";
    return `Attention: avec ${passengers} passagers et ${bagsTxt}, une berline peut être juste. Un van/minivan sera plus adapté; le chauffeur pourra adapter le véhicule si besoin.`;
  }

  return "";
}

function recommendVehicles({ vehicleQuotes, passengers, bags }: { vehicleQuotes: { id?: string; label?: string; isQuote?: boolean; total?: number | null }[]; passengers: number; bags: number | null }) {
  const fixed = vehicleQuotes
    .map((q) => ({
      id: String(q.id || "").trim(),
      label: String(q.label || q.id || "").trim(),
      isQuote: !!q.isQuote,
      total: typeof q.total === "number" && Number.isFinite(q.total) ? q.total : null,
      capacity: inferCapacityFromLabel(String(q.label || q.id || "")),
      vanLike: isVanLike(String(q.label || q.id || "")),
    }))
    .filter((q) => q.label)
    .filter((q) => !q.isQuote && typeof q.total === "number")
    .sort((a, b) => (a.total ?? 0) - (b.total ?? 0));

  const fits = fixed.filter((q) => (typeof q.capacity === "number" ? q.capacity >= passengers : true));
  const pool = fits.length ? fits : fixed;
  if (!pool.length) return [] as typeof fixed;

  const picked: typeof fixed = [];
  picked.push(pool[0]);

  const wantsVan = typeof bags === "number" && (bags >= 4 || (bags >= 3 && bags >= passengers));
  if (wantsVan) {
    const vanAlt = pool.find((q) => q.vanLike && q.id !== picked[0].id);
    if (vanAlt) picked.push(vanAlt);
  }

  for (const q of pool) {
    if (picked.length >= 3) break;
    if (picked.some((p) => p.id === q.id)) continue;
    picked.push(q);
  }

  return picked.slice(0, 3);
}

async function maybeEnrichContextWithVehicleQuotes({
  context,
  pickup,
  dropoff,
  pickupDate,
  pickupTime,
  selectedOptionIds,
}: {
  context: UnknownRecord;
  pickup: string;
  dropoff: string;
  pickupDate: string;
  pickupTime: string;
  selectedOptionIds: string[];
}) {
  let enrichedContext: UnknownRecord = context;
  try {
    const pricingConfig = sanitizePricingConfig((context as UnknownRecord).pricingConfig);
    const stopsCount = typeof context.stopsCount === "number" ? Math.max(0, context.stopsCount) : 0;
    if (!pricingConfig || !pickup || !dropoff) return enrichedContext;

    const dir = await getDrivingKmAndMinutes({ origin: pickup, destination: dropoff });
    if (!dir.ok) return enrichedContext;

    const vehicleQuotes = (pricingConfig.vehicles || [])
      .map((v) => {
        const result = computeTariffForVehicle(pricingConfig, {
          km: dir.km,
          stopsCount,
          pickupDate: pickupDate || "",
          pickupTime: pickupTime || "",
          vehicleId: v.id,
          selectedOptionIds: selectedOptionIds || [],
        });

        if (!result.ok) return null;
        if (result.isQuote) return { id: result.vehicleId, label: result.vehicleLabel, isQuote: true, total: null };
        return {
          id: result.vehicleId,
          label: result.vehicleLabel,
          isQuote: false,
          total: typeof result.total === "number" && Number.isFinite(result.total) ? result.total : null,
        };
      })
      .filter(Boolean)
      .slice(0, 12);

    enrichedContext = {
      ...context,
      vehicleQuotes,
      quote: {
        ...(context.quote && typeof context.quote === "object" ? (context.quote as UnknownRecord) : {}),
        distance: dir.km,
        duration: typeof dir.minutes === "number" ? dir.minutes : null,
      },
    };
  } catch {
    enrichedContext = context;
  }

  return enrichedContext;
}

function redactContextForModel(raw: UnknownRecord): UnknownRecord {
  const ctx: UnknownRecord = { ...(raw || {}) };

  // Pricing internals must never be exposed to the model.
  if ("pricingConfig" in ctx) delete ctx.pricingConfig;

  // Defensive: even if the client sends extra fields, keep only non-sensitive vehicle catalog data.
  if (Array.isArray(ctx.vehiclesCatalog)) {
    ctx.vehiclesCatalog = (ctx.vehiclesCatalog as unknown[])
      .map((v) => {
        const vv = v && typeof v === "object" ? (v as UnknownRecord) : null;
        if (!vv) return null;
        const id = clampString(vv.id, 64);
        const label = clampString(vv.label, 100) || id;
        const quoteOnly = !!vv.quoteOnly;
        return id || label ? { id, label, quoteOnly } : null;
      })
      .filter(Boolean)
      .slice(0, 12);
  }

  // Options catalog is OK (it doesn't contain pricing formula), but clamp anyway.
  if (Array.isArray(ctx.optionsCatalog)) {
    ctx.optionsCatalog = (ctx.optionsCatalog as unknown[])
      .map((o) => {
        const oo = o && typeof o === "object" ? (o as UnknownRecord) : null;
        if (!oo) return null;
        const id = clampString(oo.id, 64);
        const label = clampString(oo.label, 100) || id;
        const typeRaw = clampString(oo.type, 24);
        const type = typeRaw === "percent" ? "percent" : "fixed";
        const amount = typeof oo.amount === "number" && Number.isFinite(oo.amount) ? oo.amount : 0;
        return id || label ? { id, label, type, amount } : null;
      })
      .filter(Boolean)
      .slice(0, 20);
  }

  return ctx;
}

function answerLooksLikePricingLeak(answer: string) {
  const a = String(answer || "").toLowerCase();
  return (
    a.includes("€/km") ||
    a.includes("eur/km") ||
    a.includes("euro/km") ||
    a.includes("(base") ||
    a.includes("base)") ||
    /\bbase\b/.test(a)
  );
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

  const suggestedVehicleIdsRaw = Array.isArray(obj.suggestedVehicleIds) ? (obj.suggestedVehicleIds as unknown[]) : [];
  const suggestedVehicleIds = suggestedVehicleIdsRaw
    .map((x) => clampString(x, 64))
    .filter((id) => id && allowedVehicleIds.has(id))
    .slice(0, 3);

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
  if (suggestedVehicleIds.length) out.suggestedVehicleIds = suggestedVehicleIds;

  return Object.keys(out).length ? out : null;
}

function formatReplyFromModelJson(obj: UnknownRecord, context?: UnknownRecord): string {
  // Prefer a natural-language answer if provided.
  let answer = typeof obj.answer === "string" ? obj.answer.trim() : "";
  if (answer) {
    const tariffs = context ? formatVehicleQuotesBlock(context) : "";
    // Safety net: if the model tries to reveal base/€/km, replace with a safe phrasing.
    if (answerLooksLikePricingLeak(answer)) {
      answer = "Voici une estimation du prix total pour votre trajet (sans détail de calcul).";
    }
    return `${answer}${tariffs}`.trim();
  }

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
      : ["- Donnez les informations manquantes pour obtenir une estimation, puis choisissez un véhicule et passez à la réservation."]),
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
  history,
}: {
  userMessage: string;
  context: UnknownRecord;
  history?: { role: "user" | "assistant"; content: string }[];
}) {
  const optionsCatalogRaw = Array.isArray(context.optionsCatalog) ? (context.optionsCatalog as unknown[]) : [];
  const optionsCatalogLabels = optionsCatalogRaw
    .map((o) => (o && typeof o === "object" ? clampString((o as UnknownRecord).label, 60) : ""))
    .filter(Boolean)
    .slice(0, 20);

  const hasOptionsCatalog = optionsCatalogLabels.length > 0;

  const inferredOptionsDecision = inferOptionsDecisionFromConversation({ userMessage, history, optionsCatalogLabels });
  let effectiveOptionsDecision =
    typeof context.aiOptionsDecision === "string" && context.aiOptionsDecision.trim()
      ? context.aiOptionsDecision.trim()
      : inferredOptionsDecision;

  // If there are no options configured for this tenant, treat it as "no options"
  // so the assistant can move on quickly (pax/bags -> tariffs).
  if (!effectiveOptionsDecision && !hasOptionsCatalog) {
    effectiveOptionsDecision = "none";
  }

  const selectedOptionIdsFromCtx = Array.isArray((context as UnknownRecord).selectedOptionIds)
    ? ((context as UnknownRecord).selectedOptionIds as unknown[])
        .map((x) => clampString(x, 64))
        .filter(Boolean)
        .slice(0, 12)
    : [];

  const pickup = clampString(context.pickup, 220);
  const dropoff = clampString(context.dropoff, 220);
  const pickupDate = clampString((context as UnknownRecord).date, 32);
  const pickupTime = clampString((context as UnknownRecord).time, 16);

  // Step 0: booking procedure — we need the base itinerary before asking anything else.
  // Without these, tariffs are unreliable (lead-time pricing, stops, etc.).
  if (!pickup || !dropoff || !pickupDate || !pickupTime) {
    const missing: string[] = [];
    if (!pickup) missing.push("- Départ / prise en charge");
    if (!dropoff) missing.push("- Arrivée / destination");
    if (!pickupDate) missing.push("- Date");
    if (!pickupTime) missing.push("- Heure");

    return {
      ok: true as const,
      reply: [
        "Pour vous donner les tarifs, j’ai besoin de :",
        ...missing,
        "",
        "Vous pouvez répondre en une phrase, ex: ‘Départ: … / Arrivée: … / le 20 janvier / 14h30’.",
        "(S’il y a un arrêt ou un aller-retour, dites-le aussi.)",
      ].join("\n"),
    };
  }

  // Enrich with server-side quotes early so we can always show tariffs even if the model returns plain text.
  const enrichedContextEarly = await maybeEnrichContextWithVehicleQuotes({
    context: { ...context, aiOptionsDecision: effectiveOptionsDecision || undefined },
    pickup,
    dropoff,
    pickupDate,
    pickupTime,
    selectedOptionIds: selectedOptionIdsFromCtx,
  });

  // If the widget explicitly requests a second pass (typically after triggering pricing),
  // answer deterministically with tariffs when we have them. This avoids relying on the model
  // to include prices in its prose.
  if ((context as UnknownRecord).aiSecondPass === true) {
    const tariffs = formatVehicleQuotesBlock(enrichedContextEarly);
    if (tariffs) {
      const when = [pickupDate, pickupTime].filter(Boolean).join(" ");
      const route = pickup && dropoff ? `de ${pickup} à ${dropoff}` : "pour votre trajet";
      const intro = when ? `Voici les tarifs estimatifs ${route} le ${when} :` : `Voici les tarifs estimatifs ${route} :`;
      return {
        ok: true as const,
        reply: [intro, tariffs.trim(), "", "Pour continuer, choisissez un véhicule puis passez à la réservation."].join("\n"),
      };
    }
  }

  // Step 1: ask about options once (before asking passengers/bags).
  const hasSelectedOptions =
    (Array.isArray(enrichedContextEarly.options) && (enrichedContextEarly.options as unknown[]).some((x) => typeof x === "string" && x.trim())) ||
    selectedOptionIdsFromCtx.length > 0;
  const optionsDecisionKnown = !!effectiveOptionsDecision;

  if (hasOptionsCatalog && !optionsDecisionKnown && !hasSelectedOptions) {
    const examples = optionsCatalogLabels.slice(0, 3);
    const ex = examples.length ? ` (ex: ${examples.join(" · ")})` : "";
    return {
      ok: true as const,
      reply: [
        `Souhaitez-vous des options${ex}, ou aucune option ?`,
        "Vous pouvez répondre par exemple: “aucune option” ou me dire l’option souhaitée.",
      ].join("\n"),
    };
  }

  // Step 2: if options are decided, ask for passengers/bags if missing.
  const fromCtxPassengers = typeof (enrichedContextEarly as UnknownRecord).passengersCount === "number" ? (enrichedContextEarly as UnknownRecord).passengersCount : null;
  const fromCtxBags = typeof (enrichedContextEarly as UnknownRecord).bagsCount === "number" ? (enrichedContextEarly as UnknownRecord).bagsCount : null;
  const extracted = extractCountsFromConversation({ userMessage, history });
  const passengers = typeof fromCtxPassengers === "number" && Number.isFinite(fromCtxPassengers) && fromCtxPassengers > 0 ? fromCtxPassengers : extracted.passengers;
  const bags = typeof fromCtxBags === "number" && Number.isFinite(fromCtxBags) && fromCtxBags >= 0 ? fromCtxBags : extracted.bags;
  if (optionsDecisionKnown && (passengers === null || bags === null)) {
    const alreadyAsked = typeof (enrichedContextEarly as UnknownRecord).aiCountsAskedOnce === "boolean" ? !!(enrichedContextEarly as UnknownRecord).aiCountsAskedOnce : false;
    if (alreadyAsked) {
      return {
        ok: true as const,
        reply: [
          "Je n’arrive pas à lire votre réponse.",
          "Merci de répondre exactement au format :",
          "- Passagers : X",
          "- Bagages : Y",
          "Exemples : ‘Passagers : 2, Bagages : 3’ ou ‘2/3’.",
        ].join("\n"),
      };
    }

    const parts = [];
    if (passengers === null) parts.push("Combien de passagers (pax) ?");
    if (bags === null) parts.push("Combien de bagages/valises ?");
    return {
      ok: true as const,
      reply: [
        "Pour vous conseiller le bon véhicule (1 à 2 choix), j’ai besoin de :",
        ...parts.map((p) => `- ${p}`),
        "(Astuce: vous pouvez répondre ‘2/3’ pour 2 passagers et 3 bagages.)",
      ].join("\n"),
    };
  }

  // Step 3: if we have passengers/bags + vehicleQuotes, suggest 1–2 vehicles (3 max) with prices.
  const vehicleQuotesRaw = Array.isArray(enrichedContextEarly.vehicleQuotes) ? (enrichedContextEarly.vehicleQuotes as unknown[]) : [];
  const vehicleQuotes: { id: string; label: string; isQuote: boolean; total: number | null }[] = [];
  for (const q of vehicleQuotesRaw) {
    const qq = q && typeof q === "object" ? (q as UnknownRecord) : null;
    if (!qq) continue;
    const id = clampString(qq.id, 64);
    const label = clampString(qq.label, 80) || id;
    const isQuote = !!qq.isQuote;
    const total = typeof qq.total === "number" && Number.isFinite(qq.total) ? qq.total : null;
    if (!id && !label) continue;
    vehicleQuotes.push({ id, label, isQuote, total });
    if (vehicleQuotes.length >= 12) break;
  }

  if (optionsDecisionKnown && typeof passengers === "number" && passengers > 0 && vehicleQuotes.length) {
    const currency = typeof enrichedContextEarly.currency === "string" && enrichedContextEarly.currency.trim() ? enrichedContextEarly.currency.trim() : "EUR";
    const picks = recommendVehicles({ vehicleQuotes, passengers, bags });
    if (picks.length) {
      const lines = [];

      const chosenVehicleId = clampString((enrichedContextEarly as UnknownRecord).vehicleId, 64);
      const warning = buildVehicleFitWarning({
        vehicleId: chosenVehicleId,
        vehicleQuotes: vehicleQuotes.map((q) => ({ id: q.id, label: q.label })),
        passengers,
        bags,
      });
      if (warning) {
        lines.push(warning);
        lines.push("");
      }

      lines.push("Je vous conseille :");
      for (const p of picks.slice(0, 3)) {
        const price = typeof p.total === "number" ? `${p.total.toFixed(2)} ${currency}` : "sur devis";
        lines.push(`- ${p.label}: ${price}`);
      }
      lines.push("");
      lines.push("NB: Ces prix sont des estimations. Le chauffeur confirmera votre demande et le tarif.");
      lines.push("Prochaine étape: choisissez le véhicule puis passez à la réservation.");
      const suggestedVehicleIds = picks
        .slice(0, 3)
        .map((p) => clampString(p.id, 64))
        .filter(Boolean);
      return {
        ok: true as const,
        reply: lines.join("\n"),
        formUpdate: suggestedVehicleIds.length ? ({ suggestedVehicleIds } as AiAssistantFormUpdate) : undefined,
      };
    }
  }

  const msgLower = String(userMessage || "").toLowerCase();
  const asksForPricingMethod = (() => {
    const m = msgLower;
    if (!m) return false;
    const hasPriceIntent =
      m.includes("tarif") ||
      m.includes("prix") ||
      m.includes("coût") ||
      m.includes("cout") ||
      m.includes("factur") ||
      m.includes("calcul");
    if (!hasPriceIntent) return false;

    return (
      m.includes("comment") && (m.includes("calcul") || m.includes("détermin") || m.includes("determin"))
    ) ||
      m.includes("comment est calcul") ||
      m.includes("comment c'est calcul") ||
      m.includes("mode de calcul") ||
      m.includes("formule") ||
      m.includes("détail") ||
      m.includes("detail") ||
      m.includes("base") ||
      m.includes("prix/km") ||
      m.includes("prix au km") ||
      m.includes("€/km") ||
      m.includes("eur/km");
  })();

  if (asksForPricingMethod) {
    return {
      ok: true as const,
      reply: [
        "Je ne peux pas détailler la méthode de calcul (base, €/km, formules) sur le site.",
        "Je peux en revanche vous donner une estimation du total et vous aider à réserver.",
        "NB: Les prix affichés sont des estimations. Le chauffeur confirmera votre demande et le tarif.",
        "Prochaine étape: passez à la réservation ou envoyez votre demande par email/WhatsApp pour être recontacté rapidement.",
      ].join("\n"),
    };
  }

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

  const historyMessages = Array.isArray(history) ? history : [];
  // Avoid duplicating the current message if the client included it in history.
  const trimmedHistory = (() => {
    if (!historyMessages.length) return [];
    const last = historyMessages[historyMessages.length - 1];
    if (last && last.role === "user" && String(last.content || "").trim() === userMessage.trim()) {
      return historyMessages.slice(0, -1);
    }
    return historyMessages;
  })();

  const safeContext = redactContextForModel(enrichedContextEarly);

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content:
        `Aujourd'hui (ISO): ${todayIso}\nFuseau: Europe/Paris\n\nContexte (ne pas inventer):\n${JSON.stringify({ ...safeContext, webSearch })}\n\nMessage utilisateur:\n${userMessage}`,
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
    const historyText = trimmedHistory.length
      ? `Historique (récent en dernier):\n${trimmedHistory
          .map((m) => `${m.role === "assistant" ? "Assistant" : "Utilisateur"}: ${m.content}`)
          .join("\n")}`
      : "";
    const input = `Contexte (ne pas inventer):\n${JSON.stringify({ ...safeContext, webSearch })}\n\n${historyText ? historyText + "\n\n" : ""}Message utilisateur:\n${userMessage}`;
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
    const formUpdate = sanitizeFormUpdate(parsed.formUpdate, context);

    const pickupFrom = clampString(formUpdate?.pickup ?? enrichedContextEarly.pickup, 220);
    const dropoffFrom = clampString(formUpdate?.dropoff ?? enrichedContextEarly.dropoff, 220);
    const pickupDateFrom = clampString(formUpdate?.pickupDate ?? (enrichedContextEarly as UnknownRecord).date, 32);
    const pickupTimeFrom = clampString(formUpdate?.pickupTime ?? (enrichedContextEarly as UnknownRecord).time, 16);
    const selectedOptionIds = Array.isArray(formUpdate?.optionIds)
      ? formUpdate.optionIds
      : Array.isArray((enrichedContextEarly as UnknownRecord).selectedOptionIds)
        ? (((enrichedContextEarly as UnknownRecord).selectedOptionIds as unknown[]) || [])
            .map((x) => clampString(x, 64))
            .filter(Boolean)
            .slice(0, 12)
        : [];

    const enrichedContext = await maybeEnrichContextWithVehicleQuotes({
      context: enrichedContextEarly,
      pickup: pickupFrom,
      dropoff: dropoffFrom,
      pickupDate: pickupDateFrom,
      pickupTime: pickupTimeFrom,
      selectedOptionIds,
    });

    ensureVehicleQuotesInRecap({ parsed, context: enrichedContext });
    const reply = formatReplyFromModelJson(parsed, enrichedContext);
    return { ok: true as const, reply, formUpdate };
  }

  // Fallback: treat as plain text.
  const tariffs = formatVehicleQuotesBlock(enrichedContextEarly);
  const safeReply = answerLooksLikePricingLeak(replyRaw)
    ? "Voici une estimation du prix total pour votre trajet (sans détail de calcul)."
    : replyRaw;
  return { ok: true as const, reply: `${safeReply}${tariffs}`.trim() };
}
