import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, data as rrData, redirect, useActionData, useLoaderData } from "react-router";
import { requireUser } from "../lib/auth.server";
import { cleanText } from "../lib/bookingNotify.server";
import { encryptSlackWebhookForSettings, getDriverProfileAndSettings, isOnboardingComplete } from "../lib/driver.server";

type LoaderData = {
  email: string;
  profileFullName: string;
  phone: string;
  companyName: string;
  bookingEmailTo: string;
  themeName: string;
  primaryColor: string;
  logoUrl: string;
  slackConnected: boolean;
  slackLast6: string | null;
  vehicles: Array<{ id: string; name: string; plate: string | null; photo_url: string | null }>;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { supabase, headers, user } = await requireUser(request);

  const { profile, settingsPublic } = await getDriverProfileAndSettings(supabase, user.id);
  if (!isOnboardingComplete(profile, settingsPublic)) throw redirect("/onboarding", { headers });

  const vehiclesRes = await supabase
    .from("vehicles")
    .select("id,name,plate,photo_url")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const data: LoaderData = {
    email: user.email || "",
    profileFullName: String(profile?.full_name || ""),
    phone: String(profile?.phone || ""),
    companyName: String(settingsPublic.company_name || ""),
    bookingEmailTo: String(settingsPublic.booking_email_to || ""),
    themeName: String(settingsPublic.theme_name || ""),
    primaryColor: String(settingsPublic.primary_color || ""),
    logoUrl: String(settingsPublic.logo_url || ""),
    slackConnected: settingsPublic.slack.connected,
    slackLast6: settingsPublic.slack.last6,
    vehicles: (vehiclesRes.data as any[])?.map((v) => ({
      id: String(v.id),
      name: String(v.name || ""),
      plate: v.plate ? String(v.plate) : null,
      photo_url: v.photo_url ? String(v.photo_url) : null,
    })) ?? [],
  };

  return rrData(data, { headers });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { supabase, headers, user } = await requireUser(request);

  const { profile, settingsPublic } = await getDriverProfileAndSettings(supabase, user.id);
  if (!isOnboardingComplete(profile, settingsPublic)) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const intent = String(form.get("_intent") || "");

  if (intent === "save_settings") {
    const bookingEmailTo = String(form.get("booking_email_to") || "").trim();
    const themeName = String(form.get("theme_name") || "").trim();
    const primaryColor = String(form.get("primary_color") || "").trim();
    const logoUrl = String(form.get("logo_url") || "").trim();

    const upsertRes = await supabase
      .from("driver_settings")
      .upsert(
        {
          user_id: user.id,
          booking_email_to: bookingEmailTo || null,
          theme_name: themeName || null,
          primary_color: primaryColor || null,
          logo_url: logoUrl || null,
        },
        { onConflict: "user_id" },
      );

    if (upsertRes.error) {
      return rrData({ ok: false as const, error: upsertRes.error.message }, { status: 400, headers });
    }

    throw redirect("/dashboard/settings", { headers });
  }

  if (intent === "add_vehicle") {
    const name = cleanText(form.get("name"));
    const plate = cleanText(form.get("plate"));
    const photoUrl = cleanText(form.get("photo_url"));

    if (!name) {
      return rrData({ ok: false as const, error: "Nom véhicule requis" }, { status: 400, headers });
    }

    const res = await supabase.from("vehicles").insert({
      user_id: user.id,
      name,
      plate: plate || null,
      photo_url: photoUrl || null,
    });

    if (res.error) {
      return rrData({ ok: false as const, error: res.error.message }, { status: 400, headers });
    }

    throw redirect("/dashboard/settings", { headers });
  }

  if (intent === "delete_vehicle") {
    const id = cleanText(form.get("id"));
    if (!id) {
      return rrData({ ok: false as const, error: "id véhicule requis" }, { status: 400, headers });
    }

    const res = await supabase.from("vehicles").delete().eq("user_id", user.id).eq("id", id);
    if (res.error) {
      return rrData({ ok: false as const, error: res.error.message }, { status: 400, headers });
    }

    throw redirect("/dashboard/settings", { headers });
  }

  if (intent === "save_slack") {
    const webhookRaw = String(form.get("slack_webhook") || "").trim();

    if (!webhookRaw) {
      const res = await supabase
        .from("driver_settings")
        .upsert({ user_id: user.id, slack_webhook_url: null }, { onConflict: "user_id" });
      if (res.error) return rrData({ ok: false as const, error: res.error.message }, { status: 400, headers });
      throw redirect("/dashboard/settings", { headers });
    }

    const enc = encryptSlackWebhookForSettings(webhookRaw);
    if (!enc.ok) {
      return rrData({ ok: false as const, error: `Webhook Slack invalide: ${enc.error}` }, { status: 400, headers });
    }

    const upsert = await supabase
      .from("driver_settings")
      .upsert({ user_id: user.id, slack_webhook_url: enc.encrypted }, { onConflict: "user_id" });
    if (upsert.error) {
      return rrData({ ok: false as const, error: upsert.error.message }, { status: 400, headers });
    }

    throw redirect("/dashboard/settings", { headers });
  }

  return rrData({ ok: false as const, error: "Action inconnue" }, { status: 400, headers });
};

export default function DashboardSettings() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <section style={{ display: "grid", gap: 24 }}>
      <div>
        <h2>Réglages</h2>
        <p style={{ marginTop: 0, opacity: 0.75 }}>
          {data.companyName} · {data.email}
        </p>

        <Form method="post" style={{ display: "grid", gap: 12, maxWidth: 680 }}>
          <input type="hidden" name="_intent" value="save_settings" />

          <label>
            Email de notification (TO)
            <input name="booking_email_to" defaultValue={data.bookingEmailTo} style={{ width: "100%" }} />
          </label>

          <label>
            Thème
            <input name="theme_name" defaultValue={data.themeName} style={{ width: "100%" }} />
          </label>

          <label>
            Couleur principale
            <input name="primary_color" defaultValue={data.primaryColor} style={{ width: "100%" }} />
          </label>

          <label>
            Logo URL
            <input name="logo_url" defaultValue={data.logoUrl} style={{ width: "100%" }} />
          </label>

          <button type="submit">Enregistrer</button>
        </Form>

        {actionData && "error" in actionData ? <p style={{ color: "crimson" }}>{actionData.error}</p> : null}
      </div>

      <div>
        <h2>Véhicules</h2>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>nom</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>plaque</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>photo</th>
              <th style={{ borderBottom: "1px solid #ddd", padding: 8 }} />
            </tr>
          </thead>
          <tbody>
            {data.vehicles.map((v) => (
              <tr key={String(v.id)}>
                <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{String(v.name || "")}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{String(v.plate || "")}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{String(v.photo_url || "")}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>
                  <Form method="post">
                    <input type="hidden" name="_intent" value="delete_vehicle" />
                    <input type="hidden" name="id" value={String(v.id)} />
                    <button type="submit">Supprimer</button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Ajouter</h3>
        <Form method="post" style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(3, 1fr)", alignItems: "end" }}>
          <input type="hidden" name="_intent" value="add_vehicle" />
          <label>
            nom
            <input name="name" required />
          </label>
          <label>
            plaque
            <input name="plate" />
          </label>
          <label>
            photo_url
            <input name="photo_url" />
          </label>
          <button type="submit" style={{ gridColumn: "1 / span 3" }}>
            Ajouter
          </button>
        </Form>
      </div>

      <div>
        <h2>Intégrations</h2>
        <p>
          Slack: {data.slackConnected ? `connecté (…${data.slackLast6 || "??????"})` : "non configuré"}
        </p>

        <Form method="post" style={{ display: "grid", gap: 8, maxWidth: 680 }}>
          <input type="hidden" name="_intent" value="save_slack" />
          <label>
            Coller un nouveau webhook (vide = supprimer)
            <input name="slack_webhook" style={{ width: "100%" }} placeholder="https://hooks.slack.com/services/..." />
          </label>
          <button type="submit">Enregistrer Slack</button>
        </Form>
      </div>
    </section>
  );
}
