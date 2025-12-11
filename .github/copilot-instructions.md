## Copilot / AI agent instructions for this repository

This repository is a Shopify App using the React Router template with a storefront extension that provides an in-page VTC booking widget.

Keep guidance short and actionable. Inspect these files first to understand behavior and constraints.

- **Big picture**: `app/` contains the server-side React Router Shopify app (authentication, GraphQL/admin usage, webhooks). Extensions live under `extensions/*` (e.g. `extensions/vtc-smart-booking`) and render Liquid blocks + static assets that run in the storefront.

- **Key files to inspect**:
  - `extensions/vtc-smart-booking/blocks/vtc-smart-booking.liquid` — block UI and schema. It defines the `google_maps_api_key` setting and contains the booking form (input IDs: `start`, `end`, `customerName`, `customerEmail`, `customerPhone`, and `reserve-btn`).
  - `extensions/vtc-smart-booking/assets/vtc-booking.js` — client-side logic: `initAutocomplete`, `addStopField`, `validateContactForm`, `calculatePrice`. These functions are attached to `window` and required by the Liquid block.
  - `app/` — server routes and actions. Add server-side handlers here (e.g., `app/routes/reservations.js` or similar) for data capture.
  - `prisma/schema.prisma` and `package.json` — database + scripts. `npm run setup` runs Prisma generate + migrations.

- **Google Maps specifics**:
  - The extension loads Google Maps with `&callback=initAutocomplete`. The callback must exist on `window` (see `vtc-booking.js`).
  - The Google Maps API key is provided via the block schema setting `google_maps_api_key`. Set the key in the block configuration where the extension is used.

- **Data capture (how to wire up form submission)**
  - Frontend: in `vtc-booking.js` add a `fetch()` POST to a server route (example: `/api/reservations`) when `validateContactForm()` passes. Read values by IDs (`start`, `end`, stops in `stops-container`, `customerName`, `customerEmail`, `customerPhone`, vehicle/options inputs).
  - Server: implement an endpoint in `app/routes/` to accept JSON. Use `@prisma/client` (already a dependency) to persist data or use `nodemailer` (already in `package.json`) to send reservation emails. Follow the app auth patterns if admin privileges are required.

- **Scripts & dev workflow**
  - Install deps: `npm install` at repo root.
  - Local dev (app): `npm run dev` → runs `shopify app dev`.
  - Serve the extension UI during extension development: `cd extensions/vtc-smart-booking && shopify extension serve`.
  - DB setup: `npm run setup` (runs Prisma generate + migrate).
  - Build: `npm run build`.

- **Project conventions**
  - Client code that the Liquid block calls must expose functions on `window` (do not rename global functions without updating the Liquid block markup).
  - Sensitive keys are pulled from block `settings` (do not hard-code API keys in assets).
  - Use `app/shopify.server.js` patterns for authentication when creating server-side routes that interact with Shopify admin APIs.

- **Quick checks before edits**
  - Confirm `vtc-booking.js` still sets `window.initAutocomplete`, `window.calculatePrice`, etc., and that the Liquid block's `onclick` attributes match those names.
  - Ensure the Google Maps API key is present in block settings when testing maps.
  - If adding persistence, reuse the existing Prisma setup and run `npm run setup` after changes.

If you want, I can now implement a concrete example: (A) a server route to accept reservation POSTs + minimal Prisma model and client `fetch()` call, or (B) wire a `fetch()` to an existing `app/routes/lead.js` if that route is intended for leads. Tell me which to implement.
