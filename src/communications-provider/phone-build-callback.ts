import { phoneRecordStore } from "./_phone-records";
import { validCallbackDispatch, dispatchPhoneCallbacks } from "./_phone-callbacks";
const twilio = require("twilio");
const { validateTwilioWebhook } = require("./_twilio-webhook");
const { buildTwiML, publicWebSocketUrl } = require("./_receptionist");
export = async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).end();
  const account = process.env.TWILIO_ACCOUNT_SID, auth = process.env.TWILIO_AUTH_TOKEN;
  if (!account || !auth) return res.status(503).end();
  if (!req.query?.request) {
    if (!validCallbackDispatch(String(req.headers['x-n3xra-callback-time'] || ''), String(req.headers['x-n3xra-callback-signature'] || ''), process.env.N3XRA_PHONE_BUILD_SECRET || '')) return res.status(403).end();
    try { return res.status(200).json(await dispatchPhoneCallbacks(twilio(account, auth))); }
    catch { return res.status(503).json({ error: "Callback dispatch unavailable." }); }
  }
  if (!validateTwilioWebhook(req) || !/^\d+$/.test(String(req.query.request)) || !/^[0-9a-f-]{36}$/.test(String(req.query.token))) return res.status(403).end();
  const row = (await phoneRecordStore(`website_build_events?id=eq.${req.query.request}&metadata->callback->>token=eq.${req.query.token}&limit=1`))?.[0];
  const job = row?.metadata?.callback;
  if (!row || !job || Date.parse(job.expiresAt) <= Date.now() || (job.callSid && job.callSid !== req.body?.CallSid)) return res.status(403).end();
  const credential = (await phoneRecordStore(`account_phone_credentials?user_id=eq.${row.actor_user_id}&select=phone_e164&limit=1`))?.[0];
  if (credential?.phone_e164 !== req.body?.To) return res.status(403).end();
  const callback = { ...job, callSid: req.body.CallSid, state: req.query.status ? 'finished' : 'answered' };
  await phoneRecordStore(`website_build_events?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify({ metadata: { ...row.metadata, callback } }) });
  if (req.query.status) return res.status(204).end();
  res.setHeader("Content-Type", "text/xml; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(buildTwiML({ callback: true, websocketUrl: publicWebSocketUrl(req), voice: process.env.TWILIO_RECEPTIONIST_VOICE || '', greeting: "Hi, this is Nex calling you back as requested. Before we continue, please enter your four-digit phone PIN on the keypad." }));
};
