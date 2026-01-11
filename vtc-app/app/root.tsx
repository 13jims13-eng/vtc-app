import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";
import { getPublicEnvForClient } from "./lib/supabaseEnv.server";

export const loader = async () => {
  return { ENV: getPublicEnvForClient() };
};

export default function App() {
  const { ENV } = useLoaderData<typeof loader>();

  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: `window.ENV=${JSON.stringify(ENV)};` }}
        />
        <Scripts />
      </body>
    </html>
  );
}
