import type { LoaderFunctionArgs } from "react-router";

function jsonResponse(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const requestUrl = new URL(request.url);

  return jsonResponse(
    {
      ok: true,
      service: "vtc-app",
      now: new Date().toISOString(),
      path: requestUrl.pathname,
      endpoints: {
        healthz: "/apps/vtc/healthz",
        bookingNotify: "/apps/vtc/api/booking-notify",
      },
    },
    { status: 200 },
  );
};
