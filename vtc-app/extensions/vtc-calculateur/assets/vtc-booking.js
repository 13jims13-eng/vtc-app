/* global google */
// vtc-booking.js - Version B1 (formulaire toujours visible)

(function () {
  // This asset can be injected by both an app embed and a block.
  // Avoid crashing on double-load and avoid double-binding listeners.
  if (window.__VTC_BOOKING_LOADED__) return;
  window.__VTC_BOOKING_LOADED__ = true;

let directionsService;
let directionsRenderer;
let map;
let stopAutocompletes = [];
let autocompleteInitStarted = false;
let _europeBoundsCache = null;
let _widgetConfigCache = null;
let _googleMapsLoadPromise = null;
let _googleMapsApiKeyResolvePromise = null;
let _startGeoLatLng = null;
let _endGeoLatLng = null;
let _widgetState = {
  selectedVehicleId: null,
  selectedVehicleLabel: null,
  selectedIsQuote: false,
  selectedTotal: null,
  customOptionText: "",
  aiVehicleQuotesOverride: null,
  aiOptionsAskedOnce: false,
  aiOptionsDecision: "", // "none" | "some" | ""
  aiPassengersCount: null,
  aiBagsCount: null,
  aiCountsAskedOnce: false,
};

function setCustomOptionText(value) {
  _widgetState.customOptionText = String(value || "").trim();
}

let _optionsOriginalPlacement = null;

function getWidgetEl() {
  return document.querySelector("#vtc-widget") || document.querySelector("#vtc-smart-booking-widget");
}

function getWidgetDataset() {
  return getWidgetEl()?.dataset || {};
}

function setMapsStatus(text) {
  let el = document.getElementById("vtc-maps-status");
  if (!el && text) {
    el = document.createElement("div");
    el.id = "vtc-maps-status";
    el.style.fontSize = "13px";
    el.style.opacity = "0.8";
    el.style.marginTop = "6px";
    el.style.display = "none";

    const endInput = document.getElementById("end");
    if (endInput && endInput.insertAdjacentElement) {
      endInput.insertAdjacentElement("afterend", el);
    } else {
      const widget = getWidgetEl();
      if (widget) widget.appendChild(el);
    }
  }
  if (!el) return;
  if (!text) {
    el.textContent = "";
    el.style.display = "none";
    return;
  }
  el.textContent = text;
  el.style.display = "block";
}

function resolveGoogleMapsApiKey() {
  const dataset = getWidgetDataset();
  const fromThemeRaw = String(dataset.googleMapsApiKey || "").trim();
  const themeKey = (() => {
    if (!fromThemeRaw) return "";
    const v = fromThemeRaw.toLowerCase();
    if (v.includes("replace_with") || v.includes("your_google_maps") || v.includes("your-google-maps")) return "";
    return fromThemeRaw;
  })();

  // For Places Autocomplete (address suggestions), the key must have Places enabled.
  // In practice, many shops configure the key in the theme settings. Since this key is
  // not considered secret, we prefer the theme key for the front-end.
  if (themeKey) return Promise.resolve(themeKey);

  // Otherwise, fall back to a server-provided key (App Proxy) if configured.
  if (_googleMapsApiKeyResolvePromise) {
    return _googleMapsApiKeyResolvePromise.then((k) => k || themeKey);
  }

  _googleMapsApiKeyResolvePromise = fetch("/apps/vtc/api/public-config", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  })
    .then(async (res) => {
      if (!res.ok) return null;
      try {
        return await res.json();
      } catch {
        return null;
      }
    })
    .then((json) => {
      const key = String(json?.googleMapsApiKey || "").trim();
      const warnings = Array.isArray(json?.warnings) ? json.warnings : [];

      if (key) {
        console.log("google-maps: api key source=server", { ok: !!json?.ok, hasKey: true, warnings });
        return key;
      }

      if (themeKey) {
        console.log("google-maps: api key source=theme", { serverOk: !!json?.ok, warnings });
        return themeKey;
      }

      console.log("google-maps: api key missing", { serverOk: !!json?.ok, warnings });
      return "";
    })
    .catch(() => themeKey);

  return _googleMapsApiKeyResolvePromise;
}

function ensureGoogleMapsLoaded(reason) {
  if (isGoogleReady()) return Promise.resolve(true);
  if (_googleMapsLoadPromise) return _googleMapsLoadPromise;

  _googleMapsLoadPromise = resolveGoogleMapsApiKey().then((apiKey) => {
    if (!apiKey) {
      console.warn("google-maps: missing api key (theme setting or server env)");
      const host = typeof window !== "undefined" ? window.location.host : "";
      setMapsStatus(
        host
          ? `Google Maps n’est pas configuré (clé API manquante). Domaine: ${host}. Configurez-la dans le thème (App embed) ou côté serveur (env).`
          : "Google Maps n’est pas configuré (clé API manquante).",
      );
      return false;
    }

    const existing = document.getElementById("vtc-google-maps-js");
    if (existing) {
      // Script tag exists, just wait a bit for google to become ready.
      return new Promise((resolve) => {
        setMapsStatus("Chargement de Google Maps…");
        const startedAt = Date.now();
        const interval = setInterval(() => {
          if (isGoogleReady()) {
            clearInterval(interval);
            // If Places is blocked, keep a helpful message but allow routing.
            if (isPlacesReady()) {
              setMapsStatus("");
            } else {
              const host = window.location.host;
              setMapsStatus(
                `Google Maps est chargé mais l’autocomplete est indisponible (Places API). Activez "Places API" puis autorisez: https://${host}/*`,
              );
            }
            resolve(true);
            return;
          }
          if (Date.now() - startedAt > 15000) {
            clearInterval(interval);
            setMapsStatus("");
            resolve(false);
          }
        }, 150);
      });
    }

    return new Promise((resolve) => {
      setMapsStatus("Chargement de Google Maps…");
      console.log("google-maps: loading", { reason });

      // Google Maps déclenche gm_authFailure lorsque la clé est invalide/refusée.
      // On affiche un message actionnable pour guider la configuration des restrictions HTTP.
      try {
        window.gm_authFailure = () => {
          const host = window.location.host;
          setMapsStatus(
            `Google Maps a refusé la clé API. Vérifiez les restrictions (HTTP referrers) et ajoutez: https://${host}/* (et éventuellement https://*.myshopify.com/*).`,
          );
        };
      } catch {
        // ignore
      }

      const script = document.createElement("script");
      script.id = "vtc-google-maps-js";
      script.async = true;
      script.defer = true;
      // Keep it FR by default; actual restriction is enforced by Places Autocomplete options too.
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=fr&region=FR`;

      const timeout = setTimeout(() => {
        setMapsStatus("");
        resolve(false);
      }, 15000);

      script.onload = () => {
        clearTimeout(timeout);
        const ok = isGoogleReady();
        if (!ok) {
          setMapsStatus("");
          resolve(false);
          return;
        }

        if (isPlacesReady()) {
          setMapsStatus("");
        } else {
          const host = window.location.host;
          setMapsStatus(
            `Google Maps est chargé mais l’autocomplete est indisponible (Places API). Activez "Places API" puis autorisez: https://${host}/*`,
          );
        }

        resolve(true);
      };
      script.onerror = () => {
        clearTimeout(timeout);
        const host = window.location.host;
        setMapsStatus(
          `Impossible de charger Google Maps (script bloqué). Vérifiez la connexion/CSP et les restrictions de clé pour: https://${host}/*`,
        );
        resolve(false);
      };

      document.head.appendChild(script);
    });
  });

  return _googleMapsLoadPromise.then((ok) => {
    if (!ok) _googleMapsLoadPromise = null;
    return ok;
  });
}

function parseNumber(value, fallback) {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(v)) return false;
  if (["1", "true", "yes", "on"].includes(v)) return true;
  return fallback;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseCssColorToRgba(color) {
  const c = String(color || "").trim();
  if (!c) return null;

  // Hex: #rgb / #rrggbb
  if (c[0] === "#") {
    const hex = c.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if ([r, g, b].every(Number.isFinite)) return { r, g, b, a: 1 };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if ([r, g, b].every(Number.isFinite)) return { r, g, b, a: 1 };
    }
  }

  // rgb()/rgba()
  const m = c
    .replace(/\s+/g, " ")
    .match(/^rgba?\((\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\)$/i);
  if (m) {
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if ([r, g, b, a].every(Number.isFinite)) return { r, g, b, a };
  }

  return null;
}

function srgbToLinear01(x) {
  const v = x / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminanceFromRgb({ r, g, b }) {
  const R = srgbToLinear01(r);
  const G = srgbToLinear01(g);
  const B = srgbToLinear01(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function compositeOverWhite({ r, g, b, a }) {
  const alpha = typeof a === "number" ? Math.min(1, Math.max(0, a)) : 1;
  return {
    r: Math.round(r * alpha + 255 * (1 - alpha)),
    g: Math.round(g * alpha + 255 * (1 - alpha)),
    b: Math.round(b * alpha + 255 * (1 - alpha)),
  };
}

function pickTextOnColor(backgroundColor) {
  const rgba = parseCssColorToRgba(backgroundColor);
  if (!rgba) return "#fff";
  const rgb = compositeOverWhite(rgba);
  const lum = relativeLuminanceFromRgb(rgb);
  return lum < 0.55 ? "#fff" : "#0b0f19";
}

function applyAiAssistantThemeVars(targetEl, widget) {
  if (!targetEl || !widget || typeof window === "undefined" || !window.getComputedStyle) return;

  const cs = window.getComputedStyle(widget);
  const accent = String(cs.getPropertyValue("--vtc-accent") || "").trim();
  const accent2 = String(cs.getPropertyValue("--vtc-accent-2") || "").trim() || accent;
  const border = String(cs.getPropertyValue("--vtc-border") || "").trim();
  const text = String(cs.getPropertyValue("--vtc-text") || "").trim();
  const muted = String(cs.getPropertyValue("--vtc-muted") || "").trim();
  const subtle = String(cs.getPropertyValue("--vtc-subtle") || "").trim();
  const card = String(cs.getPropertyValue("--vtc-card") || "").trim();
  const card2 = String(cs.getPropertyValue("--vtc-card-2") || "").trim();
  const danger = String(cs.getPropertyValue("--vtc-danger") || "").trim();
  const radiusSm = String(cs.getPropertyValue("--vtc-radius-sm") || "").trim();

  // If CSS variables are not ready (or not present), fallback to theme class palette.
  // This keeps the Assistant IA consistent with the calculator style.
  let fallback = null;
  if (!accent && widget.classList) {
    if (widget.classList.contains("vtc-theme--black_gold")) {
      fallback = {
        accent: "#d4af37",
        accent2: "#f59e0b",
        border: "rgba(212, 175, 55, 0.22)",
        text: "rgba(255, 255, 255, 0.93)",
        muted: "rgba(255, 255, 255, 0.74)",
        subtle: "rgba(255, 255, 255, 0.56)",
        card: "rgba(255, 255, 255, 0.05)",
        card2: "rgba(255, 255, 255, 0.075)",
        danger: "#ef4444",
        radius: "12px",
      };
    } else if (widget.classList.contains("vtc-theme--blue")) {
      fallback = {
        accent: "#7c3aed",
        accent2: "#22d3ee",
        border: "rgba(255, 255, 255, 0.12)",
        text: "rgba(255, 255, 255, 0.92)",
        muted: "rgba(255, 255, 255, 0.72)",
        subtle: "rgba(255, 255, 255, 0.55)",
        card: "rgba(255, 255, 255, 0.06)",
        card2: "rgba(255, 255, 255, 0.085)",
        danger: "#ef4444",
        radius: "12px",
      };
    }
  }

  // Apply whatever we can (accent can be missing if CSS not ready yet).
  const hasThemeVars = !!(accent || border || text || card || fallback);
  if (!hasThemeVars) return;

  const resolvedAccent = accent || fallback?.accent || "";
  const resolvedAccent2 = accent2 || fallback?.accent2 || resolvedAccent;
  const resolvedBorder = border || fallback?.border || "";
  const resolvedText = text || fallback?.text || "";
  const resolvedMuted = muted || fallback?.muted || "";
  const resolvedSubtle = subtle || fallback?.subtle || "";
  const resolvedDanger = danger || fallback?.danger || "";
  const resolvedRadius = radiusSm || fallback?.radius || "";
  const resolvedCard = card || fallback?.card || "";
  const resolvedCard2 = card2 || fallback?.card2 || "";

  if (resolvedAccent) targetEl.style.setProperty("--vtc-ai-accent", resolvedAccent);
  if (resolvedAccent2) targetEl.style.setProperty("--vtc-ai-accent2", resolvedAccent2);
  if (resolvedBorder) targetEl.style.setProperty("--vtc-ai-border", resolvedBorder);

  // Match the storefront theme: dark themes should not render a large white assistant panel.
  const isDarkTheme =
    (widget.classList &&
      (widget.classList.contains("vtc-theme--black_gold") || widget.classList.contains("vtc-theme--blue"))) ||
    (!!fallback && !!fallback.text && String(fallback.text).includes("255"));

  if (isDarkTheme) {
    // Dark surface + light text (better contrast on dark hero sections).
    targetEl.style.setProperty(
      "--vtc-ai-surface",
      resolvedCard || "rgba(10, 12, 16, 0.88)"
    );
    targetEl.style.setProperty(
      "--vtc-ai-surface2",
      resolvedCard2 || "rgba(255, 255, 255, 0.06)"
    );
    targetEl.style.setProperty("--vtc-ai-text", "rgba(255, 255, 255, 0.92)");
    targetEl.style.setProperty("--vtc-ai-muted", "rgba(255, 255, 255, 0.74)");
    targetEl.style.setProperty("--vtc-ai-subtle", "rgba(255, 255, 255, 0.56)");
    targetEl.style.setProperty("--vtc-ai-inputBg", "rgba(0, 0, 0, 0.28)");
    targetEl.style.setProperty("--vtc-ai-inputBorder", "rgba(255, 255, 255, 0.16)");
    targetEl.style.setProperty("--vtc-ai-backdrop", "rgba(0,0,0,.62)");
  } else {
    // Light surface + dark text.
    targetEl.style.setProperty("--vtc-ai-surface", "rgba(255,255,255,.96)");
    targetEl.style.setProperty("--vtc-ai-surface2", "rgba(17,24,39,.04)");
    targetEl.style.setProperty("--vtc-ai-text", "#111827");
    targetEl.style.setProperty("--vtc-ai-muted", "rgba(17,24,39,.78)");
    targetEl.style.setProperty("--vtc-ai-subtle", "rgba(17,24,39,.58)");
    targetEl.style.setProperty("--vtc-ai-inputBg", "rgba(255,255,255,.92)");
    targetEl.style.setProperty("--vtc-ai-inputBorder", "rgba(17,24,39,.22)");
    targetEl.style.setProperty("--vtc-ai-backdrop", "rgba(0,0,0,.55)");
  }

  if (resolvedDanger) targetEl.style.setProperty("--vtc-ai-danger", resolvedDanger);
  if (resolvedRadius) targetEl.style.setProperty("--vtc-ai-radius", resolvedRadius);

  // Primary button matches widget gradient buttons.
  if (resolvedAccent) {
    targetEl.style.setProperty(
      "--vtc-ai-btnBg",
      `linear-gradient(135deg, ${resolvedAccent}, ${resolvedAccent2 || resolvedAccent})`
    );
    targetEl.style.setProperty("--vtc-ai-btnText", pickTextOnColor(resolvedAccent));
  }
}

function applyAiAssistantThemeWithRetry({ panel, fab, modal, widget, tries = 10 }) {
  if (!widget) return;
  let remaining = Number.isFinite(tries) ? tries : 10;

  const tick = () => {
    applyAiAssistantThemeVars(panel, widget);
    applyAiAssistantThemeVars(fab, widget);
    applyAiAssistantThemeVars(modal, widget);

    const themed =
      !!(panel && panel.style && String(panel.style.getPropertyValue("--vtc-ai-accent") || "").trim()) ||
      !!(panel && panel.style && String(panel.style.getPropertyValue("--vtc-ai-border") || "").trim());
    if (themed) return;

    remaining -= 1;
    if (remaining <= 0) return;
    window.setTimeout(tick, 180);
  };

  tick();
}

function injectAiAssistantStylesOnce() {
  if (document.getElementById("vtc-ai-assistant-styles")) return;
  const style = document.createElement("style");
  style.id = "vtc-ai-assistant-styles";
  style.textContent = `
    .vtc-ai {
      margin-top: 14px;
      border: 1px solid var(--vtc-ai-border, rgba(0,0,0,.10));
      border-radius: var(--vtc-ai-radius, 14px);
      background: var(--vtc-ai-surface, rgba(255,255,255,.95));
      color: var(--vtc-ai-text, #111827);
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      box-shadow: 0 16px 46px rgba(0,0,0,.18);
      backdrop-filter: blur(10px);
    }
    .vtc-ai__header { display:flex; align-items:center; justify-content:space-between; padding: 12px 14px; gap: 10px; }
    .vtc-ai__title { font-weight: 850; font-size: 15px; letter-spacing: -0.012em; }
    .vtc-ai__badge { font-size: 12.5px; line-height: 1.35; font-weight: 650; color: var(--vtc-ai-muted, rgba(17,24,39,.80)); }
    .vtc-ai__body { padding: 0 14px 14px 14px; }
    .vtc-ai__suggestions { margin-top: 10px; }
    .vtc-ai__suggestions h4 { font-size: 14px; font-weight: 850; letter-spacing: -0.01em; }

    /* Fallback styles for tariff cards inside assistant */
    .vtc-ai .vtc-tariffs-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    @media (min-width: 720px) {
      .vtc-ai .vtc-tariffs-grid { grid-template-columns: 1fr 1fr; }
    }
    @media (min-width: 1060px) {
      .vtc-ai .vtc-tariffs-grid { grid-template-columns: 1fr 1fr 1fr; }
    }
    .vtc-ai .vtc-tariff-card {
      border: 1px solid var(--vtc-ai-border, rgba(0,0,0,.12));
      border-radius: 14px;
      padding: 10px;
      background: color-mix(in srgb, var(--vtc-ai-surface, #fff) 92%, transparent);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .vtc-ai .vtc-tariff-left { display:flex; align-items:center; gap: 10px; min-width:0; }
    .vtc-ai .vtc-tariff-image { width: 54px; height: 40px; object-fit: cover; border-radius: 10px; border: 1px solid rgba(0,0,0,.06); }
    .vtc-ai .vtc-tariff-title { font-weight: 850; font-size: 13px; white-space: nowrap; overflow:hidden; text-overflow: ellipsis; }
    .vtc-ai .vtc-tariff-price { font-size: 13px; font-weight: 800; color: var(--vtc-ai-muted, rgba(17,24,39,.80)); }
    .vtc-ai .vtc-tariff-select {
      border-radius: 12px;
      border: 1px solid color-mix(in srgb, var(--vtc-ai-border, rgba(0,0,0,.12)) 100%, transparent);
      padding: 9px 10px;
      background: var(--vtc-ai-btnBg, #111827);
      color: var(--vtc-ai-btnText, #fff);
      font-weight: 800;
      cursor: pointer;
      white-space: nowrap;
    }
    .vtc-ai__row { display:flex; gap: 10px; align-items: flex-start; }
    .vtc-ai__input {
      width: 100%;
      min-height: 44px;
      resize: vertical;
      border-radius: var(--vtc-ai-radius, 12px);
      border: 1px solid var(--vtc-ai-inputBorder, rgba(0,0,0,.14));
      background: var(--vtc-ai-inputBg, #fff);
      color: var(--vtc-ai-text, #111827);
      padding: 10px 12px;
      font-size: 14px;
      line-height: 1.45;
      font: inherit;
      outline: none;
      transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
    }
    .vtc-ai__input::placeholder { color: var(--vtc-ai-subtle, rgba(17,24,39,.48)); }
    .vtc-ai__input:focus {
      border-color: color-mix(in srgb, var(--vtc-ai-accent, #111827) 70%, transparent);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--vtc-ai-accent, #111827) 18%, transparent);
    }
    .vtc-ai__input[disabled] {
      opacity: .72;
      cursor: wait;
    }
    .vtc-ai__btn {
      border-radius: var(--vtc-ai-radius, 12px);
      border: 1px solid color-mix(in srgb, var(--vtc-ai-border, rgba(0,0,0,.12)) 100%, transparent);
      padding: 10px 12px;
      background: var(--vtc-ai-btnBg, #111827);
      color: var(--vtc-ai-btnText, #fff);
      cursor:pointer;
      white-space: nowrap;
      font-weight: 750;
      font-size: 13px;
      letter-spacing: 0.01em;
      transition: transform 120ms ease, filter 120ms ease, opacity 120ms ease;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .vtc-ai__btn:hover { filter: brightness(1.05); transform: translateY(-1px); }
    .vtc-ai__btn:active { transform: translateY(0); }
    .vtc-ai__btn[disabled] { opacity: .6; cursor: not-allowed; transform:none; }
    .vtc-ai__btn--subtle {
      background: transparent;
      color: var(--vtc-ai-text, #111827);
      border-color: var(--vtc-ai-border, rgba(0,0,0,.12));
    }
    .vtc-ai__btn--icon {
      padding: 10px;
      min-width: 44px;
      width: 44px;
    }
    .vtc-ai__btn--icon svg { width: 18px; height: 18px; display:block; }
    .vtc-ai__btn--listening {
      border-color: color-mix(in srgb, var(--vtc-ai-accent, #111827) 60%, transparent);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--vtc-ai-accent, #111827) 18%, transparent);
    }
    .vtc-ai__status { margin-top: 10px; font-size: 13px; color: var(--vtc-ai-muted, rgba(0,0,0,.8)); }
    .vtc-ai__error { margin-top: 10px; font-size: 13px; color: var(--vtc-ai-danger, #b91c1c); }
    .vtc-ai__reply {
      margin-top: 12px;
      padding: 12px;
      border-radius: var(--vtc-ai-radius, 12px);
      border: 1px solid var(--vtc-ai-border, rgba(0,0,0,.10));
      background: var(--vtc-ai-surface2, rgba(0,0,0,.02));
      white-space: normal;
      font-size: 14px;
      line-height: 1.5;
      color: var(--vtc-ai-text, #111827);
    }
    .vtc-ai__reply p { margin: 0 0 10px; }
    .vtc-ai__reply p:last-child { margin-bottom: 0; }
    .vtc-ai__reply h4 {
      margin: 10px 0 6px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--vtc-ai-muted, rgba(17,24,39,.72));
    }
    .vtc-ai__reply ul { margin: 0 0 10px; padding-left: 18px; }
    .vtc-ai__reply li { margin: 2px 0; }
    .vtc-ai__actions { display:flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .vtc-ai__rgpd { margin-top: 10px; font-size: 12px; line-height: 1.35; color: var(--vtc-ai-muted, rgba(17,24,39,.74)); }
    .vtc-ai__rgpd a { color: inherit; text-decoration: underline; }

    .vtc-ai-fab { position: fixed; right: 16px; bottom: 92px; z-index: 2147483000; display:none; }
    .vtc-ai-fab button {
      border-radius: 999px;
      border: 1px solid var(--vtc-ai-border, rgba(0,0,0,.12));
      background: var(--vtc-ai-btnBg, #111827);
      color: var(--vtc-ai-btnText, #fff);
      padding: 12px 14px;
      font-weight: 800;
      box-shadow: 0 10px 28px rgba(0,0,0,.18);
      cursor:pointer;
    }

    .vtc-ai-modal { position: fixed; inset: 0; z-index: 2147483001; display:none; align-items: flex-end; }
    .vtc-ai-modal__backdrop { position:absolute; inset:0; background: var(--vtc-ai-backdrop, rgba(0,0,0,.45)); }
    .vtc-ai-modal__sheet {
      position:relative;
      width: 100%;
      max-height: 85vh;
      border-top-left-radius: 18px;
      border-top-right-radius: 18px;
      background: var(--vtc-ai-surface, #fff);
      color: var(--vtc-ai-text, #111827);
      overflow: auto;
      padding: 12px;
      box-shadow: 0 -10px 40px rgba(0,0,0,.25);
      border-top: 1px solid var(--vtc-ai-border, rgba(0,0,0,.12));
    }
    .vtc-ai-modal__close {
      position:absolute;
      top: 10px;
      right: 10px;
      border-radius: 999px;
      border: 1px solid var(--vtc-ai-border, rgba(0,0,0,.12));
      background: transparent;
      color: var(--vtc-ai-text, #111827);
      padding: 8px 10px;
      cursor:pointer;
    }

    /* Mobile mode only on real touch devices (prevents desktop narrow containers from switching to FAB). */
    @media (max-width: 768px) and (hover: none) and (pointer: coarse) {
      .vtc-ai { display:none; }
      .vtc-ai-fab { display:block; }
      .vtc-ai-modal { display:flex; }
      .vtc-ai-modal.is-closed { display:none; }
      .vtc-ai-modal .vtc-ai { display:block; margin-top: 0; }
    }
  `;
  document.head.appendChild(style);
}

function copyToClipboard(text) {
  const value = String(text || "");
  if (!value) return Promise.resolve(false);

  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard
      .writeText(value)
      .then(() => true)
      .catch(() => false);
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve(!!ok);
  } catch {
    return Promise.resolve(false);
  }
}

function getPrivacyPolicyUrl() {
  const dataset = getWidgetDataset();
  const fromTheme = String(dataset.privacyPolicyUrl || "").trim();
  return fromTheme || "/policies/privacy-policy";
}

function getAiAssistantMode() {
  const dataset = getWidgetDataset();
  const cfg = typeof getWidgetConfig === "function" ? getWidgetConfig() : null;

  const raw = String(dataset.aiAssistantMode || cfg?.aiAssistantMode || "").trim().toLowerCase();
  if (raw === "classic" || raw === "classique") return "classic";
  if (raw === "ai" || raw === "ia") return "ai";
  if (raw === "both" || raw === "les deux" || raw === "les_deux") return "both";
  return "both";
}

function applyAssistantMode(mode) {
  const m = mode || getAiAssistantMode();
  const classic = document.getElementById("vtc-classic-ui");

  // In AI-only mode, keep the booking form (contact/policies/reservation) available.
  // We hide only the calculator inputs/panels, not the whole classic container.
  const calculatorPanel = document.getElementById("vtc-calculator-panel");
  if (classic) classic.style.display = "";
  if (calculatorPanel) {
    calculatorPanel.style.display = m === "ai" ? "none" : "";
  }

  // If AI UI already exists (page nav cache), hide/show it.
  const aiPanel = document.getElementById("vtc-ai-assistant");
  if (aiPanel) {
    aiPanel.style.display = m === "classic" ? "none" : "";

    // If the AI panel lives inside the classic container, it becomes invisible when classic UI is hidden.
    // In AI-only mode, ensure the panel is mounted outside of the hidden classic UI.
    // If the panel lives inside the hidden calculator panel, it would disappear.
    // Prefer mounting inside the dedicated mount point.
    if (m !== "classic") {
      const mount = document.getElementById("vtc-ai-mount");
      if (mount && aiPanel.parentNode !== mount) {
        try {
          mount.appendChild(aiPanel);
        } catch {
          // ignore
        }
      }
    }
  }

  return m;
}

function buildAiAssistantContext() {
  const trip = window.lastTrip || null;
  const selectedOptions = getSelectedOptions ? getSelectedOptions() : [];
  const cfg = typeof getWidgetConfig === "function" ? getWidgetConfig() : null;

  const pickup = String(trip?.start || "").trim();
  const dropoff = String(trip?.end || "").trim();
  const date = String(trip?.pickupDate || "").trim();
  const time = String(trip?.pickupTime || "").trim();
  const vehicleId = String(trip?.vehicle || "").trim();
  const vehicle = String(trip?.vehicleLabel || "").trim() || vehicleId;
  const options = (selectedOptions || []).map((o) => String(o?.label || "").trim()).filter(Boolean);
  const selectedOptionIds = (selectedOptions || []).map((o) => String(o?.id || "").trim()).filter(Boolean);

  const isQuote = !!trip?.isQuote;
  const price = typeof window.lastPrice === "number" ? window.lastPrice : null;
  const distance = typeof trip?.distanceKm === "number" ? trip.distanceKm : null;
  const duration = typeof trip?.durationMinutes === "number" ? trip.durationMinutes : null;

  const vehiclesCatalog = Array.isArray(cfg?.vehicles)
    ? cfg.vehicles
        .map((v) => {
          const id = String(v?.id || "").trim();
          const label = String(v?.label || "").trim();
          const quoteOnly = !!v?.quoteOnly;
          return id || label ? { id, label, quoteOnly } : null;
        })
        .filter(Boolean)
    : [];

  const optionsCatalog = Array.isArray(cfg?.options)
    ? cfg.options
        .map((o) => {
          const id = String(o?.id || "").trim();
          const label = String(o?.label || "").trim();
          const type = String(o?.type || "").trim();
          const amount = typeof o?.amount === "number" ? o.amount : null;
          return id || label ? { id, label, type, amount } : null;
        })
        .filter(Boolean)
    : [];

  const context = {
    pickup,
    dropoff,
    date,
    time,
    vehicle,
    vehicleId,
    currency: "EUR",
    options,
    selectedOptionIds,
    passengersCount:
      typeof _widgetState.aiPassengersCount === "number" && Number.isFinite(_widgetState.aiPassengersCount)
        ? _widgetState.aiPassengersCount
        : undefined,
    bagsCount:
      typeof _widgetState.aiBagsCount === "number" && Number.isFinite(_widgetState.aiBagsCount)
        ? _widgetState.aiBagsCount
        : undefined,
    aiCountsAskedOnce: !!_widgetState.aiCountsAskedOnce,
    vehiclesCatalog,
    optionsCatalog,
    // Full pricing config (non-sensitive) to allow deterministic server-side quoting
    // even when the client-side calculator hasn't been filled yet.
    pricingConfig: cfg
      ? {
          stopFee: typeof cfg.stopFee === "number" ? cfg.stopFee : 0,
          quoteMessage: String(cfg.quoteMessage || "Sur devis — merci de nous contacter.").trim(),
          pricingBehavior: String(cfg.pricingBehavior || "normal_prices").trim() || "normal_prices",
          leadTimeThresholdMinutes:
            typeof cfg.leadTimeThresholdMinutes === "number" ? cfg.leadTimeThresholdMinutes : 120,
          immediateSurchargeEnabled: !!cfg.immediateSurchargeEnabled,
          immediateBaseDeltaAmount:
            typeof cfg.immediateBaseDeltaAmount === "number" ? cfg.immediateBaseDeltaAmount : 0,
          immediateBaseDeltaPercent:
            typeof cfg.immediateBaseDeltaPercent === "number" ? cfg.immediateBaseDeltaPercent : 0,
          immediateTotalDeltaPercent:
            typeof cfg.immediateTotalDeltaPercent === "number" ? cfg.immediateTotalDeltaPercent : 0,
          vehicles: (Array.isArray(cfg.vehicles) ? cfg.vehicles : [])
            .map((v) => {
              const id = String(v?.id || "").trim();
              const label = String(v?.label || "").trim();
              if (!id && !label) return null;
              return {
                id,
                label,
                baseFare: typeof v?.baseFare === "number" ? v.baseFare : 0,
                pricePerKm: typeof v?.pricePerKm === "number" ? v.pricePerKm : 0,
                quoteOnly: !!v?.quoteOnly,
              };
            })
            .filter(Boolean),
          options: (Array.isArray(cfg.options) ? cfg.options : [])
            .map((o) => {
              const id = String(o?.id || "").trim();
              const label = String(o?.label || "").trim();
              if (!id && !label) return null;
              return {
                id,
                label,
                type: String(o?.type || "").trim(),
                amount: typeof o?.amount === "number" ? o.amount : 0,
              };
            })
            .filter(Boolean),
        }
      : undefined,
    aiOptionsAskedOnce: !!_widgetState.aiOptionsAskedOnce,
    aiOptionsDecision: String(_widgetState.aiOptionsDecision || "").trim() || undefined,
    pricingBehavior: String(cfg?.pricingBehavior || "").trim() || undefined,
    leadTimeThresholdMinutes:
      typeof cfg?.leadTimeThresholdMinutes === "number" ? cfg.leadTimeThresholdMinutes : undefined,
    stopsCount: Array.isArray(trip?.stops) ? trip.stops.length : 0,
    customOption: String(trip?.customOptionText || "").trim(),
    quote: {
      price,
      isQuote,
      distance,
      duration,
    },
  };

  // Provide per-vehicle prices computed by the same calculator logic (not by AI).
  // This allows the assistant to explain prices without inventing or recalculating.
  try {
    if (cfg && trip && typeof trip.distanceKm === "number") {
      const pickupDate = String(trip.pickupDate || "").trim();
      const pickupTime = String(trip.pickupTime || "").trim();
      const leadTimeInfo = getLeadTimeInfo({ pickupDate, pickupTime });
      const stopsCount = Array.isArray(trip.stops) ? trip.stops.length : 0;

      const vehicleQuotes = (Array.isArray(cfg.vehicles) ? cfg.vehicles : [])
        .map((v) => {
          const id = String(v?.id || "").trim();
          const label = String(v?.label || "").trim();
          if (!id) return null;

          // If date is missing, we can still compute "all_quote"/quoteOnly, but totals may be incomplete.
          const computed = computeTariffForVehicle({
            km: trip.distanceKm,
            stopsCount,
            pickupTime,
            pickupDate,
            vehicleId: id,
            leadTimeInfo,
          });

          return {
            id,
            label: label || computed.vehicleLabel || id,
            isQuote: !!computed.isQuote,
            total: computed.isQuote ? null : typeof computed.total === "number" ? computed.total : null,
          };
        })
        .filter(Boolean)
        ;

      if (vehicleQuotes.length) {
        context.vehicleQuotes = vehicleQuotes;
      }
    }
  } catch {
    // ignore
  }

  // If the server computed quotes (before client-side Directions), reuse them for display.
  try {
    const existing = Array.isArray(context.vehicleQuotes) ? context.vehicleQuotes : [];
    const override = Array.isArray(_widgetState.aiVehicleQuotesOverride) ? _widgetState.aiVehicleQuotesOverride : [];
    if (override.length) {
      if (!existing.length) {
        context.vehicleQuotes = override;
      } else {
        // Merge totals by id when client computed partial data.
        const byId = new Map(override.map((q) => [String(q?.id || "").trim(), q]));
        const merged = existing.map((q) => {
          const id = String(q?.id || "").trim();
          const o = id ? byId.get(id) : null;
          if (!o) return q;
          const total = typeof q?.total === "number" ? q.total : null;
          const oTotal = typeof o?.total === "number" ? o.total : null;
          return {
            ...q,
            total: total !== null ? total : oTotal,
            isQuote: typeof q?.isQuote === "boolean" ? q.isQuote : !!o?.isQuote,
            label: String(q?.label || "").trim() || String(o?.label || "").trim(),
          };
        });
        context.vehicleQuotes = merged;
      }
    }
  } catch {
    // ignore
  }

  return context;
}

function extractCountsFromUserText(text) {
  const t = String(text || "").toLowerCase();
  const out = { passengers: null, bags: null };

  const looksLikeDateOrTime = (msg) => {
    const m = String(msg || "").toLowerCase();
    // Explicit pax/bags shorthand should always be accepted.
    if (/^\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/.test(m)) return false;

    const hasCountsKeywords = /\b(pax|passagers?|personnes?|adultes?|enfants?|bagages?|valises?|sacs?)\b/.test(m);
    if (hasCountsKeywords) return false;

    const month = /(janv|janvier|fevr|févr|fevrier|février|mars|avr|avril|mai|juin|juil|juillet|aout|août|sept|septembre|oct|octobre|nov|novembre|dec|déc|decembre|décembre)/;
    if (month.test(m)) return true;

    // Common date/time patterns
    if (/\b\d{4}-\d{1,2}-\d{1,2}\b/.test(m)) return true;
    if (/\b\d{1,2}\s*[.-]\s*\d{1,2}\b/.test(m)) return true;
    if (/\b\d{1,2}\s*\/\s*\d{1,2}\b/.test(m)) return true;
    if (/\b\d{1,2}\s*h\s*\d{0,2}\b/.test(m)) return true;
    if (/\b\d{1,2}:\d{2}\b/.test(m)) return true;
    if (/\ble\s+\d{1,2}\b/.test(m)) return true;

    return false;
  };

  const wordToNumber = (w) => {
    const s = String(w || "").trim().toLowerCase();
    const map = {
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

  const paxMatch = t.match(/\b(\d{1,2}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*(?:pax|passagers?|personnes?|adultes?|enfants?)\b/);
  if (paxMatch && paxMatch[1]) {
    const n = /^\d/.test(paxMatch[1]) ? Number(paxMatch[1]) : wordToNumber(paxMatch[1]);
    if (Number.isFinite(n) && n > 0 && n < 50) out.passengers = n;
  }

  const bagMatch = t.match(/\b(\d{1,2}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*(?:valises?|bagages?|sacs?)\b/);
  if (bagMatch && bagMatch[1]) {
    const n = /^\d/.test(bagMatch[1]) ? Number(bagMatch[1]) : wordToNumber(bagMatch[1]);
    if (Number.isFinite(n) && n >= 0 && n < 50) out.bags = n;
  }

  // Heuristic: two numbers after being asked ("2/3" = 2 pax, 3 bagages)
  if (out.passengers === null || out.bags === null) {
    // Avoid misreading date/time like "le 20 à 14h" as "20 pax / 14 bagages".
    if (!looksLikeDateOrTime(t)) {
      const nums = Array.from(t.matchAll(/\b(\d{1,2})\b/g))
        .map((m) => Number(m[1]))
        .filter((n) => Number.isFinite(n))
        .slice(0, 4);
      if (nums.length >= 2) {
        if (out.passengers === null && nums[0] > 0) out.passengers = nums[0];
        if (out.bags === null && nums[1] >= 0) out.bags = nums[1];
      }
    }
  }

  return out;
}

function buildTripSummaryText() {
  const trip = window.lastTrip || null;
  if (!trip) return "";

  const lines = [];
  lines.push("Demande VTC (devis)");
  if (trip.pickupDate || trip.pickupTime) {
    lines.push(`Date/heure: ${String(trip.pickupDate || "")} ${String(trip.pickupTime || "")}`.trim());
  }
  if (trip.start) lines.push(`Départ: ${String(trip.start)}`);
  if (Array.isArray(trip.stops) && trip.stops.length) {
    trip.stops.forEach((s, i) => lines.push(`Arrêt ${i + 1}: ${String(s)}`));
  }
  if (trip.end) lines.push(`Arrivée: ${String(trip.end)}`);

  if (typeof trip.distanceKm === "number") lines.push(`Distance: ${trip.distanceKm.toFixed(1)} km`);
  if (typeof trip.durationMinutes === "number") lines.push(`Durée: ${Math.round(trip.durationMinutes)} min`);

  if (trip.vehicleLabel || trip.vehicle) lines.push(`Véhicule: ${String(trip.vehicleLabel || trip.vehicle)}`);

  const selectedOptions = getSelectedOptions ? getSelectedOptions() : [];
  const optLabels = (selectedOptions || []).map((o) => String(o?.label || "").trim()).filter(Boolean);
  if (optLabels.length) lines.push(`Options: ${optLabels.join(" · ")}`);

  const customOpt = String(trip.customOptionText || "").trim();
  if (customOpt) lines.push(`Option personnalisée: ${customOpt}`);

  if (trip.isQuote) {
    lines.push("Tarif: sur devis");
  } else if (typeof window.lastPrice === "number") {
    lines.push(`Tarif estimatif: ${window.lastPrice.toFixed(2)} €`);
  }

  return lines.join("\n");
}

function buildWhatsAppUrl(text) {
  const msg = String(text || "").trim();
  if (!msg) return "";

  const dataset = getWidgetDataset();
  const rawTarget = String(dataset.whatsappUrl || "").trim() || "+33768889968";

  const normalizePhone = (value) => {
    const digits = String(value || "").replace(/[^0-9]/g, "");
    if (!digits) return "";
    // Helpful FR default: if user entered a local 10-digit number starting with 0, convert to +33 format.
    if (digits.length === 10 && digits.startsWith("0")) return `33${digits.slice(1)}`;
    return digits;
  };

  const resolveBaseUrl = () => {
    if (!rawTarget) return "https://wa.me/";
    if (/^https?:\/\//i.test(rawTarget)) return rawTarget;

    const phone = normalizePhone(rawTarget);
    if (!phone) return "https://wa.me/";
    return `https://wa.me/${phone}`;
  };

  const base = resolveBaseUrl();
  try {
    const u = new URL(base);
    // For standard WhatsApp URLs, `text` pre-fills the message.
    u.searchParams.set("text", msg);
    return u.toString();
  } catch {
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}text=${encodeURIComponent(msg)}`;
  }
}

function initAiAssistantUI() {
  const widget = getWidgetEl();
  if (!widget) return;
  if (document.getElementById("vtc-ai-assistant")) return;

  injectAiAssistantStylesOnce();

  // Desktop panel
  const panel = document.createElement("div");
  panel.id = "vtc-ai-assistant";
  panel.className = "vtc-ai";
  panel.innerHTML = `
    <div class="vtc-ai__header">
      <div>
        <div class="vtc-ai__title">Assistant IA</div>
        <div class="vtc-ai__badge">Conseils et réservation en 3 clics</div>
      </div>
    </div>
    <div class="vtc-ai__body">
      <div class="vtc-ai__row">
        <textarea id="vtc-ai-input" class="vtc-ai__input" placeholder="Dites-nous : prise en charge, heure, dépose, passagers, bagages…"></textarea>
        <button id="vtc-ai-mic" class="vtc-ai__btn vtc-ai__btn--subtle vtc-ai__btn--icon" type="button" title="Dicter un message" aria-label="Dicter un message">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/>
          </svg>
        </button>
        <button id="vtc-ai-send" class="vtc-ai__btn" type="button">Envoyer</button>
      </div>
      <div id="vtc-ai-status" class="vtc-ai__status" style="display:none;"></div>
      <div id="vtc-ai-error" class="vtc-ai__error" style="display:none;"></div>
      <div id="vtc-ai-reply" class="vtc-ai__reply" style="display:none;"></div>
      <div id="vtc-ai-suggestions" class="vtc-ai__suggestions" style="display:none;"></div>
      <div class="vtc-ai__actions">
        <button id="vtc-ai-send-email" class="vtc-ai__btn" type="button">Envoyer par email</button>
        <a id="vtc-ai-whatsapp" class="vtc-ai__btn" href="#" target="_blank" rel="noopener noreferrer">WhatsApp</a>
      </div>
      <div class="vtc-ai__rgpd">
        RGPD: n’envoyez pas d’informations sensibles. Votre message peut être traité par un service d’IA pour générer une réponse.
        <a id="vtc-ai-privacy" href="#" target="_blank" rel="noopener noreferrer">Politique de confidentialité</a>.
      </div>
    </div>
  `.trim();

  // Mobile: FAB + bottom sheet
  const fab = document.createElement("div");
  fab.className = "vtc-ai-fab";
  fab.innerHTML = `<button id="vtc-ai-fab-btn" type="button">Assistant IA</button>`;

  const modal = document.createElement("div");
  modal.id = "vtc-ai-modal";
  modal.className = "vtc-ai-modal is-closed";
  modal.innerHTML = `
    <div class="vtc-ai-modal__backdrop" data-close="1"></div>
    <div class="vtc-ai-modal__sheet">
      <button class="vtc-ai-modal__close" type="button" data-close="1">Fermer</button>
      <div id="vtc-ai-modal-mount"></div>
    </div>
  `.trim();

  const mode = getAiAssistantMode();
  const classicRoot = document.getElementById("vtc-classic-ui");
  const aiMount = document.getElementById("vtc-ai-mount");
  const summaryDiv = document.getElementById("vtc-summary");

  // Prefer the dedicated mount point (works for classic/both/ai-only).
  if (aiMount) {
    aiMount.appendChild(panel);
  } else if (summaryDiv && summaryDiv.insertAdjacentElement) {
    summaryDiv.insertAdjacentElement("afterend", panel);
  } else if (classicRoot && classicRoot.insertAdjacentElement) {
    classicRoot.insertAdjacentElement("afterend", panel);
  } else {
    widget.appendChild(panel);
  }
  document.body.appendChild(fab);
  document.body.appendChild(modal);

  // Apply premium theme colors (blue / black_gold) to the assistant UI.
  // Retry because CSS variables may not be ready yet at first paint.
  applyAiAssistantThemeWithRetry({ panel, fab, modal, widget, tries: 12 });

  // In mobile modal, we reuse the same panel node (move it).
  function openModal() {
    const mount = document.getElementById("vtc-ai-modal-mount");
    if (mount && panel.parentNode !== mount) mount.appendChild(panel);
    modal.classList.remove("is-closed");
  }
  function closeModal() {
    modal.classList.add("is-closed");
    // Put it back to the desktop mount so it exists in DOM when leaving mobile.
    const newAiMount = document.getElementById("vtc-ai-mount");
    if (newAiMount) {
      newAiMount.appendChild(panel);
      return;
    }

    const newSummaryDiv = document.getElementById("vtc-summary");
    if (newSummaryDiv && newSummaryDiv.insertAdjacentElement) {
      newSummaryDiv.insertAdjacentElement("afterend", panel);
      return;
    }

    widget.appendChild(panel);
  }

  fab.querySelector("#vtc-ai-fab-btn")?.addEventListener("click", () => openModal());
  modal.addEventListener("click", (e) => {
    const target = e.target;
    if (target && target.getAttribute && target.getAttribute("data-close") === "1") closeModal();
  });

  const privacyLink = panel.querySelector("#vtc-ai-privacy");
  if (privacyLink) privacyLink.setAttribute("href", getPrivacyPolicyUrl());

  const input = panel.querySelector("#vtc-ai-input");
  const micBtn = panel.querySelector("#vtc-ai-mic");
  const sendBtn = panel.querySelector("#vtc-ai-send");
  const statusEl = panel.querySelector("#vtc-ai-status");
  const errorEl = panel.querySelector("#vtc-ai-error");
  const replyEl = panel.querySelector("#vtc-ai-reply");
  const suggestionsEl = panel.querySelector("#vtc-ai-suggestions");
  const sendEmailBtn = panel.querySelector("#vtc-ai-send-email");
  const whatsappLink = panel.querySelector("#vtc-ai-whatsapp");
  // Copy buttons were intentionally removed from the UI, but keep null-safe bindings.
  const copySummaryBtn = panel.querySelector("#vtc-ai-copy-summary");
  const copyReplyBtn = panel.querySelector("#vtc-ai-copy-reply");

  let lastReply = "";
  let lastSuggestedVehicleIds = [];
  const chatHistory = [];
  // Restore previous conversation (same session) to avoid "restart at 0".
  loadAiSession();
  if (lastReply) {
    try {
      setReply(lastReply);
    } catch {
      // ignore
    }
  }
  if (Array.isArray(lastSuggestedVehicleIds) && lastSuggestedVehicleIds.length) {
    try {
      setAiSuggestions(lastSuggestedVehicleIds);
    } catch {
      // ignore
    }
  }

  // If tariffs already exist (user computed them), show cards immediately.
  try {
    const ctxInit = buildAiAssistantContext();
    const hasQuotesInit = Array.isArray(ctxInit?.vehicleQuotes) && ctxInit.vehicleQuotes.length > 0;
    if (hasQuotesInit) setAiAllTariffsCards({ highlightIds: lastSuggestedVehicleIds });
  } catch {
    // ignore
  }

  function pushHistory(role, content) {
    const r = role === "assistant" ? "assistant" : role === "user" ? "user" : null;
    const c = String(content || "").trim();
    if (!r || !c) return;
    chatHistory.push({ role: r, content: c });
    while (chatHistory.length > 12) chatHistory.shift();
    saveAiSession();
  }

  const aiStorageKeyBase = (() => {
    try {
      const p = typeof window !== "undefined" && window.location ? String(window.location.pathname || "") : "";
      return `vtc_ai_v1:${p || "default"}`;
    } catch {
      return "vtc_ai_v1:default";
    }
  })();

  function loadAiSession() {
    try {
      const raw = sessionStorage.getItem(`${aiStorageKeyBase}:state`);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        const hist = Array.isArray(obj.history) ? obj.history : [];
        chatHistory.length = 0;
        hist
          .filter((h) => h && typeof h === "object")
          .slice(-12)
          .forEach((h) => {
            const role = h.role === "assistant" ? "assistant" : h.role === "user" ? "user" : null;
            const content = typeof h.content === "string" ? h.content : "";
            if (role && content) chatHistory.push({ role, content });
          });

        lastReply = typeof obj.lastReply === "string" ? obj.lastReply : "";
        lastSuggestedVehicleIds = Array.isArray(obj.lastSuggestedVehicleIds) ? obj.lastSuggestedVehicleIds.slice(0, 3) : [];
      }
    } catch {
      // ignore
    }
  }

  function saveAiSession() {
    try {
      const payload = {
        history: Array.isArray(chatHistory) ? chatHistory.slice(-12) : [],
        lastReply: String(lastReply || "").slice(0, 6000),
        lastSuggestedVehicleIds: Array.isArray(lastSuggestedVehicleIds) ? lastSuggestedVehicleIds.slice(0, 3) : [],
      };
      sessionStorage.setItem(`${aiStorageKeyBase}:state`, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  function extractAiSection(text, sectionPrefix) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    const lines = raw.split(/\r?\n/).map((l) => l.trim());
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].toLowerCase().startsWith(String(sectionPrefix).toLowerCase())) {
        start = i + 1;
        break;
      }
    }
    if (start < 0) return "";
    const out = [];
    for (let i = start; i < lines.length; i += 1) {
      const l = lines[i];
      if (/^\d\)\s+/.test(l)) break;
      if (!l) continue;
      out.push(l);
    }
    return out.join("\n").trim();
  }

  function buildAdaptiveSummaryText() {
    const base = buildTripSummaryText();
    const parts = [];
    if (base) parts.push(base);

    const recap = extractAiSection(lastReply, "2) Récap devis");
    if (recap) {
      parts.push(`Assistant IA — récapitulatif\n${recap}`);
    } else if (lastReply) {
      parts.push(`Assistant IA\n${String(lastReply || "").trim()}`);
    }

    return parts.join("\n\n").trim();
  }

  // Speech-to-text (Web Speech API) — best-effort.
  const SpeechRecognition =
    (typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
  let recognition = null;
  let isListening = false;
  let dictationBaseText = "";
  let dictationLastInterim = "";

  function setMicState(listening) {
    isListening = !!listening;
    if (!micBtn) return;
    micBtn.classList.toggle("vtc-ai__btn--listening", isListening);
    micBtn.innerHTML = isListening
      ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 6h12v12H6z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>';
  }

  function ensureRecognition() {
    if (!SpeechRecognition) return null;
    if (recognition) return recognition;
    try {
      recognition = new SpeechRecognition();
      recognition.lang = "fr-FR";
      // Longer recording: keep listening until user stops (browser-dependent).
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setError("");
        setStatus("Écoute…");
        setMicState(true);

        dictationBaseText = String(input?.value || "").trim();
        dictationLastInterim = "";
      };

      recognition.onend = () => {
        setMicState(false);
        setStatus("");

        // Cleanup interim state.
        dictationLastInterim = "";
      };

      recognition.onerror = (e) => {
        const code = String(e?.error || "").trim();
        setMicState(false);
        if (code === "not-allowed" || code === "service-not-allowed") {
          setError("Micro refusé. Autorisez l'accès au micro dans le navigateur.");
        } else if (code === "no-speech") {
          setError("Aucune voix détectée. Réessayez.");
        } else {
          setError("Dictée vocale indisponible sur ce navigateur.");
        }
        setStatus("");
      };

      recognition.onresult = (event) => {
        if (!input) return;
        let interim = "";
        let finalChunk = "";

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const r = event.results[i];
          const alt0 = r && r[0] ? r[0] : null;
          const t = alt0 && alt0.transcript ? String(alt0.transcript) : "";
          if (!t) continue;
          if (r.isFinal) finalChunk += t;
          else interim += t;
        }

        const interimTrim = interim.trim();
        const finalTrim = finalChunk.trim();

        // Update preview text without re-appending interim multiple times.
        if (interimTrim && interimTrim !== dictationLastInterim) {
          dictationLastInterim = interimTrim;
          const base = dictationBaseText;
          input.value = base ? `${base} ${interimTrim}` : interimTrim;
          try {
            input.dispatchEvent(new Event("input", { bubbles: true }));
          } catch {
            // ignore
          }
        }

        // Commit final chunk by appending it once to the base.
        if (finalTrim) {
          const base = dictationBaseText;
          dictationBaseText = base ? `${base} ${finalTrim}` : finalTrim;
          dictationLastInterim = "";
          input.value = dictationBaseText;
          try {
            input.dispatchEvent(new Event("input", { bubbles: true }));
          } catch {
            // ignore
          }
        }
      };
    } catch {
      recognition = null;
      return null;
    }

    return recognition;
  }

  const defaultInputPlaceholder = input ? String(input.getAttribute("placeholder") || "").trim() : "";

  function pushHistory(role, content) {
    const r = role === "assistant" ? "assistant" : "user";
    const c = String(content || "").trim();
    if (!c) return;
    chatHistory.push({ role: r, content: c });
    if (chatHistory.length > 12) chatHistory.splice(0, chatHistory.length - 12);
  }

  function setStatus(text) {
    if (!statusEl) return;
    const v = String(text || "").trim();
    statusEl.style.display = v ? "block" : "none";
    statusEl.textContent = v;
  }
  function setError(text) {
    if (!errorEl) return;
    const v = String(text || "").trim();
    errorEl.style.display = v ? "block" : "none";
    errorEl.textContent = v;
  }

  async function selectVehicleFromAi(vehicleId) {
    const vid = String(vehicleId || "").trim();
    if (!vid) return;

    setError("");
    setStatus("");

    // Ensure we have a computed trip (distance/time) before selecting.
    const ctxReady = await ensureVehicleQuotesReady({ timeoutMs: 9000 });
    if (!ctxReady || !window.lastTrip || typeof window.lastTrip.distanceKm !== "number") {
      setError("Je n’arrive pas à calculer le trajet pour le moment. Merci de préciser les adresses (ville/code postal) et réessayer.");
      return;
    }

    // Keep classic fields in sync.
    try {
      applyAiFormUpdate({ vehicleId: vid });
    } catch {
      // ignore
    }

    try {
      const trip = window.lastTrip;
      const pickupDate = String(trip.pickupDate || "").trim();
      const pickupTime = String(trip.pickupTime || "").trim();
      const leadTimeInfo = getLeadTimeInfo({ pickupDate, pickupTime });
      const stopsCount = Array.isArray(trip.stops) ? trip.stops.length : 0;

      const computed = computeTariffForVehicle({
        km: trip.distanceKm,
        stopsCount,
        pickupTime,
        pickupDate,
        vehicleId: vid,
        leadTimeInfo,
      });

      _widgetState.selectedVehicleId = computed.vehicleId;
      _widgetState.selectedVehicleLabel = computed.vehicleLabel;
      _widgetState.selectedIsQuote = !!computed.isQuote;
      _widgetState.selectedTotal = computed.isQuote ? 0 : computed.total;

      if (window.lastTrip) {
        window.lastTrip.vehicle = computed.vehicleId;
        window.lastTrip.vehicleLabel = computed.vehicleLabel;
        window.lastTrip.isQuote = !!computed.isQuote;
        window.lastTrip.pricingMode = computed.pricingMode || window.lastTrip.pricingMode || null;
        window.lastTrip.surchargesApplied = computed.surchargesApplied || window.lastTrip.surchargesApplied || null;
      }

      if (computed.isQuote) {
        clearPriceUI(true);
        updateResultTariffDisplay({ isQuote: true, quoteMessage: computed.quoteMessage });
        window.lastPrice = 0;
      } else {
        updateResultTariffDisplay({ isQuote: false, total: computed.total });
        window.lastPrice = computed.total;
      }

      renderTripSummaryFromLastTrip();
      applyOptionsDisplayMode("after_calc");
      setReserveButtonEnabled(true);

      const contactWrapper = document.getElementById("contact-wrapper");
      if (contactWrapper) contactWrapper.style.display = "block";

      setStatus("Véhicule sélectionné. Vous pouvez compléter vos coordonnées.");
      setTimeout(() => setStatus(""), 2200);

      try {
        scrollToAnchor("vtc-reservation");
      } catch {
        // ignore
      }
    } catch {
      setError("Impossible de sélectionner ce véhicule pour le moment.");
    }
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderReplyHtml(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";

    // If the API ever returns JSON (shouldn't), render it nicely.
    if (raw.startsWith("{") && raw.endsWith("}")) {
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") {
          const ans = typeof obj.answer === "string" ? obj.answer.trim() : "";
          const q = Array.isArray(obj.questionsMissing) ? obj.questionsMissing : [];
          const r = Array.isArray(obj.recap) ? obj.recap : [];
          const n = Array.isArray(obj.nextStep) ? obj.nextStep : [];

          const parts = [];
          if (ans) parts.push(`<p>${escapeHtml(ans)}</p>`);

          const renderList = (title, items) => {
            const lines = (items || [])
              .map((x) => (typeof x === "string" ? x.trim() : ""))
              .filter(Boolean)
              .slice(0, 12);
            if (!lines.length) return;
            parts.push(`<h4>${escapeHtml(title)}</h4>`);
            parts.push(`<ul>${lines.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`);
          };

          renderList("Questions", q);
          renderList("Récap", r);
          renderList("Prochaine étape", n);

          return parts.join("");
        }
      } catch {
        // fall through
      }
    }

    // Lightweight formatting: paragraphs + bullet lists.
    const lines = raw.split(/\r?\n/);
    const html = [];
    let listOpen = false;
    const flushList = () => {
      if (!listOpen) return;
      html.push("</ul>");
      listOpen = false;
    };

    for (const line of lines) {
      const t = String(line || "").trim();
      if (!t) {
        flushList();
        continue;
      }

      if (t.startsWith("- ")) {
        if (!listOpen) {
          html.push("<ul>");
          listOpen = true;
        }
        html.push(`<li>${escapeHtml(t.slice(2))}</li>`);
        continue;
      }

      flushList();
      // Headings like "1) ..." become h4.
      if (/^\d+\)\s+/.test(t)) {
        html.push(`<h4>${escapeHtml(t.replace(/^\d+\)\s+/, ""))}</h4>`);
      } else {
        html.push(`<p>${escapeHtml(t)}</p>`);
      }
    }
    flushList();
    return html.join("");
  }

  function setReply(text) {
    if (!replyEl) return;
    const v = String(text || "").trim();
    replyEl.style.display = v ? "block" : "none";
    replyEl.innerHTML = v ? renderReplyHtml(v) : "";

    lastReply = v;
    saveAiSession();
  }

  function setAiSuggestions(ids) {
    if (!suggestionsEl) return;
    const list = Array.isArray(ids) ? ids.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 3) : [];
    if (!list.length) {
      suggestionsEl.style.display = "none";
      suggestionsEl.innerHTML = "";
      return;
    }

    const cfg = typeof getWidgetConfig === "function" ? getWidgetConfig() : null;
    const vehicles = Array.isArray(cfg?.vehicles) ? cfg.vehicles : [];
    const quoteMessage = String(cfg?.quoteMessage || "").trim();
    const currency = String(cfg?.currency || "EUR").trim() || "EUR";

    const vehiclesById = new Map(vehicles.map((v) => [String(v.id || "").trim(), v]));
    const ctx = buildAiAssistantContext();
    const quotes = Array.isArray(ctx?.vehicleQuotes) ? ctx.vehicleQuotes : [];
    const quoteById = new Map(
      quotes
        .map((q) => {
          const id = String(q?.id || "").trim();
          return id ? [id, q] : null;
        })
        .filter(Boolean),
    );

    const cards = [];
    for (const id of list) {
      const v = vehiclesById.get(id);
      const q = quoteById.get(id);
      if (!v) continue;

      const label = String(v.label || id).trim() || id;
      const imageSrc = (String(v.imageUrl || "").trim() || getVehicleDemoImage(id)).trim();
      const isQuote = !!(q && q.isQuote);
      const total = q && typeof q.total === "number" && Number.isFinite(q.total) ? q.total : null;

      const right = isQuote || total === null
        ? `Sur devis${quoteMessage ? ` — <span style="opacity:0.85;">${escapeHtml(quoteMessage)}</span>` : ""}`
        : `<strong>${Number(total).toFixed(2)} ${escapeHtml(currency)}</strong>`;

      cards.push(
        `
          <div class="vtc-tariff-card" data-vehicle-card="${String(id).replace(/"/g, "&quot;")}">
            <div class="vtc-tariff-left">
              <img class="vtc-tariff-image" src="${String(imageSrc).replace(/"/g, "&quot;")}" alt="${String(label).replace(/"/g, "&quot;")}" />
              <div style="min-width:0;">
                <div class="vtc-tariff-title">${escapeHtml(label)}</div>
                <div class="vtc-tariff-price">${right}</div>
              </div>
            </div>
            <button type="button" class="vtc-tariff-select" data-ai-choose-vehicle="${String(id).replace(/"/g, "&quot;")}">Choisir</button>
          </div>
        `.trim(),
      );
    }

    if (!cards.length) {
      suggestionsEl.style.display = "none";
      suggestionsEl.innerHTML = "";
      return;
    }

    suggestionsEl.style.display = "block";
    suggestionsEl.innerHTML = `
      <h4 style="margin:12px 0 8px 0;">Tarifs proposés</h4>
      <div class="vtc-tariffs-grid">${cards.join("\n")}</div>
    `.trim();

    suggestionsEl.querySelectorAll("button[data-ai-choose-vehicle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const vehicleId = String(btn.getAttribute("data-ai-choose-vehicle") || "").trim();
        selectVehicleFromAi(vehicleId);
      });
    });
  }

  function setAiAllTariffsCards({ highlightIds } = {}) {
    if (!suggestionsEl) return;
    const highlight = new Set((Array.isArray(highlightIds) ? highlightIds : []).map((x) => String(x || "").trim()).filter(Boolean));

    const cfg = typeof getWidgetConfig === "function" ? getWidgetConfig() : null;
    const vehicles = Array.isArray(cfg?.vehicles) ? cfg.vehicles : [];
    const quoteMessage = String(cfg?.quoteMessage || "").trim();
    const currency = String(cfg?.currency || "EUR").trim() || "EUR";

    const vehiclesById = new Map(vehicles.map((v) => [String(v.id || "").trim(), v]));
    const ctx = buildAiAssistantContext();
    const quotes = Array.isArray(ctx?.vehicleQuotes) ? ctx.vehicleQuotes : [];
    if (!quotes.length) {
      suggestionsEl.style.display = "none";
      suggestionsEl.innerHTML = "";
      return;
    }

    // Sort by computed total (quotes last)
    const ordered = [...quotes].sort((a, b) => {
      const aQuote = !!a?.isQuote;
      const bQuote = !!b?.isQuote;
      if (aQuote !== bQuote) return aQuote ? 1 : -1;
      const at = typeof a?.total === "number" ? a.total : Number.POSITIVE_INFINITY;
      const bt = typeof b?.total === "number" ? b.total : Number.POSITIVE_INFINITY;
      return at - bt;
    });

    const cards = [];
    for (const q of ordered) {
      const id = String(q?.id || "").trim();
      if (!id) continue;
      const v = vehiclesById.get(id);
      if (!v) continue;

      const label = String(v.label || id).trim() || id;
      const imageSrc = (String(v.imageUrl || "").trim() || getVehicleDemoImage(id)).trim();
      const isQuote = !!q?.isQuote;
      const total = typeof q?.total === "number" && Number.isFinite(q.total) ? q.total : null;

      const right = isQuote || total === null
        ? `Sur devis${quoteMessage ? ` — <span style="opacity:0.85;">${escapeHtml(quoteMessage)}</span>` : ""}`
        : `<strong>${Number(total).toFixed(2)} ${escapeHtml(currency)}</strong>`;

      const badge = highlight.has(id) ? '<span style="margin-left:8px;font-size:12px;opacity:0.85;">Recommandé</span>' : "";
      cards.push(
        `
          <div class="vtc-tariff-card" data-vehicle-card="${String(id).replace(/"/g, "&quot;")}">
            <div class="vtc-tariff-left">
              <img class="vtc-tariff-image" src="${String(imageSrc).replace(/"/g, "&quot;")}" alt="${String(label).replace(/"/g, "&quot;")}" />
              <div style="min-width:0;">
                <div class="vtc-tariff-title">${escapeHtml(label)}${badge}</div>
                <div class="vtc-tariff-price">${right}</div>
              </div>
            </div>
            <button type="button" class="vtc-tariff-select" data-ai-choose-vehicle="${String(id).replace(/"/g, "&quot;")}">Choisir</button>
          </div>
        `.trim(),
      );
    }

    if (!cards.length) {
      suggestionsEl.style.display = "none";
      suggestionsEl.innerHTML = "";
      return;
    }

    suggestionsEl.style.display = "block";
    suggestionsEl.innerHTML = `
      <h4 style="margin:12px 0 8px 0;">Tarifs (tous véhicules)</h4>
      <div class="vtc-tariffs-grid">${cards.join("\n")}</div>
    `.trim();

    suggestionsEl.querySelectorAll("button[data-ai-choose-vehicle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const vehicleId = String(btn.getAttribute("data-ai-choose-vehicle") || "").trim();
        selectVehicleFromAi(vehicleId);
      });
    });
  }

  async function ensureVehicleQuotesReady({ timeoutMs = 9000 } = {}) {
    const ctx0 = buildAiAssistantContext();
    if (Array.isArray(ctx0?.vehicleQuotes) && ctx0.vehicleQuotes.length > 0) return ctx0;

    const triggered = maybeTriggerCalculator();
    if (!triggered) return null;

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const ctx = buildAiAssistantContext();
      if (Array.isArray(ctx?.vehicleQuotes) && ctx.vehicleQuotes.length > 0) return ctx;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }

  function applyInputValueIfEmpty(inputEl, value) {
    if (!inputEl) return false;
    const v = String(value || "").trim();
    if (!v) return false;
    const current = String(inputEl.value || "").trim();
    if (current) return false;

    inputEl.value = v;
    try {
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
      inputEl.dispatchEvent(new Event("blur", { bubbles: true }));
    } catch {
      // ignore
    }
    return true;
  }

  function applyCheckboxSelectionByIds(containerEl, ids) {
    if (!containerEl || !Array.isArray(ids)) return false;
    const wanted = new Set(ids.map((x) => String(x || "").trim()).filter(Boolean));
    if (!wanted.size) return false;

    let changed = false;
    containerEl.querySelectorAll("input[type=checkbox][data-option-id]").forEach((input) => {
      const el = input;
      const id = String(el.dataset.optionId || "").trim();
      if (!id) return;
      const shouldCheck = wanted.has(id);
      if (el.checked !== shouldCheck) {
        el.checked = shouldCheck;
        changed = true;
        try {
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } catch {
          // ignore
        }
      }
    });

    return changed;
  }

  function clearAllOptions(containerEl) {
    if (!containerEl) return false;
    let changed = false;
    containerEl.querySelectorAll("input[type=checkbox][data-option-id]").forEach((input) => {
      const el = input;
      if (!el.checked) return;
      el.checked = false;
      changed = true;
      try {
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {
        // ignore
      }
    });
    return changed;
  }

  function applyVehicleSelection(formUpdate) {
    const cfg = typeof getWidgetConfig === "function" ? getWidgetConfig() : null;
    const vehicleId = String(formUpdate?.vehicleId || "").trim();
    if (!cfg || !vehicleId) return false;

    const escAttr = (v) => String(v || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");

    // Mode A: radio selection
    if (cfg.displayMode === "A") {
      const widgetEl = getWidgetEl() || document;
      const radio =
        widgetEl.querySelector?.(`input[name="vehicle"][value="${escAttr(vehicleId)}"]`) ||
        document.querySelector(`input[name="vehicle"][value="${escAttr(vehicleId)}"]`);

      if (radio && !radio.checked) {
        radio.checked = true;
        try {
          radio.dispatchEvent(new Event("change", { bubbles: true }));
        } catch {
          // ignore
        }
        return true;
      }
      return false;
    }

    // Mode B: tariffs selection (requires tariffs list to exist)
    const btn = document.querySelector(`button[data-vehicle-id="${escAttr(vehicleId)}"]`);
    if (btn) {
      btn.click();
      return true;
    }

    return false;
  }

  function maybeTriggerCalculator() {
    const start = String(document.getElementById("start")?.value || "").trim();
    const end = String(document.getElementById("end")?.value || "").trim();
    const pickupDate = String(document.getElementById("pickupDate")?.value || "").trim();
    if (!start || !end || !pickupDate) return false;

    if (typeof window.calculatePrice === "function") {
      try {
        window.calculatePrice();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  function applyAiFormUpdate(formUpdate) {
    if (!formUpdate || typeof formUpdate !== "object") return { changed: false };

    const startInput = document.getElementById("start");
    const endInput = document.getElementById("end");
    const dateInput = document.getElementById("pickupDate");
    const timeInput = document.getElementById("pickupTime");
    const optionsContainer = document.getElementById("vtc-options");

    let changed = false;
    changed = applyInputValueIfEmpty(startInput, formUpdate.pickup) || changed;
    changed = applyInputValueIfEmpty(endInput, formUpdate.dropoff) || changed;
    changed = applyInputValueIfEmpty(dateInput, formUpdate.pickupDate) || changed;
    changed = applyInputValueIfEmpty(timeInput, formUpdate.pickupTime) || changed;

    // Options are theme-configured via data-option-id.
    // If optionIds is omitted -> do nothing.
    // If optionIds is [] -> explicit "no options" -> clear all.
    // If optionIds has values -> select exactly those ids.
    if (Array.isArray(formUpdate.optionIds)) {
      if (formUpdate.optionIds.length === 0) {
        changed = clearAllOptions(optionsContainer) || changed;
      } else {
        changed = applyCheckboxSelectionByIds(optionsContainer, formUpdate.optionIds) || changed;
      }
    }

    // Vehicle selection depends on display mode.
    changed = applyVehicleSelection(formUpdate) || changed;

    // Trigger calculator pricing (theme settings) when mandatory fields exist.
    const triggered = maybeTriggerCalculator();

    // If the trip exists, keep summary consistent after option updates.
    try {
      syncAiOptionsDecisionFromUI();
    } catch {
      // ignore
    }

    // In mode B, tariffs buttons are rendered asynchronously after Google Directions callback.
    // If vehicleId was provided and not selectable yet, retry a few times.
    const cfg = typeof getWidgetConfig === "function" ? getWidgetConfig() : null;
    const vehicleId = String(formUpdate?.vehicleId || "").trim();
    if (cfg?.displayMode === "B" && vehicleId) {
      let tries = 0;
      const tick = () => {
        tries += 1;
        const ok = applyVehicleSelection({ vehicleId });
        if (ok || tries >= 12) return;
        window.setTimeout(tick, 250);
      };
      window.setTimeout(tick, 250);
    }

    return { changed, triggered };
  }

  async function sendMessage() {
    const message = String(input?.value || "").trim();
    setError("");
    setStatus("");
    if (!message) {
      setError("Écrivez un message pour l’assistant.");
      return;
    }

    pushHistory("user", message);

    // Persist pax/bags if the user provided them.
    try {
      const { passengers, bags } = extractCountsFromUserText(message);
      if (typeof passengers === "number") _widgetState.aiPassengersCount = passengers;
      if (typeof bags === "number") _widgetState.aiBagsCount = bags;
    } catch {
      // ignore
    }

    // UX: clear immediately, show "Je réfléchis…" inside the field while processing.
    if (input) {
      input.value = "";
      input.setAttribute("placeholder", "Je réfléchis…");
      input.setAttribute("disabled", "disabled");
      try {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } catch {
        // ignore
      }
    }

    // Stop dictation if active.
    try {
      if (recognition && isListening) recognition.stop();
    } catch {
      // ignore
    }

    if (sendBtn) sendBtn.setAttribute("disabled", "disabled");
    setStatus("Je réfléchis…");

    const wantsTariffs = /\b(tarif|tarifs|prix)\b/i.test(message);

    // Pre-compute tariffs when possible so the assistant can answer in 1 pass.
    // - Explicit price intent: always precompute.
    // - Implicit: if we already have pickup+dropoff+date+time, also precompute.
    const ctxCandidate = buildAiAssistantContext();
    const canTryQuotes =
      !!String(ctxCandidate?.pickup || "").trim() &&
      !!String(ctxCandidate?.dropoff || "").trim() &&
      !!String(ctxCandidate?.date || "").trim() &&
      !!String(ctxCandidate?.time || "").trim();

    const preCtx = (wantsTariffs || canTryQuotes) ? await ensureVehicleQuotesReady({ timeoutMs: 9000 }) : null;
    const contextBefore = preCtx || ctxCandidate;
    const hadDistanceBefore = typeof contextBefore?.quote?.distance === "number";
    const hadVehicleQuotesBefore = Array.isArray(contextBefore?.vehicleQuotes) && contextBefore.vehicleQuotes.length > 0;

    const body = {
      userMessage: message,
      context: wantsTariffs && preCtx ? { ...contextBefore, aiSecondPass: true } : contextBefore,
      history: Array.isArray(chatHistory) ? chatHistory.slice(-12) : [],
    };

    let json = null;
    try {
      const res = await fetch("/apps/vtc/api/ai-assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });

      try {
        json = await res.json();
      } catch {
        json = null;
      }

      if (!res.ok || !json?.ok) {
        const err = String(json?.error || "Erreur serveur");
        if (res.status === 404 && err === "AI_DISABLED") {
          setError("Assistant indisponible (désactivé côté serveur).");
        } else if (err === "OPENAI_NOT_CONFIGURED") {
          setError("Assistant indisponible (configuration IA manquante)." );
        } else if (err === "OPENAI_FAILED") {
          setError("Assistant indisponible (erreur IA). Réessayez plus tard." );
        } else if (err === "OPENAI_EMPTY") {
          setError("Réponse vide. Réessayez." );
        } else if (res.status === 429) {
          const retry = typeof json?.retryAfterSeconds === "number" ? json.retryAfterSeconds : 30;
          setError(`Trop de demandes. Réessayez dans ${retry}s.`);
        } else {
          setError("Impossible de générer une réponse pour le moment.");
        }
        setStatus("");
        return;
      }

      lastReply = String(json.reply || "").trim();
      setReply(lastReply);
      pushHistory("assistant", lastReply);

      // If the server returns computed quotes, keep them for card display.
      try {
        if (Array.isArray(json?.vehicleQuotes) && json.vehicleQuotes.length) {
          _widgetState.aiVehicleQuotesOverride = json.vehicleQuotes.slice(0, 50);
        }
      } catch {
        // ignore
      }

      // Mark that we already asked about options if the assistant prompts for it.
      try {
        const t = String(lastReply || "").toLowerCase();
        if (t.includes("souhaitez-vous") && t.includes("option")) {
          _widgetState.aiOptionsAskedOnce = true;
        }
        if ((t.includes("combien") && t.includes("passager")) || (t.includes("combien") && (t.includes("bagage") || t.includes("valise")))) {
          _widgetState.aiCountsAskedOnce = true;
        }
      } catch {
        // ignore
      }

      // Optional: let the AI auto-fill calculator fields (no pricing here).
      if (json && typeof json === "object" && json.formUpdate) {
        try {
          const ids = Array.isArray(json.formUpdate?.suggestedVehicleIds) ? json.formUpdate.suggestedVehicleIds : [];
          lastSuggestedVehicleIds = Array.isArray(ids) ? ids.slice(0, 3) : [];
          setAiSuggestions(lastSuggestedVehicleIds);
          saveAiSession();
        } catch {
          // ignore
        }

        const applied = applyAiFormUpdate(json.formUpdate);
        if (applied?.changed) {
          setStatus(applied.triggered ? "Champs mis à jour, calcul en cours…" : "Formulaire mis à jour." );
          setTimeout(() => setStatus(""), 2200);
        }

        // If the calculator was not filled/ready before, do a 2nd AI pass AFTER we have vehicleQuotes.
        // This makes the assistant able to give tariffs even when the user didn't fill the calculator.
        const needsSecondPass = applied.triggered && !hadDistanceBefore && !hadVehicleQuotesBefore;
        if (needsSecondPass) {
          setStatus("Tarifs en cours de calcul…");

          const waitForQuotes = async () => {
            const started = Date.now();
            while (Date.now() - started < 8000) {
              const ctxNow = buildAiAssistantContext();
              const hasQuotes = Array.isArray(ctxNow?.vehicleQuotes) && ctxNow.vehicleQuotes.length > 0;
              if (hasQuotes) return ctxNow;
              await new Promise((r) => setTimeout(r, 250));
            }
            return null;
          };

          const ctxAfter = await waitForQuotes();
          if (ctxAfter) {
            try {
              const res2 = await fetch("/apps/vtc/api/ai-assistant", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ userMessage: message, context: { ...ctxAfter, aiSecondPass: true } }),
              });
              const json2 = await res2.json().catch(() => null);
              if (res2.ok && json2?.ok && typeof json2.reply === "string") {
                lastReply = String(json2.reply || "").trim();
                setReply(lastReply);
                pushHistory("assistant", lastReply);

                try {
                  const ids2 = Array.isArray(json2?.formUpdate?.suggestedVehicleIds) ? json2.formUpdate.suggestedVehicleIds : [];
                  lastSuggestedVehicleIds = Array.isArray(ids2) ? ids2.slice(0, 3) : [];
                  setAiSuggestions(lastSuggestedVehicleIds);
                } catch {
                  // ignore
                }
              }
            } catch {
              // ignore
            }
          }
        }
      }

      // Always refresh tariff cards when quotes exist.
      try {
        const ctxNow = buildAiAssistantContext();
        const hasQuotesNow = Array.isArray(ctxNow?.vehicleQuotes) && ctxNow.vehicleQuotes.length > 0;
        if (hasQuotesNow) setAiAllTariffsCards({ highlightIds: lastSuggestedVehicleIds });
      } catch {
        // ignore
      }

      // Don't clear suggestions blindly: if we have computed tariffs we can still show cards.
      try {
        const ctxNow = buildAiAssistantContext();
        const hasQuotesNow = Array.isArray(ctxNow?.vehicleQuotes) && ctxNow.vehicleQuotes.length > 0;
        if (!hasQuotesNow && !json?.formUpdate?.suggestedVehicleIds) {
          lastSuggestedVehicleIds = [];
          setAiSuggestions([]);
          saveAiSession();
        }
      } catch {
        // ignore
      }

      // Restore input UX after reply.
      if (input) {
        input.removeAttribute("disabled");
        input.setAttribute("placeholder", defaultInputPlaceholder || "");
        try {
          input.focus();
        } catch {
          // ignore
        }
      }

      setStatus("");
      return;
    } catch (e) {
      console.error("ai-assistant: fetch failed", e);
      setError("Connexion impossible. Vérifiez votre réseau.");
      setStatus("");
      return;
    } finally {
      if (sendBtn) sendBtn.removeAttribute("disabled");

      // Ensure input is usable again even on errors.
      if (input) {
        input.removeAttribute("disabled");
        input.setAttribute("placeholder", defaultInputPlaceholder || "");
      }
    }
  }

  async function sendLeadEmail() {
    setError("");
    setStatus("");

    const bookingEmailTo = String(getWidgetDataset().bookingEmailTo || "").trim();
    if (!bookingEmailTo) {
      setError("Email destinataire non configuré dans le bloc (réglages du thème)." );
      return;
    }

    const tripSummaryText = buildAdaptiveSummaryText();
    if (!tripSummaryText && !chatHistory.length) {
      setError("Renseignez d’abord un trajet ou posez une question à l’assistant.");
      return;
    }

    if (sendEmailBtn) sendEmailBtn.setAttribute("disabled", "disabled");
    setStatus("Envoi email en cours…");

    try {
      const payload = {
        bookingEmailTo,
        tripSummaryText,
        messages: chatHistory,
        sourceUrl: typeof window !== "undefined" && window.location ? window.location.href : undefined,
        context: buildAiAssistantContext(),
      };

      const res = await fetch("/apps/vtc/api/ai-assistant-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });

      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }

      if (!res.ok || !json?.ok) {
        const err = String(json?.error || "Erreur serveur");
        if (err === "EMAIL_NOT_CONFIGURED") {
          setError("Email destinataire non configuré.");
        } else {
          setError("Envoi email impossible pour le moment.");
        }
        setStatus("");
        return;
      }

      setStatus("Email envoyé. Nous vous recontactons rapidement.");
      setTimeout(() => setStatus(""), 2800);
      return;
    } catch (e) {
      console.error("ai-assistant-email: fetch failed", e);
      setError("Connexion impossible. Vérifiez votre réseau.");
      setStatus("");
      return;
    } finally {
      if (sendEmailBtn) sendEmailBtn.removeAttribute("disabled");
    }
  }

  sendBtn?.addEventListener("click", () => sendMessage());
  sendEmailBtn?.addEventListener("click", () => sendLeadEmail());

  micBtn?.addEventListener("click", () => {
    setError("");
    if (!SpeechRecognition) {
      setError("Dictée vocale non supportée sur ce navigateur.");
      return;
    }
    // Web Speech generally requires HTTPS (or localhost).
    try {
      const isLocalhost = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/i.test(window.location?.hostname || "");
      const isHttps = typeof window !== "undefined" && window.location?.protocol === "https:";
      if (!isHttps && !isLocalhost) {
        setError("La dictée vocale nécessite HTTPS (ou localhost).");
        return;
      }
    } catch {
      // ignore
    }

    const rec = ensureRecognition();
    if (!rec) {
      setError("Dictée vocale indisponible.");
      return;
    }

    try {
      if (isListening) {
        rec.stop();
      } else {
        rec.start();

        // Safety timeout: stop after ~120s to avoid endless sessions (browser-dependent).
        try {
          window.setTimeout(() => {
            try {
              if (recognition && isListening) recognition.stop();
            } catch {
              // ignore
            }
          }, 120000);
        } catch {
          // ignore
        }
      }
    } catch {
      setError("Impossible de démarrer la dictée vocale.");
      setMicState(false);
    }
  });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage();
    }
  });

  copySummaryBtn?.addEventListener("click", async () => {
    const txt = buildAdaptiveSummaryText();
    const ok = await copyToClipboard(txt);
    setStatus(ok ? "Résumé copié." : "Impossible de copier le résumé.");
    setTimeout(() => setStatus(""), 2500);
  });

  copyReplyBtn?.addEventListener("click", async () => {
    const txt = String(lastReply || "").trim();
    const ok = await copyToClipboard(txt);
    setStatus(ok ? "Réponse copiée." : "Impossible de copier la réponse.");
    setTimeout(() => setStatus(""), 2500);
  });

  whatsappLink?.addEventListener("click", (e) => {
    e.preventDefault();
    const msg = buildAdaptiveSummaryText();
    const url = buildWhatsAppUrl(msg);
    if (!url) {
      setError("Calculez un trajet pour générer un résumé WhatsApp.");
      return;
    }
    whatsappLink.setAttribute("href", url);

    window.open(url, "_blank", "noopener,noreferrer");
  });
}

function getCustomOptionTextFromUI() {
  const raw = String(document.getElementById("customOption")?.value || "").trim();
  if (!raw) return "";

  // If the user types a time-like value, normalize it (floor to 5-minute steps).
  const m = raw.match(/^\s*(\d{1,2})\s*(?:[:hH])\s*(\d{2})\s*$/);
  if (!m) return raw;

  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return raw;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return raw;

  const floored = Math.floor(mm / 5) * 5;
  const mmStr = String(floored).padStart(2, "0");
  return `${String(hh).padStart(2, "0")}:${mmStr}`;
}

function normalizeOptionsDisplayMode(value) {
  const v = String(value || "").trim();
  if (v === "before_calc" || v === "after_calc" || v === "before_booking") return v;
  return "before_calc";
}

function safeJsonParse(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizePricingBehavior(value) {
  const v = String(value || "").trim();
  if (v === "all_quote" || v === "lead_time_pricing" || v === "normal_prices") return v;
  return "normal_prices";
}

function parsePickupDateTime(pickupDate, pickupTime) {
  const date = String(pickupDate || "").trim();
  if (!date) return null;
  const time = String(pickupTime || "").trim() || "00:00";
  const dt = new Date(`${date}T${time}`);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function normalizeTimeTo5Minutes(value) {
  const v = String(value || "").trim();
  if (!v) return v;
  const m = v.match(/^\s*(\d{1,2})\s*:\s*(\d{2})\s*$/);
  if (!m) return v;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return v;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return v;
  const floored = Math.floor(mm / 5) * 5;
  return `${String(hh).padStart(2, "0")}:${String(floored).padStart(2, "0")}`;
}

function getLeadTimeInfo({ pickupDate, pickupTime }) {
  const cfg = getWidgetConfig();
  const thresholdMinutes = Math.max(0, parseNumber(cfg.leadTimeThresholdMinutes, 0));
  const pickupDateTime = parsePickupDateTime(pickupDate, pickupTime);
  if (!pickupDateTime) {
    return {
      mode: "reservation",
      thresholdMinutes,
      deltaMinutes: null,
    };
  }

  const now = new Date();
  const deltaMinutes = (pickupDateTime.getTime() - now.getTime()) / 60000;

  if (!Number.isFinite(deltaMinutes)) {
    return {
      mode: "reservation",
      thresholdMinutes,
      deltaMinutes: null,
    };
  }

  const isImmediate = deltaMinutes < thresholdMinutes;

  return {
    mode: isImmediate ? "immediate" : "reservation",
    thresholdMinutes,
    deltaMinutes,
  };
}

function normalizeVehicle(raw) {
  const id = String(raw?.id || "").trim();
  const label = String(raw?.label || "").trim();
  const baseFare = parseNumber(raw?.baseFare, 0);
  const pricePerKm = parseNumber(raw?.pricePerKm, 0);
  const quoteOnly = !!raw?.quoteOnly || id === "autre";
  const imageUrl = String(raw?.imageUrl || "").trim();
  return {
    id,
    label: label || id || "Véhicule",
    baseFare,
    pricePerKm,
    quoteOnly,
    imageUrl,
  };
}

function normalizeOption(raw) {
  const id = String(raw?.id || "").trim();
  const label = String(raw?.label || "").trim();
  const typeRaw = String(raw?.type || "").trim().toLowerCase();
  const type = typeRaw === "percent" ? "percent" : "fixed";
  const amount = parseNumber(raw?.amount, parseNumber(raw?.fee, 0));
  return {
    id,
    label: label || id || "Option",
    type,
    amount,
  };
}

function getOptionsFromDataset(dataset) {
  const raw = safeJsonParse(dataset.optionsConfig);
  if (!Array.isArray(raw)) return [];

  const normalizeIdFromLabel = (label, index) => {
    const cleaned = String(label || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return cleaned || `option_${index + 1}`;
  };

  const options = [];
  raw.forEach((item, index) => {
    if (!item) return;

    const label = String(item.label || "").trim();
    if (!label) return;

    const id = String(item.id || "").trim() || normalizeIdFromLabel(label, index);
    const normalized = normalizeOption({ ...item, id, label });
    if (!normalized.id) return;
    options.push(normalized);
  });

  return options;
}

function getWidgetConfig() {
  if (_widgetConfigCache) return _widgetConfigCache;

  const dataset = getWidgetDataset();
  const rawCfg = safeJsonParse(dataset.config);

  const legacyDefaults = {
    vehicles: [
      {
        id: "berline",
        label: "Berline",
        baseFare: parseNumber(dataset.baseFareBerline, 29.99),
        pricePerKm: parseNumber(dataset.pricePerKmBerline, 2.4),
        quoteOnly: false,
        imageUrl: (dataset.vehicleImageBerline || dataset.berlineImg || "").trim(),
      },
      {
        id: "van",
        label: "Van 7 places",
        baseFare: parseNumber(dataset.baseFareVan, 29.99),
        pricePerKm: parseNumber(dataset.pricePerKmVan, 3.5),
        quoteOnly: false,
        imageUrl: (dataset.vehicleImageVan || dataset.vanImg || "").trim(),
      },
      {
        id: "autre",
        label: "Autre (sur devis)",
        baseFare: 0,
        pricePerKm: 0,
        quoteOnly: true,
        imageUrl: (dataset.vehicleImageAutre || dataset.autreImg || "").trim(),
      },
    ],
    options: [],
  };

  const displayModeRaw = String(rawCfg?.displayMode || "").trim().toUpperCase();
  const displayMode = displayModeRaw === "B" ? "B" : "A";
  const stopFee = parseNumber(rawCfg?.stopFee, parseNumber(dataset.stopFee, 0));
  const quoteMessage = String(
    rawCfg?.quoteMessage || dataset.quoteMessage || "Sur devis — merci de nous contacter.",
  ).trim();
  // Slack settings were removed from the theme block; keep Slack disabled from the widget.
  const slackEnabled = false;

  const optionsDisplayMode = normalizeOptionsDisplayMode(
    rawCfg?.optionsDisplayMode || dataset.optionsDisplayMode,
  );

  const pricingBehavior = normalizePricingBehavior(rawCfg?.pricingBehavior);
  const leadTimeThresholdMinutes = parseNumber(rawCfg?.leadTimeThresholdMinutes, 120);
  const immediateLabel = String(rawCfg?.immediateLabel || "Immédiat").trim();
  const reservationLabel = String(rawCfg?.reservationLabel || "Réservation").trim();
  const immediateSurchargeEnabled = parseBoolean(rawCfg?.immediateSurchargeEnabled, true);
  const immediateBaseDeltaAmount = parseNumber(rawCfg?.immediateBaseDeltaAmount, 0);
  const immediateBaseDeltaPercent = parseNumber(rawCfg?.immediateBaseDeltaPercent, 0);
  const immediateTotalDeltaPercent = parseNumber(rawCfg?.immediateTotalDeltaPercent, 0);

  const vehiclesRaw = Array.isArray(rawCfg?.vehicles) ? rawCfg.vehicles : legacyDefaults.vehicles;
  const vehicles = vehiclesRaw.map(normalizeVehicle).filter((v) => v.id);
  const datasetOptions = getOptionsFromDataset(dataset);
  const optionsRaw = datasetOptions.length
    ? datasetOptions
    : Array.isArray(rawCfg?.options)
      ? rawCfg.options
      : legacyDefaults.options;
  const options = optionsRaw.map(normalizeOption).filter((o) => o.id);

  _widgetConfigCache = {
    displayMode,
    stopFee,
    quoteMessage,
    slackEnabled,
    optionsDisplayMode,
    pricingBehavior,
    leadTimeThresholdMinutes,
    immediateLabel,
    reservationLabel,
    immediateSurchargeEnabled,
    immediateBaseDeltaAmount,
    immediateBaseDeltaPercent,
    immediateTotalDeltaPercent,
    vehicles: vehicles.length ? vehicles : legacyDefaults.vehicles.map(normalizeVehicle),
    options,
  };

  return _widgetConfigCache;
}

function getVehicleById(vehicleId) {
  const cfg = getWidgetConfig();
  return cfg.vehicles.find((v) => v.id === vehicleId) || null;
}

function getPricingConfig(vehicleId, stopsCount) {
  const cfg = getWidgetConfig();
  const vehicle = getVehicleById(vehicleId) || normalizeVehicle({ id: vehicleId, label: vehicleId });

  const extraStopsTotal = Math.max(0, stopsCount || 0) * (cfg.stopFee || 0);

  return {
    baseFare: vehicle.baseFare || 0,
    pricePerKm: vehicle.pricePerKm || 0,
    stopFee: cfg.stopFee || 0,
    extraStopsTotal,
    quoteMessage: cfg.quoteMessage,
    slackEnabled: cfg.slackEnabled,
    quoteOnly: !!vehicle.quoteOnly,
    vehicleLabel: vehicle.label,
  };
}

function getSelectedOptions() {
  const cfg = getWidgetConfig();
  const optionsContainer = document.getElementById("vtc-options");
  if (!optionsContainer) return [];

  const selected = [];
  optionsContainer.querySelectorAll("input[type=checkbox][data-option-id]").forEach((input) => {
    const el = input;
    if (!el.checked) return;
    const optionId = String(el.dataset.optionId || "").trim();
    const option = cfg.options.find((o) => o.id === optionId);
    if (!option) return;
    selected.push(option);
  });

  return selected;
}

function computeSelectedOptionsPricing(baseTotal) {
  const options = getSelectedOptions();
  const base = Number.isFinite(baseTotal) ? baseTotal : 0;
  const applied = options.map((o) => {
    const type = o.type === "percent" ? "percent" : "fixed";
    const amount = Number.isFinite(o.amount) ? o.amount : 0;
    const fee = type === "percent" ? base * (amount / 100) : amount;
    return {
      id: o.id,
      label: o.label,
      type,
      amount,
      fee,
    };
  });

  const totalFee = applied.reduce((sum, o) => sum + (Number.isFinite(o.fee) ? o.fee : 0), 0);
  return { applied, totalFee };
}

function getSelectedVehicleIdFromUI() {
  const cfg = getWidgetConfig();
  if (cfg.displayMode === "B") {
    return _widgetState.selectedVehicleId;
  }

  const widget = getWidgetEl() || document;
  return (
    widget.querySelector?.('input[name="vehicle"]:checked')?.value ||
    document.querySelector('input[name="vehicle"]:checked')?.value ||
    null
  );
}

function computeTariffForVehicle({ km, stopsCount, pickupTime, pickupDate, vehicleId, leadTimeInfo }) {
  const cfg = getWidgetConfig();
  const vehicle = getVehicleById(vehicleId);
  if (!vehicle) return { vehicleId, vehicleLabel: vehicleId, isQuote: true, total: 0 };

  const extraStopsTotal = Math.max(0, stopsCount || 0) * (cfg.stopFee || 0);

  if (cfg.pricingBehavior === "all_quote" || vehicle.quoteOnly) {
    return {
      vehicleId: vehicle.id,
      vehicleLabel: vehicle.label,
      isQuote: true,
      total: 0,
      quoteMessage: cfg.quoteMessage,
      pricingMode: cfg.pricingBehavior === "all_quote" ? "all_quote" : null,
    };
  }

  let total = (km || 0) * (vehicle.pricePerKm || 0);
  total += extraStopsTotal;

  // Majoration nuit 22h–05h
  if (pickupTime) {
    const hour = parseInt(String(pickupTime).split(":")[0] || "", 10);
    if (Number.isFinite(hour) && (hour >= 22 || hour < 5)) total *= 1.1;
  }

  // Remise si > 600 €
  if (total > 600) total *= 0.9;

  // Minimum (base fare)
  if (total < (vehicle.baseFare || 0)) total = vehicle.baseFare || 0;

  const optionsPricing = computeSelectedOptionsPricing(total);
  total += optionsPricing.totalFee;

  let pricingMode = null;
  let surchargesApplied = null;
  const lead = leadTimeInfo || getLeadTimeInfo({ pickupDate, pickupTime });
  if (cfg.pricingBehavior === "lead_time_pricing") {
    pricingMode = lead.mode;

    if (lead.mode === "immediate" && cfg.immediateSurchargeEnabled) {
      const base = vehicle.baseFare || 0;
      const baseDeltaAmount = Math.max(0, parseNumber(cfg.immediateBaseDeltaAmount, 0));
      const baseDeltaPercent = Math.max(0, parseNumber(cfg.immediateBaseDeltaPercent, 0));
      const totalDeltaPercent = Math.max(0, parseNumber(cfg.immediateTotalDeltaPercent, 0));

      const basePercentAmount = base * (baseDeltaPercent / 100);
      total += baseDeltaAmount + basePercentAmount;
      if (totalDeltaPercent > 0) total *= 1 + totalDeltaPercent / 100;

      surchargesApplied = {
        kind: "immediate",
        baseDeltaAmount,
        baseDeltaPercent,
        totalDeltaPercent,
        thresholdMinutes: lead.thresholdMinutes,
        deltaMinutes: lead.deltaMinutes,
      };
    } else {
      surchargesApplied = {
        kind: lead.mode,
        thresholdMinutes: lead.thresholdMinutes,
        deltaMinutes: lead.deltaMinutes,
      };
    }
  }

  return {
    vehicleId: vehicle.id,
    vehicleLabel: vehicle.label,
    isQuote: false,
    total,
    optionsFee: optionsPricing.totalFee,
    appliedOptions: optionsPricing.applied,
    extraStopsTotal,
    stopFee: cfg.stopFee || 0,
    pricingMode,
    surchargesApplied,
  };
}

function ensureOptionsOriginalPlacement() {
  if (_optionsOriginalPlacement) return;
  const section =
    document.getElementById("vtc-options-section") ||
    document.getElementById("vtc-options")?.closest?.(".vtc-section");
  if (!section) return;
  _optionsOriginalPlacement = {
    section,
    parent: section.parentNode,
    nextSibling: section.nextSibling,
  };
}

function placeOptionsSection() {
  ensureOptionsOriginalPlacement();
  if (!_optionsOriginalPlacement) return;

  // Contrainte: l'emplacement est géré par le markup Liquid.
  // On restaure uniquement l'emplacement d'origine (pas de déplacement selon mode).
  const { section, parent, nextSibling } = _optionsOriginalPlacement;
  if (section.parentNode !== parent) {
    if (nextSibling && nextSibling.parentNode === parent) {
      parent.insertBefore(section, nextSibling);
    } else {
      parent.appendChild(section);
    }
  }
}

function setOptionsSectionVisible(visible) {
  const section =
    document.getElementById("vtc-options-section") ||
    document.getElementById("vtc-options")?.closest?.(".vtc-section");
  if (!section) return;
  section.style.display = visible ? "" : "none";
}

function applyOptionsDisplayMode(phase) {
  const cfg = getWidgetConfig();
  const mode = cfg.optionsDisplayMode || "before_calc";

  // Si aucune option activée, on masque simplement la liste.
  if (!Array.isArray(cfg.options) || cfg.options.length === 0) {
    setOptionsSectionVisible(false);
    return;
  }

  placeOptionsSection(mode);

  if (mode === "before_calc") {
    setOptionsSectionVisible(true);
    return;
  }

  if (mode === "after_calc") {
    setOptionsSectionVisible(phase === "after_calc");
    return;
  }

  if (mode === "before_booking") {
    setOptionsSectionVisible(phase === "before_booking");
  }
}

function scrollToAnchor(anchorId) {
  const el = document.getElementById(anchorId);
  if (!el) return;
  try {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    // ignore
  }
  // Offset sticky header
  setTimeout(() => {
    try {
      const rect = el.getBoundingClientRect?.();
      if (rect && Number.isFinite(rect.top)) {
        const absoluteTop = rect.top + (window.scrollY || 0);
        window.scrollTo({ top: Math.max(0, absoluteTop - 80), behavior: "smooth" });
        return;
      }
      window.scrollBy(0, -80);
    } catch {
      // ignore
    }
  }, 250);
}

function updateSelectedVehicleCardUI(tariffsEl, selectedVehicleId) {
  if (!tariffsEl) return;
  tariffsEl.querySelectorAll("[data-vehicle-card]").forEach((card) => {
    const id = String(card.getAttribute("data-vehicle-card") || "").trim();
    const isSelected = !!selectedVehicleId && id === selectedVehicleId;

    try {
      card.classList.toggle("is-selected", isSelected);
    } catch {
      // ignore
    }

    card.style.border = isSelected ? "2px solid #111" : "1px solid #e5e5e5";
    card.style.opacity = isSelected ? "1" : "1";

    const btn = card.querySelector("button[data-vehicle-id]");
    if (btn) {
      try {
        btn.classList.toggle("is-selected", isSelected);
      } catch {
        // ignore
      }
      btn.textContent = isSelected ? "Sélectionné" : "Choisir";
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  });
}

function refreshPricingAfterOptionsChange() {
  const cfg = getWidgetConfig();
  const trip = window.lastTrip;
  if (!trip || typeof trip.distanceKm !== "number") return;

  const km = trip.distanceKm;
  const stopsCount = Array.isArray(trip.stops) ? trip.stops.length : 0;
  const pickupTime = trip.pickupTime || "";
  const pickupDate = trip.pickupDate || "";
  const leadTimeInfo = getLeadTimeInfo({ pickupDate, pickupTime });

  if (cfg.displayMode === "B") {
    const keepVehicleId = _widgetState.selectedVehicleId || trip.vehicle || null;
    renderTariffsAfterCalculation(km, stopsCount, pickupTime, pickupDate, keepVehicleId);
    return;
  }

  const vehicleId = getSelectedVehicleIdFromUI() || trip.vehicle;
  if (!vehicleId) return;

  const computed = computeTariffForVehicle({
    km,
    stopsCount,
    pickupTime,
    pickupDate,
    vehicleId,
    leadTimeInfo,
  });

  _widgetState.selectedVehicleId = computed.vehicleId;
  _widgetState.selectedVehicleLabel = computed.vehicleLabel;
  _widgetState.selectedIsQuote = computed.isQuote;
  _widgetState.selectedTotal = computed.isQuote ? 0 : computed.total;

  if (window.lastTrip) {
    window.lastTrip.vehicle = computed.vehicleId;
    window.lastTrip.vehicleLabel = computed.vehicleLabel;
    window.lastTrip.isQuote = !!computed.isQuote;
    window.lastTrip.surchargesApplied = computed.surchargesApplied || null;
  }

  if (computed.isQuote) {
    clearPriceUI(true);
    updateResultTariffDisplay({ isQuote: true, quoteMessage: computed.quoteMessage });
    window.lastPrice = 0;
  } else {
    updateResultTariffDisplay({ isQuote: false, total: computed.total });
    window.lastPrice = computed.total;
  }

  renderTripSummaryFromLastTrip();
}

function syncAiOptionsDecisionFromUI() {
  const selected = getSelectedOptions ? getSelectedOptions() : [];
  _widgetState.aiOptionsDecision = selected.length ? "some" : _widgetState.aiOptionsDecision === "none" ? "none" : "";
}

function setReserveButtonEnabled(enabled) {
  const reserveBtn = document.getElementById("reserve-btn");
  if (!reserveBtn) return;
  reserveBtn.disabled = !enabled;
  reserveBtn.style.opacity = enabled ? "1" : "0.45";
  reserveBtn.style.cursor = enabled ? "pointer" : "not-allowed";
}

function updateResultTariffDisplay({ isQuote, total, quoteMessage }) {
  const resultEl = document.getElementById("result");
  if (!resultEl) return;

  if (isQuote) {
    resultEl.innerHTML = `Sur devis — <span style="opacity:0.85;">${quoteMessage || getWidgetConfig().quoteMessage}</span>`;
    return;
  }

  if (typeof total === "number" && Number.isFinite(total)) {
    resultEl.innerHTML = `Tarif estimé : <strong>${total.toFixed(2)} €</strong>`;
    return;
  }

  resultEl.innerHTML = "Tarif indisponible";
}

function renderVehiclesAndOptions() {
  const cfg = getWidgetConfig();

  // Vehicles
  const vehiclesContainer = document.getElementById("vtc-vehicles");
  if (vehiclesContainer) {
    const section = vehiclesContainer.closest?.(".vtc-section");
    if (cfg.displayMode === "B") {
      if (section) section.style.display = "none";
      vehiclesContainer.innerHTML = "";
    } else {
      if (section) section.style.display = "";
      const firstVehicle = cfg.vehicles[0];
      vehiclesContainer.innerHTML = cfg.vehicles
        .map((v, idx) => {
          const checked = idx === 0 ? "checked" : "";

          const imageSrc = v.imageUrl || getVehicleDemoImage(v.id);
          const safeId = String(v.id).replace(/"/g, "&quot;");
          const safeLabel = String(v.label);
          return `
            <label class="vtc-choice vtc-vehicle-choice">
              <input type="radio" name="vehicle" value="${safeId}" ${checked}>
              <img class="vtc-choice-image" src="${imageSrc}" alt="${safeLabel.replace(/"/g, "&quot;")}">
              <span class="vtc-choice-text">
                <span class="vtc-choice-title">${safeLabel}</span>
                <span class="vtc-choice-sub">Sélectionnez pour calculer</span>
              </span>
            </label>
          `.trim();
        })
        .join("\n");

      _widgetState.selectedVehicleId = firstVehicle?.id || null;
      _widgetState.selectedVehicleLabel = firstVehicle?.label || null;
      _widgetState.selectedIsQuote = !!firstVehicle?.quoteOnly;

      vehiclesContainer.querySelectorAll('input[name="vehicle"]').forEach((radio) => {
        radio.addEventListener("change", () => {
          try {
            vehiclesContainer.querySelectorAll(".vtc-choice").forEach((label) => {
              label.classList.remove("is-selected");
            });
            const maybeLabel = radio.closest?.(".vtc-choice");
            if (maybeLabel) maybeLabel.classList.add("is-selected");
          } catch {
            // ignore
          }

          const id = getSelectedVehicleIdFromUI();
          const vehicle = getVehicleById(id);
          _widgetState.selectedVehicleId = vehicle?.id || id || null;
          _widgetState.selectedVehicleLabel = vehicle?.label || null;
          _widgetState.selectedIsQuote = !!vehicle?.quoteOnly;

          if (vehicle?.quoteOnly) {
            clearPriceUI(true);
            updateResultTariffDisplay({ isQuote: true, quoteMessage: cfg.quoteMessage });
          }
        });
      });

      // Ensure initial UI state is selected
      try {
        const firstChecked = vehiclesContainer.querySelector('input[name="vehicle"]:checked');
        const maybeLabel = firstChecked?.closest?.(".vtc-choice");
        if (maybeLabel) maybeLabel.classList.add("is-selected");
      } catch {
        // ignore
      }
    }
  }

  // Options
  const optionsContainer = document.getElementById("vtc-options");
  if (optionsContainer) {
    optionsContainer.innerHTML = cfg.options
      .map((o) => {
        const feeText =
          o.type === "percent"
            ? o.amount
              ? ` (+${o.amount}%)`
              : ""
            : Number.isFinite(o.amount) && o.amount !== 0
              ? ` (+${o.amount.toFixed(2)} €)`
              : "";
        return `
          <label class="vtc-choice vtc-option-choice vtc-checkbox">
            <input type="checkbox" data-option-id="${String(o.id).replace(/"/g, "&quot;")}">
            <span class="vtc-choice-text">
              <span class="vtc-choice-title">${String(o.label)}${feeText}</span>
            </span>
          </label>
        `.trim();
      })
      .join("\n");

    // Add a simple "Aucune option" helper button (does not block calculation).
    if (!document.getElementById("vtc-options-none")) {
      const btnWrap = document.createElement("div");
      btnWrap.style.marginTop = "8px";
      btnWrap.innerHTML = `
        <button id="vtc-options-none" type="button" class="vtc-btn" style="padding:8px 10px;font-size:13px;">
          Aucune option
        </button>
      `.trim();
      optionsContainer.insertAdjacentElement("afterend", btnWrap);
    }

    optionsContainer.querySelectorAll("input[type=checkbox]").forEach((input) => {
      input.addEventListener("change", () => {
        // Always refresh summary line-items
        syncAiOptionsDecisionFromUI();
        refreshPricingAfterOptionsChange();
      });
    });
  }

  const noneBtn = document.getElementById("vtc-options-none");
  if (noneBtn && !noneBtn._vtcBound) {
    noneBtn._vtcBound = true;
    noneBtn.addEventListener("click", () => {
      const container = document.getElementById("vtc-options");
      if (!container) return;
      let changed = false;
      container.querySelectorAll('input[type=checkbox][data-option-id]').forEach((input) => {
        const el = input;
        if (!el.checked) return;
        el.checked = false;
        changed = true;
        try {
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } catch {
          // ignore
        }
      });
      _widgetState.aiOptionsDecision = "none";
      if (changed) refreshPricingAfterOptionsChange();
    });
  }

  applyOptionsDisplayMode("init");
}

function renderTariffsAfterCalculation(km, stopsCount, pickupTime, pickupDate, keepSelectedVehicleId) {
  const cfg = getWidgetConfig();
  const tariffsEl = document.getElementById("vtc-tariffs");
  if (!tariffsEl) return;

  const leadTimeInfo = getLeadTimeInfo({ pickupDate, pickupTime });

  tariffsEl.style.display = "block";

  // Reset selection on each re-render
  _widgetState.selectedVehicleId = null;
  _widgetState.selectedVehicleLabel = null;
  _widgetState.selectedIsQuote = false;
  _widgetState.selectedTotal = null;
  setReserveButtonEnabled(false);
  clearPriceUI(false);

  const lines = cfg.vehicles.map((v) => {
    const computed = computeTariffForVehicle({
      km,
      stopsCount,
      pickupTime,
      pickupDate,
      vehicleId: v.id,
      leadTimeInfo,
    });
    const imageSrc = v.imageUrl || getVehicleDemoImage(v.id);
    const right = computed.isQuote
      ? `Sur devis — <span style="opacity:0.85;">${cfg.quoteMessage}</span>`
      : `<strong>${computed.total.toFixed(2)} €</strong>`;

    return `
      <div class="vtc-tariff-card" data-vehicle-card="${String(v.id).replace(/"/g, "&quot;")}">
        <div class="vtc-tariff-left">
          <img class="vtc-tariff-image" src="${imageSrc}" alt="${String(v.label).replace(/"/g, "&quot;")}" />
          <div style="min-width:0;">
            <div class="vtc-tariff-title">${v.label}</div>
            <div class="vtc-tariff-price">${right}</div>
          </div>
        </div>
        <button type="button" class="vtc-tariff-select" data-vehicle-id="${String(v.id).replace(/"/g, "&quot;")}">Choisir</button>
      </div>
    `.trim();
  });

  tariffsEl.innerHTML = `
    <h3 style="font-size:18px;margin:0 0 10px 0;">Tarifs</h3>
    <div class="vtc-tariffs-grid">${lines.join("\n")}</div>
  `.trim();

  tariffsEl.querySelectorAll("button[data-vehicle-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const vehicleId = String(btn.dataset.vehicleId || "").trim();
      const computed = computeTariffForVehicle({
        km,
        stopsCount,
        pickupTime,
        pickupDate,
        vehicleId,
        leadTimeInfo,
      });

      _widgetState.selectedVehicleId = computed.vehicleId;
      _widgetState.selectedVehicleLabel = computed.vehicleLabel;
      _widgetState.selectedIsQuote = computed.isQuote;
      _widgetState.selectedTotal = computed.isQuote ? 0 : computed.total;

      updateResultTariffDisplay({
        isQuote: computed.isQuote,
        total: computed.isQuote ? null : computed.total,
        quoteMessage: computed.quoteMessage,
      });

      if (window.lastTrip) {
        window.lastTrip.vehicle = computed.vehicleId;
        window.lastTrip.vehicleLabel = computed.vehicleLabel;
        window.lastTrip.isQuote = !!computed.isQuote;
        window.lastTrip.pricingMode = computed.pricingMode || window.lastTrip.pricingMode || null;
        window.lastTrip.leadTimeThresholdMinutes = leadTimeInfo.thresholdMinutes;
        window.lastTrip.surchargesApplied = computed.surchargesApplied || window.lastTrip.surchargesApplied || null;
      }

      renderTripSummaryFromLastTrip();

      // Dans ce mode, les options peuvent devoir apparaître seulement après choix véhicule.
      applyOptionsDisplayMode("after_calc");
      updateSelectedVehicleCardUI(tariffsEl, computed.vehicleId);

      setReserveButtonEnabled(true);

      // Scroll vers la zone Réserver / Résumé
      scrollToAnchor("vtc-reservation");
    });
  });

  if (keepSelectedVehicleId) {
    const computed = computeTariffForVehicle({
      km,
      stopsCount,
      pickupTime,
      pickupDate,
      vehicleId: keepSelectedVehicleId,
      leadTimeInfo,
    });

    _widgetState.selectedVehicleId = computed.vehicleId;
    _widgetState.selectedVehicleLabel = computed.vehicleLabel;
    _widgetState.selectedIsQuote = computed.isQuote;
    _widgetState.selectedTotal = computed.isQuote ? 0 : computed.total;

    updateResultTariffDisplay({
      isQuote: computed.isQuote,
      total: computed.isQuote ? null : computed.total,
      quoteMessage: computed.quoteMessage,
    });

    if (window.lastTrip) {
      window.lastTrip.vehicle = computed.vehicleId;
      window.lastTrip.vehicleLabel = computed.vehicleLabel;
      window.lastTrip.isQuote = !!computed.isQuote;
      window.lastTrip.surchargesApplied = computed.surchargesApplied || window.lastTrip.surchargesApplied || null;
    }

    renderTripSummaryFromLastTrip();
    applyOptionsDisplayMode("after_calc");
    updateSelectedVehicleCardUI(tariffsEl, computed.vehicleId);
    setReserveButtonEnabled(true);
  }
}

/* --------------------------
   UTILITAIRE : Google prêt ?
--------------------------- */
function isGoogleReady() {
  return !!(window.google && google.maps);
}

function isPlacesReady() {
  return !!(window.google && google.maps && google.maps.places);
}

/* --------------------------
   AUTOCOMPLETE : OPTIONS EUROPE
--------------------------- */
function getEuropeBounds() {
  if (_europeBoundsCache) return _europeBoundsCache;
  // Europe approx: SW (34, -25) / NE (72, 45)
  _europeBoundsCache = new google.maps.LatLngBounds(
    new google.maps.LatLng(34, -25),
    new google.maps.LatLng(72, 45),
  );
  return _europeBoundsCache;
}

function getAutocompleteOptions() {
  const base = {
    fields: ["place_id", "formatted_address"],
    types: ["geocode", "establishment"],
  };

  const europeMode = !!document.getElementById("europeMode")?.checked;
  if (!europeMode) {
    return {
      ...base,
      componentRestrictions: { country: "fr" },
    };
  }

  return {
    ...base,
    componentRestrictions: {},
    bounds: getEuropeBounds(),
    strictBounds: true,
  };
}

function rebindAutocompletes() {
  if (!isPlacesReady()) return;

  const options = getAutocompleteOptions();

  const inputs = [
    document.getElementById("start"),
    document.getElementById("end"),
    ...Array.from(document.querySelectorAll(".stop-input")),
  ].filter(Boolean);

  stopAutocompletes = [];

  inputs.forEach((input) => {
    const oldAc = input._gmAutocomplete;
    if (oldAc && window.google?.maps?.event?.clearInstanceListeners) {
      google.maps.event.clearInstanceListeners(oldAc);
    }

    const newAc = new google.maps.places.Autocomplete(input, options);
    input._gmAutocomplete = newAc;

    // NB: il n’y a pas de handler place_changed spécifique actuellement.

    if (input.classList?.contains("stop-input")) {
      stopAutocompletes.push(newAc);
    }
  });
}

/* --------------------------
   AUTOCOMPLETE DÉPART / ARRIVÉE
--------------------------- */
function ensureBaseAutocompletes() {
  if (!isPlacesReady()) return;

  const startInput = document.getElementById("start");
  const endInput = document.getElementById("end");

  if (startInput && !startInput._gmAutocomplete) {
    startInput._gmAutocomplete = new google.maps.places.Autocomplete(startInput, getAutocompleteOptions());
  }

  if (endInput && !endInput._gmAutocomplete) {
    endInput._gmAutocomplete = new google.maps.places.Autocomplete(endInput, getAutocompleteOptions());
  }

  console.log("✔ Autocomplete départ/arrivée OK");
}

/* --------------------------
   INIT GÉNÉRAL GOOGLE + LISTENERS
--------------------------- */
function initAutocomplete() {
  if (autocompleteInitStarted) return;
  autocompleteInitStarted = true;

  const startInput = document.getElementById("start");
  const endInput = document.getElementById("end");

  const bindFocusLoader = (input) => {
    if (!input) return;
    input.addEventListener("focus", () => {
      ensureGoogleMapsLoaded("focus").then((ok) => {
        if (!ok) return;
        if (!directionsService) {
          directionsService = new google.maps.DirectionsService();
        }
        ensureBaseAutocompletes();
      });
    });
  };

  bindFocusLoader(startInput);
  bindFocusLoader(endInput);
}

/* --------------------------
   AJOUTER UN ARRÊT
--------------------------- */
function addStopField() {
  const container = document.getElementById("stops-container");
  if (!container) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "vtc-input stop-input";
  input.placeholder = "Adresse arrêt";

  container.appendChild(input);

  if (isPlacesReady()) {
    const ac = new google.maps.places.Autocomplete(input, getAutocompleteOptions());
    input._gmAutocomplete = ac;
    stopAutocompletes.push(ac);
  } else {
    input.addEventListener("focus", () => {
      if (input._gmAutocomplete) return;
      ensureGoogleMapsLoaded("stop-focus").then((ok) => {
        if (!ok || !isPlacesReady() || input._gmAutocomplete) return;
        const ac = new google.maps.places.Autocomplete(input, getAutocompleteOptions());
        input._gmAutocomplete = ac;
        stopAutocompletes.push(ac);
      });
    });
  }
}

/* --------------------------
   VALIDATION FORMULAIRE COORDONNÉES
--------------------------- */
function validateContactForm() {
  const nameEl = document.getElementById("customerName");
  const emailEl = document.getElementById("customerEmail");
  const phoneEl = document.getElementById("customerPhone");
  const errorEl = document.getElementById("contact-error");

  if (!nameEl || !emailEl || !phoneEl) {
    return null; // Si le formulaire n’est pas dans le HTML, on ne bloque pas
  }

  const name = nameEl.value.trim();
  const email = emailEl.value.trim();
  const phone = phoneEl.value.trim();

  if (!name || !email || !phone) {
    if (errorEl) errorEl.textContent = "Merci de remplir tous les champs (nom, e-mail, téléphone).";
    return null;
  }

  // Vérification e-mail très simple
  const emailRegex = /\S+@\S+\.\S+/;
  if (!emailRegex.test(email)) {
    if (errorEl) errorEl.textContent = "L'adresse e-mail semble invalide.";
    return null;
  }

  // Vérification téléphonique simple
  if (phone.length < 6) {
    if (errorEl) errorEl.textContent = "Le numéro de téléphone semble trop court.";
    return null;
  }

  if (errorEl) errorEl.textContent = "";

  return { name, email, phone };
}

function clearPriceUI(isQuote) {
  const priceEl = document.getElementById("price-result") || document.getElementById("result");
  if (priceEl) {
    // En mode "Sur devis", on n'affiche aucun montant.
    priceEl.innerHTML = "";
  }
  window.lastPrice = isQuote ? 0 : null;
}

async function postBookingNotify(payload) {
  const dataset = getWidgetDataset();
  const configuredEndpoint = (
    dataset.notifyEndpoint ||
    dataset.slackEndpoint ||
    dataset.slackEndpointUrl ||
    ""
  ).trim();
  const defaultEndpoint = "/apps/vtc/api/booking-notify";
  const rawEndpoint = configuredEndpoint || defaultEndpoint;

  // IMPORTANT: la réservation doit passer par l'App Proxy Shopify (URL relative côté boutique)
  // pour éviter CORS et surtout pour que Shopify ajoute la signature (`signature`/`hmac`).
  // On refuse donc les URLs absolues si quelqu'un a tenté de les configurer dans le thème.
  const isAbsolute = /^https?:\/\//i.test(rawEndpoint) || rawEndpoint.startsWith("//");
  const isRelative = rawEndpoint.startsWith("/") && !rawEndpoint.startsWith("//");
  const endpoint = isRelative && !isAbsolute ? rawEndpoint : defaultEndpoint;
  if (endpoint !== rawEndpoint) {
    console.warn("booking-notify: ignoring non-relative endpoint (forcing App Proxy)", {
      rawEndpoint,
      endpoint,
    });
  }

  // Sécurité: ne jamais appeler un Incoming Webhook Slack depuis le storefront.
  // Les secrets (Slack/SMTP) doivent rester côté serveur.
  if (/^https?:\/\/hooks\.slack\.com\//i.test(endpoint)) {
    console.warn("booking-notify: blocked direct Slack webhook usage", { endpoint });
    return {
      ok: false,
      error:
        "Configuration invalide : n'utilisez pas une URL Incoming Webhook Slack (hooks.slack.com) dans le thème. Utilisez uniquement un endpoint serveur (par défaut: /apps/vtc/api/booking-notify).",
    };
  }

  const requestId = `vtc_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const fetchOnce = async () => {
    const controller = new AbortController();
    const timeoutMs = 15000;
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
        body: JSON.stringify(payload),
        credentials: "same-origin",
        signal: controller.signal,
      });
      const rawText = await resp.text().catch(() => "");
      const parsed = (() => {
        try {
          return rawText ? JSON.parse(rawText) : null;
        } catch {
          return null;
        }
      })();

      return { resp, rawText, parsed };
    } finally {
      clearTimeout(t);
    }
  };

  const shouldRetryStatus = (status) => [408, 429, 500, 502, 503, 504].includes(status);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      console.log("booking-notify: POST", { endpoint, requestId, attempt });

      const { resp, rawText, parsed } = await fetchOnce();

      const data = parsed;
      console.log("booking-notify: response", {
        endpoint,
        requestId,
        attempt,
        status: resp.status,
        ok: resp.ok,
      });

      if (!resp.ok) {
        const msg = (() => {
          // If the server returned a structured error code, surface it with a helpful message.
          const errCode = data?.error ? String(data.error) : "";
          if (errCode === "EMAIL_NOT_CONFIGURED") {
            return "Email non configuré côté application (SMTP_* / BOOKING_EMAIL_FROM).";
          }
          if (errCode === "EMAIL_FAILED") {
            return "Erreur lors de l'envoi de l'e-mail côté application.";
          }
          if (errCode) return errCode;
          if (resp.status === 400 && data?.error) return String(data.error);
          if (resp.status === 400 && data?.reason) return `Accès refusé (App Proxy) [${String(data.reason)}]`;
          if (resp.status === 401) return "Accès refusé (App Proxy / signature invalide).";
          if (resp.status === 404) return "Endpoint introuvable (App Proxy non configuré ?)";
          if (resp.status >= 400 && resp.status < 500) return "Requête refusée par le serveur.";
          return "Impossible de contacter le serveur…";
        })();

        if (attempt < 2 && shouldRetryStatus(resp.status)) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        return {
          ok: false,
          error: msg,
          detail: data?.error || rawText || null,
          status: resp.status,
          requestId,
        };
      }

      if (data && typeof data === "object") {
        return data;
      }

      return { ok: false, error: "Réponse serveur invalide", detail: rawText || null, requestId };
    } catch (err) {
      const isAbort = err && typeof err === "object" && (err.name === "AbortError" || err.code === 20);
      console.log("booking-notify: fetch error", {
        endpoint,
        requestId,
        attempt,
        kind: isAbort ? "timeout" : "network",
      });

      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }

      return {
        ok: false,
        error: isAbort ? "Le serveur met trop de temps à répondre…" : "Impossible de contacter le serveur…",
        requestId,
      };
    }
  }

  return { ok: false, error: "Impossible de contacter le serveur…", requestId };
}

/* --------------------------
   CALCUL ITINÉRAIRE + PRIX + CARTE + RÉSUMÉ
--------------------------- */
function getVehicleLabel(vehicle) {
  const v = getVehicleById(vehicle);
  if (v?.label) return v.label;
  if (vehicle === "van") return "Van 7 places";
  if (vehicle === "autre") return "Autre (sur devis)";
  return "Berline";
}

function getVehicleDemoImage(vehicle) {
  const label = getVehicleLabel(vehicle);

  let bg = "#f3f4f6";
  let fg = "#111827";
  if (vehicle === "van") bg = "#e0f2fe";
  if (vehicle === "autre") bg = "#ede9fe";

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120" viewBox="0 0 180 120">
  <rect x="0" y="0" width="180" height="120" rx="14" fill="${bg}"/>
  <g fill="${fg}" font-family="Arial, sans-serif" font-size="18" font-weight="700">
    <text x="90" y="62" text-anchor="middle">${label}</text>
  </g>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getConfiguredVehicleImage(vehicle) {
  const v = getVehicleById(vehicle);
  if (v?.imageUrl) return v.imageUrl;

  const ds = getWidgetDataset();
  // Compat fallback
  const berlineImg = (ds.vehicleImageBerline || ds.berlineImg || "").trim();
  const vanImg = (ds.vehicleImageVan || ds.vanImg || "").trim();
  const autreImg = (ds.vehicleImageAutre || ds.autreImg || "").trim();

  if (vehicle === "van") return vanImg;
  if (vehicle === "autre") return autreImg;
  return berlineImg;
}

function getVehicleImageSrc(vehicle) {
  return getConfiguredVehicleImage(vehicle) || getVehicleDemoImage(vehicle);
}

async function calculatePrice(_retry) {
  const widgetEl = getWidgetEl();
  const widget = widgetEl || document;
  const startEl = document.getElementById("start");
  const start = startEl?.value || "";
  const end = document.getElementById("end")?.value || "";
  const pickupTime = document.getElementById("pickupTime")?.value || "";
  const pickupDate = document.getElementById("pickupDate")?.value || "";
  const resultEl = document.getElementById("result");
  const cfg = getWidgetConfig();
  const reserveBtn = document.getElementById("reserve-btn");
  const vehicle =
    cfg.displayMode === "A"
      ? widget.querySelector?.('input[name="vehicle"]:checked')?.value ||
        document.querySelector('input[name="vehicle"]:checked')?.value ||
        cfg.vehicles[0]?.id ||
        "berline"
      : null;

  const pricing = vehicle ? getPricingConfig(vehicle, 0) : null;
  const isQuote = cfg.pricingBehavior === "all_quote" || !!pricing?.quoteOnly;
  const quoteMessage = cfg.quoteMessage;

  // Nettoyer tout ancien tarif
  clearPriceUI(isQuote);

  // En mode A, si véhicule sur devis, afficher le message immédiatement
  if (cfg.displayMode === "A" && isQuote && resultEl) {
    resultEl.innerHTML = `Sur devis — <span style="opacity:0.85;">${quoteMessage}</span>`;
  }

  // Réinitialiser le bouton réserver
  if (reserveBtn) setReserveButtonEnabled(false);

  // 1️⃣ Vérif date
  if (!pickupDate) {
    if (resultEl) resultEl.innerHTML = "Veuillez sélectionner une date.";
    return;
  }

  // 2️⃣ Vérif départ / arrivée
  if (!start || !end) {
    if (resultEl) resultEl.innerHTML = "Veuillez renseigner départ et arrivée.";
    return;
  }

  // 3️⃣ Construction des arrêts
  const waypoints = [];
  document
    .querySelectorAll("#stops-container input")
    .forEach((input) => {
      if (input.value.trim() !== "") {
        waypoints.push({ location: input.value, stopover: true });
      }
    });

  if (!isGoogleReady()) {
    if (!_retry) {
      if (resultEl) resultEl.innerHTML = "Chargement de Google Maps…";
      const ok = await ensureGoogleMapsLoaded("calculate");
      if (ok) return calculatePrice(true);
    }
    if (resultEl) {
      resultEl.innerHTML = "Google Maps n’est pas disponible. Vérifiez la configuration.";
    }
    return;
  }

  if (!directionsService) {
    directionsService = new google.maps.DirectionsService();
  }

  const origin = startEl?.dataset?.vtcGeo === "1" && _startGeoLatLng ? _startGeoLatLng : start;

  const request = {
    origin,
    destination: end,
    waypoints,
    optimizeWaypoints: false,
    travelMode: google.maps.TravelMode.DRIVING,
  };

  directionsService.route(request, (result, status) => {
    if (status !== "OK") {
      console.error("Directions error:", status);
      if (resultEl) {
        resultEl.innerHTML = "Impossible de calculer l’itinéraire.";
      }
      return;
    }

    // 4️⃣ MAP (créée seulement au moment du calcul)
    const mapDiv = document.getElementById("map");
    if (!map && mapDiv) {
      map = new google.maps.Map(mapDiv, {
        center: { lat: 43.3, lng: 5.4 }, // Marseille par défaut
        zoom: 11,
        disableDefaultUI: true,
      });

      directionsRenderer = new google.maps.DirectionsRenderer();
      directionsRenderer.setMap(map);
    }

    if (directionsRenderer) {
      directionsRenderer.setDirections(result);
    }
    if (mapDiv) {
      mapDiv.style.display = "block";
    }

    // 5️⃣ Distance / durée
    let totalMeters = 0;
    let totalSeconds = 0;

    result.routes[0].legs.forEach((leg) => {
      totalMeters += leg.distance.value;
      totalSeconds += leg.duration.value;
    });

    const km = totalMeters / 1000;
    const minutes = totalSeconds / 60;

    const cfg = getWidgetConfig();
    const leadTimeInfo = getLeadTimeInfo({ pickupDate, pickupTime });
    const leadTimeLabel =
      leadTimeInfo.mode === "immediate" ? cfg.immediateLabel || "Immédiat" : cfg.reservationLabel || "Réservation";

    // Persist base trip info (used later by reserve click and mode B selection)
    setCustomOptionText(getCustomOptionTextFromUI());
    window.lastTrip = {
      start,
      startLatLng: startEl?.dataset?.vtcGeo === "1" && _startGeoLatLng ? _startGeoLatLng : null,
      end,
      stops: waypoints.map((w) => w.location),
      pickupDate,
      pickupTime,
      vehicle: null,
      vehicleLabel: null,
      distanceKm: km,
      durationMinutes: Math.round(minutes),
      isQuote: false,
      customOptionText: _widgetState.customOptionText,
      pricingMode: cfg.pricingBehavior === "lead_time_pricing" ? leadTimeInfo.mode : null,
      leadTimeThresholdMinutes: leadTimeInfo.thresholdMinutes,
      leadTimeLabel: cfg.pricingBehavior === "lead_time_pricing" ? leadTimeLabel : null,
      surchargesApplied: null,
    };

    // 6️⃣ Tarifs / Mode A ou B
    let total = null;
    let vehicleNow = null;
    let vehicleLabelNow = null;
    let isQuoteNow = false;

    const tariffsEl = document.getElementById("vtc-tariffs");
    if (cfg.displayMode === "B") {
      if (tariffsEl) tariffsEl.style.display = "block";
      if (resultEl) resultEl.innerHTML = "";
      window.lastPrice = null;
      renderTariffsAfterCalculation(km, waypoints.length, pickupTime, pickupDate);
      setReserveButtonEnabled(false);
    } else {
      if (tariffsEl) tariffsEl.style.display = "none";

      vehicleNow =
        widget.querySelector?.('input[name="vehicle"]:checked')?.value ||
        document.querySelector('input[name="vehicle"]:checked')?.value ||
        cfg.vehicles[0]?.id ||
        "berline";

      const computed = computeTariffForVehicle({
        km,
        stopsCount: waypoints.length,
        pickupTime,
        pickupDate,
        vehicleId: vehicleNow,
        leadTimeInfo,
      });
      vehicleLabelNow = computed.vehicleLabel;
      isQuoteNow = !!computed.isQuote;

      if (computed.isQuote) {
        total = 0;
        clearPriceUI(true);
        updateResultTariffDisplay({ isQuote: true, quoteMessage: computed.quoteMessage });
        window.lastPrice = 0;
      } else {
        total = computed.total;
        updateResultTariffDisplay({ isQuote: false, total });
        window.lastPrice = total;
      }

      _widgetState.selectedVehicleId = vehicleNow;
      _widgetState.selectedVehicleLabel = vehicleLabelNow;
      _widgetState.selectedIsQuote = isQuoteNow;
      _widgetState.selectedTotal = computed.isQuote ? 0 : total;

      window.lastTrip.vehicle = vehicleNow;
      window.lastTrip.vehicleLabel = vehicleLabelNow;
      window.lastTrip.isQuote = isQuoteNow;
      window.lastTrip.pricingMode = computed.pricingMode || window.lastTrip.pricingMode || null;
      window.lastTrip.leadTimeThresholdMinutes = leadTimeInfo.thresholdMinutes;
      window.lastTrip.leadTimeLabel = cfg.pricingBehavior === "lead_time_pricing" ? leadTimeLabel : null;
      window.lastTrip.surchargesApplied = computed.surchargesApplied || null;

      setReserveButtonEnabled(true);
    }

    // Options display mode: some modes reveal options only after a successful calculation.
    applyOptionsDisplayMode("after_calc");

    // 7️⃣ Résumé premium
    const summaryDiv = document.getElementById("vtc-summary");
    if (summaryDiv) {
      summaryDiv.style.display = "block";

      const selectedOptions = getSelectedOptions();
      const optionsLine = (() => {
        if (!selectedOptions.length) return `<div><strong>Options :</strong> (aucune)</div>`;
        if (!vehicleNow) {
          return `<div><strong>Options :</strong> ${selectedOptions.map((o) => o.label).join(" · ")}</div>`;
        }

        const computedForSummary = computeTariffForVehicle({
          km,
          stopsCount: waypoints.length,
          pickupTime,
          pickupDate,
          vehicleId: vehicleNow,
          leadTimeInfo,
        });

        const applied = Array.isArray(computedForSummary?.appliedOptions) ? computedForSummary.appliedOptions : [];
        return `<div><strong>Options :</strong> ${(applied.length ? applied : selectedOptions).map((o) => {
          const label = o.label;
          const fee = typeof o.fee === "number" ? o.fee : null;
          if (typeof fee === "number" && fee !== 0) return `${label} (+${fee.toFixed(2)} €)`;
          return label;
        }).join(" · ")}</div>`;
      })();

      const customOptionLine = (() => {
        const txt = _widgetState.customOptionText;
        if (!txt) return "";
        return `<div><strong>Option personnalisée :</strong> ${escapeHtml(txt)}</div>`;
      })();

      const extraPricingLine = cfg.stopFee > 0 && waypoints.length
        ? `<div><strong>Frais arrêts :</strong> ${waypoints.length} × ${cfg.stopFee.toFixed(2)} €</div>`
        : "";

      const leadTimeLine =
        cfg.pricingBehavior === "lead_time_pricing"
          ? `<div><strong>Type :</strong> ${leadTimeLabel}</div>`
          : "";

      const leadTimeThresholdLine =
        cfg.pricingBehavior === "lead_time_pricing"
          ? `<div style="font-size:13px;opacity:0.75;margin-top:2px;">Seuil : ${Math.round(leadTimeInfo.thresholdMinutes)} min</div>`
          : "";

      const quoteLine = isQuoteNow
        ? `<div style="margin-top:10px;"><strong>Sur devis :</strong> ${cfg.quoteMessage}</div>`
        : "";

      const vehicleBlock = vehicleNow
        ? `
          <div style="display:flex;gap:12px;align-items:center;margin:10px 0 14px 0;">
            <img
              src="${getVehicleImageSrc(vehicleNow)}"
              alt="${getVehicleLabel(vehicleNow)}"
              style="width:90px;height:60px;border-radius:10px;border:1px solid #ddd;background:#fff;object-fit:cover;"
            >
            <div><strong>${getVehicleLabel(vehicleNow)}</strong></div>
          </div>
        `.trim()
        : `<p style="margin:10px 0 0 0;opacity:0.85;">Choisissez un véhicule dans la liste des tarifs.</p>`;

      summaryDiv.innerHTML = `
        <h3 style="font-size:18px; margin-bottom:10px;">Résumé du trajet</h3>
        ${vehicleBlock}

        <div><strong>Date :</strong> ${pickupDate}</div>
        <div><strong>Heure :</strong> ${pickupTime}</div>
        <br>

        <div><strong>Départ :</strong> ${start}</div>
        ${waypoints
          .map((w, i) => `<div><strong>Arrêt ${i + 1} :</strong> ${w.location}</div>`)
          .join("")}
        <div style="margin:6px 0;"><strong>Arrivée :</strong> ${end}</div>

        <hr style="margin:14px 0;">

        <div><strong>Distance :</strong> ${km.toFixed(1)} km</div>
        <div><strong>Durée :</strong> ${Math.round(minutes)} min</div>
        ${leadTimeLine}
        ${leadTimeThresholdLine}
        ${vehicleNow ? `<div><strong>Véhicule :</strong> ${getVehicleLabel(vehicleNow)}</div>` : ""}
        ${optionsLine}
        ${customOptionLine}
        ${extraPricingLine}
        ${quoteLine}
      `;
    }

    // Log des infos client (pour debug, futur envoi email / base de données)
    console.log("Lead VTC Smart Booking :", {
      contact: null,
      start,
      end,
      waypoints,
      pickupDate,
      pickupTime,
      km: km.toFixed(1),
      minutes: Math.round(minutes),
      vehicle: vehicleNow,
      total: total === null ? null : total.toFixed ? total.toFixed(2) : String(total),
    });
  });
}

function renderTripSummaryFromLastTrip() {
  const summaryDiv = document.getElementById("vtc-summary");
  if (!summaryDiv) return;
  const cfg = getWidgetConfig();
  const trip = window.lastTrip;
  if (!trip) return;

  summaryDiv.style.display = "block";

  const vehicleId = trip.vehicle;
  const vehicleBlock = vehicleId
    ? `
      <div style="display:flex;gap:12px;align-items:center;margin:10px 0 14px 0;">
        <img
          src="${getVehicleImageSrc(vehicleId)}"
          alt="${getVehicleLabel(vehicleId)}"
          style="width:90px;height:60px;border-radius:10px;border:1px solid #ddd;background:#fff;object-fit:cover;"
        >
        <div><strong>${getVehicleLabel(vehicleId)}</strong></div>
      </div>
    `.trim()
    : `<p style="margin:10px 0 0 0;opacity:0.85;">Choisissez un véhicule dans la liste des tarifs.</p>`;

  const selectedOptions = getSelectedOptions();
  const optionsLine = (() => {
    if (!selectedOptions.length) return `<div><strong>Options :</strong> (aucune)</div>`;

    const vehicleIdForSummary = trip.vehicle;
    if (!vehicleIdForSummary || typeof trip.distanceKm !== "number") {
      return `<div><strong>Options :</strong> ${selectedOptions.map((o) => o.label).join(" · ")}</div>`;
    }

    const leadTimeInfo = getLeadTimeInfo({ pickupDate: trip.pickupDate || "", pickupTime: trip.pickupTime || "" });
    const computed = computeTariffForVehicle({
      km: trip.distanceKm,
      stopsCount: Array.isArray(trip.stops) ? trip.stops.length : 0,
      pickupTime: trip.pickupTime || "",
      pickupDate: trip.pickupDate || "",
      vehicleId: vehicleIdForSummary,
      leadTimeInfo,
    });

    const applied = Array.isArray(computed?.appliedOptions) ? computed.appliedOptions : [];

    return `<div><strong>Options :</strong> ${(applied.length ? applied : selectedOptions)
      .map((o) => {
        const label = o.label;
        const fee = typeof o.fee === "number" ? o.fee : null;
        if (typeof fee === "number" && fee !== 0) return `${label} (+${fee.toFixed(2)} €)`;
        return label;
      })
      .join(" · ")}</div>`;
  })();

  const customOptionLine = (() => {
    const txt = String(trip.customOptionText || _widgetState.customOptionText || "").trim();
    if (!txt) return "";
    return `<div><strong>Option personnalisée :</strong> ${escapeHtml(txt)}</div>`;
  })();

  const extraPricingLine = cfg.stopFee > 0 && trip.stops?.length
    ? `<div><strong>Frais arrêts :</strong> ${trip.stops.length} × ${cfg.stopFee.toFixed(2)} €</div>`
    : "";

  const leadTimeLine =
    cfg.pricingBehavior === "lead_time_pricing" && trip.leadTimeLabel
      ? `<div><strong>Type :</strong> ${trip.leadTimeLabel}</div>`
      : "";

  const leadTimeThresholdLine =
    cfg.pricingBehavior === "lead_time_pricing" && typeof trip.leadTimeThresholdMinutes === "number"
      ? `<div style="font-size:13px;opacity:0.75;margin-top:2px;">Seuil : ${Math.round(trip.leadTimeThresholdMinutes)} min</div>`
      : "";

  const quoteLine = trip.isQuote
    ? `<div style="margin-top:10px;"><strong>Sur devis :</strong> ${cfg.quoteMessage}</div>`
    : "";

  summaryDiv.innerHTML = `
    <h3 style="font-size:18px; margin-bottom:10px;">Résumé du trajet</h3>
    ${vehicleBlock}

    <div><strong>Date :</strong> ${trip.pickupDate || ""}</div>
    <div><strong>Heure :</strong> ${trip.pickupTime || ""}</div>
    <br>

    <div><strong>Départ :</strong> ${trip.start || ""}</div>
    ${(trip.stops || []).map((s, i) => `<div><strong>Arrêt ${i + 1} :</strong> ${s}</div>`).join("")}
    <div style="margin:6px 0;"><strong>Arrivée :</strong> ${trip.end || ""}</div>

    <hr style="margin:14px 0;">

    <div><strong>Distance :</strong> ${typeof trip.distanceKm === "number" ? trip.distanceKm.toFixed(1) : "(inconnu)"} km</div>
    <div><strong>Durée :</strong> ${typeof trip.durationMinutes === "number" ? Math.round(trip.durationMinutes) : "(inconnu)"} min</div>
    ${leadTimeLine}
    ${leadTimeThresholdLine}
    ${vehicleId ? `<div><strong>Véhicule :</strong> ${getVehicleLabel(vehicleId)}</div>` : ""}
    ${optionsLine}
    ${customOptionLine}
    ${extraPricingLine}
    ${quoteLine}
  `.trim();
}

/* --------------------------
   BLOQUER LES DATES PASSÉES
--------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  renderVehiclesAndOptions();
  renderTripSummaryFromLastTrip();

  const mode = applyAssistantMode();
  if (mode !== "classic") {
    initAiAssistantUI();
  }

  const customOptionInput = document.getElementById("customOption");
  if (customOptionInput) {
    setCustomOptionText(getCustomOptionTextFromUI());
    customOptionInput.addEventListener("input", () => {
      setCustomOptionText(getCustomOptionTextFromUI());
      renderTripSummaryFromLastTrip();
    });
    customOptionInput.addEventListener("change", () => {
      setCustomOptionText(getCustomOptionTextFromUI());
      renderTripSummaryFromLastTrip();
    });
  }

  const dateInput = document.getElementById("pickupDate");
  if (dateInput) {
    const today = new Date().toISOString().split("T")[0];
    dateInput.setAttribute("min", today);
  }

  const reserveBtn = document.getElementById("reserve-btn");
  if (reserveBtn) {
    reserveBtn.addEventListener("click", async (e) => {
      e.preventDefault();

      console.log("reservation click received");

      const contactWrapper = document.getElementById("contact-wrapper");
      if (contactWrapper) {
        contactWrapper.style.display = "block";
        contactWrapper.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      applyOptionsDisplayMode("before_booking");

      const contact = validateContactForm();

      const termsConsent = document.getElementById("termsConsent");
      const marketingConsent = document.getElementById("marketingConsent");
      const contactErrorEl = document.getElementById("contact-error");
      const consentErrorEl = document.getElementById("consent-error");

      if (consentErrorEl) consentErrorEl.textContent = "";

      if (!termsConsent || !termsConsent.checked) {
        if (consentErrorEl) {
          consentErrorEl.textContent =
            "Merci d’accepter les Conditions et la Politique de confidentialité pour réserver.";
        }
        alert("Merci d’accepter les Conditions et la Politique de confidentialité pour réserver.");
        return;
      }

      if (!contact) return;

      const start = document.getElementById("start")?.value || "";
      const end = document.getElementById("end")?.value || "";
      const pickupDate = document.getElementById("pickupDate")?.value || "";
      const pickupTime = document.getElementById("pickupTime")?.value || "";
      const cfg = getWidgetConfig();
      const vehicle = getSelectedVehicleIdFromUI();
      if (cfg.displayMode === "B" && !vehicle) {
        alert("Merci de choisir un véhicule dans la liste des tarifs.");
        return;
      }

      const vehicleObj = getVehicleById(vehicle) || {
        id: vehicle || "",
        label: getVehicleLabel(vehicle),
        quoteOnly: vehicle === "autre",
      };
      const stops = Array.from(document.querySelectorAll(".stop-input"))
        .map((i) => i.value.trim())
        .filter(Boolean);

      const customOptionText = getCustomOptionTextFromUI();
      setCustomOptionText(customOptionText);

      const selectedOptions = getSelectedOptions();
      const kmForPricing = typeof window.lastTrip?.distanceKm === "number" ? window.lastTrip.distanceKm : 0;
      const leadTimeInfo = getLeadTimeInfo({ pickupDate, pickupTime });
      const vehicleForPricing = vehicleObj.id || "";

      const computedForOptions = vehicleForPricing
        ? computeTariffForVehicle({
            km: kmForPricing,
            stopsCount: stops.length,
            pickupTime,
            pickupDate,
            vehicleId: vehicleForPricing,
            leadTimeInfo,
          })
        : null;

      const appliedOptions = Array.isArray(computedForOptions?.appliedOptions) ? computedForOptions.appliedOptions : [];
      const optionsTotalFee = typeof computedForOptions?.optionsFee === "number" ? computedForOptions.optionsFee : 0;

      // Compat legacy booleans
      const petOption = selectedOptions.some((o) => o.id === "pet");
      const babySeatOption = selectedOptions.some((o) => o.id === "baby_seat");

      const kmForPayload = typeof window.lastTrip?.distanceKm === "number" ? window.lastTrip.distanceKm : 0;
      const effectiveComputed = vehicleObj.id
        ? computeTariffForVehicle({
            km: kmForPayload,
            stopsCount: stops.length,
            pickupTime,
            pickupDate,
            vehicleId: vehicleObj.id,
            leadTimeInfo,
          })
        : null;

      const isQuoteEffective = effectiveComputed ? !!effectiveComputed.isQuote : !!vehicleObj.quoteOnly;

      const trip = {
        start,
        end,
        stops,
        pickupDate,
        pickupTime,
        vehicle: vehicleObj.id,
        vehicleLabel: vehicleObj.label,
        isQuote: isQuoteEffective,
        petOption,
        babySeatOption,
        options: appliedOptions.length
          ? appliedOptions
          : selectedOptions.map((o) => ({ id: o.id, label: o.label, type: o.type, amount: o.amount, fee: 0 })),
        optionsTotalFee,
        customOption: customOptionText,
        price: isQuoteEffective
          ? 0
          : effectiveComputed && typeof effectiveComputed.total === "number"
            ? effectiveComputed.total
            : typeof window.lastPrice === "number"
              ? window.lastPrice
              : null,
        pricingMode: effectiveComputed?.pricingMode || (cfg.pricingBehavior === "lead_time_pricing" ? leadTimeInfo.mode : null),
        leadTimeThresholdMinutes: cfg.pricingBehavior === "lead_time_pricing" ? leadTimeInfo.thresholdMinutes : null,
        surchargesApplied: effectiveComputed?.surchargesApplied || null,
        distanceKm: typeof window.lastTrip?.distanceKm === "number" ? window.lastTrip.distanceKm : null,
        durationMinutes:
          typeof window.lastTrip?.durationMinutes === "number" ? window.lastTrip.durationMinutes : null,
      };

      const payload = {
        contact,
        trip,
        consents: {
          termsConsent: true,
          marketingConsent: !!marketingConsent?.checked,
        },
        config: {
          bookingEmailTo:
            (getWidgetDataset().bookingEmailTo || "").trim() || undefined,
          slackEnabled: false,
        },
      };

      const res = await postBookingNotify(payload);
      if (!res?.ok) {
        const msg = (() => {
          const base = res?.error || "Impossible de contacter le serveur…";
          const status = typeof res?.status === "number" ? res.status : null;
          const requestId = res?.requestId ? ` (réf: ${res.requestId})` : "";
          if (status) return `${base} (code ${status})${requestId}`;
          return `${base}${requestId}`;
        })();
        if (contactErrorEl) contactErrorEl.textContent = msg;
        if (consentErrorEl) consentErrorEl.textContent = msg;

        return;
      }

      // Avertissements: l'API peut répondre ok=true mais ne pas envoyer email/slack
      // (ex: configuration manquante côté app). On informe l'utilisateur sans bloquer.
      if (contactErrorEl) contactErrorEl.textContent = "";
      if (consentErrorEl) consentErrorEl.textContent = "";

      const warnings = [];
      if (res?.email && res.email.sent === false) {
        warnings.push(
          "le chauffeur n’a pas été notifié par e-mail (configuration manquante).",
        );
      }
      if (res?.slack && res.slack.enabled === true && res.slack.sent === false) {
        warnings.push("la notification Slack n’a pas été envoyée (configuration manquante).");
      }

      if (warnings.length && contactErrorEl) {
        contactErrorEl.textContent = `Attention : ${warnings.join(" ")}`;
      }

        const showSuccessPopupAndRedirect = () => {
          if (document.getElementById("vtc-success-modal")) return;

          const overlay = document.createElement("div");
          overlay.id = "vtc-success-modal";
          overlay.setAttribute("role", "dialog");
          overlay.setAttribute("aria-modal", "true");
          overlay.style.cssText = [
            "position:fixed",
            "inset:0",
            "z-index:2147483647",
            "display:flex",
            "align-items:center",
            "justify-content:center",
            "padding:20px",
            "background:rgba(0,0,0,0.55)",
          ].join(";");

          const card = document.createElement("div");
          card.style.cssText = [
            "max-width:520px",
            "width:100%",
            "background:#fff",
            "border-radius:16px",
            "padding:22px 20px",
            "box-shadow:0 20px 60px rgba(0,0,0,0.25)",
            "border:1px solid rgba(0,0,0,0.08)",
          ].join(";");

          const title = document.createElement("div");
          title.textContent = "Demande envoyée";
          title.style.cssText = [
            "font-size:18px",
            "font-weight:700",
            "letter-spacing:0.2px",
            "color:#000",
            "margin:0 0 10px 0",
          ].join(";");

          const message = document.createElement("div");
          message.textContent =
            "Votre demande est prise en compte , un chauffeur vous contactera tres vite pour confirmer votre trajet . Merci . Your request has been received; a driver will contact you very soon to confirm your reservation. Thank you.";
          message.style.cssText = [
            "font-size:14px",
            "line-height:1.5",
            "color:rgba(0,0,0,0.85)",
          ].join(";");

          const hint = document.createElement("div");
          hint.textContent = "Retour à l’accueil dans 5 secondes…";
          hint.style.cssText = [
            "margin-top:14px",
            "font-size:12px",
            "color:rgba(0,0,0,0.6)",
          ].join(";");

          card.appendChild(title);
          card.appendChild(message);
          card.appendChild(hint);
          overlay.appendChild(card);
          document.body.appendChild(overlay);

          const goHome = () => {
            try {
              overlay.remove();
            } catch {
              // ignore
            }
            window.location.href = `${window.location.origin}/`;
          };

          setTimeout(goHome, 5000);
        };

        if (contactErrorEl) contactErrorEl.textContent = "";
        if (consentErrorEl) consentErrorEl.textContent = "";

        showSuccessPopupAndRedirect();
    });
  }

  const widgetForVehicles = getWidgetEl();
  (widgetForVehicles
    ? widgetForVehicles.querySelectorAll('input[name="vehicle"]')
    : document.querySelectorAll('input[name="vehicle"]')
  ).forEach((radio) => {
    radio.addEventListener("change", () => {
      const vehicleId = getSelectedVehicleIdFromUI();
      if (!radio.checked || !vehicleId) return;
      const pricing = getPricingConfig(vehicleId, 0);
      if (pricing.quoteOnly) {
        clearPriceUI(true);
        updateResultTariffDisplay({ isQuote: true, quoteMessage: pricing.quoteMessage });
      }
    });
  });

  const europeModeEl = document.getElementById("europeMode");
  if (europeModeEl) {
    europeModeEl.addEventListener("change", () => {
      ensureGoogleMapsLoaded("europe-toggle").then((ok) => {
        if (!ok) return;
        rebindAutocompletes();
      });
    });
  }

  const geoBtn = document.getElementById("geoStartBtn");
  if (geoBtn) {
    geoBtn.addEventListener("click", async (e) => {
      e.preventDefault();

      const startInput = document.getElementById("start");
      if (!startInput) return;

      if (!navigator.geolocation) {
        alert("La géolocalisation n’est pas disponible sur ce navigateur.");
        return;
      }

      // Ensure Maps JS is loaded (Directions uses it). Reverse geocoding is optional.
      const ok = await ensureGoogleMapsLoaded("geo");
      if (!ok || !(window.google && google.maps)) {
        alert("Google Maps n’est pas disponible. Vérifiez la configuration.");
        return;
      }

      // If the user edits the field after using geolocation, stop using lat/lng.
      if (!startInput._vtcGeoResetBound) {
        startInput._vtcGeoResetBound = true;
        startInput.addEventListener("input", () => {
          startInput.dataset.vtcGeo = "0";
          _startGeoLatLng = null;
        });
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;

          // Always keep a usable origin, even if Geocoding API isn't enabled.
          _startGeoLatLng = { lat, lng };
          startInput.dataset.vtcGeo = "1";
          startInput.value = "Position actuelle";

          // Best effort: reverse geocode into a nicer address when available.
          if (google.maps.Geocoder) {
            try {
              const geocoder = new google.maps.Geocoder();
              geocoder.geocode({ location: { lat, lng } }, (results, status) => {
                if (status === "OK" && results && results[0] && results[0].formatted_address) {
                  startInput.value = results[0].formatted_address;
                  return;
                }
                // Fallback: show coordinates for clarity.
                startInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
              });
            } catch {
              startInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            }
          } else {
            startInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
          }
        },
        () => {
          alert("Autorisez la localisation pour utiliser votre position.");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      );
    });
  }

  // Empêcher certains scripts de thème de capter les events et voler le focus
  // sur les inputs date/heure (capture + stopPropagation).
  const pickupDateInput = document.getElementById("pickupDate");
  const pickupTimeInput = document.getElementById("pickupTime");

  if (pickupTimeInput) {
    const applyStep = () => {
      const normalized = normalizeTimeTo5Minutes(pickupTimeInput.value);
      if (normalized !== pickupTimeInput.value) pickupTimeInput.value = normalized;
      if (window.lastTrip) {
        window.lastTrip.pickupTime = pickupTimeInput.value;
      }
    };
    // Round typed/selected values.
    pickupTimeInput.addEventListener("change", applyStep);
    pickupTimeInput.addEventListener("blur", applyStep);
    applyStep();
  }

  [pickupDateInput, pickupTimeInput].filter(Boolean).forEach((input) => {
    ["pointerdown", "mousedown", "mouseup", "touchstart"].forEach((eventName) => {
      input.addEventListener(eventName, (e) => e.stopPropagation(), true);
    });
    input.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        input.showPicker?.();
      },
      true,
    );
  });

  // On lance aussi l’init autocomplete côté DOM
  initAutocomplete();
});

/* --------------------------
   RENDRE LES FONCTIONS GLOBALES
--------------------------- */
window.initAutocomplete = initAutocomplete;
window.addStopField = addStopField;
window.calculatePrice = calculatePrice;

})();
