import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import { getSupabasePublicConfig, getSupabaseSecretKeyOptional, getSupabaseSecretKeyRequired } from "./supabaseEnv.server";

type CookieToSet = {
  name: string;
  value: string;
  options?: Parameters<typeof serializeCookie>[2];
};

function getCookies(request: Request) {
  const header = request.headers.get("Cookie") || "";
  return parseCookie(header);
}

export function createSupabaseServerClient(request: Request) {
  const { url, publishableKey } = getSupabasePublicConfig();

  const responseHeaders = new Headers();
  const cookies = getCookies(request);

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return Object.entries(cookies).map(([name, value]) => ({ name, value }));
      },
      setAll(
        toSet: Array<{
          name: string;
          value: string;
          options?: Parameters<typeof serializeCookie>[2];
        }>,
      ) {
        // React Router: we collect Set-Cookie headers and return them to the caller.
        const items: CookieToSet[] = toSet.map((c) => ({ name: c.name, value: c.value, options: c.options }));

        for (const item of items) {
          responseHeaders.append(
            "Set-Cookie",
            serializeCookie(item.name, item.value, {
              path: "/",
              sameSite: "lax",
              httpOnly: true,
              secure: String(process.env.NODE_ENV || "").toLowerCase() === "production",
              ...item.options,
            }),
          );
        }
      },
    },
  });

  return { supabase, headers: responseHeaders };
}

export function createSupabaseServiceClient() {
  const { url } = getSupabasePublicConfig();
  const secretKey = getSupabaseSecretKeyRequired();
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createSupabaseServiceClientOptional() {
  const { url } = getSupabasePublicConfig();
  const secretKey = getSupabaseSecretKeyOptional();
  if (!secretKey) return null;
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
