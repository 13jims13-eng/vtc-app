import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, data as rrData, redirect, useActionData, useLoaderData } from "react-router";
import { requireUser } from "../lib/auth.server";
import { buildBookingSummary, cleanText } from "../lib/bookingNotify.server";
import { createNotification } from "../lib/notifications.server";
import { getDriverProfileAndSettings, isOnboardingComplete } from "../lib/driver.server";

// TEMP: disable customer-facing emails.
const CUSTOMER_EMAIL_DISABLED = true;

type LoaderData = {
  notifications: Array<{ id: string; created_at: string; title: string; body: string; read_at: string | null }>;
  bookings: Array<{
    id: string;
    created_at: string;
    datetime: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    customer_email: string | null;
    pickup: string | null;
    dropoff: string | null;
    price: number | null;
    status: string;
  }>;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { supabase, headers, user } = await requireUser(request);

  const { profile, settingsPublic } = await getDriverProfileAndSettings(supabase, user.id);
  if (!isOnboardingComplete(profile, settingsPublic)) throw redirect("/onboarding", { headers });

  const notifRes = await supabase
    .from("notifications")
    .select("id,created_at,title,body,read_at")
    .eq("recipient_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const bookingsRes = await supabase
    .from("bookings")
    .select(
      "id,status,created_at,datetime,customer_name,customer_phone,customer_email,contact_email,contact_name,contact_phone,pickup,dropoff,start,end,pickup_date,pickup_time,price,price_total",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const data: LoaderData = {
    notifications:
      (notifRes.data as any[])?.map((n) => ({
        id: String(n.id),
        created_at: String(n.created_at || ""),
        title: String(n.title || ""),
        body: String(n.body || ""),
        read_at: n.read_at ? String(n.read_at) : null,
      })) ?? [],
    bookings:
      (bookingsRes.data as any[])?.map((b) => ({
        id: String(b.id),
        created_at: String(b.created_at || ""),
        datetime: b.datetime ? String(b.datetime) : null,
        customer_name: b.customer_name ? String(b.customer_name) : b.contact_name ? String(b.contact_name) : null,
        customer_phone: b.customer_phone ? String(b.customer_phone) : b.contact_phone ? String(b.contact_phone) : null,
        customer_email: b.customer_email
          ? String(b.customer_email)
          : b.contact_email
            ? String(b.contact_email)
            : null,
        pickup: b.pickup ? String(b.pickup) : b.start ? String(b.start) : null,
        dropoff: b.dropoff ? String(b.dropoff) : b.end ? String(b.end) : null,
        price:
          typeof b.price === "number"
            ? b.price
            : b.price_total != null
              ? Number(b.price_total)
              : b.price != null
                ? Number(b.price)
                : null,
        status: String(b.status || ""),
      })) ?? [],
  };

  return rrData(data, { headers });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { supabase, headers, user } = await requireUser(request);
  const { profile, settingsPublic } = await getDriverProfileAndSettings(supabase, user.id);
  if (!isOnboardingComplete(profile, settingsPublic)) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const intent = cleanText(form.get("intent")) || "update_status";

  if (intent === "mark_notif_read") {
    const notificationId = cleanText(form.get("notification_id"));
    if (!notificationId) {
      return rrData({ ok: false as const, error: "notification_id requis" }, { status: 400, headers });
    }

    const res = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_user_id", user.id)
      .eq("id", notificationId);

    if (res.error) {
      return rrData({ ok: false as const, error: res.error.message }, { status: 400, headers });
    }

    throw redirect("/dashboard/bookings", { headers });
  }

  const bookingId = cleanText(form.get("booking_id"));
  const status = cleanText(form.get("status"));

  if (!bookingId) {
    return rrData({ ok: false as const, error: "booking_id requis" }, { status: 400, headers });
  }

  // Confirmer (optionnel)
  if (intent === "confirm") {
    const bookingRes = await supabase
      .from("bookings")
      .select(
        "id,status,created_at,datetime,customer_name,customer_phone,customer_email,contact_name,contact_phone,contact_email,pickup,dropoff,start,end,pickup_date,pickup_time,price,price_total",
      )
      .eq("user_id", user.id)
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingRes.error || !bookingRes.data) {
      return rrData({ ok: false as const, error: bookingRes.error?.message || "Réservation introuvable" }, { status: 404, headers });
    }

    const b: any = bookingRes.data;
    const clientEmail = cleanText(b.customer_email) || cleanText(b.contact_email) || null;

    const updateRes = await supabase
      .from("bookings")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        confirmed_by_user_id: user.id,
      } as any)
      .eq("user_id", user.id)
      .eq("id", bookingId);

    if (updateRes.error) {
      return rrData({ ok: false as const, error: updateRes.error.message }, { status: 400, headers });
    }

    // Notif in-app chauffeur
    await createNotification({
      recipientUserId: user.id,
      bookingId,
      title: "Réservation confirmée",
      body: `Vous avez confirmé la réservation ${bookingId}.`,
    });

    // Notif client (si on a un email). Email client intentionally disabled.
    if (clientEmail) {
      const summary = buildBookingSummary({
        contact: {
          name: cleanText(b.customer_name) || cleanText(b.contact_name) || "Client",
          email: clientEmail,
          phone: cleanText(b.customer_phone) || cleanText(b.contact_phone) || "",
        },
        trip: {
          start: cleanText(b.pickup) || cleanText(b.start) || "",
          end: cleanText(b.dropoff) || cleanText(b.end) || "",
          pickupDate: cleanText(b.pickup_date) || cleanText(b.datetime) || "",
          pickupTime: cleanText(b.pickup_time) || "",
          price:
            typeof b.price === "number"
              ? b.price
              : b.price_total != null
                ? Number(b.price_total)
                : b.price != null
                  ? Number(b.price)
                  : undefined,
          isQuote: false,
        },
        consents: { termsConsent: true, marketingConsent: false },
      } as any);

      if (!CUSTOMER_EMAIL_DISABLED) {
        // (kept for future re-enable)
      }

      await createNotification({
        recipientEmail: clientEmail,
        bookingId,
        title: "Votre réservation est confirmée",
        body: summary.text,
      });
    }

    throw redirect("/dashboard/bookings", { headers });
  }

  if (!status) {
    return rrData({ ok: false as const, error: "status requis" }, { status: 400, headers });
  }

  const res = await supabase
    .from("bookings")
    .update({ status })
    .eq("user_id", user.id)
    .eq("id", bookingId);

  if (res.error) {
    return rrData({ ok: false as const, error: res.error.message }, { status: 400, headers });
  }

  throw redirect("/dashboard/bookings", { headers });
};

export default function DashboardBookings() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <section>
      <h2>Réservations</h2>

      <div style={{ margin: "12px 0" }}>
        <h3 style={{ margin: "0 0 8px" }}>Notifications</h3>
        {data.notifications.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {data.notifications.map((n) => (
              <div key={n.id} style={{ border: "1px solid #eee", padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <b>{n.title}</b>
                  <span style={{ fontSize: 12, opacity: 0.7 }}>{n.read_at ? "lu" : "nouveau"}</span>
                </div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{n.created_at}</div>
                <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{n.body}</div>
                {!n.read_at ? (
                  <Form method="post" style={{ marginTop: 8 }}>
                    <input type="hidden" name="intent" value="mark_notif_read" />
                    <input type="hidden" name="notification_id" value={n.id} />
                    <button type="submit">Marquer comme lu</button>
                  </Form>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ opacity: 0.75 }}>Aucune notification.</div>
        )}
      </div>

      {actionData && "error" in actionData ? <p style={{ color: "crimson" }}>{actionData.error}</p> : null}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Date</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Client</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Trajet</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Prix</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Statut</th>
            <th style={{ borderBottom: "1px solid #ddd", padding: 8 }} />
          </tr>
        </thead>
        <tbody>
          {data.bookings.map((b) => (
            <tr key={String(b.id)}>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{String(b.datetime || b.created_at || "")}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>
                {String(b.customer_name || "")}
                <div style={{ fontSize: 12, opacity: 0.75 }}>{String(b.customer_phone || "")}</div>
                {b.customer_email ? (
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{String(b.customer_email || "")}</div>
                ) : null}
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>
                <div>
                  <b>{String(b.pickup || "")}</b>
                </div>
                <div>→ {String(b.dropoff || "")}</div>
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>
                {b.price == null ? "" : `${Number(b.price || 0).toFixed(2)} €`}
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{String(b.status || "")}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>
                <Form method="post" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="hidden" name="booking_id" value={String(b.id)} />
                  {String(b.status || "") !== "confirmed" ? (
                    <button type="submit" name="intent" value="confirm">Confirmer</button>
                  ) : null}
                  <select name="status" defaultValue={String(b.status || "") || "new"}>
                    <option value="new">new</option>
                    <option value="confirmed">confirmed</option>
                    <option value="cancelled">cancelled</option>
                    <option value="done">done</option>
                  </select>
                  <button type="submit" name="intent" value="update_status">Mettre à jour</button>
                </Form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
