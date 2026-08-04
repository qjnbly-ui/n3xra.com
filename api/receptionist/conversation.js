const http = require("http");
const express = require("express");
const twilio = require("twilio");
const { WebSocketServer, WebSocket } = require("ws");
const askN3xra = require("../ask");
const { toSpeechText } = require("../_receptionist");

const RECEPTIONIST_RULES = [
  "You are the N3XRA AI receptionist speaking with a caller on the phone.",
  "The written brand is N3XRA, but it is always pronounced NEXRA.",
  "Use a warm, polished, conversational voice.",
  "Answer the caller's question directly using the supplied current N3XRA knowledge.",
  "Keep most replies to two or three short spoken sentences.",
  "Do not use markdown, bullets, emojis, raw URLs, route lists, or decorative symbols.",
  "Do not claim to take notes, send email, schedule appointments, or transfer calls yet.",
  "If asked for an unavailable action, explain briefly that this demonstration currently answers questions about N3XRA.",
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
      return;
    }

    if (message.type !== "prompt" || message.last === false || ws.processing) return;
    const question = toSpeechText(message.voicePrompt).slice(0, 800);
    if (!question) return;

    ws.processing = true;
    try {
      const reply = await requestGroqReply(question, ws.history);
      ws.history.push({ role: "user", content: question }, { role: "assistant", content: reply });
      ws.history = ws.history.slice(-10);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "text",
          token: reply,
          last: true,
          interruptible: true,
          preemptible: true,
        }));
      }
    } catch (error) {
      console.error("Receptionist response failed", { callSid: ws.callSid, error: error?.message });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "text",
          token: "I'm sorry, I had trouble answering that. Please try your question once more.",
          last: true,
          interruptible: true,
          preemptible: true,
        }));
      }
    } finally {
      ws.processing = false;
    }
  });
});

module.exports = server;
module.exports.publicWebSocketRequestUrl = publicWebSocketRequestUrl;
module.exports.requestGroqReply = requestGroqReply;
module.exports.verifyTwilioWebSocket = verifyTwilioWebSocket;
