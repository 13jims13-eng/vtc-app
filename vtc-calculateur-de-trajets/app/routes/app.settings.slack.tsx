import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { cleanText, validateSlackWebhookUrl } from "../lib/bookingNotify.server";
import { decryptSecret } from "../lib/encryption.server";
import {
  getSlackConfigForShop,
  upsertSlackDestinations,
  type SlackDestinationKey,
} from "../lib/slackConfig.server";

type LoaderData = {
  defaultDestinationKey: SlackDestinationKey | "";
  destinations: Record<SlackDestinationKey, { name: string; webhookUrl: string }>;
};

type ActionData =
  | { ok: true }
  | {
      ok: false;
      fieldErrors?: Partial<Record<"devis" | "reservations" | "support" | "defaultDestinationKey", string>>;
      error?: string;
    };

const DESTS: Array<{ key: SlackDestinationKey; label: string }> = [
  { key: "devis", label: "devis" },
  { key: "reservations", label: "reservations" },
  { key: "support", label: "support" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const config = await getSlackConfigForShop(shop);

  const byKey = new Map(config?.destinations?.map((d) => [d.key, d]) || []);

  const destinations = {
    devis: { name: "devis", webhookUrl: "" },
    reservations: { name: "reservations", webhookUrl: "" },
    support: { name: "support", webhookUrl: "" },
  } satisfies Record<SlackDestinationKey, { name: string; webhookUrl: string }>;

  for (const { key } of DESTS) {
    const row = byKey.get(key);
    if (!row?.webhookEncrypted) continue;
    try {
      destinations[key] = {
        name: cleanText(row.name) || key,
        webhookUrl: decryptSecret(row.webhookEncrypted),
      };
    } catch {
      // Ne pas exposer d'erreur; on affiche juste vide.
    }
  }

  return {
    defaultDestinationKey: (config?.defaultDestinationKey ?? "") as LoaderData["defaultDestinationKey"],
    destinations,
  } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();

  const defaultDestinationKey = cleanText(form.get("defaultDestinationKey"));
  const fieldErrors: NonNullable<Extract<ActionData, { ok: false }>['fieldErrors']> = {};

  const readDest = (key: SlackDestinationKey) => {
    const webhookUrl = cleanText(form.get(`webhook_${key}`));
    if (webhookUrl) {
      const validation = validateSlackWebhookUrl(webhookUrl);
      if (!validation.ok) {
        fieldErrors[key] = "URL Slack invalide";
      }
    }
    return { key, name: key, webhookUrl };
  };

  const destinations = DESTS.map((d) => readDest(d.key));

  if (defaultDestinationKey && !DESTS.some((d) => d.key === defaultDestinationKey)) {
    fieldErrors.defaultDestinationKey = "Destination invalide";
  }

  if (Object.keys(fieldErrors).length) {
    return { ok: false, fieldErrors } satisfies ActionData;
  }

  try {
    await upsertSlackDestinations({
      shop,
      defaultDestinationKey: (defaultDestinationKey || null) as SlackDestinationKey | null,
      destinations,
    });
    return { ok: true } satisfies ActionData;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("CONFIG_ENCRYPTION_KEY")) {
      return { ok: false, error: "CONFIG_ENCRYPTION_KEY manquant (chiffrement Slack)" } satisfies ActionData;
    }
    return { ok: false, error: "Erreur lors de l’enregistrement" } satisfies ActionData;
  }
};

export default function SlackSettingsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();

  const [defaultDestinationKey, setDefaultDestinationKey] = useState(loaderData.defaultDestinationKey);
  const [devis, setDevis] = useState(loaderData.destinations.devis.webhookUrl);
  const [reservations, setReservations] = useState(loaderData.destinations.reservations.webhookUrl);
  const [support, setSupport] = useState(loaderData.destinations.support.webhookUrl);

  useEffect(() => {
    setDefaultDestinationKey(loaderData.defaultDestinationKey);
    setDevis(loaderData.destinations.devis.webhookUrl);
    setReservations(loaderData.destinations.reservations.webhookUrl);
    setSupport(loaderData.destinations.support.webhookUrl);
  }, [
    loaderData.defaultDestinationKey,
    loaderData.destinations.devis.webhookUrl,
    loaderData.destinations.reservations.webhookUrl,
    loaderData.destinations.support.webhookUrl,
  ]);

  const fieldErrors = actionData && !actionData.ok ? actionData.fieldErrors : undefined;

  const details = useMemo(() => {
    return "Les webhooks Slack sont des secrets: ils sont stockés chiffrés et ne doivent jamais être mis dans le thème.";
  }, []);

  useEffect(() => {
    if (!actionData) return;
    if (actionData.ok) {
      shopify.toast.show("Enregistré");
    } else if (actionData.error) {
      shopify.toast.show(actionData.error);
    } else {
      shopify.toast.show("Erreur");
    }
  }, [actionData, shopify]);

  return (
    <s-page heading="Paramètres Slack">
      <s-section heading="Destinations">
        <Form method="post">
          <s-stack direction="block" gap="base">
            <s-paragraph>{details}</s-paragraph>

            <div>
              <label htmlFor="defaultDestinationKey" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
                Destination par défaut (optionnel)
              </label>
              <select
                id="defaultDestinationKey"
                name="defaultDestinationKey"
                value={defaultDestinationKey}
                onChange={(e) =>
                  setDefaultDestinationKey(
                    e.currentTarget.value as LoaderData["defaultDestinationKey"],
                  )
                }
                style={{ width: "100%", padding: 10 }}
              >
                <option value="">(aucune)</option>
                <option value="devis">devis</option>
                <option value="reservations">reservations</option>
                <option value="support">support</option>
              </select>
              {fieldErrors?.defaultDestinationKey ? (
                <div style={{ color: "#b42318", marginTop: 6 }}>{fieldErrors.defaultDestinationKey}</div>
              ) : null}
            </div>

            <s-text-field
              name="webhook_devis"
              label="Webhook destination devis"
              details="Ex: https://hooks.slack.com/services/..."
              placeholder="https://hooks.slack.com/services/..."
              value={devis}
              onChange={(e) => setDevis(e.currentTarget.value)}
              error={fieldErrors?.devis}
            ></s-text-field>

            <s-text-field
              name="webhook_reservations"
              label="Webhook destination reservations"
              details="Ex: https://hooks.slack.com/services/..."
              placeholder="https://hooks.slack.com/services/..."
              value={reservations}
              onChange={(e) => setReservations(e.currentTarget.value)}
              error={fieldErrors?.reservations}
            ></s-text-field>

            <s-text-field
              name="webhook_support"
              label="Webhook destination support"
              details="Ex: https://hooks.slack.com/services/..."
              placeholder="https://hooks.slack.com/services/..."
              value={support}
              onChange={(e) => setSupport(e.currentTarget.value)}
              error={fieldErrors?.support}
            ></s-text-field>

            <s-paragraph>
              Astuce: laisse une destination vide pour la désactiver.
            </s-paragraph>

            <s-button type="submit" variant="primary">
              Enregistrer
            </s-button>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}
