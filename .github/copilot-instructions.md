# Instructions Copilot (Private Driver Book)

## Où travailler
- Code principal: `vtc-app/`.
- `app/` et `_BACKUP/` à la racine sont legacy.

## Architecture (React Router + Supabase)
- Front + serveur: React Router v7 (routes fichiers) dans `vtc-app/app/routes/`.
- Génération des routes: `vtc-app/app/routes.ts` utilise `flatRoutes()` avec une liste `ignoredRouteFiles` (anciens fichiers Shopify).
- Supabase:
  - SSR/dashboard: `vtc-app/app/lib/supabase.server.ts` (ANON + cookies)
  - API backend: `SUPABASE_SERVICE_ROLE_KEY` côté serveur uniquement.

## Flux critiques (MVP)
- **Onboarding**: `/onboarding` appelle `create_tenant_and_profile(name, slug, fullName)`.
- **Réglages tenant**: `/dashboard/settings` gère `tenant_settings`, `vehicles`, `tenant_integrations`.
  - Slack: stocker uniquement `slack_webhook_encrypted` + `slack_webhook_mask` (jamais renvoyer le webhook brut au front).
  - Validation webhook: `validateSlackWebhookUrl()` dans `vtc-app/app/lib/bookingNotify.server.ts`.
  - Chiffrement: AES-256-GCM via `vtc-app/app/lib/encryption.server.ts`.
- **Réservations**: `/dashboard/bookings` liste + update status via RLS.
- **API publique**: `POST /create-booking` dans `vtc-app/app/routes/create-booking.ts`.
  - Entrée: `slug` + coordonnées + trajet.
  - Calcul prix côté serveur: `vtc-app/app/lib/pricing.server.ts` (portage de la logique du widget).
  - Persistance: insert dans `bookings` + `ip`/`user_agent`.
  - Notifications: email + Slack selon la config du tenant (pas de fallback global implicite).

## Commandes utiles (depuis `vtc-app/`)
- Dev: `npm run dev`
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Test manuel API: `TENANT_SLUG=<slug> npm run test:create-booking`

## Conventions
- Réponses JSON: `Content-Type: application/json; charset=utf-8` + `Cache-Control: no-store`.
- Log détaillé côté serveur, erreurs minimales côté client.
