import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export type PhoneIdentity = { id: string; phoneWebsiteId: string; phoneCallId: string };
const used = new Map<string, number>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A request-specific delegation from the trusted receptionist, never a browser login. */
export function verifyPhoneRequest(token: string, method: string, path: string, rawBody: string,
  secret: string, websiteId: string, now = Date.now()): PhoneIdentity {
  if (secret.length < 32 || !uuid.test(websiteId) || token.length > 4096) throw new Error("Phone access is not configured.");
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) throw new Error("Invalid phone access.");
  const expected = createHmac("sha256", secret).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid phone access.");
  const claim = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  const seconds = Math.floor(now / 1000);
  if (claim.aud !== "n3xra-build-phone" || !uuid.test(claim.sub) || claim.website !== websiteId
    || !/^CA[0-9a-f]{32}$/i.test(claim.call) || !Number.isInteger(claim.exp) || !Number.isInteger(claim.iat)
    || !uuid.test(claim.nonce) || claim.exp <= seconds || claim.iat > seconds + 5 || claim.exp - claim.iat > 60
    || claim.exp - claim.iat < 1 || claim.iat < seconds - 60
    || claim.method !== method || claim.path !== path
    || claim.body !== createHash("sha256").update(rawBody).digest("hex")) throw new Error("Invalid or expired phone access.");
  const permitted = (method === "POST" && path === "/v1/projects/open")
    || (method === "GET" && path === `/v1/projects/${websiteId}/active`)
    || (method === "GET" && /^\/v1\/sessions\/[0-9a-f-]+\/phone-status$/.test(path))
    || (method === "POST" && /^\/v1\/sessions\/[0-9a-f-]+\/(messages|cancel|save|close)$/.test(path));
  if (!permitted) throw new Error("Phone access does not permit this action. Use the dashboard.");
  // A repeated signed mutation must not execute twice after a lost response.
  for (const [key, expiry] of used) if (expiry <= seconds) used.delete(key);
  if (used.has(claim.nonce)) throw new Error("Phone request was already received. Check workspace status.");
  used.set(claim.nonce, claim.exp);
  return { id: claim.sub, phoneWebsiteId: websiteId, phoneCallId: claim.call };
}
