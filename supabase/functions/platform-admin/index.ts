import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getAppOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin) return origin;

  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // Ignore invalid referrers and fall back to the production domain.
    }
  }

  return "https://n3xra.com";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Supabase environment variables are missing." }, 500);
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: userError?.message || "Unable to resolve user." }, 401);
    }

    if (String(user.email || "").toLowerCase() !== "quentin@quentinnichols.com") {
      return jsonResponse({ error: "Platform admin access required." }, 403);
    }

    const payload = await request.json().catch(() => ({}));
    const action = payload.action;

    if (action === "reset-password") {
      const email = String(payload.email || "").trim();
      if (!email) {
        return jsonResponse({ error: "email is required." }, 400);
      }

      const redirectTo = `${getAppOrigin(request)}/app/reset-password.html`;
      const { error } = await adminClient.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) {
        return jsonResponse({ error: error.message }, 400);
      }

      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Unsupported platform-admin action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected platform-admin error.";
    return jsonResponse({ error: message }, 500);
  }
});
