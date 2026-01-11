# Mobile (Expo) — wrapper WebView

Objectif: publier une app iOS/Android rapidement **sans casser** le widget Shopify existant.

L'app mobile charge simplement une URL (page Shopify ou page sur ton domaine) qui contient le widget.

## Prérequis
- Node.js
- Expo CLI (via npx)

## Setup
```bash
cd "../vtc-app/mobile"
npm install
```

Créer `mobile/.env` à partir de `mobile/.env.example` et définir:
- `EXPO_PUBLIC_WIDGET_URL=https://<ta-boutique>.myshopify.com/pages/reservation`

## Lancer en dev
```bash
npm run start
```

## Build stores (plus tard)
Recommandé: EAS Build.
```bash
npx expo login
npx eas build:configure
npx eas build --platform android
npx eas build --platform ios
```

Notes:
- Cette approche réutilise la mécanique Shopify (App Proxy, emails, Slack) telle qu'elle existe déjà.
- Quand tu voudras du “vrai Uber/Bolt” (Maps natif, tracking, push, comptes), on fera une app native qui appelle directement l'API publique `/create-booking`.
