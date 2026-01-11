import type { LoaderFunctionArgs } from "react-router";

function jsonResponse(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const requestUrl = new URL(request.url);
  console.log("healthz ok", { path: requestUrl.pathname });

  return jsonResponse(
    {
      ok: true,
      service: "vtc-calculateur-de-trajets",
      now: new Date().toISOString(),
    },
    { status: 200 },
  );
};
