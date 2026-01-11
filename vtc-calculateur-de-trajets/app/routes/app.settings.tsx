import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getShopConfig, upsertShopConfig } from "../lib/shopConfig.server";
import { cleanText, isValidSingleEmail } from "../lib/bookingNotify.server";

type LoaderData = {
  bookingEmailTo: string;
  defaults: {
    bookingEmailTo: string;
  };
};

type ActionData =
  | { ok: true }
  | {
      ok: false;
      fieldErrors?: {
        bookingEmailTo?: string;
      };
      error?: string;
    };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const config = await getShopConfig(shop);

  const defaults = {
    bookingEmailTo: cleanText(process.env.BOOKING_EMAIL_TO),
  };

  return {
    bookingEmailTo: config?.bookingEmailTo ?? "",
    defaults,
  } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();

  const bookingEmailToRaw = cleanText(form.get("bookingEmailTo"));

  const fieldErrors: NonNullable<Extract<ActionData, { ok: false }>['fieldErrors']> = {};

  if (bookingEmailToRaw && !isValidSingleEmail(bookingEmailToRaw)) {
    fieldErrors.bookingEmailTo = "Email invalide";
  }

  if (Object.keys(fieldErrors).length) {
    return { ok: false, fieldErrors } satisfies ActionData;
  }

  try {
    await upsertShopConfig({
      shop,
      bookingEmailTo: bookingEmailToRaw ? bookingEmailToRaw : null,
    });

    return { ok: true } satisfies ActionData;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("settings save error", message);
    return { ok: false, error: "Erreur lors de l’enregistrement" } satisfies ActionData;
  }
};

export default function SettingsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();

  const [bookingEmailTo, setBookingEmailTo] = useState(loaderData.bookingEmailTo);

  useEffect(() => {
    setBookingEmailTo(loaderData.bookingEmailTo);
  }, [loaderData.bookingEmailTo]);

  const fieldErrors = actionData && !actionData.ok ? actionData.fieldErrors : undefined;

  const showDefaults = useMemo(() => {
    return {
      bookingEmailTo: loaderData.defaults.bookingEmailTo,
    };
  }, [loaderData.defaults.bookingEmailTo]);

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
    <s-page heading="Paramètres">
      <s-section heading="Notifications">
        <Form method="post">
          <s-stack direction="block" gap="base">
            <s-text-field
              name="bookingEmailTo"
              label="Email de notification"
              details={`Optionnel : destinataire des emails de réservation. Si vide, valeur par défaut = ${showDefaults.bookingEmailTo || "(non défini)"}.`}
              placeholder="contact@exemple.com"
              value={bookingEmailTo}
              onChange={(e) => setBookingEmailTo(e.currentTarget.value)}
              error={fieldErrors?.bookingEmailTo}
            ></s-text-field>

            <s-button type="submit" variant="primary">
              Enregistrer
            </s-button>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}
