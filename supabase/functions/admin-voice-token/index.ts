import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type VoiceConfiguration = {
  twilio_api_key_sid: string;
  twilio_api_key_secret: string;
  twilio_twiml_app_sid: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function twilioBasicAuth(accountSid: string, authToken: string) {
  return `Basic ${btoa(`${accountSid}:${authToken}`)}`;
}

async function twilioFormRequest(
  path: string,
  accountSid: string,
  authToken: string,
  body: URLSearchParams,
  method = "POST",
) {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/${path}`, {
    method,
    headers: {
      Authorization: twilioBasicAuth(accountSid, authToken),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "DELETE" ? undefined : body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(data?.message || `Twilio request failed (${response.status}).`));
    Object.assign(error, { status: response.status, twilioCode: data?.code });
    throw error;
  }
  return data;
}

async function removeTwilioResource(path: string, accountSid: string, authToken: string) {
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/${path}`, {
    method: "DELETE",
    headers: { Authorization: twilioBasicAuth(accountSid, authToken) },
  }).catch(() => null);
}

async function createVoiceConfiguration(
  adminClient: ReturnType<typeof createClient>,
  accountSid: string,
  authToken: string,
) {
  const key = await twilioFormRequest(
    "Keys.json",
    accountSid,
    authToken,
    new URLSearchParams({ FriendlyName: "N3XRA Admin Voice" }),
  );
  if (!/^SK[0-9a-f]{32}$/i.test(String(key.sid || "")) || !String(key.secret || "")) {
    throw new Error("Twilio did not return a usable Voice API key.");
  }

  let application: Record<string, unknown> | null = null;
  try {
    application = await twilioFormRequest(
      "Applications.json",
      accountSid,
      authToken,
      new URLSearchParams({
        FriendlyName: "N3XRA Admin Browser Calling",
        VoiceUrl: "https://www.n3xra.com/api/admin-communications-voice-outbound",
        VoiceMethod: "POST",
      }),
    );
    if (!/^AP[0-9a-f]{32}$/i.test(String(application.sid || ""))) {
      throw new Error("Twilio did not return a usable Voice application.");
    }

    const configuration = {
      singleton: true,
      twilio_api_key_sid: String(key.sid),
      twilio_api_key_secret: String(key.secret),
      twilio_twiml_app_sid: String(application.sid),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await adminClient
      .from("admin_voice_configuration")
      .upsert(configuration, { onConflict: "singleton" })
      .select("twilio_api_key_sid,twilio_api_key_secret,twilio_twiml_app_sid")
      .single();
    if (error || !data) throw new Error(error?.message || "Unable to save the Voice configuration.");
    return data as VoiceConfiguration;
  } catch (error) {
    if (application?.sid) await removeTwilioResource(`Applications/${application.sid}.json`, accountSid, authToken);
    await removeTwilioResource(`Keys/${key.sid}.json`, accountSid, authToken);
    throw error;
  }
}

async function loadVoiceConfiguration(
  adminClient: ReturnType<typeof createClient>,
  accountSid: string,
  authToken: string,
) {
  const { data, error } = await adminClient
    .from("admin_voice_configuration")
    .select("twilio_api_key_sid,twilio_api_key_secret,twilio_twiml_app_sid")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VoiceConfiguration | null) || createVoiceConfiguration(adminClient, accountSid, authToken);
}

function base64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function createVoiceToken(accountSid: string, configuration: VoiceConfiguration, identity: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", cty: "twilio-fpa;v=1", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    jti: `${configuration.twilio_api_key_sid}-${now}`,
    grants: {
      identity,
      voice: { outgoing: { application_sid: configuration.twilio_twiml_app_sid } },
    },
    iat: now,
    exp: now + 900,
    iss: configuration.twilio_api_key_sid,
    sub: accountSid,
  }));
  const signingKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(configuration.twilio_api_key_secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", signingKey, new TextEncoder().encode(`${header}.${payload}`)));
  return `${header}.${payload}.${base64Url(signature)}`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
    const accountSid = String(Deno.env.get("TWILIO_ACCOUNT_SID") || "").trim();
    const authToken = String(Deno.env.get("TWILIO_AUTH_TOKEN") || "").trim();
    const authHeader = request.headers.get("Authorization");
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authHeader) return jsonResponse({ error: "Voice authentication is unavailable." }, 500);
    if (!/^AC[0-9a-f]{32}$/i.test(accountSid) || !authToken) return jsonResponse({ error: "Twilio Voice credentials are unavailable." }, 503);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "Authentication required." }, 401);

    const { data: platformAdmin, error: adminError } = await adminClient
      .from("platform_admins")
      .select("user_id,role,status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .in("role", ["owner", "admin"])
      .maybeSingle();
    if (adminError) throw new Error(adminError.message);
    if (!platformAdmin) return jsonResponse({ error: "Active platform administrator access is required." }, 403);

    const configuration = await loadVoiceConfiguration(adminClient, accountSid, authToken);
    const token = await createVoiceToken(accountSid, configuration, `n3xra-admin-${user.id}`);
    return jsonResponse({ success: true, token, expiresIn: 900 });
  } catch (error) {
    console.error("N3XRA Voice token failed", error instanceof Error ? error.message : error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Calling is unavailable." }, 500);
  }
});
