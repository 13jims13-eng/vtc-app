import nodemailer from "nodemailer";
import prisma from "../db.server";

const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const { contact, trip } = req.body || {};

    const subject = `Nouvelle demande de trajet - ${trip?.pickupDate || ""} ${
      trip?.pickupTime || ""
    }`;

    const text = `
Nouvelle demande de trajet :

Client :
- Nom : ${contact?.name || ""}
- Email : ${contact?.email || ""}
- Téléphone : ${contact?.phone || ""}

Trajet :
- Date : ${trip?.pickupDate || ""}
- Heure : ${trip?.pickupTime || ""}
- Départ : ${trip?.start || ""}
- Arrivée : ${trip?.end || ""}
- Arrêts : ${(trip?.waypoints || []).join(" / ")}
- Distance : ${trip?.distanceKm || ""} km
- Durée : ${trip?.durationMinutes || ""} min
- Véhicule : ${trip?.vehicle || ""}
- Prix estimé : ${trip?.price || ""} €
`;

    const html = `
      <h2>Nouvelle demande de trajet</h2>
      <h3>Client</h3>
      <ul>
        <li><strong>Nom :</strong> ${contact?.name || ""}</li>
        <li><strong>Email :</strong> ${contact?.email || ""}</li>
        <li><strong>Téléphone :</strong> ${contact?.phone || ""}</li>
      </ul>

      <h3>Trajet</h3>
      <ul>
        <li><strong>Date :</strong> ${trip?.pickupDate || ""}</li>
        <li><strong>Heure :</strong> ${trip?.pickupTime || ""}</li>
        <li><strong>Départ :</strong> ${trip?.start || ""}</li>
        <li><strong>Arrivée :</strong> ${trip?.end || ""}</li>
        <li><strong>Arrêts :</strong> ${(trip?.waypoints || []).join(
          " / "
        )}</li>
        <li><strong>Distance :</strong> ${trip?.distanceKm || ""} km</li>
        <li><strong>Durée :</strong> ${
          trip?.durationMinutes || ""
        } min</li>
        <li><strong>Véhicule :</strong> ${trip?.vehicle || ""}</li>
        <li><strong>Prix estimé :</strong> ${trip?.price || ""} €</li>
      </ul>
    `;

    await transporter.sendMail({
      from: `"VTC Smart Booking" <${SMTP_USER}>`,
      to: SMTP_USER, // plus tard: email du chauffeur
      subject,
      text,
      html,
    });

    // Persist reservation in DB (non-blocking but report errors)
    let createdReservation = null;
    try {
      createdReservation = await prisma.reservation.create({
        data: {
          name: contact?.name || "",
          email: contact?.email || "",
          phone: contact?.phone || "",
          start: trip?.start || "",
          end: trip?.end || "",
          waypoints: trip?.waypoints || [],
          pickupDate: trip?.pickupDate || "",
          pickupTime: trip?.pickupTime || "",
          distanceKm: trip?.distanceKm || undefined,
          durationMinutes: trip?.durationMinutes || undefined,
          vehicle: trip?.vehicle || "",
          price: trip?.price || undefined,
        },
      });
    } catch (dbErr) {
      console.error("Erreur sauvegarde reservation Prisma:", dbErr);
    }
    return res.status(200).json({ ok: true, reservationId: createdReservation?.id || null });
  } catch (error) {
    console.error("Erreur envoi email lead :", error);
    return res.status(500).json({ ok: false, error: "MAIL_ERROR" });
  }
}
