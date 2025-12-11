import React from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const reservations = await db.reservation.findMany({ orderBy: { createdAt: "desc" } });

  return { reservations };
};

export default function Reservations() {
  const { reservations } = useLoaderData();

  return (
    <div style={{ padding: 24 }}>
      <h1>Réservations VTC</h1>
      <p>Liste des demandes reçues (dernières en premier)</p>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
        <thead>
          <tr>
            <th style={{ borderBottom: "1px solid #ddd", textAlign: "left", padding: 8 }}>ID</th>
            <th style={{ borderBottom: "1px solid #ddd", textAlign: "left", padding: 8 }}>Client</th>
            <th style={{ borderBottom: "1px solid #ddd", textAlign: "left", padding: 8 }}>Téléphone / Email</th>
            <th style={{ borderBottom: "1px solid #ddd", textAlign: "left", padding: 8 }}>Trajet</th>
            <th style={{ borderBottom: "1px solid #ddd", textAlign: "left", padding: 8 }}>Date</th>
            <th style={{ borderBottom: "1px solid #ddd", textAlign: "left", padding: 8 }}>Prix</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((r) => (
            <tr key={r.id}>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{r.id}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{r.name}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>
                {r.phone}
                <br />
                {r.email}
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>
                <strong>{r.start}</strong>
                <br />
                → {r.end}
                {r.waypoints && Array.isArray(r.waypoints) && r.waypoints.length > 0 ? (
                  <div style={{ marginTop: 6 }}>Arrêts: {r.waypoints.join(" / ")}</div>
                ) : null}
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{r.pickupDate} {r.pickupTime}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{r.price ?? "-"} €</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
