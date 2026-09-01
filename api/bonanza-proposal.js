const crypto = require("node:crypto");
const { apiError, parseJson, serviceRequest } = require("./_website-proposal-ai-supabase");

const PROPOSAL_SLUG = "town-of-bonanza";
const SECTION_CHOICES = Object.freeze({
  included_website: ["looks_good", "question"],
  included_data: ["looks_good", "question"],
  included_content: ["looks_good", "question"],
  included_forms: ["looks_good", "question"],
  included_payments: ["looks_good", "question"],
  addon_records: ["add_now", "later", "question"],
  addon_communications: ["basic", "plus", "later", "question"],
  later_grant: ["interested", "later", "question"],
  later_workspace: ["interested", "later", "question"],
  overall: ["comfortable", "discuss"],
  presentation_comments: ["comment"],
});

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function codeHash(value) {
  return crypto.createHash("sha256").update(normalizeCode(value), "utf8").digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maxLength);
}

async function loadProposal(code) {
  if (!normalizeCode(code)) throw apiError("Enter the shared access code.", 401);
  const rows = await serviceRequest(
    `collaborative_proposals?select=id,slug,title,status,access_code_hash&slug=eq.${PROPOSAL_SLUG}&limit=1`,
  );
  const proposal = Array.isArray(rows) ? rows[0] : null;
  if (!proposal || proposal.status !== "open") throw apiError("This presentation is not available.", 404);
  if (!safeEqual(codeHash(code), proposal.access_code_hash)) throw apiError("That access code is not correct.", 401);
  return proposal;
}

async function readResponses(proposalId) {
  return serviceRequest(
    `collaborative_proposal_responses?select=participant_id,participant_name,section_key,choice,note,updated_at&proposal_id=eq.${encodeURIComponent(proposalId)}&order=updated_at.desc`,
  );
}

function sendError(res, error) {
  const status = Number(error?.status || 500);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: status >= 500 ? "The presentation could not be updated. Please try again." : error.message,
  });
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const body = await parseJson(req);
    const proposal = await loadProposal(body.accessCode);
    if (body.action === "read") {
      const responses = await readResponses(proposal.id);
      return res.status(200).json({ proposal: { slug: proposal.slug, title: proposal.title }, responses });
    }
    if (body.action !== "save") throw apiError("Choose a valid action.", 400);

    const participantId = cleanText(body.participantId, 36);
    const participantName = cleanText(body.participantName, 80);
    const sectionKey = cleanText(body.sectionKey, 80);
    const choice = cleanText(body.choice, 40);
    const note = cleanText(body.note, 1200);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(participantId)) throw apiError("Refresh the page and try again.", 400);
    if (participantName.length < 2) throw apiError("Enter your name before responding.", 400);
    if (!SECTION_CHOICES[sectionKey]?.includes(choice)) throw apiError("Choose one of the available responses.", 400);
    if (["question", "comment"].includes(choice) && note.length < 2) throw apiError("Add your comment before saving.", 400);

    await serviceRequest("collaborative_proposal_responses?on_conflict=proposal_id,participant_id,section_key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        proposal_id: proposal.id,
        participant_id: participantId,
        participant_name: participantName,
        section_key: sectionKey,
        choice,
        note,
      }),
    });
    const responses = await readResponses(proposal.id);
    return res.status(200).json({ ok: true, responses });
  } catch (error) {
    return sendError(res, error);
  }
}

module.exports = handler;
module.exports._test = { codeHash, normalizeCode, safeEqual, SECTION_CHOICES };
