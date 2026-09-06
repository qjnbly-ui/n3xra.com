const http = require("http");
const express = require("express");
const twilio = require("twilio");
const { WebSocketServer, WebSocket } = require("ws");
const askN3xra = require("../ask");
const { callbackForCall } = require("../_phone-callbacks");
const { PhoneRecorder } = require("../_phone-records");
const { PhoneBuildConversation, createPhoneBuildRpc, phoneBuildConfigured, isPhoneBuildRequest } = require("../_phone-build");
const { toSpeechText } = require("../_receptionist");
const {
  accountOverview,
  getCallerAccount,
  sendPasswordResetEmail,
  verifyCallerPin,
} = require("../_account-phone");
const { latestConsent, sendTransactionalSms } = require("../_sms-consent");

const SMS_OPT_IN_INSTRUCTIONS = "Before I can text you, please text START to this NEXRA number or opt in at NEXRA dot com slash SMS consent. Calling alone does not provide SMS consent. Once you are opted in, ask me again and I can send the link.";
const SMS_DESTINATIONS = Object.freeze({
  none: "",
  home: "https://www.n3xra.com/",
  account: "https://www.n3xra.com/account/",
  services: "https://www.n3xra.com/services/",
  website_request: "https://www.n3xra.com/website-request/",
  projects: "https://www.n3xra.com/projects/",
  records: "https://www.n3xra.com/records/",
  partners: "https://www.n3xra.com/partners/",
  invest: "https://www.n3xra.com/invest/",
  support: "https://www.n3xra.com/support/",
  project_pulse: "https://www.n3xra.com/project-pulse/",
  sms_consent: "https://www.n3xra.com/sms-consent/",
  terms: "https://www.n3xra.com/terms/",
  privacy: "https://www.n3xra.com/privacy/",
});

const RECEPTIONIST_RULES = [
  "You are the N3XRA AI receptionist speaking with a caller on the phone.",
  "Your name is Nex. Use that name naturally when introducing yourself or when a caller asks who you are.",
  "The written brand is N3XRA, but it is always pronounced NEXRA.",
  "Use a warm, polished, conversational voice.",
  "Answer the caller's question directly using the supplied current N3XRA knowledge.",
  "Keep most replies to three to five short spoken sentences, using one complete thought per sentence.",
  "Never stop mid-sentence. Finish the current thought before ending a response.",
  "Do not use markdown, bullets, emojis, raw URLs, route lists, or decorative symbols.",
  "Do not claim to take notes, send general email, or schedule appointments yet.",
  "Quentin Nichols is N3XRA's founder, creator, and owner. References to the founder, creator, owner, or Quentin mean him.",
  "If a caller asks for Quentin or demands an immediate transfer without explaining why, politely ask what the call is regarding. Do not promise a connection.",
  "Once the caller gives a legitimate N3XRA-related reason for asking for Quentin, do not keep interrogating them or require urgency, a budget, or formal details.",
  "For routine questions, answer directly and guide the caller to the most relevant N3XRA website page or next step.",
  "A separate decision step may proactively recommend Quentin when personal attention would be useful, or offer him after a screened caller request.",
  "Never claim that a transfer is starting until that separate step asks and the caller clearly agrees.",
  "After caller recognition and keypad PIN verification, you may send a password reset email only to the address already on that account.",
  "If asked for an unavailable action, explain briefly that this demonstration currently answers questions about N3XRA.",
  "Account overviews are handled separately using caller recognition and a keypad PIN.",
  "A phone conversation is not SMS consent. Only send a requested text when the caller has already opted in through the web form or by texting START.",
  "When a caller requests a text, a separate decision step uses the conversation and current N3XRA knowledge to compose the most relevant message. It asks for clarification instead of guessing when the request is unclear.",
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

function accountIntentFor(value) {
  const text = String(value || "").trim();
  const accountScoped = /\b(my|mine|me|account|billing status|subscription status|usage left|remaining usage|plan status|do i|am i|i owe|i have)\b/i.test(text);
  if (!accountScoped) return "";
  if (/\b(bill|billing|invoice|payment|charge|owe|due|paid|past due|card|receipt)\b/i.test(text)) return "billing";
  if (/\b(usage|limit|remaining|left|songs?|analys(?:is|es)|storage|requests? used)\b/i.test(text)) return "usage";
  if (/\b(subscription|subscriptions|plan|plans|renew|renewal|cancel|membership)\b/i.test(text)) return "subscriptions";
  if (/\b(website request|project|progress|stage|launch|onboarding|proposal)\b/i.test(text)) return "projects";
  if (/\b(support|ticket|case|help request)\b/i.test(text)) return "support";
  if (/\b(my account|account overview|account status|what.*account|tell me about.*account|products?.*(i have|my)|services?.*(i have|my)|my.*(products?|services?|access))\b/i.test(text)) return "general";
  return "";
}

function isAccountOverviewRequest(value) {
  return Boolean(accountIntentFor(value));
}

function isPasswordResetRequest(value) {
  return /\b(forgot (my )?password|reset (my |the )?password|password reset|send (me )?(a )?(password )?reset (email|link)|can'?t (log|sign) in)\b/i.test(String(value || ""));
}

function isEmergencyRequest(value) {
  return /\b(911|suicid|medical emergency|house (is )?on fire|someone (is )?(dying|unconscious)|immediate danger)\b/i.test(String(value || ""));
}

function isSmsRequest(value) {
  return /\b(text|sms|message)\b.*\b(me|my|link|information|info|details|website|page|that|it|summary|recap|next steps|instructions|directions|answer|explanation)\b|\b(send|share)\b.*\b(text|sms|link|that|it|information|info|details|summary|recap|next steps|instructions|directions|answer|explanation)\b/i.test(String(value || ""));
}

function normalizeSmsPlan(value) {
  const plan = value && typeof value === "object" ? value : {};
  const shouldSend = plan.shouldSend === true;
  const destination = Object.hasOwn(SMS_DESTINATIONS, plan.destination) ? plan.destination : "none";
  const cleanMessage = String(plan.message || "")
    .replace(/[*_`#>]/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
  const clarification = toSpeechText(plan.clarification).slice(0, 240);
  if (!shouldSend || !cleanMessage) {
    return {
      shouldSend: false,
      destination: "none",
      body: "",
      clarification: clarification || "What would you like me to text you?",
    };
  }
  const url = SMS_DESTINATIONS[destination];
  return {
    shouldSend: true,
    destination,
    body: `N3XRA: ${cleanMessage}${url ? ` ${url}` : ""} Reply STOP to opt out or HELP for help.`.slice(0, 1000),
    clarification: "",
  };
}

async function planRequestedSms(question, history) {
  const apiKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) throw new Error("Missing GROQ_API_KEY.");
  const siteContext = await askN3xra.getSiteContext(question, history);
  const model = String(process.env.GROQ_RECEPTIONIST_MODEL || process.env.GROQ_ASK_MODEL || "openai/gpt-oss-120b").trim();
  const destinations = Object.entries(SMS_DESTINATIONS)
    .map(([key, url]) => `${key}: ${url || "no link"}`)
    .join("\n");
  const messages = [
    {
      role: "system",
      content: [
        "Decide what the N3XRA phone receptionist should text in response to the caller's latest request.",
        "Return only one JSON object with exactly these fields: shouldSend (boolean), destination (allowed destination key), message (string), and clarification (string).",
        "Use the supplied current N3XRA knowledge and recent conversation as the source of truth.",
        "First determine exactly what the caller asked to receive. Prefer their explicit request; use recent context only to resolve references such as 'that' or 'the link.'",
        "Set shouldSend false when the requested content is unclear, unsupported, unsafe, sensitive, or would require private account data. In that case, put one short spoken question in clarification.",
        "When shouldSend is true, write a concise, useful transactional SMS in message. It may summarize the relevant answer, next step, or requested information instead of merely naming a page.",
        "If the caller asks for a summary or recap, summarize the relevant recent conversation faithfully and include the most useful next step. Do not introduce topics that were not discussed.",
        "Choose the single destination that best supports the request, or none when a link would not help. Do not put any URL in message; the server adds the verified destination.",
        "Never include or request passwords, PINs, payment data, Social Security numbers, private account details, or claims not supported by the supplied knowledge.",
        `Allowed destinations:\n${destinations}`,
        siteContext,
      ].join("\n\n"),
    },
    ...history.slice(-8),
    { role: "user", content: question },
  ];
  const schemaFormat = {
    type: "json_schema",
    json_schema: {
      name: "receptionist_sms_plan",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          shouldSend: { type: "boolean" },
          destination: { type: "string", enum: Object.keys(SMS_DESTINATIONS) },
          message: { type: "string" },
          clarification: { type: "string" },
        },
        required: ["shouldSend", "destination", "message", "clarification"],
      },
    },
  };
  let firstError;
  for (const responseFormat of [schemaFormat, { type: "json_object" }]) {
    try {
      const request = {
        model,
        temperature: 0,
        max_tokens: 500,
        response_format: responseFormat,
        messages,
      };
      if (/^openai\/gpt-oss-(20b|120b)$/i.test(model)) request.reasoning_effort = "low";
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data?.error?.message || data?.message || "SMS planning failed."));
      const content = String(data?.choices?.[0]?.message?.content || "").trim();
      if (!content) throw new Error("SMS planning returned an empty response.");
      return normalizeSmsPlan(JSON.parse(content));
    } catch (error) {
      if (!firstError) {
        firstError = error;
        console.warn("Receptionist SMS planning retry", { error: error?.message });
        continue;
      }
      throw new Error(`SMS planning failed after retry: ${error?.message || firstError?.message}`);
    }
  }
  throw firstError || new Error("SMS planning failed.");
}

function isAffirmativeTransferResponse(value) {
  return /^(yes|yeah|yep|sure|okay|ok|please|please do|connect me|transfer me|go ahead|that works|that would be great|sounds good|i(?:'d| would) like that)(\b|[.!?])/i.test(String(value || "").trim());
}

function isNegativeTransferResponse(value) {
  return /^(no|nope|not now|no thanks|don'?t|do not)(\b|[.!?])/i.test(String(value || "").trim());
}

function hasDirectTransferRequest(value) {
  const text = String(value || "");
  const person = "(?:Quentin|the founder|the owner|a person|a human|someone|a real person|a representative|a team member|a staff member)";
  const action = "(?:talk|speak|connect|transfer|forward|put me through|reach)";
  return new RegExp(`\\b${action}\\b.{0,80}\\b${person}\\b|\\b${person}\\b.{0,80}\\b${action}\\b`, "i").test(text);
}

function hasScreenedTransferRequest(question, history = []) {
  const userTurns = [
    ...history.filter((item) => item?.role === "user").slice(-4).map((item) => String(item.content || "")),
    String(question || ""),
  ].filter(Boolean);
  if (!hasDirectTransferRequest(userTurns.join(" "))) return false;
  return userTurns.some((turn) => /\b(account|bill|business|buy|collaborat|customer|discuss|idea|invest|issue|legal|media|music|n3xra|nexra|partner|payment|press|pricing|problem|project|proposal|question|quote|record|sale|security|service|software|support|utilit|viral|website|work)\w*\b/i.test(turn));
}

async function evaluateTransferWorthiness(question, history) {
  const screenedRequest = hasScreenedTransferRequest(question, history);
  const fallback = {
    offerTransfer: screenedRequest,
    requestedByCaller: screenedRequest,
    reason: screenedRequest ? "screened-caller-request" : "classifier-unavailable",
    summary: screenedRequest ? "The caller asked to speak with Quentin about a NEXRA matter." : "",
  };
  const apiKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) return fallback;
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
            "Set offerTransfer true when the caller explicitly asks for Quentin or a person and has given any legitimate N3XRA-related reason. The reason may be routine support, pricing, an account question, a project idea, sales, partnership, investment, media, legal, or security. Do not require urgency, a budget, an investment amount, or formal details.",
            "Use recent conversation to recognize a screened request: if the caller first asked for Quentin and then answered what the call is about, that is enough to offer the transfer.",
            "Also proactively set offerTransfer true when personal attention from Quentin would be useful, including a custom project, proposal, partnership, investment, unresolved customer problem, unusual request, or situation the receptionist cannot finish well.",
            "For routine informational questions that the receptionist can fully answer and guide to the website, keep offerTransfer false unless the caller has asked for a person.",
            "Keep offerTransfer false when the caller still has not explained why they want a person, or for spam, abuse, and emergencies requiring 911.",
            "The summary is for Quentin only. State what the caller is trying to accomplish in one concise sentence. Never include names, phone numbers, email addresses, passwords, PINs, payment data, or other sensitive details.",
            "An offer is only a recommendation or option, never permission to transfer. The caller must clearly confirm before the call is forwarded.",
          ].join(" "),
        },
        ...history.slice(-6),
        { role: "user", content: question },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { ...fallback, reason: screenedRequest ? fallback.reason : "classifier-error" };
  try {
    const result = JSON.parse(String(data?.choices?.[0]?.message?.content || "{}"));
    const modelOffered = result.offerTransfer === true;
    return {
      offerTransfer: modelOffered || screenedRequest,
      requestedByCaller: screenedRequest,
      reason: String(modelOffered ? (result.reason || "classified") : fallback.reason).slice(0, 40),
      summary: toSpeechText(result.summary).slice(0, 180) || fallback.summary,
    };
  } catch {
    return { ...fallback, reason: screenedRequest ? fallback.reason : "classifier-invalid" };
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
  ws.phoneRecorder?.record("nex_sent", "Absolutely. One moment while I try to connect you with Quentin.");
  ws.send(JSON.stringify({
    type: "text",
    token: "Absolutely. One moment while I try to connect you with Quentin.",
    last: true,
    interruptible: false,
    preemptible: false,
  }));
  ws.transferTimer = setTimeout(() => endForTransfer(ws), delayMs);
}

function splitSpeechIntoChunks(value, maxChars = 320) {
  const text = toSpeechText(value);
  if (!text) return [];
  const sentences = text.match(/[^.!?]+(?:[.!?]+["']?|$)/g) || [text];
  const chunks = [];
  for (const rawSentence of sentences) {
    let remaining = rawSentence.trim();
    while (remaining.length > maxChars) {
      const search = remaining.slice(0, maxChars + 1);
      const breakAt = Math.max(search.lastIndexOf(", "), search.lastIndexOf("; "), search.lastIndexOf(" "));
      const end = breakAt >= Math.floor(maxChars * 0.55) ? breakAt + 1 : maxChars;
      chunks.push(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trim();
    }
    if (remaining) chunks.push(remaining);
  }
  return chunks;
}

function sendSpeech(ws, token, { historyIndex = null, preemptible = !ws.phoneBuild?.active } = {}) {
  if (ws.readyState !== WebSocket.OPEN) return [];
  const fullText = toSpeechText(token);
  const chunks = splitSpeechIntoChunks(fullText);
  chunks.forEach((chunk, index) => {
    ws.send(JSON.stringify({
      type: "text",
      token: `${index > 0 ? " " : ""}${chunk}`,
      last: index === chunks.length - 1,
      interruptible: true,
      preemptible,
    }));
  });
  if (chunks.length) ws.phoneRecorder?.record("nex_sent", fullText);
  ws.activeSpeech = fullText ? { fullText, historyIndex } : null;
  return chunks;
}

function speechRemainder(fullText, utteranceUntilInterrupt) {
  const full = toSpeechText(fullText);
  const heard = toSpeechText(utteranceUntilInterrupt);
  if (!full) return "";
  if (!heard) return full;
  const directIndex = full.toLowerCase().indexOf(heard.toLowerCase());
  if (directIndex >= 0) return full.slice(directIndex + heard.length).replace(/^[\s,;:.-]+/, "").trim();
  const heardWords = heard.toLowerCase().match(/[a-z0-9']+/g) || [];
  if (!heardWords.length) return full;
  const lastWords = heardWords.slice(-6).join(" ");
  const normalizedFull = full.toLowerCase().replace(/[^a-z0-9']+/g, " ").trim();
  const overlapIndex = normalizedFull.indexOf(lastWords);
  if (overlapIndex < 0) return full;
  const consumedWords = normalizedFull.slice(0, overlapIndex + lastWords.length).split(" ").length;
  return full.split(/\s+/).slice(consumedWords).join(" ").replace(/^[\s,;:.-]+/, "").trim();
}

function recordSpeechInterruption(ws, message) {
  if (!ws.activeSpeech) return null;
  const heard = toSpeechText(message?.utteranceUntilInterrupt);
  ws.phoneRecorder?.record("interrupt", heard || "Interruption reported without spoken text.");
  const remainder = speechRemainder(ws.activeSpeech.fullText, heard);
  const historyIndex = ws.activeSpeech.historyIndex;
  if (Number.isInteger(historyIndex) && ws.history?.[historyIndex]?.role === "assistant") {
    if (heard) ws.history[historyIndex].content = heard;
    else ws.history.splice(historyIndex, 1);
  }
  ws.lastInterruption = { heard, remainder };
  ws.activeSpeech = null;
  return ws.lastInterruption;
}

function isContinueRequest(value) {
  return /^(?:please\s+)?(?:continue|go on|keep going|finish|finish that|finish what you were saying|what were you saying)(?:\s+please)?[.!?]*$/i.test(String(value || "").trim());
}

function resumeInterruptedSpeech(ws, question) {
  const remainder = toSpeechText(ws.lastInterruption?.remainder);
  if (!remainder || !isContinueRequest(question)) return false;
  ws.history.push({ role: "user", content: question }, { role: "assistant", content: remainder });
  ws.history = ws.history.slice(-10);
  const historyIndex = ws.history.length - 1;
  ws.lastInterruption = null;
  sendSpeech(ws, remainder, { historyIndex });
  return true;
}

async function sendRequestedSms(ws, question) {
  if (!question || !ws.fromNumber) {
    sendSpeech(ws, "I could not identify a mobile number for this call, so I cannot send that text.");
    return;
  }
  try {
    const consent = await latestConsent(ws.fromNumber);
    if (consent?.event_type !== "opt_in") {
      sendSpeech(ws, SMS_OPT_IN_INSTRUCTIONS);
      return;
    }
    const plan = await planRequestedSms(question, ws.history);
    if (!plan.shouldSend) {
      sendSpeech(ws, plan.clarification);
      return;
    }
    await sendTransactionalSms(ws.fromNumber, plan.body);
    sendSpeech(ws, "Done. I sent the requested information to the number you're calling from.");
  } catch (error) {
    console.error("Receptionist SMS failed", { callSid: ws.callSid, error: error?.message });
    sendSpeech(ws, "I could not send the text right now. Please visit NEXRA dot com or try again later.");
  }
}

async function sendAccountOverview(ws, intent) {
  try {
    sendSpeech(ws, await accountOverview(ws.caller.user_id, intent));
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

function completeAccountActionState(ws) {
  const action = ws.pendingAccountAction;
  const accountIntent = ws.pendingAccountIntent || "general";
  ws.pendingAccountAction = "";
  ws.pendingAccountIntent = "";
  ws.requestedSmsResource = null;
  ws.transferOffered = false;
  ws.transferSummary = "";
  return { action, accountIntent };
}

async function performAccountAction(ws) {
  const { action, accountIntent } = completeAccountActionState(ws);
  if (action === "build_studio") {
    ws.phoneBuild?.dispose();
    if (ws.phoneRecorder) await ws.phoneRecorder.close();
    ws.phoneRecorder = null;
    let reviewedInstruction = "";
    try {
      const capture = await PhoneRecorder.start(ws.caller.user_id, ws.callSid, process.env.N3XRA_PHONE_BUILD_WEBSITE_ID);
      if (capture) { ws.phoneRecorder = capture.recorder; reviewedInstruction = capture.instruction.instruction; }
    } catch { sendSpeech(ws, "Phone history is unavailable right now. You can still use the builder, but this conversation may not be saved."); }
    if (ws.readyState !== WebSocket.OPEN) { await ws.phoneRecorder?.close(); return; }
    ws.phoneBuild = new PhoneBuildConversation(createPhoneBuildRpc(ws.caller.user_id, ws.callSid),
      (text) => sendSpeech(ws, text), process.env.N3XRA_PHONE_BUILD_WEBSITE_ID,
      "N3XRA Build Studio Demo", undefined, undefined, reviewedInstruction, () => {
        // Allow the short goodbye to play before ending ConversationRelay.
        ws.transferTimer = setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "end", handoffData: JSON.stringify({ reasonCode: "requested-builder-callback" }) }));
        }, 3000);
      });
    if (ws.buildCallback) {
      const callback = ws.buildCallback; ws.buildCallback = null;
      try { await ws.phoneBuild.resumeCallback(callback.sessionId, callback.request, callback.result); }
      catch { sendSpeech(ws, "Your PIN is verified, but I could not reopen that workspace. Please check Build Studio before making more changes."); ws.phoneBuild.dispose(); }
    } else ws.phoneBuild.begin();
    return;
  }
  if (action === "password_reset") return sendPasswordReset(ws);
  return sendAccountOverview(ws, accountIntent);
}

async function requestVerifiedAccountAction(ws, action, accountIntent = "general") {
  await ws.callerReady;
  if (!ws.caller) {
    sendSpeech(ws, "I could not match this number to a NEXRA account. Please use the NEXRA sign-in page for secure account help.");
    return;
  }
  ws.pendingAccountAction = action;
  ws.pendingAccountIntent = accountIntent;
  if (ws.accountVerified) {
    await performAccountAction(ws);
    return;
  }
  ws.awaitingPin = true;
  ws.pinDigits = "";
  sendSpeech(ws, "For security, please enter your four digit phone PIN using the keypad. I will not ask you for personal information.");
}

function trimToCompleteSentence(value) {
  const text = toSpeechText(value);
  if (!text || /[.!?]["']?$/.test(text)) return text;
  const matches = [...text.matchAll(/[.!?]["']?(?=\s|$)/g)];
  if (!matches.length) return `${text}.`;
  const last = matches[matches.length - 1];
  return text.slice(0, last.index + last[0].length).trim();
}

async function requestGroqReply(question, history, interruption = null) {
  const apiKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) throw new Error("Missing GROQ_API_KEY.");
  const siteContext = await askN3xra.getSiteContext(question, history);
  const model = String(process.env.GROQ_RECEPTIONIST_MODEL || process.env.GROQ_ASK_MODEL || "openai/gpt-oss-120b").trim();
  const interruptionContext = interruption?.heard
    ? `\n\nINTERRUPTION CONTEXT: The caller heard only this portion of the previous response: "${interruption.heard}". Do not repeat it. Answer the new request naturally from that exact conversation state.`
    : "";
  const messages = [
    { role: "system", content: `${siteContext}\n\nPHONE RECEPTIONIST RULES:\n${RECEPTIONIST_RULES}${interruptionContext}` },
    ...history,
    { role: "user", content: question },
  ];
  const parts = [];
  let finishReason = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: attempt === 0 ? 600 : 400,
        messages,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(data?.error?.message || data?.message || "Groq request failed."));
    const part = toSpeechText(data?.choices?.[0]?.message?.content);
    if (!part) throw new Error("Groq returned an empty response.");
    parts.push(part);
    finishReason = String(data?.choices?.[0]?.finish_reason || "stop");
    if (finishReason !== "length") break;
    messages.push(
      { role: "assistant", content: part },
      { role: "user", content: "Continue exactly where you stopped. Finish the answer in complete sentences without repeating anything already written." },
    );
  }
  const reply = parts.join(" ").replace(/\s+/g, " ").trim();
  return finishReason === "length" ? trimToCompleteSentence(reply) : reply;
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
  ws.pendingAccountIntent = "";
  ws.requestedSmsResource = null;
  ws.transferStarting = false;
  ws.transferTimer = null;
  ws.activeSpeech = null;
  ws.lastInterruption = null;

  ws.on("close", () => {
    if (ws.transferTimer) clearTimeout(ws.transferTimer);
    ws.phoneBuild?.dispose();
    void ws.phoneRecorder?.close();
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
      ws.callerReady = (async () => {
        const isCallback = message.customParameters?.n3xraCallback === "true";
        const callback = isCallback ? await callbackForCall(ws.callSid) : null;
        if (isCallback && !callback) throw Error("Callback unavailable.");
        const caller = await getCallerAccount(callback ? callback.phone : message.from);
        if (callback) {
          if (!caller || caller.user_id !== callback.userId || message.to !== callback.phone) throw Error("Callback identity mismatch.");
          ws.fromNumber = callback.phone;
          ws.buildCallback = callback;
          ws.pendingAccountAction = "build_studio";
          ws.awaitingPin = true;
          ws.accountVerified = false;
          ws.pinDigits = "";
        }
        ws.caller = caller;
        return caller;
      })().catch(() => { ws.close(1008, "Caller verification unavailable"); return null; });
      return;
    }

    if (message.type === "interrupt") {
      recordSpeechInterruption(ws, message);
      ws.phoneBuild?.interrupted(toSpeechText(message.utteranceUntilInterrupt));
      return;
    }

    if (message.type === "dtmf") await ws.callerReady;
    if (message.type === "dtmf" && ws.awaitingPin) {
      const digit = String(message.digit || "");
      if (!/^[0-9]$/.test(digit)) return;
      ws.pinDigits = `${ws.pinDigits}${digit}`.slice(0, 4);
      if (ws.pinDigits.length < 4 || ws.processing) return;
      ws.processing = true;
      try {
        // Reload credentials so PIN changes and lockouts from earlier calls take effect.
        const freshCaller = await getCallerAccount(ws.fromNumber);
        if (!freshCaller || freshCaller.user_id !== ws.caller?.user_id) throw new Error("Caller access changed.");
        ws.caller = freshCaller;
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

    if (message.type === "prompt" && message.last === false) ws.phoneBuild?.listening();
    if (message.type === "prompt" && message.last !== false && !ws.awaitingPin) {
      ws.phoneRecorder?.record(ws.processing || ws.transferStarting ? "caller_ignored" : "caller", message.voicePrompt);
    }
    if (message.type !== "prompt" || message.last === false || ws.processing || ws.transferStarting) return;
    const question = toSpeechText(message.voicePrompt).slice(0, 800);
    if (!question) return;

    if (resumeInterruptedSpeech(ws, question)) return;
    const interruption = ws.lastInterruption;
    ws.lastInterruption = null;
    ws.activeSpeech = null;

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

    if (ws.awaitingPin) {
      sendSpeech(ws, "Please enter your PIN with the keypad; do not say it aloud.");
      return;
    }
    if (ws.phoneBuild?.active) {
      await ws.phoneBuild.handle(question);
      return;
    }
    if (isPhoneBuildRequest(question)) {
      if (!phoneBuildConfigured()) {
        sendSpeech(ws, "Phone editing is not enabled yet. Please use Build Studio in the dashboard.");
        return;
      }
      // Always verify a fresh PIN for elevated editing, even after an account overview.
      ws.accountVerified = false;
      await requestVerifiedAccountAction(ws, "build_studio");
      return;
    }
    if (isPasswordResetRequest(question)) {
      await requestVerifiedAccountAction(ws, "password_reset");
      return;
    }

    if (isAccountOverviewRequest(question)) {
      await requestVerifiedAccountAction(ws, "account_overview", accountIntentFor(question));
      return;
    }

    if (isSmsRequest(question)) {
      ws.processing = true;
      try {
        await sendRequestedSms(ws, question);
      } finally {
        ws.processing = false;
      }
      return;
    }

    ws.processing = true;
    try {
      const [reply, transferDecision] = await Promise.all([
        requestGroqReply(question, ws.history, interruption),
        evaluateTransferWorthiness(question, ws.history),
      ]);
      let spokenReply = reply;
      if (transferDecision.offerTransfer) {
        ws.transferOffered = true;
        ws.transferSummary = transferDecision.summary;
        const transferOffer = transferDecision.requestedByCaller
          ? "If you'd still like, I can try connecting you with Quentin now. Would you like me to do that?"
          : "This sounds like something Quentin may want to handle personally. Would you like me to try connecting you now?";
        spokenReply = `${reply} ${transferOffer}`;
      }
      ws.history.push({ role: "user", content: question }, { role: "assistant", content: spokenReply });
      ws.history = ws.history.slice(-10);
      sendSpeech(ws, spokenReply, { historyIndex: ws.history.length - 1 });
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
module.exports.accountIntentFor = accountIntentFor;
module.exports.isPasswordResetRequest = isPasswordResetRequest;
module.exports.isAffirmativeTransferResponse = isAffirmativeTransferResponse;
module.exports.isEmergencyRequest = isEmergencyRequest;
module.exports.isNegativeTransferResponse = isNegativeTransferResponse;
module.exports.hasDirectTransferRequest = hasDirectTransferRequest;
module.exports.hasScreenedTransferRequest = hasScreenedTransferRequest;
module.exports.evaluateTransferWorthiness = evaluateTransferWorthiness;
module.exports.announceAndTransfer = announceAndTransfer;
module.exports.isSmsRequest = isSmsRequest;
module.exports.normalizeSmsPlan = normalizeSmsPlan;
module.exports.planRequestedSms = planRequestedSms;
module.exports.SMS_DESTINATIONS = SMS_DESTINATIONS;
module.exports.SMS_OPT_IN_INSTRUCTIONS = SMS_OPT_IN_INSTRUCTIONS;
module.exports.completeAccountActionState = completeAccountActionState;
module.exports.splitSpeechIntoChunks = splitSpeechIntoChunks;
module.exports.sendSpeech = sendSpeech;
module.exports.speechRemainder = speechRemainder;
module.exports.recordSpeechInterruption = recordSpeechInterruption;
module.exports.isContinueRequest = isContinueRequest;
module.exports.resumeInterruptedSpeech = resumeInterruptedSpeech;
module.exports.trimToCompleteSentence = trimToCompleteSentence;
