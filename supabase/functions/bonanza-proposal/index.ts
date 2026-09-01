import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const PROPOSAL_SLUG = "town-of-bonanza";
const ALLOWED_ORIGINS = new Set([
  "https://n3xra.com",
  "https://www.n3xra.com",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);
const SECTION_CHOICES: Record<string, string[]> = {
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
};

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://n3xra.com",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maxLength);
}

async function codeHash(value: unknown) {
  const normalized = String(value || "").trim().toUpperCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json(request, { error: "The planning page is not configured." }, 503);
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return json(request, { error: "The request body is not valid JSON." }, 400);

    const accessCode = cleanText(body.accessCode, 100);
    if (!accessCode) return json(request, { error: "Enter the shared access code." }, 401);
    const { data: proposal, error: proposalError } = await admin
      .from("collaborative_proposals")
      .select("id,slug,title,status,access_code_hash")
      .eq("slug", PROPOSAL_SLUG)
      .maybeSingle();
    if (proposalError) throw proposalError;
    if (!proposal || proposal.status !== "open") return json(request, { error: "This presentation is not available." }, 404);
    if (!safeEqual(await codeHash(accessCode), String(proposal.access_code_hash || ""))) {
      return json(request, { error: "That access code is not correct." }, 401);
    }

    if (body.action === "save") {
      const participantId = cleanText(body.participantId, 36);
      const participantName = cleanText(body.participantName, 80);
      const sectionKey = cleanText(body.sectionKey, 80);
      const choice = cleanText(body.choice, 40);
      const note = cleanText(body.note, 1200);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(participantId)) {
        return json(request, { error: "Refresh the page and try again." }, 400);
      }
      if (participantName.length < 2) return json(request, { error: "Enter your name before responding." }, 400);
      if (!SECTION_CHOICES[sectionKey]?.includes(choice)) return json(request, { error: "Choose one of the available responses." }, 400);
      if (["question", "comment"].includes(choice) && note.length < 2) return json(request, { error: "Add your comment before saving." }, 400);

      const { error: saveError } = await admin.from("collaborative_proposal_responses").upsert({
        proposal_id: proposal.id,
        participant_id: participantId,
        participant_name: participantName,
        section_key: sectionKey,
        choice,
        note,
      }, { onConflict: "proposal_id,participant_id,section_key" });
      if (saveError) throw saveError;
    } else if (body.action !== "read") {
      return json(request, { error: "Choose a valid action." }, 400);
    }

    const { data: responses, error: responsesError } = await admin
      .from("collaborative_proposal_responses")
      .select("participant_id,participant_name,section_key,choice,note,updated_at")
      .eq("proposal_id", proposal.id)
      .order("updated_at", { ascending: false });
    if (responsesError) throw responsesError;
    return json(request, {
      ...(body.action === "save" ? { ok: true } : { proposal: { slug: proposal.slug, title: proposal.title } }),
      responses: responses || [],
    });
  } catch (error) {
    console.error("bonanza-proposal", error);
    return json(request, { error: "The presentation could not be updated. Please try again." }, 500);
  }
});
