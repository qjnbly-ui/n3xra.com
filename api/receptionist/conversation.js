const http = require("http");
const express = require("express");
const twilio = require("twilio");
const { WebSocketServer, WebSocket } = require("ws");
const askN3xra = require("../ask");
const { toSpeechText } = require("../_receptionist");
const {
  accountOverview,
  getCallerAccount,
  sendPasswordResetEmail,
  verifyCallerPin,
} = require("../_account-phone");
const { recordSmsConsent, sendTransactionalSms } = require("../_sms-consent");

const RECEPTIONIST_RULES = [
  "You are the N3XRA AI receptionist speaking with a caller on the phone.",
  "The written brand is N3XRA, but it is always pronounced NEXRA.",
  "Use a warm, polished, conversational voice.",
  "Answer the caller's question directly using the supplied current N3XRA knowledge.",
  "Keep most replies to two or three short spoken sentences.",
  "Do not use markdown, bullets, emojis, raw URLs, route lists, or decorative symbols.",
  "Do not claim to take notes, send general email, or schedule appointments yet.",
  "Quentin Nichols is N3XRA's founder, creator, and owner. References to the founder, creator, owner, or Quentin mean him.",
  "If a caller asks for Quentin or demands an immediate transfer without explaining why, politely ask what the call is regarding. Do not promise a connection.",
  "Live transfers are offered separately only after the call's business importance has been evaluated and the caller confirms.",
  "After caller recognition and keypad PIN verification, you may send a password reset email only to the address already on that account.",
  "If asked for an unavailable action, explain briefly that this demonstration currently answers questions about N3XRA.",
  "Account overviews are handled separately using caller recognition and a keypad PIN.",
  "Never ask a caller to say their phone number, PIN, or personal information out loud.",
  "Never request passwords, payment card information, Social Security numbers, or other sensitive secrets.",
].join("\n");

function publicWebSocketRequestUrl(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "www.n3xra.com")
    .split(",")[0]
    .trim();
  return `wss://${host}${req.url}`;
}

function verifyTwilioWebSocket(info, done) {
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const signature = String(info.req.headers["x-twilio-signature"] || "").trim();
  if (!authToken || !signature) return done(false, 403, "Invalid Twilio signature");
  const valid = twilio.validateRequest(authToken, signature, publicWebSocketRequestUrl(info.req), {});
  return done(valid, valid ? 101 : 403, valid ? undefined : "Invalid Twilio signature");
}

function isAccountOverviewRequest(value) {
  return /\b(my account|account overview|my plan|my subscription|my usage|account status|what.*account|billing status)\b/i.test(String(value || ""));
}

function isPasswordResetRequest(value) {
  return /\b(forgot (my )?password|reset (my |the )?password|password reset|send (me )?(a )?(password )?reset (email|link)|can'?t (log|sign) in)\b/i.test(String(value || ""));
}

function isEmergencyRequest(value) {
  return /\b(911|suicid|medical emergency|house (is )?on fire|someone (is )?(dying|unconscious)|immediate danger)\b/i.test(String(value || ""));
}

function isSmsRequest(value) {
  return /\b(text|sms|message)\b.*\b(me|my|link|information|info|details|website|page)\b|\b(send|share)\b.*\b(text|sms|link)\b/i.test(String(value || ""));
}

function smsResourceFor(value, history = []) {
  const context = `${history.slice(-4).map((entry) => entry.content).join(" ")} ${value}`.toLowerCase();
  if (/\b(account|log ?in|sign ?in|password)\b/.test(context)) return { label: "N3XRA account page", url: "https://www.n3xra.com/account/" };
  if (/\b(website|project|quote|proposal|build)\b/.test(context)) return { label: "website project request", url: "https://www.n3xra.com/website-request/" };
  if (/\b(record|meeting|minutes|document)\b/.test(context)) return { label: "N3XRA Records", url: "https://www.n3xra.com/records/" };
  if (/\b(support|help|problem|issue)\b/.test(context)) return { label: "N3XRA support", url: "https://www.n3xra.com/support/" };
  if (/\b(service|pricing|price|cost|plan)\b/.test(context)) return { label: "N3XRA services", url: "https://www.n3xra.com/services/" };
  return { label: "N3XRA website", url: "https://www.n3xra.com/" };
}

function isAffirmativeTransferResponse(value) {
  return /^(yes|yeah|yep|sure|okay|ok|please do|connect me|transfer me|go ahead|that works)(\b|[.!?])/i.test(String(value || "").trim());
}

function isNegativeTransferResponse(value) {
  return /^(no|nope|not now|no thanks|don'?t|do not)(\b|[.!?])/i.test(String(value || "").trim());
}

async function evaluateTransferWorthiness(question, history) {
  const apiKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) return { offerTransfer: false, reason: "classifier-unavailable", summary: "" };
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: String(process.env.GROQ_RECEPTIONIST_MODEL || process.env.GROQ_ASK_MODEL || "openai/gpt-oss-120b").trim(),
      temperature: 0,
      max_tokens: 180,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Classify whether a N3XRA business caller should be offered a live transfer to the owner.",
            "Quentin Nichols is N3XRA's founder, creator, and owner. Founder, creator, owner, and Quentin all refer to him.",
            "Return JSON only: {\"offerTransfer\":boolean,\"reason\":\"short-code\",\"summary\":\"one sentence\"}.",
            "True for an urgent active-customer blocker; a plausible sales, project, partnership, or investment opportunity; or a legal/security matter needing owner attention.",
            "Treat early-stage or exploratory business interest as a real opportunity. For example, 'I may want to invest in the company' is enough to offer a transfer after brief clarification; the caller does not need to provide an investment amount or formal terms.",
            "A demand to talk to someone, the founder, creator, owner, or Quentin is not important by itself. Keep offerTransfer false until the caller gives a meaningful business reason.",
            "False for general questions, routine support, pricing exploration, password/account help, spam, abuse, or emergencies requiring 911.",
            "The summary is for Quentin only. State what the caller is trying to accomplish in one concise sentence. Never include names, phone numbers, email addresses, passwords, PINs, payment data, or other sensitive details.",
            "Be conservative. An offer is not permission to transfer; the caller must confirm.",
          ].join(" "),
        },
        ...history.slice(-6),
        { role: "user", content: question },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { offerTransfer: false, reason: "classifier-error", summary: "" };
  try {
    const result = JSON.parse(String(data?.choices?.[0]?.message?.content || "{}"));
    return {
      offerTransfer: result.offerTransfer === true,
      reason: String(result.reason || "classified").slice(0, 40),
      summary: toSpeechText(result.summary).slice(0, 180),
    };
  } catch {
    return { offerTransfer: false, reason: "classifier-invalid", summary: "" };
  }
}

function endForTransfer(ws) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: "end",
    handoffData: JSON.stringify({
      reasonCode: "approved-live-transfer",
      summary: ws.transferSummary || "The caller has an important NEXRA business matter to discuss.",
    }),
  }));
}

function announceAndTransfer(ws, delayMs = 4600) {
  if (ws.readyState !== WebSocket.OPEN || ws.transferStarting) return;
  ws.transferStarting = true;
  ws.send(JSON.stringify({
    type: "text",
    token: "Absolutely. One moment while I try to connect you with Quentin.",
    last: true,
    interruptible: false,
    preemptible: false,
  }));
  ws.transferTimer = setTimeout(() => endForTransfer(ws), delayMs);
}

function sendSpeech(ws, token) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: "text",
    token: toSpeechText(token),
    last: true,
    interruptible: true,
    preemptible: true,
  }));
}

async function sendRequestedSms(ws) {
  const resource = ws.pendingSms;
  ws.pendingSms = null;
  if (!resource || !ws.fromNumber) {
    sendSpeech(ws, "I could not identify a mobile number for this call, so I cannot send that text.");
    return;
  }
  try {
    await recordSmsConsent({
      phone: ws.fromNumber,
      method: "verbal",
      callSid: ws.callSid,
      sourceUrl: "tel:+15416526840",
    });
    await sendTransactionalSms(
      ws.fromNumber,
      `N3XRA: Here is the ${resource.label} you requested: ${resource.url} Reply STOP to opt out or HELP for help.`,
    );
    sendSpeech(ws, "Done. I sent the requested NEXRA link to the number you're calling from.");
  } catch (error) {
    console.error("Receptionist SMS failed", { callSid: ws.callSid, error: error?.message });
    sendSpeech(ws, "I saved your SMS preference, but I could not send the text right now. Please visit NEXRA dot com.");
  }
}

async function sendAccountOverview(ws) {
  try {
    sendSpeech(ws, await accountOverview(ws.caller.user_id));
  } catch (error) {
    console.error("Receptionist account overview failed", { callSid: ws.callSid, error: error?.message });
    sendSpeech(ws, "I could not load your account overview right now. Please use your signed-in dashboard.");
  }
}

async function sendPasswordReset(ws) {
  try {
    const result = await sendPasswordResetEmail(ws.caller);
    if (result.reason === "cooldown") {
      sendSpeech(ws, "A password reset email was already requested recently. Please check your inbox, junk, or spam folder before trying again.");
      return;
    }
    sendSpeech(ws, "I sent a password reset link to the email address already on your NEXRA account. Please check your inbox, junk, or spam folder.");
  } catch (error) {
    console.error("Receptionist password reset failed", { callSid: ws.callSid, error: error?.message });
    sendSpeech(ws, "I could not send a password reset email right now. Please use the Forgot password option on the NEXRA sign-in page.");
  }
}

async function performAccountAction(ws) {
  const action = ws.pendingAccountAction;
  ws.pendingAccountAction = "";
  ws.pendingSms = null;
  ws.fromNumber = "";
  ws.transferOffered = false;
  ws.transferSummary = "";
  ws.transferOffered = false;
  if (action === "password_reset") return sendPasswordReset(ws);
  return sendAccountOverview(ws);
}

async function requestVerifiedAccountAction(ws, action) {
  await ws.callerReady;
  if (!ws.caller) {
    sendSpeech(ws, "I could not match this number to a NEXRA account. Please use the NEXRA sign-in page for secure account help.");
    return;
  }
  ws.pendingAccountAction = action;
  if (ws.accountVerified) {
    await performAccountAction(ws);
    return;
  }
  ws.awaitingPin = true;
  ws.pinDigits = "";
  sendSpeech(ws, "For security, please enter your four digit phone PIN using the keypad. I will not ask you for personal information.");
}

async function requestGroqReply(question, history) {
  const apiKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) throw new Error("Missing GROQ_API_KEY.");
  const siteContext = await askN3xra.getSiteContext(question, history);
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: String(process.env.GROQ_RECEPTIONIST_MODEL || process.env.GROQ_ASK_MODEL || "openai/gpt-oss-120b").trim(),
      temperature: 0.2,
      max_tokens: 240,
      messages: [
        { role: "system", content: `${siteContext}\n\nPHONE RECEPTIONIST RULES:\n${RECEPTIONIST_RULES}` },
        ...history,
        { role: "user", content: question },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error?.message || data?.message || "Groq request failed."));
  const reply = toSpeechText(data?.choices?.[0]?.message?.content);
  if (!reply) throw new Error("Groq returned an empty response.");
  return reply;
}

const app = express();
app.use((_req, res) => res.status(426).json({ error: "WebSocket upgrade required." }));

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  maxPayload: 64 * 1024,
  perMessageDeflate: false,
  verifyClient: verifyTwilioWebSocket,
});

wss.on("connection", (ws) => {
  ws.callSid = "";
  ws.history = [];
  ws.processing = false;
  ws.caller = null;
  ws.callerReady = Promise.resolve(null);
  ws.awaitingPin = false;
  ws.pinDigits = "";
  ws.accountVerified = false;
  ws.pendingAccountAction = "";
  ws.transferStarting = false;
  ws.transferTimer = null;

  ws.on("close", () => {
    if (ws.transferTimer) clearTimeout(ws.transferTimer);
  });

  ws.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }

    if (message.type === "setup") {
      const expectedAccount = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
      if (expectedAccount && message.accountSid !== expectedAccount) {
        ws.close(1008, "Twilio account mismatch");
        return;
      }
      ws.callSid = String(message.callSid || "");
      ws.fromNumber = String(message.from || "");
      ws.callerReady = getCallerAccount(message.from).then((caller) => {
        ws.caller = caller;
        return caller;
      }).catch(() => null);
      return;
    }

    if (message.type === "dtmf" && ws.awaitingPin) {
      const digit = String(message.digit || "");
      if (!/^[0-9]$/.test(digit)) return;
      ws.pinDigits = `${ws.pinDigits}${digit}`.slice(0, 4);
      if (ws.pinDigits.length < 4 || ws.processing) return;
      ws.processing = true;
      try {
        const result = await verifyCallerPin(ws.caller, ws.pinDigits);
        ws.pinDigits = "";
        if (!result.ok) {
          if (result.reason === "locked") {
            ws.awaitingPin = false;
            sendSpeech(ws, "Phone access is temporarily locked after too many attempts. Please use your signed-in dashboard or try again later.");
          } else {
            sendSpeech(ws, "That PIN did not match. Please try the four digits again.");
          }
          return;
        }
        ws.awaitingPin = false;
        ws.accountVerified = true;
        await performAccountAction(ws);
      } catch (error) {
        console.error("Receptionist PIN verification failed", { callSid: ws.callSid, error: error?.message });
        sendSpeech(ws, "I could not verify phone access right now. Please use your signed-in dashboard.");
      } finally {
        ws.processing = false;
      }
      return;
    }

    if (message.type !== "prompt" || message.last === false || ws.processing || ws.transferStarting) return;
    const question = toSpeechText(message.voicePrompt).slice(0, 800);
    if (!question) return;

    if (ws.pendingSms) {
      if (isAffirmativeTransferResponse(question)) {
        ws.processing = true;
        try {
          await sendRequestedSms(ws);
        } finally {
          ws.processing = false;
        }
        return;
      }
      if (isNegativeTransferResponse(question)) {
        ws.pendingSms = null;
        sendSpeech(ws, "No problem. I will not send a text. What else can I help with?");
        return;
      }
      sendSpeech(ws, "Before I can text you, I need a clear yes or no. Do you agree to receive this requested transactional text from NEXRA?");
      return;
    }

    if (ws.transferOffered) {
      if (isAffirmativeTransferResponse(question)) {
        ws.transferOffered = false;
        announceAndTransfer(ws);
        return;
      }
      if (isNegativeTransferResponse(question)) {
        ws.transferOffered = false;
        ws.transferSummary = "";
        sendSpeech(ws, "No problem. What else can I help you with?");
        return;
      }
      ws.transferOffered = false;
      ws.transferSummary = "";
    }

    if (isEmergencyRequest(question)) {
      sendSpeech(ws, "If anyone is in immediate danger, hang up and call 911 or your local emergency number now. I cannot provide emergency dispatch.");
      return;
    }

    if (isPasswordResetRequest(question)) {
      await requestVerifiedAccountAction(ws, "password_reset");
      return;
    }

    if (isAccountOverviewRequest(question)) {
      await requestVerifiedAccountAction(ws, "account_overview");
      return;
    }

    if (isSmsRequest(question)) {
      ws.pendingSms = smsResourceFor(question, ws.history);
      sendSpeech(ws, "I can text that link to the number you're calling from. NEXRA sends transactional messages, message frequency varies, and message and data rates may apply. Reply STOP to opt out or HELP for help. Do you agree to receive this requested text?");
      return;
    }

    ws.processing = true;
    try {
      const [reply, transferDecision] = await Promise.all([
        requestGroqReply(question, ws.history),
        evaluateTransferWorthiness(question, ws.history),
      ]);
      ws.history.push({ role: "user", content: question }, { role: "assistant", content: reply });
      ws.history = ws.history.slice(-10);
      if (transferDecision.offerTransfer) {
        ws.transferOffered = true;
        ws.transferSummary = transferDecision.summary;
        sendSpeech(ws, `${reply} This sounds like something Quentin may want to handle personally. Would you like me to try connecting you now?`);
      } else {
        sendSpeech(ws, reply);
      }
    } catch (error) {
      console.error("Receptionist response failed", { callSid: ws.callSid, error: error?.message });
      sendSpeech(ws, "I'm sorry, I had trouble answering that. Please try your question once more.");
    } finally {
      ws.processing = false;
    }
  });
});

module.exports = server;
module.exports.publicWebSocketRequestUrl = publicWebSocketRequestUrl;
module.exports.requestGroqReply = requestGroqReply;
module.exports.verifyTwilioWebSocket = verifyTwilioWebSocket;
module.exports.isAccountOverviewRequest = isAccountOverviewRequest;
module.exports.isPasswordResetRequest = isPasswordResetRequest;
module.exports.isAffirmativeTransferResponse = isAffirmativeTransferResponse;
module.exports.isEmergencyRequest = isEmergencyRequest;
module.exports.isNegativeTransferResponse = isNegativeTransferResponse;
module.exports.announceAndTransfer = announceAndTransfer;
module.exports.isSmsRequest = isSmsRequest;
module.exports.smsResourceFor = smsResourceFor;
