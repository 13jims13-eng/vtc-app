import { createBrowserClient } from "@supabase/ssr";

type PublicEnv = {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
};

declare global {
  interface Window {
    ENV?: Partial<PublicEnv>;
  }
}

export function createSupabaseBrowserClient() {
  const url = String(window.ENV?.SUPABASE_URL || "");
  const key = String(window.ENV?.SUPABASE_PUBLISHABLE_KEY || "");

  if (!url || !key) {
    throw new Error("Missing public Supabase env (SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY)");
  }

  return createBrowserClient(url, key);
}
