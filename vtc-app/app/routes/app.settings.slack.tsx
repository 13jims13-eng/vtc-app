import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { cleanText, validateSlackWebhookUrl } from "../lib/bookingNotify.server";
import { getSlackStatusForShop, setSlackWebhookUrl } from "../lib/slackConfig.server";
import { ensureTenant } from "../lib/tenant.server";

type LoaderData = { connected: boolean; masked: string | null };

type ActionData =
  | { ok: true }
  | {
      ok: false;
      fieldErrors?: Partial<Record<"webhookUrl", string>>;
      error?: string;
    };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const status = await getSlackStatusForShop(shop);
  return status satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();

  const webhookUrl = cleanText(form.get("webhookUrl"));
  const fieldErrors: NonNullable<Extract<ActionData, { ok: false }>['fieldErrors']> = {};
  if (webhookUrl) {
    const validation = validateSlackWebhookUrl(webhookUrl);
    if (!validation.ok) {
      fieldErrors.webhookUrl = "URL Slack invalide";
    }
  }
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors } satisfies ActionData;

  try {
    const ensured = await ensureTenant(shop);
    await setSlackWebhookUrl(ensured.id, webhookUrl || null);
    return { ok: true } satisfies ActionData;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ENCRYPTION_KEY") || message.includes("CONFIG_ENCRYPTION_KEY")) {
      return { ok: false, error: "ENCRYPTION_KEY manquant (chiffrement Slack)" } satisfies ActionData;
    }
    return { ok: false, error: "Erreur lors de l’enregistrement" } satisfies ActionData;
  }
};

export default function SlackSettingsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();

  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    // Never hydrate decrypted webhook in the client.
    setWebhookUrl("");
  }, [loaderData.connected, loaderData.masked]);

  const fieldErrors = actionData && !actionData.ok ? actionData.fieldErrors : undefined;

  const details = useMemo(() => {
    return "Le webhook Slack est un secret : il est stocké chiffré côté serveur et n’est jamais renvoyé au navigateur.";
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
      <s-section heading="Webhook">
        <Form method="post">
          <s-stack direction="block" gap="base">
            <s-paragraph>{details}</s-paragraph>

            <s-paragraph>
              Statut actuel : {loaderData.connected ? loaderData.masked : "disconnected"}
            </s-paragraph>
            <s-text-field
              name="webhookUrl"
              label="Webhook Slack"
              details="Ex: https://hooks.slack.com/services/..."
              placeholder="https://hooks.slack.com/services/..."
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.currentTarget.value)}
              error={fieldErrors?.webhookUrl}
            ></s-text-field>

            <s-paragraph>Astuce : laisse vide et enregistre pour déconnecter Slack.</s-paragraph>

            <s-button type="submit" variant="primary">
              Enregistrer
            </s-button>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}
