import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, data as rrData, redirect, useLoaderData } from "react-router";
import { requireUser } from "../lib/auth.server";
import { cleanText } from "../lib/bookingNotify.server";

type LoaderData = {
  email: string;
  notifications: Array<{ id: string; created_at: string; title: string; body: string; read_at: string | null }>;
  bookings: Array<{
    id: string;
    created_at: string;
    pickup: string;
    dropoff: string;
    when: string;
    price: string;
    status: string;
  }>;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { supabase, headers, user } = await requireUser(request);
  const email = cleanText(user.email) || "";

  if (!email) {
    throw redirect("/login", { headers });
  }

  const notifRes = await supabase
    .from("notifications")
    .select("id,created_at,title,body,read_at")
    .eq("recipient_email", email)
    .order("created_at", { ascending: false })
    .limit(20);

  // Compat: certaines tables utilisent customer_email, d'autres contact_email.
  const bookingsRes = await supabase
    .from("bookings")
    .select(
      "id,status,created_at,datetime,pickup,dropoff,price,price_total,start,end,pickup_date,pickup_time,customer_email,contact_email",
    )
    .or(`customer_email.eq.${email},contact_email.eq.${email}`)
    .order("created_at", { ascending: false })
    .limit(50);

  const bookings = ((bookingsRes.data as any[]) || []).map((b) => {
    const pickup = cleanText(b.pickup) || cleanText(b.start) || "";
    const dropoff = cleanText(b.dropoff) || cleanText(b.end) || "";

    const when =
      cleanText(b.datetime) ||
      [cleanText(b.pickup_date), cleanText(b.pickup_time)].filter(Boolean).join(" ") ||
      cleanText(b.created_at) ||
      "";

    const priceNum =
      typeof b.price === "number"
        ? b.price
        : b.price_total != null
          ? Number(b.price_total)
          : b.price != null
            ? Number(b.price)
            : null;

    return {
      id: String(b.id),
      created_at: String(b.created_at || ""),
      pickup,
      dropoff,
      when,
      price: priceNum == null ? "" : `${priceNum.toFixed(2)} €`,
      status: String(b.status || ""),
    };
  });

  return rrData(
    {
      email,
      notifications:
        (notifRes.data as any[])?.map((n) => ({
          id: String(n.id),
          created_at: String(n.created_at || ""),
          title: String(n.title || ""),
          body: String(n.body || ""),
          read_at: n.read_at ? String(n.read_at) : null,
        })) ?? [],
      bookings,
    } satisfies LoaderData,
    { headers },
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { supabase, headers, user } = await requireUser(request);
  const email = cleanText(user.email) || "";
  const form = await request.formData();
  const intent = cleanText(form.get("intent"));

  if (intent === "mark_notif_read") {
    const notificationId = cleanText(form.get("notification_id"));
    if (!notificationId) {
      return rrData({ ok: false as const, error: "notification_id requis" }, { status: 400, headers });
    }

    const res = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_email", email)
      .eq("id", notificationId);

    if (res.error) {
      return rrData({ ok: false as const, error: res.error.message }, { status: 400, headers });
    }

    throw redirect("/client/courses", { headers });
  }

  return rrData({ ok: false as const, error: "Action invalide" }, { status: 400, headers });
};

export default function ClientCourses() {
  const data = useLoaderData<typeof loader>();

  return (
    <main style={{ maxWidth: 900, margin: "24px auto", padding: 16 }}>
      <h1>Mes courses</h1>
      <p style={{ opacity: 0.75 }}>Connecté en tant que {data.email}</p>

      <section style={{ marginTop: 18 }}>
        <h2 style={{ margin: "0 0 10px" }}>Notifications</h2>
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
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ margin: "0 0 10px" }}>Courses</h2>
        {data.bookings.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Quand</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Trajet</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Prix</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.bookings.map((b) => (
                <tr key={b.id}>
                  <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{b.when}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>
                    <div>
                      <b>{b.pickup}</b>
                    </div>
                    <div>→ {b.dropoff}</div>
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{b.price}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{b.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ opacity: 0.75 }}>Aucune course pour le moment.</div>
        )}
      </section>
    </main>
  );
}
