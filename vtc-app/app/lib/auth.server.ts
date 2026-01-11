import { redirect } from "react-router";
import { createSupabaseServerClient } from "./supabase.server";

export async function requireUser(request: Request) {
  const { supabase, headers } = createSupabaseServerClient(request);

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    // Do not leak details.
    throw redirect("/login", { headers });
  }

  if (!user) {
    throw redirect("/login", { headers });
  }

  return { supabase, headers, user };
}

export async function getOptionalUser(request: Request) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, headers, user: user ?? null };
}
