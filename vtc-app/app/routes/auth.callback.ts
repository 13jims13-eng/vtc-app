import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createSupabaseServerClient } from "../lib/supabase.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorDescription = url.searchParams.get("error_description");

  if (errorDescription) {
    const message = encodeURIComponent(errorDescription);
    throw redirect(`/login?error=${message}`);
  }

  if (!code) {
    throw redirect("/login?error=Code%20manquant");
  }

  const { supabase, headers } = createSupabaseServerClient(request);
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const message = encodeURIComponent(error.message);
    throw redirect(`/login?error=${message}`);
  }

  throw redirect("/dashboard", { headers });
};
