const http = require("http");
const express = require("express");
const twilio = require("twilio");
const { WebSocketServer, WebSocket } = require("ws");

function publicWebSocketRequestUrl(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "www.n3xra.com").split(",")[0].trim();
  return `wss://${host}${req.url}`;
}

function verifyTwilioWebSocket(info, done) {
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const signature = String(info.req.headers["x-twilio-signature"] || "").trim();
  if (!authToken || !signature) return done(false, 403, "Invalid Twilio signature");
  const valid = twilio.validateRequest(authToken, signature, publicWebSocketRequestUrl(info.req), {});
  return done(valid, valid ? 101 : 403, valid ? undefined : "Invalid Twilio signature");
}

function finishScreen(ws, accepted) {
  if (ws.readyState !== WebSocket.OPEN || ws.finished) return;
  ws.finished = true;
  ws.send(JSON.stringify({
    type: "end",
    handoffData: JSON.stringify({ reasonCode: accepted ? "screen-accepted" : "screen-declined" }),
  }));
}

const app = express();
app.use((_req, res) => res.status(426).json({ error: "WebSocket upgrade required." }));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024, perMessageDeflate: false, verifyClient: verifyTwilioWebSocket });

wss.on("connection", (ws) => {
  ws.finished = false;
  ws.screenTimer = null;
  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    if (message.type === "setup") {
      const expectedAccount = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
      if (expectedAccount && message.accountSid !== expectedAccount) return ws.close(1008, "Twilio account mismatch");
      ws.screenTimer = setTimeout(() => finishScreen(ws, false), 25000);
      return;
    }
    if (message.type === "dtmf") finishScreen(ws, String(message.digit || "") === "1");
  });
  ws.on("close", () => clearTimeout(ws.screenTimer));
});

module.exports = server;
module.exports.finishScreen = finishScreen;
module.exports.publicWebSocketRequestUrl = publicWebSocketRequestUrl;
module.exports.verifyTwilioWebSocket = verifyTwilioWebSocket;
