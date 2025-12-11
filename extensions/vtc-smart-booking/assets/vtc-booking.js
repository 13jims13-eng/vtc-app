// vtc-booking.js - Version B1 (formulaire toujours visible)

let directionsService;
let directionsRenderer;
let map;
let stopAutocompletes = [];
let autocompleteInitStarted = false;

/* --------------------------
   UTILITAIRE : Google prêt ?
--------------------------- */
function isGoogleReady() {
  return !!(window.google && google.maps && google.maps.places);
}

/* --------------------------
   AUTOCOMPLETE DÉPART / ARRIVÉE
--------------------------- */
function ensureBaseAutocompletes() {
  if (!isGoogleReady()) return;

  const startInput = document.getElementById("start");
  const endInput = document.getElementById("end");

  if (startInput && !startInput._gmAutocomplete) {
    startInput._gmAutocomplete = new google.maps.places.Autocomplete(startInput, {
      fields: ["place_id", "formatted_address"],
      types: ["geocode", "establishment"],
    });
  }

  if (endInput && !endInput._gmAutocomplete) {
    endInput._gmAutocomplete = new google.maps.places.Autocomplete(endInput, {
      fields: ["place_id", "formatted_address"],
      types: ["geocode", "establishment"],
    });
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
  input.className = "vtc-input";
  input.placeholder = "Adresse arrêt";

  container.appendChild(input);

  if (isGoogleReady()) {
    const ac = new google.maps.places.Autocomplete(input, {
      fields: ["place_id", "formatted_address"],
      types: ["geocode", "establishment"],
    });
    stopAutocompletes.push(ac);
  } else {
    input.addEventListener("focus", () => {
      if (!isGoogleReady() || input._gmAutocomplete) return;
      input._gmAutocomplete = new google.maps.places.Autocomplete(input, {
        fields: ["place_id", "formatted_address"],
        types: ["geocode", "establishment"],
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

/* --------------------------
   CALCUL ITINÉRAIRE + PRIX + CARTE + RÉSUMÉ
--------------------------- */
function calculatePrice() {
  const start = document.getElementById("start")?.value || "";
  const end = document.getElementById("end")?.value || "";
  const pickupTime = document.getElementById("pickupTime")?.value || "";
  const pickupDate = document.getElementById("pickupDate")?.value || "";
  const resultEl = document.getElementById("result");
  const reserveBtn = document.getElementById("reserve-btn");

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

  // 3️⃣ Vérif coordonnées client
  const contact = validateContactForm();
  if (!contact) {
    if (resultEl) {
      resultEl.innerHTML = "Merci de remplir vos coordonnées pour obtenir votre tarif.";
    }
    // Scroll vers le formulaire pour aider l’utilisateur
    const contactWrapper = document.getElementById("contact-wrapper");
    if (contactWrapper && typeof contactWrapper.scrollIntoView === "function") {
      contactWrapper.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return;
  }

  // 4️⃣ Construction des arrêts
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

    // 5️⃣ MAP (créée seulement au moment du calcul)
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

    // 6️⃣ Distance / durée
    let totalMeters = 0;
    let totalSeconds = 0;

    result.routes[0].legs.forEach((leg) => {
      totalMeters += leg.distance.value;
      totalSeconds += leg.duration.value;
    });

    const km = totalMeters / 1000;
    const minutes = totalSeconds / 60;

    // 7️⃣ Tarifs
    const minFare = 29.99;
    const priceKmBerline = 2.4; // IMPORTANT : 2,4 € / km pour Berline
    const priceKmVan = 3.5;
    const vehicle = document.querySelector('input[name="vehicle"]:checked')?.value || "berline";
    const priceKm = vehicle === "van" ? priceKmVan : priceKmBerline;

    let total = km * priceKm;

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

    // 8️⃣ Résumé premium
    const summaryDiv = document.getElementById("route-summary");
    if (summaryDiv) {
      summaryDiv.style.display = "block";

      summaryDiv.innerHTML = `
        <h3 style="font-size:18px; margin-bottom:10px;">Résumé du trajet</h3>

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
        <div><strong>Véhicule :</strong> ${
          vehicle === "van" ? "Van 7 places" : "Berline"
        }</div>
      `;
    }

    // 9️⃣ Activation du bouton "Réserver mon trajet"
    if (reserveBtn) {
      reserveBtn.disabled = false;
      reserveBtn.style.opacity = "1";
      reserveBtn.style.cursor = "pointer";
      // Attacher les données de réservation au bouton pour l'envoi
      const reservation = {
        contact,
        trip: {
          start,
          end,
          waypoints: waypoints.map((w) => w.location),
          pickupDate,
          pickupTime,
          distanceKm: +km.toFixed(1),
          durationMinutes: Math.round(minutes),
          vehicle,
          price: +total.toFixed(2),
        },
      };
      try {
        reserveBtn.dataset.reservation = JSON.stringify(reservation);
      } catch (e) {
        reserveBtn.dataset.reservation = "";
      }
      reserveBtn.onclick = submitReservation;
    }

    // Log des infos client (pour debug, futur envoi email / base de données)
    console.log("Lead VTC Smart Booking :", {
      contact,
      start,
      end,
      waypoints,
      pickupDate,
      pickupTime,
      km: km.toFixed(1),
      minutes: Math.round(minutes),
      vehicle,
      total: total.toFixed(2),
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

  // On lance aussi l’init autocomplete côté DOM
  initAutocomplete();
  // Crée le modal de confirmation (invisible) utilisé après envoi
  createConfirmationModal();
});

/* --------------------------
   RENDRE LES FONCTIONS GLOBALES
--------------------------- */
window.initAutocomplete = initAutocomplete;
window.addStopField = addStopField;
window.calculatePrice = calculatePrice;

// Envoi de la réservation au serveur (route existante: /lead)
async function submitReservation(e) {
  const btn = (e && e.currentTarget) || document.getElementById("reserve-btn");
  const resultEl = document.getElementById("result");
  if (!btn) return;

  let payload = null;
  if (btn.dataset && btn.dataset.reservation) {
    try {
      payload = JSON.parse(btn.dataset.reservation);
    } catch (err) {
      payload = null;
    }
  }

  // Fallback: reconstruct minimal payload from DOM
  if (!payload) {
    const contact = validateContactForm();
    const start = document.getElementById("start")?.value || "";
    const end = document.getElementById("end")?.value || "";
    const pickupDate = document.getElementById("pickupDate")?.value || "";
    const pickupTime = document.getElementById("pickupTime")?.value || "";
    const waypoints = [];
    document.querySelectorAll("#stops-container input").forEach((i) => {
      if (i.value.trim() !== "") waypoints.push(i.value.trim());
    });
    const vehicle = document.querySelector('input[name="vehicle"]:checked')?.value || "berline";

    payload = {
      contact,
      trip: { start, end, waypoints, pickupDate, pickupTime, vehicle },
    };
  }

  if (!payload || !payload.contact) {
    if (resultEl) resultEl.innerHTML = "Impossible d'envoyer la réservation : informations manquantes.";
    return;
  }

  btn.disabled = true;
  const oldText = btn.innerText;
  btn.innerText = "Envoi...";
  btn.style.opacity = 0.6;

  try {
    const resp = await fetch("/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) throw new Error("Network response not ok");

    const data = await resp.json();
    if (data && data.ok) {
        if (resultEl) resultEl.innerHTML = "Demande envoyée — nous vous contacterons bientôt.";
        btn.innerText = "Envoyé";
        btn.style.cursor = "default";
        // Show confirmation modal with optional reservation id
        const reservationId = data.reservationId || null;
        showConfirmationModal({
          title: "Réservation reçue",
          message: reservationId
            ? `Votre demande a été enregistrée (ID: ${reservationId}). Nous vous contacterons bientôt.`
            : "Votre demande a été enregistrée. Nous vous contacterons bientôt.",
        });
    } else {
      throw new Error("Server error");
    }
  } catch (err) {
    console.error("Erreur envoi réservation:", err);
    if (resultEl) resultEl.innerHTML = "Une erreur est survenue lors de l'envoi. Veuillez réessayer.";
    btn.disabled = false;
    btn.innerText = oldText;
    btn.style.opacity = 1;
  }
}

/* --------------------------
   MODAL DE CONFIRMATION
--------------------------- */
function createConfirmationModal() {
  if (document.getElementById("vtc-confirmation-modal")) return;

  const modal = document.createElement("div");
  modal.id = "vtc-confirmation-modal";
  modal.style = `position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);z-index:9999;`;

  const card = document.createElement("div");
  card.style = `background:#fff;padding:20px;border-radius:12px;max-width:480px;width:90%;box-shadow:0 8px 30px rgba(0,0,0,0.2);font-family:Inter, sans-serif;`;

  const title = document.createElement("h3");
  title.id = "vtc-confirmation-title";
  title.style = "margin:0 0 8px;font-size:18px;";
  title.textContent = "Réservation";

  const msg = document.createElement("p");
  msg.id = "vtc-confirmation-message";
  msg.style = "margin:0 0 12px;opacity:0.9;";
  msg.textContent = "Merci — votre demande a été envoyée.";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Fermer";
  closeBtn.style = "padding:10px 14px;background:#000;color:#fff;border:none;border-radius:8px;cursor:pointer;";
  closeBtn.onclick = () => hideConfirmationModal();

  card.appendChild(title);
  card.appendChild(msg);
  card.appendChild(closeBtn);
  modal.appendChild(card);
  document.body.appendChild(modal);
}

function showConfirmationModal({ title, message }) {
  const modal = document.getElementById("vtc-confirmation-modal");
  if (!modal) return;
  const t = document.getElementById("vtc-confirmation-title");
  const m = document.getElementById("vtc-confirmation-message");
  if (t) t.textContent = title || "Réservation";
  if (m) m.textContent = message || "Merci — votre demande a été envoyée.";
  modal.style.display = "flex";
}

function hideConfirmationModal() {
  const modal = document.getElementById("vtc-confirmation-modal");
  if (modal) modal.style.display = "none";
}

