import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, Outlet, data as rrData, redirect, useLoaderData } from "react-router";
import { requireUser } from "../lib/auth.server";
import { getDriverProfileAndSettings, isOnboardingComplete } from "../lib/driver.server";

type LoaderData = { email: string; companyName: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { headers, user, supabase } = await requireUser(request);

  const { profile, settingsPublic } = await getDriverProfileAndSettings(supabase, user.id);

  if (!isOnboardingComplete(profile, settingsPublic)) {
    throw redirect("/onboarding", { headers });
  }

  return rrData(
    { email: user.email || "", companyName: String(settingsPublic.company_name || "") } satisfies LoaderData,
    { headers },
  );
};

export default function DashboardLayout() {
  const { email, companyName } = useLoaderData<typeof loader>();

  return (
    <main style={{ maxWidth: 980, margin: "24px auto", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Private Driver Book</h1>
          <div style={{ opacity: 0.7, fontSize: 14 }}>
            {companyName ? `${companyName} · ` : ""}
            {email}
          </div>
        </div>
        <nav style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link to="/dashboard/settings">Réglages</Link>
          <Link to="/dashboard/bookings">Réservations</Link>
          <Form method="post" action="/logout" style={{ margin: 0 }}>
            <button type="submit">Déconnexion</button>
          </Form>
        </nav>
      </header>

      <hr style={{ margin: "16px 0" }} />

      <Outlet />
    </main>
  );
}

export const action = async ({ request }: ActionFunctionArgs) => {
  // Aucune action ici (évite un 405 noisy si quelqu’un POST sur /dashboard).
  const { headers } = await requireUser(request);
  throw redirect("/dashboard/settings", { headers });
};
