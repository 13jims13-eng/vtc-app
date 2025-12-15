/* global google */
// vtc-booking.js - Version B1 (formulaire toujours visible)

let directionsService;
let directionsRenderer;
let map;
let stopAutocompletes = [];
let autocompleteInitStarted = false;
let _europeBoundsCache = null;
let _widgetConfigCache = null;
let _widgetState = {
  selectedVehicleId: null,
  selectedVehicleLabel: null,
  selectedIsQuote: false,
  selectedTotal: null,
};

function getWidgetEl() {
  return document.querySelector("#vtc-widget") || document.querySelector("#vtc-smart-booking-widget");
}

function getWidgetDataset() {
  return getWidgetEl()?.dataset || {};
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
  const fee = parseNumber(raw?.fee, 0);
  return {
    id,
    label: label || id || "Option",
    fee,
  };
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
    options: [
      { id: "pet", label: "Animal de compagnie", fee: 20 },
      { id: "baby_seat", label: "Siège bébé", fee: 15 },
    ],
  };

  const displayModeRaw = String(rawCfg?.displayMode || "").trim().toUpperCase();
  const displayMode = displayModeRaw === "B" ? "B" : "A";
  const stopFee = parseNumber(rawCfg?.stopFee, parseNumber(dataset.stopFee, 0));
  const quoteMessage = String(
    rawCfg?.quoteMessage || dataset.quoteMessage || "Sur devis — merci de nous contacter.",
  ).trim();
  const slackEnabled = parseBoolean(dataset.slackEnabled, true);

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
  const optionsRaw = Array.isArray(rawCfg?.options) ? rawCfg.options : legacyDefaults.options;
  const options = optionsRaw.map(normalizeOption).filter((o) => o.id);

  _widgetConfigCache = {
    displayMode,
    stopFee,
    quoteMessage,
    slackEnabled,
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

function getOptionsTotalFee() {
  return getSelectedOptions().reduce((sum, o) => sum + (Number.isFinite(o.fee) ? o.fee : 0), 0);
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
  const optionsFee = getOptionsTotalFee();

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
  total += optionsFee;

  // Majoration nuit 22h–05h
  if (pickupTime) {
    const hour = parseInt(String(pickupTime).split(":")[0] || "", 10);
    if (Number.isFinite(hour) && (hour >= 22 || hour < 5)) total *= 1.1;
  }

  // Remise si > 600 €
  if (total > 600) total *= 0.9;

  // Minimum (base fare)
  if (total < (vehicle.baseFare || 0)) total = vehicle.baseFare || 0;

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
    optionsFee,
    extraStopsTotal,
    stopFee: cfg.stopFee || 0,
    pricingMode,
    surchargesApplied,
  };
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
        const feeText = Number.isFinite(o.fee) && o.fee !== 0 ? ` (+${o.fee.toFixed(2)} €)` : "";
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
        renderTripSummaryFromLastTrip();

        // If we already calculated and we're in mode B, tariffs must reflect options.
        if (cfg.displayMode === "B" && typeof window.lastTrip?.distanceKm === "number") {
          renderTariffsAfterCalculation(
            window.lastTrip.distanceKm,
            Array.isArray(window.lastTrip.stops) ? window.lastTrip.stops.length : 0,
            window.lastTrip.pickupTime || "",
            window.lastTrip.pickupDate || "",
          );
        }
      });
    });
  }
}

function renderTariffsAfterCalculation(km, stopsCount, pickupTime, pickupDate) {
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
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #e5e5e5;border-radius:12px;padding:12px;margin-top:10px;background:#fff;">
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

      setReserveButtonEnabled(true);
    });
  });
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

  if (startInput) {
    startInput.addEventListener("focus", ensureBaseAutocompletes);
  }
  if (endInput) {
    endInput.addEventListener("focus", ensureBaseAutocompletes);
  }

  const intervalId = setInterval(() => {
    if (!isGoogleReady()) return;

    if (!directionsService) {
      directionsService = new google.maps.DirectionsService();
    }

    ensureBaseAutocompletes();
    clearInterval(intervalId);
  }, 200);
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
      if (!isGoogleReady() || input._gmAutocomplete) return;
      const ac = new google.maps.places.Autocomplete(input, getAutocompleteOptions());
      input._gmAutocomplete = ac;
      stopAutocompletes.push(ac);
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
  const endpoint = configuredEndpoint || defaultEndpoint;

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

  try {
    console.log("booking-notify: POST", endpoint);
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const rawText = await resp.text().catch(() => "");
    const parsed = (() => {
      try {
        return rawText ? JSON.parse(rawText) : null;
      } catch {
        return null;
      }
    })();

    console.log("booking-notify: response", {
      url: endpoint,
      status: resp.status,
      ok: resp.ok,
      json: parsed,
      body: rawText,
    });

    const data = parsed;

    if (!resp.ok) {
      return {
        ok: false,
        error: "Impossible de contacter le serveur…",
        detail: data?.error || rawText || null,
        status: resp.status,
      };
    }

    if (data && typeof data === "object") {
      return data;
    }

    return { ok: false, error: "Réponse serveur invalide", detail: rawText || null };
  } catch (err) {
    console.log("booking-notify: fetch error", { url: endpoint, err });
    return {
      ok: false,
      error: "Impossible de contacter le serveur…",
    };
  }
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

function calculatePrice() {
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
    if (resultEl) {
      resultEl.innerHTML = "Google Maps n’est pas encore prêt, veuillez réessayer.";
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

    // 7️⃣ Résumé premium
    const summaryDiv = document.getElementById("route-summary");
    if (summaryDiv) {
      summaryDiv.style.display = "block";

      const selectedOptions = getSelectedOptions();
      const optionsLine = selectedOptions.length
        ? `<div><strong>Options :</strong> ${selectedOptions
            .map((o) => `${o.label}${o.fee ? ` (+${o.fee.toFixed(2)} €)` : ""}`)
            .join(" · ")}</div>`
        : `<div><strong>Options :</strong> (aucune)</div>`;

      const extraPricingLine = cfg.stopFee > 0 && waypoints.length
        ? `<div><strong>Frais arrêts :</strong> ${waypoints.length} × ${cfg.stopFee.toFixed(2)} €</div>`
        : "";

      const leadTimeLine =
        cfg.pricingBehavior === "lead_time_pricing"
          ? `<div><strong>Type :</strong> ${leadTimeLabel}</div>`
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
        ${vehicleNow ? `<div><strong>Véhicule :</strong> ${getVehicleLabel(vehicleNow)}</div>` : ""}
        ${optionsLine}
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
  const summaryDiv = document.getElementById("route-summary");
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
  const optionsLine = selectedOptions.length
    ? `<div><strong>Options :</strong> ${selectedOptions
        .map((o) => `${o.label}${o.fee ? ` (+${o.fee.toFixed(2)} €)` : ""}`)
        .join(" · ")}</div>`
    : `<div><strong>Options :</strong> (aucune)</div>`;

  const extraPricingLine = cfg.stopFee > 0 && trip.stops?.length
    ? `<div><strong>Frais arrêts :</strong> ${trip.stops.length} × ${cfg.stopFee.toFixed(2)} €</div>`
    : "";

  const leadTimeLine =
    cfg.pricingBehavior === "lead_time_pricing" && trip.leadTimeLabel
      ? `<div><strong>Type :</strong> ${trip.leadTimeLabel}</div>`
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
    ${vehicleId ? `<div><strong>Véhicule :</strong> ${getVehicleLabel(vehicleId)}</div>` : ""}
    ${optionsLine}
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

      const selectedOptions = getSelectedOptions();
      const optionsTotalFee = getOptionsTotalFee();

      // Compat legacy booleans
      const petOption = selectedOptions.some((o) => o.id === "pet");
      const babySeatOption = selectedOptions.some((o) => o.id === "baby_seat");

      const kmForPayload = typeof window.lastTrip?.distanceKm === "number" ? window.lastTrip.distanceKm : 0;
      const leadTimeInfo = getLeadTimeInfo({ pickupDate, pickupTime });
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
        options: selectedOptions.map((o) => ({ id: o.id, label: o.label, fee: o.fee })),
        optionsTotalFee,
        customOption: document.getElementById("customOption")?.value || "",
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
        const msg =
          res?.error ||
          "Impossible de contacter le serveur…";

        const contactErrorEl = document.getElementById("contact-error");
        if (contactErrorEl) contactErrorEl.textContent = msg;
        if (consentErrorEl) consentErrorEl.textContent = msg;

        alert(msg);
        return;
      }

      const okMsg = "Demande envoyée";
      const contactErrorEl = document.getElementById("contact-error");
      if (contactErrorEl) contactErrorEl.textContent = okMsg;
      if (consentErrorEl) consentErrorEl.textContent = "";

      alert(okMsg);
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
      rebindAutocompletes();
    });
  }

  const geoBtn = document.getElementById("geoStartBtn");
  if (geoBtn) {
    geoBtn.addEventListener("click", (e) => {
      e.preventDefault();

      const startInput = document.getElementById("start");
      if (!startInput) return;

      if (!navigator.geolocation) {
        alert("La géolocalisation n’est pas disponible sur ce navigateur.");
        return;
      }

      if (!(window.google && google.maps && google.maps.Geocoder)) {
        alert("Google Maps n’est pas encore prêt. Réessayez dans quelques secondes.");
        return;
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
