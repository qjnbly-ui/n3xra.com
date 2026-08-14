import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type JsonObject = Record<string, unknown>;
type SupabaseJson = (path: string, options?: RequestInit) => Promise<unknown>;
type FetchImplementation = typeof fetch;

const { supabaseJson } = require("./_communications") as { supabaseJson: SupabaseJson };

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

interface SendResendEmailInput {
  workspaceId: string;
  subscriberId: string;
  idempotencyKey: string;
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

interface SendDependencies {
  database?: SupabaseJson;
  fetch?: FetchImplementation;
  apiKey?: string;
  timeoutMs?: number;
}

interface VerifyWebhookInput {
  payload: Buffer | string;
  svixId: string;
  svixTimestamp: string;
  svixSignature: string | readonly string[];
  secret?: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}

interface PreparedResult extends JsonObject {
  request_id: string;
  status: string;
}

interface ClaimResult extends JsonObject {
  request_id: string;
  status: string;
  should_send: boolean;
}

interface ResendSuccessPayload {
  id: string;
}

interface ProviderFailure extends Error {
  retryable: boolean;
  providerStatus?: number;
}

function requiredString(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${label} is invalid.`);
  return normalized;
}

function requiredUuid(value: unknown, label: string): string {
  const normalized = requiredString(value, label, 80);
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function requiredEmail(value: unknown, label: string): string {
  const normalized = requiredString(value, label, 320).toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function optionalEmail(value: unknown, label: string): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized ? requiredEmail(normalized, label) : undefined;
}

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid response.`);
  }
  return value as JsonObject;
}

function canonicalPayload(input: SendResendEmailInput): JsonObject {
  const workspaceId = requiredUuid(input.workspaceId, "Workspace");
  const subscriberId = requiredUuid(input.subscriberId, "Subscriber");
  const idempotencyKey = requiredString(input.idempotencyKey, "Idempotency key", 200);
  const from = requiredEmail(input.from, "From address");
  const to = requiredEmail(input.to, "To address");
  const subject = requiredString(input.subject, "Subject", 300);
  const html = String(input.html ?? "");
  const text = String(input.text ?? "");
  if (!html && !text) throw new Error("HTML or text email content is required.");
  if (html.length > 1_000_000 || text.length > 1_000_000) throw new Error("Email content is too large.");
  const replyTo = optionalEmail(input.replyTo, "Reply-to address");
  return {
    workspaceId,
    subscriberId,
    idempotencyKey,
    from,
    to,
    subject,
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
  };
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function payloadHash(payload: JsonObject): string {
  return sha256(JSON.stringify(payload));
}

function providerFailure(message: string, retryable: boolean, status?: number): ProviderFailure {
  const error = new Error(message) as ProviderFailure;
  error.retryable = retryable;
  if (status !== undefined) error.providerStatus = status;
  return error;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function parseResponseBody(response: Response): Promise<JsonObject> {
  const body = await response.text();
  if (!body) return {};
  try {
    return asObject(JSON.parse(body), "Resend");
  } catch {
    return { message: body.slice(0, 1000) };
  }
}

async function rpc(database: SupabaseJson, functionName: string, body: JsonObject): Promise<JsonObject> {
  return asObject(await database(`rpc/${functionName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), functionName);
}

async function sendResendEmail(
  input: SendResendEmailInput,
  dependencies: SendDependencies = {},
): Promise<JsonObject> {
  const canonical = canonicalPayload(input);
  const database = dependencies.database ?? supabaseJson;
  const fetchImplementation = dependencies.fetch ?? fetch;
  const apiKey = String(dependencies.apiKey ?? process.env.COMMUNICATIONS_RESEND_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("Resend delivery is not configured.");

  const hash = payloadHash(canonical);
  if (!SHA256_PATTERN.test(hash)) throw new Error("Email payload hashing failed.");
  const prepared = asObject(await rpc(database, "communications_prepare_resend_delivery", {
    input_workspace_id: canonical.workspaceId,
    input_subscriber_id: canonical.subscriberId,
    input_idempotency_key: canonical.idempotencyKey,
    input_payload_hash: hash,
    input_from_address: canonical.from,
    input_to_address: canonical.to,
    input_subject: canonical.subject,
  }), "communications_prepare_resend_delivery") as PreparedResult;
  const requestId = requiredUuid(prepared.request_id, "Delivery request");

  const claim = asObject(await rpc(database, "communications_claim_resend_delivery", {
    input_request_id: requestId,
  }), "communications_claim_resend_delivery") as ClaimResult;
  if (!claim.should_send) {
    return {
      ok: true,
      sent: false,
      existing: true,
      requestId,
      status: String(claim.status ?? prepared.status ?? "unknown"),
      providerMessageId: prepared.provider_message_id ?? null,
    };
  }

  const providerBody: JsonObject = {
    from: canonical.from,
    to: [canonical.to],
    subject: canonical.subject,
    ...(canonical.html ? { html: canonical.html } : {}),
    ...(canonical.text ? { text: canonical.text } : {}),
    ...(canonical.replyTo ? { reply_to: canonical.replyTo } : {}),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let providerId: string | null = null;
  try {
    const response = await fetchImplementation(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": String(canonical.idempotencyKey),
      },
      body: JSON.stringify(providerBody),
      signal: controller.signal,
    });
    const responseBody = await parseResponseBody(response);
    if (!response.ok) {
      const message = String(responseBody.message ?? responseBody.error ?? `Resend returned HTTP ${response.status}.`);
      throw providerFailure(message.slice(0, 1000), isRetryableStatus(response.status), response.status);
    }
    providerId = requiredString((responseBody as unknown as ResendSuccessPayload).id, "Resend message ID", 200);
  } catch (caught) {
    const error = caught as Partial<ProviderFailure>;
    const retryable = typeof error.retryable === "boolean" ? error.retryable : true;
    await rpc(database, "communications_record_resend_delivery_result", {
      input_request_id: requestId,
      input_success: false,
      input_provider_message_id: null,
      input_error: String(error.message ?? "Resend delivery failed.").slice(0, 1000),
      input_retryable: retryable,
    });
    throw caught;
  } finally {
    clearTimeout(timeout);
  }

  const recorded = await rpc(database, "communications_record_resend_delivery_result", {
    input_request_id: requestId,
    input_success: true,
    input_provider_message_id: providerId,
    input_error: null,
    input_retryable: false,
  });
  return {
    ok: true,
    sent: true,
    existing: Boolean(recorded.existing),
    requestId,
    providerMessageId: providerId,
    status: String(recorded.status ?? "sent"),
  };
}

function verifyResendWebhook(input: VerifyWebhookInput): boolean {
  const secret = String(input.secret ?? process.env.COMMUNICATIONS_RESEND_WEBHOOK_SECRET ?? "").trim();
  if (!secret) throw new Error("Resend webhook verification is not configured.");
  const secretValue = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secretValue, "base64");
  } catch {
    throw new Error("Resend webhook secret is invalid.");
  }
  if (!secretBytes.length) throw new Error("Resend webhook secret is invalid.");

  const svixId = requiredString(input.svixId, "Webhook event ID", 200);
  const timestampText = requiredString(input.svixTimestamp, "Webhook timestamp", 30);
  if (!/^\d{1,15}$/.test(timestampText)) return false;
  const timestamp = Number(timestampText);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > tolerance) return false;

  const payload = Buffer.isBuffer(input.payload) ? input.payload : Buffer.from(input.payload, "utf8");
  const signed = Buffer.concat([
    Buffer.from(`${svixId}.${timestampText}.`, "utf8"),
    payload,
  ]);
  const expected = createHmac("sha256", secretBytes).update(signed).digest();
  const signatures = (Array.isArray(input.svixSignature) ? input.svixSignature : [input.svixSignature])
    .flatMap((value) => String(value).split(/\s+/))
    .map((value) => value.trim())
    .filter(Boolean);
  return signatures.some((signature) => {
    const [version, encoded, ...rest] = signature.split(",");
    if (version !== "v1" || !encoded || rest.length) return false;
    try {
      const candidate = Buffer.from(encoded, "base64");
      return candidate.length === expected.length && timingSafeEqual(candidate, expected);
    } catch {
      return false;
    }
  });
}

export = {
  RESEND_ENDPOINT,
  payloadHash,
  sendResendEmail,
  sha256,
  verifyResendWebhook,
};
