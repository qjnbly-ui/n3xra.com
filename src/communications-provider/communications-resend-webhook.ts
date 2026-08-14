import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

type JsonObject = Record<string, unknown>;
type SupabaseJson = (path: string, options?: RequestInit) => Promise<unknown>;
type WebhookRequest = IncomingMessage & { body?: unknown };
type WebhookResponse = ServerResponse & {
  status?: (statusCode: number) => WebhookResponse;
  json?: (body: JsonObject) => unknown;
};

const { supabaseJson } = require("./_communications") as { supabaseJson: SupabaseJson };
const { verifyResendWebhook } = require("./_communications-resend") as {
  verifyResendWebhook: (input: {
    payload: Buffer;
    svixId: string;
    svixTimestamp: string;
    svixSignature: string | readonly string[];
    secret?: string;
    nowSeconds?: number;
  }) => boolean;
};

const MAX_WEBHOOK_BYTES = 256 * 1024;
const SUPPORTED_EVENTS = new Set([
  "email.scheduled",
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.bounced",
  "email.complained",
  "email.suppressed",
  "email.opened",
  "email.clicked",
  "suppression.added",
  "suppression.removed",
]);

interface WebhookDependencies {
  database?: SupabaseJson;
  secret?: string;
  nowSeconds?: number;
}

function header(req: WebhookRequest, name: string): string | readonly string[] {
  const value = req.headers[name.toLowerCase()];
  return value ?? "";
}

function sendJson(res: WebhookResponse, statusCode: number, body: JsonObject): unknown {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (res.status && res.json) {
    const response = res.status(statusCode);
    return response.json ? response.json(body) : response.end(JSON.stringify(body));
  }
  res.statusCode = statusCode;
  return res.end(JSON.stringify(body));
}

async function readRawBody(req: WebhookRequest, maximumBytes = MAX_WEBHOOK_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    bytes += buffer.length;
    if (bytes > maximumBytes) {
      const error = new Error("Webhook payload is too large.") as Error & { status?: number };
      error.status = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function requiredPayloadObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Webhook payload is invalid.");
  return value as JsonObject;
}

async function processResendWebhook(
  rawBody: Buffer,
  headers: { svixId: string; svixTimestamp: string; svixSignature: string | readonly string[] },
  dependencies: WebhookDependencies = {},
): Promise<JsonObject> {
  const valid = verifyResendWebhook({
    payload: rawBody,
    svixId: headers.svixId,
    svixTimestamp: headers.svixTimestamp,
    svixSignature: headers.svixSignature,
    ...(dependencies.secret ? { secret: dependencies.secret } : {}),
    ...(dependencies.nowSeconds !== undefined ? { nowSeconds: dependencies.nowSeconds } : {}),
  });
  if (!valid) {
    const error = new Error("Webhook signature is invalid or expired.") as Error & { status?: number };
    error.status = 400;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    const error = new Error("Webhook payload must be valid JSON.") as Error & { status?: number };
    error.status = 400;
    throw error;
  }
  const payload = requiredPayloadObject(parsed);
  const type = String(payload.type ?? "").trim().toLowerCase();
  if (!SUPPORTED_EVENTS.has(type)) {
    const error = new Error("Webhook event type is unsupported.") as Error & { status?: number };
    error.status = 400;
    throw error;
  }
  const createdAt = String(payload.created_at ?? "").trim();
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
    const error = new Error("Webhook occurrence time is invalid.") as Error & { status?: number };
    error.status = 400;
    throw error;
  }
  const data = requiredPayloadObject(payload.data);
  const providerMessageId = String(data.email_id ?? "").trim() || null;
  const database = dependencies.database ?? supabaseJson;
  const result = await database("rpc/communications_process_resend_webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input_svix_id: headers.svixId,
      input_event_type: type,
      input_provider_message_id: providerMessageId,
      input_payload_hash: createHash("sha256").update(rawBody).digest("hex"),
      input_event_payload: payload,
      input_occurred_at: new Date(createdAt).toISOString(),
    }),
  });
  return requiredPayloadObject(result);
}

async function handleResendWebhookRequest(
  req: WebhookRequest,
  res: WebhookResponse,
  dependencies: WebhookDependencies = {},
): Promise<unknown> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }
  try {
    const rawBody = await readRawBody(req);
    const svixIdValue = header(req, "svix-id");
    const svixTimestampValue = header(req, "svix-timestamp");
    const svixSignatureValue = header(req, "svix-signature");
    const svixId = Array.isArray(svixIdValue) ? String(svixIdValue[0] ?? "") : String(svixIdValue);
    const svixTimestamp = Array.isArray(svixTimestampValue)
      ? String(svixTimestampValue[0] ?? "")
      : String(svixTimestampValue);
    if (!svixId || !svixTimestamp || !svixSignatureValue) {
      return sendJson(res, 400, { error: "Required webhook signature headers are missing." });
    }
    const result = await processResendWebhook(rawBody, {
      svixId,
      svixTimestamp,
      svixSignature: svixSignatureValue,
    }, dependencies);
    return sendJson(res, 200, { ok: true, result });
  } catch (caught) {
    const error = caught as Error & { status?: number };
    const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status >= 500) console.error("Resend webhook processing failed:", error);
    return sendJson(res, status, {
      error: status >= 500 ? "Resend webhook processing failed." : error.message,
    });
  }
}

const handler = Object.assign(
  (req: WebhookRequest, res: WebhookResponse) => handleResendWebhookRequest(req, res),
  {
    config: { api: { bodyParser: false } },
    handleResendWebhookRequest,
    processResendWebhook,
    readRawBody,
  },
);

export = handler;
