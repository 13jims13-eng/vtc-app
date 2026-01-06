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

function replaceTomlScalarInSection(contents, section, key, value) {
  const sectionHeader = `[${section}]`;
  const start = contents.search(new RegExp(`^\\[${section.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\]\\s*$`, "m"));
  if (start < 0) {
    throw new Error(`Section TOML introuvable: ${sectionHeader}`);
  }

  const afterStart = contents.slice(start);
  const nextSectionMatch = afterStart.slice(sectionHeader.length).match(/^\n\[[^\]]+\]\s*$/m);
  const end = nextSectionMatch ? start + sectionHeader.length + nextSectionMatch.index : contents.length;
  const sectionText = contents.slice(start, end);

  const keyPattern = new RegExp(`^${key}\\s*=\\s*"[^"]*"\\s*$`, "m");
  if (!keyPattern.test(sectionText)) {
    throw new Error(`Clé TOML introuvable dans ${sectionHeader}: ${key}`);
  }

  const updatedSectionText = sectionText.replace(keyPattern, `${key} = "${value}"`);
  return contents.slice(0, start) + updatedSectionText + contents.slice(end);
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
contents = replaceTomlScalarInSection(contents, "app_proxy", "url", `${appUrl}/apps/vtc`);

fs.writeFileSync(tomlPath, contents, "utf8");
console.log("shopify.app.toml mis à jour", {
  application_url: appUrl,
  redirect_urls: 3,
  app_proxy_url: `${appUrl}/apps/vtc`,
});
