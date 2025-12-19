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
- `DATABASE_URL`

### Email (si utilisé)

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE` (`true`/`false`)
- `SMTP_USER`
- `SMTP_PASS`
- `BOOKING_EMAIL_FROM`
- `BOOKING_EMAIL_TO`

### Slack (optionnel)

- `SLACK_WEBHOOK_URL`

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

## 4) App Proxy: mapping recommandé

Dans `shopify.app.toml`, la section `[app_proxy]` doit rester cohérente:

- `prefix = "apps"`
- `subpath = "vtc"`

Cela signifie:

- URL storefront côté boutique: `/apps/vtc/...`
- Route backend côté app: `/apps/vtc/...`

Routes implémentées côté app:

- Healthcheck: `GET /healthz`
- Booking notify App Proxy: `POST /apps/vtc/api/booking-notify`

## 5) Sécurité: signature App Proxy

Les routes App Proxy valident la signature Shopify via HMAC avant traitement.

- Si la signature est absente/invalide: `401 Unauthorized`
- Si `SHOPIFY_API_SECRET` est manquant côté serveur: `500` avec logs explicites (sans afficher le secret)

## 6) Debug rapide (prod)

1) Vérifier healthcheck:

- `GET https://vtc-app-calculator.onrender.com/healthz` doit répondre `200 { ok: true, ... }`

2) Vérifier App Proxy:

- Depuis la boutique, déclencher l'appel du thème: `POST /apps/vtc/api/booking-notify`
- Sur Render, logs attendus:
  - `notify hit` + ensuite `incoming payload ok` puis `email ok` / `slack ok|skip`

Si vous voyez `Unauthorized`:
- App Proxy pas configuré ou mauvaise `application_url`
- `shopify.app.toml` non synchronisé / non déployé
- signature bloquée (URL pas passée par Shopify)
