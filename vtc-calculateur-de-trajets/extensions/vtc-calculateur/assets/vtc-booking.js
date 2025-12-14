/* global google */
// vtc-booking.js - Version B1 (formulaire toujours visible)

let directionsService;
let directionsRenderer;
let map;
let stopAutocompletes = [];
let autocompleteInitStarted = false;
let _europeBoundsCache = null;

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
  const widget = document.getElementById("vtc-smart-booking-widget");
  const configuredEndpoint = (
    // nouveau nom (préféré)
    widget?.dataset?.notifyEndpoint ||
    // compat: ancien attribut (historique)
    widget?.dataset?.slackEndpoint ||
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
  if (vehicle === "van") return "Van 7 places";
  if (vehicle === "autre") return "Sur devis";
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
  const wrapper = document.getElementById("vtc-smart-booking-widget");
  if (!wrapper) return "";

  const berlineImg = wrapper.dataset.berlineImg || "";
  const vanImg = wrapper.dataset.vanImg || "";
  const autreImg = wrapper.dataset.autreImg || "";

  if (vehicle === "van") return vanImg.trim();
  if (vehicle === "autre") return autreImg.trim();
  return berlineImg.trim();
}

function getVehicleImageSrc(vehicle) {
  return getConfiguredVehicleImage(vehicle) || getVehicleDemoImage(vehicle);
}

function calculatePrice() {
  const widget = document.getElementById("vtc-smart-booking-widget") || document;
  const start = document.getElementById("start")?.value || "";
  const end = document.getElementById("end")?.value || "";
  const pickupTime = document.getElementById("pickupTime")?.value || "";
  const pickupDate = document.getElementById("pickupDate")?.value || "";
  const resultEl = document.getElementById("result");
  const reserveBtn = document.getElementById("reserve-btn");
  const vehicle =
    widget.querySelector?.('input[name="vehicle"]:checked')?.value ||
    document.querySelector('input[name="vehicle"]:checked')?.value ||
    "berline";
  const isQuote = vehicle === "autre";

  // Nettoyer tout ancien prix (important quand on passe en "Sur devis")
  clearPriceUI(isQuote);

  // Réinitialiser le bouton réserver
  if (reserveBtn) {
    reserveBtn.disabled = true;
    reserveBtn.style.opacity = "0.45";
    reserveBtn.style.cursor = "not-allowed";
  }

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

    // Re-lire le véhicule au moment de l'affichage (évite qu'un changement pendant la requête conserve un ancien prix)
    const vehicleNow =
      widget.querySelector?.('input[name="vehicle"]:checked')?.value ||
      document.querySelector('input[name="vehicle"]:checked')?.value ||
      "berline";
    const isQuoteNow = vehicleNow === "autre";

    // 6️⃣ Tarifs
    let total = null;
    if (isQuoteNow) {
      clearPriceUI(true);
      total = 0;
    } else {
      const minFare = 29.99;
      const priceKmBerline = 2.4; // IMPORTANT : 2,4 € / km pour Berline
      const priceKmVan = 3.5;
      const priceKm = vehicleNow === "van" ? priceKmVan : priceKmBerline;

      total = km * priceKm;

      if (document.getElementById("petOption")?.checked) total += 20;
      if (document.getElementById("babySeatOption")?.checked) total += 15;

      // Majoration nuit 22h–05h
      if (pickupTime) {
        const hour = parseInt(pickupTime.split(":")[0], 10);
        if (hour >= 22 || hour < 5) total *= 1.10;
      }

      // Remise si > 600 €
      if (total > 600) total *= 0.90;

      // Minimum
      if (total < minFare) total = minFare;

      if (resultEl) {
        resultEl.innerHTML = `Prix estimé : <strong>${total.toFixed(2)} €</strong>`;
      }

      window.lastPrice = total;
    }

    window.lastTrip = {
      start,
      end,
      stops: waypoints.map((w) => w.location),
      pickupDate,
      pickupTime,
      vehicle: vehicleNow,
      distanceKm: km,
      durationMinutes: Math.round(minutes),
      isQuote: isQuoteNow,
    };

    // 7️⃣ Résumé premium
    const summaryDiv = document.getElementById("route-summary");
    if (summaryDiv) {
      summaryDiv.style.display = "block";

      summaryDiv.innerHTML = `
        <h3 style="font-size:18px; margin-bottom:10px;">Résumé du trajet</h3>

        <div style="display:flex;gap:12px;align-items:center;margin:10px 0 14px 0;">
          <img
            src="${getVehicleImageSrc(vehicleNow)}"
            alt="${getVehicleLabel(vehicleNow)}"
            style="width:90px;height:60px;border-radius:10px;border:1px solid #ddd;background:#fff;object-fit:cover;"
          >
          <div><strong>${getVehicleLabel(vehicleNow)}</strong></div>
        </div>

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
        <div><strong>Véhicule :</strong> ${getVehicleLabel(vehicleNow)}</div>
      `;
    }

    // 8️⃣ Activation du bouton "Réserver mon trajet"
    if (reserveBtn) {
      reserveBtn.disabled = false;
      reserveBtn.style.opacity = "1";
      reserveBtn.style.cursor = "pointer";
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

/* --------------------------
   BLOQUER LES DATES PASSÉES
--------------------------- */
document.addEventListener("DOMContentLoaded", () => {
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
      const vehicle =
        document.getElementById("vtc-smart-booking-widget")
          ?.querySelector?.('input[name="vehicle"]:checked')?.value ||
        document.querySelector('input[name="vehicle"]:checked')?.value ||
        "berline";

      const isQuote = vehicle === "autre";
      const stops = Array.from(document.querySelectorAll(".stop-input"))
        .map((i) => i.value.trim())
        .filter(Boolean);

      const trip = {
        start,
        end,
        stops,
        pickupDate,
        pickupTime,
        vehicle,
        isQuote,
        petOption: !!document.getElementById("petOption")?.checked,
        babySeatOption: !!document.getElementById("babySeatOption")?.checked,
        customOption: document.getElementById("customOption")?.value || "",
        price: isQuote ? 0 : typeof window.lastPrice === "number" ? window.lastPrice : null,
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
            (document.getElementById("vtc-smart-booking-widget")?.dataset?.bookingEmailTo || "").trim() ||
            undefined,
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

      const okMsg = "Demande envoyée ✅";
      const contactErrorEl = document.getElementById("contact-error");
      if (contactErrorEl) contactErrorEl.textContent = okMsg;
      if (consentErrorEl) consentErrorEl.textContent = "";

      alert(okMsg);
    });
  }

  document.querySelectorAll('#vtc-smart-booking-widget input[name="vehicle"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked && radio.value === "autre") {
        clearPriceUI(true);
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
