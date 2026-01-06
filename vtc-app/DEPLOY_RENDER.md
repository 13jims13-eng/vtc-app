# Déploiement Render (production)

URL prod (Render): `https://vtc-app-calculator.onrender.com`

Objectif: rendre l'App Proxy Shopify fonctionnel pour que le thème puisse appeler:

- `POST /apps/vtc/api/booking-notify` (sur le domaine de la boutique)

et que Shopify forwarde la requête vers le backend Render.

## 1) Variables d'environnement Render

Configurer ces variables (sans jamais commiter de secrets).

### Requis

- `NODE_ENV=production`
- `APP_URL=https://vtc-app-calculator.onrender.com`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SCOPES`

## Base Prisma (sessions Shopify)

- `DATABASE_URL` (Postgres) : utilisé par Prisma (sessions Shopify). Ce n'est pas Supabase.

## Supabase (données app + auth)

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (ou compat `SUPABASE_ANON_KEY`)
- `SUPABASE_SECRET_KEY` (ou compat `SUPABASE_SERVICE_ROLE_KEY`) — serveur uniquement

## Secrets (chiffrement)

- `ENCRYPTION_KEY` (ou compat `CONFIG_ENCRYPTION_KEY`) — requis pour enregistrer Slack chiffré

### Email (si utilisé)

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE` (`true`/`false`)
- `SMTP_USER`
- `SMTP_PASS`
- `BOOKING_EMAIL_FROM`
- `BOOKING_EMAIL_TO`

### Slack (optionnel)

- `ENCRYPTION_KEY` (32 bytes en base64 ou 64 hex chars) — requis si Slack est utilisé
- (fallback DEV uniquement) `ALLOW_DEFAULT_SLACK_FALLBACK=true` + `DEFAULT_SLACK_WEBHOOK_URL`
- (compat legacy) `SLACK_WEBHOOK_URL`

Vérification locale (sans afficher les secrets):

```bash
npm run setup:prod
```

## 2) Build / Start sur Render

Le Blueprint [render.yaml](../render.yaml) configure:

- Build: `npm ci && npm run build`
- Start: `npm run docker-start`

Le serveur écoute sur `process.env.PORT` (Render injecte `PORT`).

## 3) Config Shopify Partners: App URL + Redirect URLs

Si `application_url` ou les `redirect_urls` pointent sur `https://example.com`, Shopify peut afficher "Example Domain" et l'App Proxy peut échouer.

Mettre à jour le fichier `shopify.app.toml` avant déploiement Shopify:

```bash
APP_URL=https://vtc-app-calculator.onrender.com npm run sync:shopify-url
shopify app deploy
```

Valeurs attendues:

- `application_url = "https://vtc-app-calculator.onrender.com"`
- `redirect_urls = [`
  - `"https://vtc-app-calculator.onrender.com/auth/callback"`
  - `"https://vtc-app-calculator.onrender.com/auth/shopify/callback"`
  - `"https://vtc-app-calculator.onrender.com/api/auth/callback"`
  `]`
- `[app_proxy] url = "/apps/vtc"` (Shopify proxy vers `application_url` + ce chemin)

## 4) App Proxy: mapping recommandé

Dans `shopify.app.toml`, la section `[app_proxy]` doit rester cohérente:

- `prefix = "apps"`
- `subpath = "vtc"`

Cela signifie:

- URL storefront côté boutique: `/apps/vtc/...`
- Route backend côté app: `/apps/vtc/...`

Routes implémentées côté app:

- Healthcheck: `GET /healthz`
- Healthcheck App Proxy: `GET /apps/vtc/healthz`
- Booking notify App Proxy: `POST /apps/vtc/api/booking-notify`

## 6) Thème Shopify: bloc + App embed

Après `shopify app deploy` (et si besoin réinstallation de l’app sur la boutique), aller dans:

- **Online Store** → **Themes** → **Customize**

Puis:

- Ajouter le bloc/section dans **Ajouter une section** → **Apps** → **VTC Smart Booking**
- (Optionnel) Activer l’embed dans **App embeds** → **VTC Smart Booking (App embed)**

## 5) Sécurité: signature App Proxy

Les routes App Proxy valident la signature Shopify via HMAC avant traitement.

- Si la signature est absente/invalide: `401 Unauthorized`
- Si `SHOPIFY_API_SECRET` est manquant côté serveur: `500` avec logs explicites (sans afficher le secret)

## 7) Debug rapide (prod)

1) Vérifier healthcheck:

- `GET https://vtc-app-calculator.onrender.com/healthz` doit répondre `200 { ok: true, ... }`

2) Vérifier App Proxy (healthcheck):

- `GET https://<shop>.myshopify.com/apps/vtc/healthz` doit répondre `200 { ok: true, now: ... }`

3) Vérifier App Proxy:

- Depuis la boutique, déclencher l'appel du thème: `POST /apps/vtc/api/booking-notify`
- Sur Render, logs attendus:
  - `notify hit` + ensuite `incoming payload ok` puis `email ok` / `slack ok|skip`

Si vous voyez `Unauthorized`:
- App Proxy pas configuré ou mauvaise `application_url`
- `shopify.app.toml` non synchronisé / non déployé
- signature bloquée (URL pas passée par Shopify)
