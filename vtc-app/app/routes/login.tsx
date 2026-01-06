import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import { getOptionalUser } from "../lib/auth.server";
import { createSupabaseServerClient } from "../lib/supabase.server";

type LoaderData = { errorFromQuery: string | null };
type ActionData = { ok: false; error: string } | { ok: true; notice: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user, headers } = await getOptionalUser(request);
  if (user) throw redirect("/dashboard", { headers });
  const url = new URL(request.url);
  const errorFromQuery = url.searchParams.get("error");
  return { errorFromQuery } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const intent = String(form.get("_intent") || "password");
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");

  const { supabase, headers } = createSupabaseServerClient(request);

  if (intent === "magic") {
    if (!email) return { ok: false as const, error: "Email requis" };

    const url = new URL(request.url);
    const emailRedirectTo = `${url.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo },
    });
    if (error) return { ok: false as const, error: error.message };

    return { ok: true as const, notice: "Lien magique envoyé (si l’email existe)." };
  }

  if (!email || !password) {
    return { ok: false as const, error: "Email et mot de passe requis" };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false as const, error: "Identifiants invalides" };
  }

  throw redirect("/dashboard", { headers });
};

export default function Login() {
  const { errorFromQuery } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <main style={{ maxWidth: 480, margin: "40px auto", padding: 16 }}>
      <h1>Connexion</h1>

      <Form method="post" style={{ display: "grid", gap: 12 }}>
        <label>
          Email
          <input name="email" type="email" required style={{ width: "100%" }} />
        </label>
        <label>
          Mot de passe
          <input name="password" type="password" style={{ width: "100%" }} />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="submit" name="_intent" value="password">
            Se connecter
          </button>
          <button type="submit" name="_intent" value="magic">
            Recevoir un lien magique
          </button>
        </div>
      </Form>

      {errorFromQuery ? <p style={{ color: "crimson" }}>{errorFromQuery}</p> : null}
      {actionData && "error" in actionData ? <p style={{ color: "crimson" }}>{actionData.error}</p> : null}
      {actionData && "notice" in actionData ? <p style={{ color: "green" }}>{actionData.notice}</p> : null}

      <p style={{ marginTop: 12 }}>
        Pas de compte ? <Link to="/signup">Créer un compte</Link>
      </p>
    </main>
  );
}
