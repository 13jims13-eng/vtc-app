import crypto from "node:crypto";

const ALG = "aes-256-gcm" as const;

type EncryptedPayloadV1 = {
  v: 1;
  alg: typeof ALG;
  iv: string; // base64
  tag: string; // base64
  ct: string; // base64
};

function decodeEncryptionKey(): Buffer {
  const raw = String(process.env.ENCRYPTION_KEY || process.env.CONFIG_ENCRYPTION_KEY || "").trim();
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is missing");
  }

  const looksHex = /^[0-9a-f]{64}$/i.test(raw);
  const key = looksHex ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes (base64 or hex)");
  }

  return key;
}

export function encryptSecret(plaintext: string): string {
  const value = String(plaintext || "");
  if (!value) throw new Error("Cannot encrypt empty value");

  const key = decodeEncryptionKey();
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayloadV1 = {
    v: 1,
    alg: ALG,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  };

  return JSON.stringify(payload);
}

export function decryptSecret(encrypted: string): string {
  const raw = String(encrypted || "").trim();
  if (!raw) throw new Error("Cannot decrypt empty value");

  let payload: EncryptedPayloadV1;
  try {
    payload = JSON.parse(raw) as EncryptedPayloadV1;
  } catch {
    throw new Error("Invalid encrypted payload (not JSON)");
  }

  if (payload?.v !== 1 || payload?.alg !== ALG) {
    throw new Error("Invalid encrypted payload (version/alg)");
  }

  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ct = Buffer.from(payload.ct, "base64");

  const key = decodeEncryptionKey();
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);

  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
