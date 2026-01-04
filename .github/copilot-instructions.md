# Copilot instructions (vtc-calculateur-de-trajets)

## Where the “real app” lives
- Work primarily in `vtc-calculateur-de-trajets/` (Shopify app + theme extension). The top-level `app/` and `_BACKUP/` are legacy/older copies.
- Render deploy uses the blueprint at `render.yaml` and points `rootDir: vtc-calculateur-de-trajets`.

## Core architecture (Shopify + React Router)
- This is a Shopify app built on `@shopify/shopify-app-react-router` + React Router v7 file routes.
- Routes are generated via `app/routes.ts` using `flatRoutes()`; route files use dot naming (e.g. `apps.vtc.api.booking-notify.ts`).
- Shopify integration is centralized in `app/shopify.server.ts` and uses Prisma session storage.

## Key request flows you must preserve
- **Storefront widget (Theme Extension) → App Proxy → backend**
  - Theme extension block: `extensions/vtc-calculateur/blocks/vtc-calculateur.liquid` renders the widget and exposes config via `data-*` attributes (including `data-booking-email-to`, `data-slack-enabled`, and pricing behavior).
  - App Proxy endpoints live under `/apps/vtc/...` and must validate App Proxy auth.
  - Pattern: App Proxy wrapper route authenticates then delegates to the “real” handler:
    - `app/routes/apps.vtc.api.booking-notify.ts` → delegates to `app/routes/api.booking-notify.ts`
    - `app/routes/apps.vtc.api.slack-booking.ts` → delegates to `app/routes/api.slack-booking.ts`
  - Use `await authenticate.public.appProxy(request)` (from `app/shopify.server.ts`). Keep client error responses minimal; log details server-side.

- **Booking notify (email + optional Slack)**
  - Main handler: `app/routes/api.booking-notify.ts` parses JSON into `BookingNotifyRequestBody`, builds a summary, validates required fields, sends email, then optionally sends Slack.
  - Summary building/validation/email formatting is in `app/lib/bookingNotify.server.ts`.

- **Health checks**
  - `GET /healthz` in `app/routes/healthz.ts`
  - `GET /apps/vtc/healthz` in `app/routes/apps.vtc.healthz.ts`

## Local dev & verification commands (run from vtc-calculateur-de-trajets/)
- Dev (Shopify CLI tunnel + embedded app): `npm run dev` (`shopify app dev`)
- Build server/client: `npm run build`
- Typecheck (includes route typegen): `npm run typecheck`
- Lint: `npm run lint`
- DB/session setup (prod-style migrations): `npm run setup` (runs `prisma generate && prisma migrate deploy`)
- Internal route tests (no App Proxy auth):
  - `node ./scripts/run-booking-notify-client-test.mjs` / `node ./scripts/run-slack-booking-client-test.mjs`
  - `npx tsx ./scripts/run-booking-notify-internal-test.ts` / `npx tsx ./scripts/run-slack-booking-internal-test.ts`

## Environment variables & secrets
- See `.env.example` for SMTP/booking/slack variables.
- Shopify secrets: code accepts `SHOPIFY_API_SECRET_KEY` or `SHOPIFY_API_SECRET` (and warns in production if `APP_URL/SHOPIFY_APP_URL` is missing).
- Slack is optional:
  - `api.slack-booking` requires `SLACK_WEBHOOK_URL`.
  - `api.booking-notify` sends Slack only if enabled and configured.

## Render deployment (production)
- Render build/start:
  - Build: `npm ci && npm run build`
  - Start: `npm run docker-start` (runs `setup` then `start`)
- If the Render URL changes, update Shopify config before deploy:
  - `APP_URL=https://<render-app> npm run sync:shopify-url`
  - then `shopify app deploy`

## Project conventions
- API routes typically return JSON with `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store` (see `jsonResponse` helpers in routes).
- Prefer adding new server-only helpers under `app/lib/*.server.ts` when logic is shared by multiple routes.
