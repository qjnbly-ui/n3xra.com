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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse(
        {
          error:
            "Supabase environment variables are missing. Required: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.",
        },
        500
      );
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

    const { data: ownedOrganizations, error: ownedOrganizationsError } = await adminClient
      .from("organizations")
      .select("id, name, subscription_tier")
      .eq("owner_user_id", user.id);

    if (ownedOrganizationsError) {
      return jsonResponse({ error: ownedOrganizationsError.message }, 400);
    }

    const paidOwnedOrganizations = (ownedOrganizations || []).filter((org) =>
      ["starter", "organization"].includes(String(org.subscription_tier || ""))
    );
    if (paidOwnedOrganizations.length) {
      return jsonResponse({ error: "Cancel paid libraries before deleting this account." }, 400);
    }

    const ownedOrganizationIds = (ownedOrganizations || []).map((org) => org.id);

    if (ownedOrganizationIds.length) {
      const { data: documents, error: documentsError } = await adminClient
        .from("documents")
        .select("storage_path")
        .in("organization_id", ownedOrganizationIds);

      if (documentsError) {
        return jsonResponse({ error: documentsError.message }, 400);
      }

      const storagePaths = (documents || [])
        .map((doc) => doc.storage_path)
        .filter((path): path is string => Boolean(path));

      if (storagePaths.length) {
        const { error: storageError } = await adminClient.storage.from("documents").remove(storagePaths);
        if (storageError) {
          return jsonResponse({ error: storageError.message }, 400);
        }
      }
      const { error: deleteOrganizationsError } = await adminClient
        .from("organizations")
        .delete()
        .in("id", ownedOrganizationIds);

      if (deleteOrganizationsError) {
        return jsonResponse({ error: deleteOrganizationsError.message }, 400);
      }
    }

    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
      return jsonResponse({ error: deleteUserError.message }, 400);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected delete-account error.";
    console.error("delete-account failed:", message);
    return jsonResponse({ error: message }, 500);
  }
});
