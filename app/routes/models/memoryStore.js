// models/memoryStore.js
// Stockage en mémoire pour la version BÊTA (pas encore de vraie base de données)

export const memoryStore = {
  drivers: [],        // liste des chauffeurs
  vehicles: [],       // véhicules reliés à chaque chauffeur
  bookings: [],       // réservations
  settings: {},       // réglages du chauffeur
  pricing: {},        // tarification personnalisée
  pendingBookings: [], // réservations “à valider”
};

// 🔹 Ajouter un chauffeur
export function addDriver(driver) {
  memoryStore.drivers.push(driver);
  return driver;
}

// 🔹 Ajouter un véhicule
export function addVehicle(vehicle) {
  memoryStore.vehicles.push(vehicle);
  return vehicle;
}

// 🔹 Ajouter une réservation
export function addBooking(booking) {
  memoryStore.bookings.push(booking);
  return booking;
}

// 🔹 Ajouter une réservation en attente (paiement espèces ou validation chauffeur)
export function addPendingBooking(booking) {
  memoryStore.pendingBookings.push(booking);
  return booking;
}

// 🔹 Mettre à jour les réglages du chauffeur
export function updateSettings(settings) {
  memoryStore.settings = { ...memoryStore.settings, ...settings };
  return memoryStore.settings;
}

// 🔹 Mettre à jour la tarification
export function updatePricing(pricing) {
  memoryStore.pricing = { ...memoryStore.pricing, ...pricing };
  return memoryStore.pricing;
}
