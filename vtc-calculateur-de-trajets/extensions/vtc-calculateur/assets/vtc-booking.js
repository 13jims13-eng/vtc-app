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
let _widgetState = {
  selectedVehicleId: null,
  selectedVehicleLabel: null,
  selectedIsQuote: false,
  selectedTotal: null,
  customOptionText: "",
};

let _optionsOriginalPlacement = null;

function getWidgetEl() {
  return document.querySelector("#vtc-widget") || document.querySelector("#vtc-smart-booking-widget");
}

function getWidgetDataset() {
  return getWidgetEl()?.dataset || {};
}

function setMapsStatus(text) {
  const el = document.getElementById("vtc-maps-status");
  if (!el) return;
  if (!text) {
    el.textContent = "";
    el.style.display = "none";
    return;
  }
  el.textContent = text;
  el.style.display = "block";
}

function ensureGoogleMapsLoaded(reason) {
  if (isGoogleReady()) return Promise.resolve(true);
  if (_googleMapsLoadPromise) return _googleMapsLoadPromise;

  const dataset = getWidgetDataset();
  const apiKey = String(dataset.googleMapsApiKey || "").trim();
  if (!apiKey) {
    console.warn("google-maps: missing api key (theme setting google_maps_api_key)");
    setMapsStatus("Google Maps n’est pas configuré.");
    return Promise.resolve(false);
  }

  const existing = document.getElementById("vtc-google-maps-js");
  if (existing) {
    // Script tag exists, just wait a bit for google to become ready.
    _googleMapsLoadPromise = new Promise((resolve) => {
      setMapsStatus("Chargement de Google Maps…");
      const startedAt = Date.now();
      const interval = setInterval(() => {
        if (isGoogleReady()) {
          clearInterval(interval);
          setMapsStatus("");
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
    return _googleMapsLoadPromise.then((ok) => {
      if (!ok) _googleMapsLoadPromise = null;
      return ok;
    });
  }

  _googleMapsLoadPromise = new Promise((resolve) => {
    setMapsStatus("Chargement de Google Maps…");
    console.log("google-maps: loading", { reason });

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
      setMapsStatus("");
      resolve(isGoogleReady());
    };
    script.onerror = () => {
      clearTimeout(timeout);
      setMapsStatus("");
      resolve(false);
    };

    document.head.appendChild(script);
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

function getCustomOptionTextFromUI() {
  const raw = document.getElementById("customOption")?.value || "";
  return String(raw).trim();
}

function setCustomOptionText(value) {
  _widgetState.customOptionText = String(value || "").trim();
  if (window.lastTrip) {
    window.lastTrip.customOptionText = _widgetState.customOptionText;
  }
}

function normalizeTimeTo5Minutes(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  if (!m) return v;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return v;
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
  const slackEnabled = parseBoolean(dataset.slackEnabled, true);

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
    card.style.border = isSelected ? "2px solid #111" : "1px solid #e5e5e5";
    card.style.opacity = isSelected ? "1" : "1";

    const btn = card.querySelector("button[data-vehicle-id]");
    if (btn) {
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
          return `<label><input type="radio" name="vehicle" value="${String(v.id).replace(/"/g, "&quot;")}" ${checked}> ${String(v.label)}</label>`;
        })
        .join("\n");

      _widgetState.selectedVehicleId = firstVehicle?.id || null;
      _widgetState.selectedVehicleLabel = firstVehicle?.label || null;
      _widgetState.selectedIsQuote = !!firstVehicle?.quoteOnly;

      vehiclesContainer.querySelectorAll('input[name="vehicle"]').forEach((radio) => {
        radio.addEventListener("change", () => {
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
          <label class="vtc-checkbox">
            <input type="checkbox" data-option-id="${String(o.id).replace(/"/g, "&quot;")}"> ${String(o.label)}${feeText}
          </label>
        `.trim();
      })
      .join("\n");

    optionsContainer.querySelectorAll("input[type=checkbox]").forEach((input) => {
      input.addEventListener("change", () => {
        // Always refresh summary line-items
        refreshPricingAfterOptionsChange();
      });
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
      <div data-vehicle-card="${String(v.id).replace(/"/g, "&quot;")}" style="display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #e5e5e5;border-radius:12px;padding:12px;margin-top:10px;background:#fff;" data-vehicle-card>
        <div style="display:flex;align-items:center;gap:12px;min-width:0;">
          <img src="${imageSrc}" alt="${String(v.label).replace(/"/g, "&quot;")}" style="width:70px;height:46px;border-radius:10px;border:1px solid #ddd;background:#fff;object-fit:cover;" />
          <div style="min-width:0;">
            <div style="font-weight:700;">${v.label}</div>
            <div style="font-size:14px;opacity:0.85;">${right}</div>
          </div>
        </div>
        <button
          type="button"
          data-vehicle-id="${String(v.id).replace(/"/g, "&quot;")}" 
          style="padding:10px 14px;border-radius:10px;border:1px solid #111;background:#111;color:#fff;cursor:pointer;flex:0 0 auto;"
        >Choisir</button>
      </div>
    `.trim();
  });

  tariffsEl.innerHTML = `
    <h3 style="font-size:18px;margin:0 0 10px 0;">Tarifs</h3>
    ${lines.join("\n")}
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
  if (!isGoogleReady()) return;

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
  if (!isGoogleReady()) return;

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

  if (isGoogleReady()) {
    const ac = new google.maps.places.Autocomplete(input, getAutocompleteOptions());
    input._gmAutocomplete = ac;
    stopAutocompletes.push(ac);
  } else {
    input.addEventListener("focus", () => {
      if (input._gmAutocomplete) return;
      ensureGoogleMapsLoaded("stop-focus").then((ok) => {
        if (!ok || !isGoogleReady() || input._gmAutocomplete) return;
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
        body: data || (rawText ? rawText.slice(0, 800) : null),
      });

      if (!resp.ok) {
        const msg = (() => {
          if (resp.status === 400 && data?.error) return String(data.error);
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
          reason: data?.reason || null,
          serverRequestId: data?.requestId || null,
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
  const start = document.getElementById("start")?.value || "";
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

  const request = {
    origin: start,
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
          slackEnabled: getWidgetConfig().slackEnabled,
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

        const contactErrorEl = document.getElementById("contact-error");
        if (contactErrorEl) contactErrorEl.textContent = msg;
        if (consentErrorEl) consentErrorEl.textContent = msg;

        return;
      }

      const okMsg = "Demande envoyée";
      const contactErrorEl = document.getElementById("contact-error");
      if (contactErrorEl) contactErrorEl.textContent = okMsg;
      if (consentErrorEl) consentErrorEl.textContent = "";

      // Message visible dans le formulaire (pas de pop-up)
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

      if (!(window.google && google.maps && google.maps.Geocoder)) {
        const ok = await ensureGoogleMapsLoaded("geo");
        if (!ok || !(window.google && google.maps && google.maps.Geocoder)) {
          alert("Google Maps n’est pas disponible. Vérifiez la configuration.");
          return;
        }
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;

          const geocoder = new google.maps.Geocoder();
          geocoder.geocode({ location: { lat, lng } }, (results, status) => {
            if (status !== "OK" || !results || !results[0]) {
              alert("Impossible de récupérer une adresse à partir de votre position.");
              return;
            }

            startInput.value = results[0].formatted_address || "";
            startInput.dataset.lat = String(lat);
            startInput.dataset.lng = String(lng);
          });
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
