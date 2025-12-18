import fs from "node:fs";
import path from "node:path";

function normalizeAppUrl(raw) {
  const value = (raw || "").trim();
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`APP_URL invalide: ${value}`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`APP_URL doit être en https: ${value}`);
  }

  // Strip trailing slash for consistency
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/+$/, "");
}

function replaceTomlScalar(contents, key, value) {
  const pattern = new RegExp(`^${key}\\s*=\\s*\"[^\"]*\"\\s*$`, "m");
  if (!pattern.test(contents)) {
    throw new Error(`Clé TOML introuvable: ${key}`);
  }
  return contents.replace(pattern, `${key} = "${value}"`);
}

function replaceTomlArray(contents, key, values) {
  const pattern = new RegExp(`^${key}\\s*=\\s*\\[[\\s\\S]*?\\]\\s*$`, "m");
  if (!pattern.test(contents)) {
    throw new Error(`Clé TOML introuvable: ${key}`);
  }
  const rendered = `${key} = [\n${values.map((v) => `  "${v}",`).join("\n")}\n]`;
  return contents.replace(pattern, rendered);
}

const appUrl = normalizeAppUrl(process.env.APP_URL);
if (!appUrl) {
  console.error("APP_URL manquant. Exemple: https://your-app.onrender.com");
  process.exit(1);
}

const tomlPath = path.resolve(process.cwd(), "shopify.app.toml");
if (!fs.existsSync(tomlPath)) {
  console.error(`shopify.app.toml introuvable: ${tomlPath}`);
  process.exit(1);
}

let contents = fs.readFileSync(tomlPath, "utf8");
contents = replaceTomlScalar(contents, "application_url", appUrl);
contents = replaceTomlArray(contents, "redirect_urls", [
  `${appUrl}/auth/callback`,
  `${appUrl}/auth/shopify/callback`,
  `${appUrl}/api/auth/callback`,
]);

fs.writeFileSync(tomlPath, contents, "utf8");
console.log("shopify.app.toml mis à jour", {
  application_url: appUrl,
  redirect_urls: 3,
});
