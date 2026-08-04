const http = require("http");
const express = require("express");
const twilio = require("twilio");
const { WebSocketServer, WebSocket } = require("ws");
const askN3xra = require("../ask");
const { toSpeechText } = require("../_receptionist");
const { accountOverview, getCallerAccount, verifyCallerPin } = require("../_account-phone");

const RECEPTIONIST_RULES = [
  "You are the N3XRA AI receptionist speaking with a caller on the phone.",
  "The written brand is N3XRA, but it is always pronounced NEXRA.",
  "Use a warm, polished, conversational voice.",
  "Answer the caller's question directly using the supplied current N3XRA knowledge.",
  "Keep most replies to two or three short spoken sentences.",
  "Do not use markdown, bullets, emojis, raw URLs, route lists, or decorative symbols.",
  "Do not claim to take notes, send email, schedule appointments, or transfer calls yet.",
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

async function sendAccountOverview(ws) {
  try {
    sendSpeech(ws, await accountOverview(ws.caller.user_id));
  } catch (error) {
    console.error("Receptionist account overview failed", { callSid: ws.callSid, error: error?.message });
    sendSpeech(ws, "I could not load your account overview right now. Please use your signed-in dashboard.");
  }
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
        await sendAccountOverview(ws);
      } catch (error) {
        console.error("Receptionist PIN verification failed", { callSid: ws.callSid, error: error?.message });
        sendSpeech(ws, "I could not verify phone access right now. Please use your signed-in dashboard.");
      } finally {
        ws.processing = false;
      }
      return;
    }

    if (message.type !== "prompt" || message.last === false || ws.processing) return;
    const question = toSpeechText(message.voicePrompt).slice(0, 800);
    if (!question) return;

    if (isAccountOverviewRequest(question)) {
      await ws.callerReady;
      if (!ws.caller) {
        sendSpeech(ws, "I could not match this number to a NEXRA account. Please sign in to your dashboard to add your phone number and phone PIN.");
        return;
      }
      if (!ws.accountVerified) {
        ws.awaitingPin = true;
        ws.pinDigits = "";
        sendSpeech(ws, "For security, please enter your four digit phone PIN using the keypad. I will not ask you for personal information.");
        return;
      }
      await sendAccountOverview(ws);
      return;
    }

    ws.processing = true;
    try {
      const reply = await requestGroqReply(question, ws.history);
      ws.history.push({ role: "user", content: question }, { role: "assistant", content: reply });
      ws.history = ws.history.slice(-10);
      sendSpeech(ws, reply);
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
