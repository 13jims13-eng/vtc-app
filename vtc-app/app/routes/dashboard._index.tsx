import type { LoaderFunctionArgs } from "react-router";
import { Link, data as rrData, redirect, useLoaderData } from "react-router";
import { requireUser } from "../lib/auth.server";
import { getDriverProfileAndSettings, isOnboardingComplete } from "../lib/driver.server";

type LoaderData = {
  bookingsCount: number;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { supabase, headers, user } = await requireUser(request);
  const { profile, settingsPublic } = await getDriverProfileAndSettings(supabase, user.id);
  if (!isOnboardingComplete(profile, settingsPublic)) throw redirect("/onboarding", { headers });

  const countRes = await supabase.from("bookings").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  const bookingsCount = typeof countRes.count === "number" ? countRes.count : 0;

  return rrData({ bookingsCount } satisfies LoaderData, { headers });
};

export default function DashboardIndex() {
  const { bookingsCount } = useLoaderData<typeof loader>();

  return (
    <section style={{ display: "grid", gap: 12 }}>
      <h2>Résumé</h2>
      <p style={{ margin: 0 }}>Réservations: {bookingsCount}</p>
      <p style={{ margin: 0 }}>
        <Link to="/dashboard/settings">Aller aux réglages</Link>
      </p>
    </section>
  );
}
