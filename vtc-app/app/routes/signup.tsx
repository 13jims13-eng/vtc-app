import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData } from "react-router";
import { getOptionalUser } from "../lib/auth.server";
import { createSupabaseServerClient } from "../lib/supabase.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user, headers } = await getOptionalUser(request);
  if (user) throw redirect("/dashboard", { headers });
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");

  const { supabase, headers } = createSupabaseServerClient(request);

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    return { ok: false as const, error: error.message };
  }

  // Si une session est créée immédiatement, on peut continuer.
  if (data.session) {
    throw redirect("/onboarding", { headers });
  }

  return {
    ok: true as const,
    notice: "Compte créé. Vérifiez votre email pour confirmer/terminer la connexion, puis connectez-vous.",
  };
};

export default function Signup() {
  const actionData = useActionData<typeof action>();

  return (
    <main style={{ maxWidth: 480, margin: "40px auto", padding: 16 }}>
      <h1>Créer un compte</h1>

      <Form method="post" style={{ display: "grid", gap: 12 }}>
        <label>
          Email
          <input name="email" type="email" required style={{ width: "100%" }} />
        </label>
        <label>
          Mot de passe
          <input name="password" type="password" required minLength={8} style={{ width: "100%" }} />
        </label>
        <button type="submit">Créer</button>
      </Form>

      {actionData && "error" in actionData ? <p style={{ color: "crimson" }}>{actionData.error}</p> : null}
      {actionData && "notice" in actionData ? <p style={{ color: "green" }}>{actionData.notice}</p> : null}

      <p style={{ marginTop: 12 }}>
        Déjà un compte ? <Link to="/login">Se connecter</Link>
      </p>
    </main>
  );
}
