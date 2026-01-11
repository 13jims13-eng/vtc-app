# Private Driver Book — MVP Supabase (multi-chauffeurs)

## Objectif
- Dashboard web minimal (auth + onboarding + réglages + réservations).
- API backend `POST /create-booking` (slug chauffeur → calcule prix côté serveur → enregistre booking → notifie email + Slack).
- Sécurité: RLS + Service Role uniquement côté serveur, webhook Slack validé/normalisé et jamais renvoyé au front.

## Démarrage local
1) Dans `vtc-app/`, copier l’exemple d’env:
- `cp .env.example .env` (ou créer `.env` manuellement sous Windows)

2) Renseigner au minimum:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `BOOKING_EMAIL_FROM`
- `CONFIG_ENCRYPTION_KEY` (obligatoire si vous activez Slack)

3) Installer & lancer:
- `npm install`
- `npm run dev`

Endpoints:
- Dashboard: `http://localhost:3000/`
- Healthcheck: `GET /healthz`
- API: `POST /create-booking`

## Parcours MVP (manuel)
1) Créer un compte:
- Ouvrir `/signup` (email/password)

2) Se connecter:
- `/login`

3) Onboarding (création tenant):
- `/onboarding`
- Remplit `name`, `slug`, `fullName`
- Appelle la fonction SQL Supabase `create_tenant_and_profile(name, slug, fullName)`

4) Configurer le tenant:
- `/dashboard/settings`
- `tenant_settings.booking_email_to`: destinataire des emails de réservation
- `tenant_settings.*`: pricing (stop fee, quote message, lead-time, majorations)
- `tenant_settings.options`: JSON array d’options (MVP)
- `vehicles`: ajouter les véhicules (`id`, `label`, `base_fare`, `price_per_km`, `quote_only`)
- `tenant_integrations` (Slack): coller un webhook → stocké chiffré (mask affiché)

5) Voir / gérer les bookings:
- `/dashboard/bookings`
- Liste + changement de statut (`new/confirmed/cancelled/done`)

## Test API /create-booking
Pré-requis: un tenant existe + au moins un véhicule `berline`.

- Lancer le serveur (`npm run dev`)
- Exécuter:
  - `TENANT_SLUG=<slug> npm run test:create-booking`

Variables utiles:
- `BASE_URL` (défaut `http://localhost:3000`)
- `TENANT_SLUG` (défaut `demo`)

## Schéma Supabase attendu (MVP)
Ce code suppose l’existence de ces objets (noms/colonnes) :

### Tables
- `tenants`: `id`, `slug` (unique), `name`
- `profiles`: `id` (auth.users.id), `tenant_id`
- `tenant_settings`:
  - `tenant_id` (unique)
  - `booking_email_to`
  - `stop_fee`, `quote_message`
  - `pricing_behavior` (`normal_prices` | `all_quote` | `lead_time_pricing`)
  - `lead_time_threshold_minutes`
  - `immediate_surcharge_enabled`, `immediate_base_delta_amount`, `immediate_base_delta_percent`, `immediate_total_delta_percent`
  - `options` (jsonb, array)
- `vehicles`:
  - `tenant_id`
  - `id` (string, ex: `berline`, `van`, `autre`)
  - `label`, `base_fare`, `price_per_km`, `quote_only`, `image_url`, `created_at`
- `tenant_integrations`:
  - `tenant_id`
  - `provider` (ex: `slack`) + unique `(tenant_id, provider)`
  - `slack_webhook_encrypted`, `slack_webhook_mask`
- `bookings`:
  - `tenant_id`, `slug`, `status`, `created_at`
  - `contact_name`, `contact_email`, `contact_phone`
  - `start`, `end`, `stops` (json/array)
  - `pickup_date`, `pickup_time`
  - `vehicle_id`, `vehicle_label`, `is_quote`
  - `price_total`, `pricing_mode`, `lead_time_threshold_minutes`, `surcharges_applied` (json)
  - `distance_km`, `duration_minutes`
  - `applied_options` (json), `options_total_fee`
  - `ip`, `user_agent`

### Function SQL
- `create_tenant_and_profile(name, slug, fullName)`

### RLS (exigence)
- Dashboard: requêtes via `SUPABASE_ANON_KEY` + session utilisateur → RLS doit autoriser uniquement le tenant du user.
- API `/create-booking`: utilise `SUPABASE_SERVICE_ROLE_KEY` côté serveur uniquement.

## Références code
- API: `vtc-app/app/routes/create-booking.ts`
- Pricing (source de vérité serveur): `vtc-app/app/lib/pricing.server.ts` (portage depuis le widget)
- Supabase (SSR + service role): `vtc-app/app/lib/supabase.server.ts`
- Dashboard: `vtc-app/app/routes/dashboard.*.tsx`
- Slack: validation `validateSlackWebhookUrl` + chiffrement AES-256-GCM `vtc-app/app/lib/encryption.server.ts`
