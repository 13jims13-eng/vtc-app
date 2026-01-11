import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, data as rrData, redirect, useActionData, useLoaderData } from "react-router";
import { requireUser } from "../lib/auth.server";
import { getDriverProfileAndSettings, isOnboardingComplete } from "../lib/driver.server";

type LoaderData = {
  email: string;
  fullName: string;
  phone: string;
  companyName: string;
};

type ActionData = { ok: false; error: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { supabase, headers, user } = await requireUser(request);

  const { profile, settingsPublic } = await getDriverProfileAndSettings(supabase, user.id);
  if (isOnboardingComplete(profile, settingsPublic)) {
    throw redirect("/dashboard", { headers });
  }

  return rrData(
    {
      email: user.email || "",
      fullName: String(profile?.full_name || ""),
      phone: String(profile?.phone || ""),
      companyName: String(settingsPublic.company_name || ""),
    } satisfies LoaderData,
    { headers },
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { supabase, headers, user } = await requireUser(request);

  const form = await request.formData();
  const fullName = String(form.get("fullName") || "").trim();
  const phone = String(form.get("phone") || "").trim();
  const companyName = String(form.get("companyName") || "").trim();

  if (!fullName || !companyName) {
    return rrData({ ok: false as const, error: "Nom complet et nom d’entreprise requis." } satisfies ActionData, {
      status: 400,
      headers,
    });
  }

  const profileUpsert = await supabase.from("profiles").upsert(
    {
      id: user.id,
      full_name: fullName,
      phone: phone || null,
    },
    { onConflict: "id" },
  );

  if (profileUpsert.error) {
    return rrData({ ok: false as const, error: profileUpsert.error.message } satisfies ActionData, {
      status: 400,
      headers,
    });
  }

  const settingsUpsert = await supabase.from("driver_settings").upsert(
    {
      user_id: user.id,
      company_name: companyName,
    },
    { onConflict: "user_id" },
  );

  if (settingsUpsert.error) {
    return rrData({ ok: false as const, error: settingsUpsert.error.message } satisfies ActionData, {
      status: 400,
      headers,
    });
  }

  throw redirect("/dashboard", { headers });
};

export default function Onboarding() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <main style={{ maxWidth: 560, margin: "40px auto", padding: 16 }}>
      <h1>Onboarding</h1>
      <p>Compte: {loaderData.email || "(email inconnu)"}</p>

      <Form method="post" style={{ display: "grid", gap: 12 }}>
        <label>
          Nom complet
          <input name="fullName" required defaultValue={loaderData.fullName} style={{ width: "100%" }} />
        </label>
        <label>
          Téléphone (optionnel)
          <input name="phone" defaultValue={loaderData.phone} style={{ width: "100%" }} />
        </label>
        <label>
          Entreprise / chauffeur
          <input name="companyName" required defaultValue={loaderData.companyName} style={{ width: "100%" }} />
        </label>
        <button type="submit">Continuer</button>
      </Form>

      {actionData && "error" in actionData ? <p style={{ color: "crimson" }}>{actionData.error}</p> : null}
    </main>
  );
}
