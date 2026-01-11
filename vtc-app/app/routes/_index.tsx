import { Link, redirect, type LoaderFunctionArgs } from "react-router";
import { getOptionalUser } from "../lib/auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Shopify embedded apps often hit the root with ?shop=...
  // Preserve query params and redirect to the embedded app entry.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  const { user, headers } = await getOptionalUser(request);
  if (user) throw redirect("/dashboard", { headers });
  return null;
};

export default function Index() {
  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: 16 }}>
      <h1>Private Driver Book</h1>
      <p>Dashboard multi-chauffeurs (MVP).</p>
      <p>
        <Link to="/login">Se connecter</Link> · <Link to="/signup">Créer un compte</Link>
      </p>
    </main>
  );
}

