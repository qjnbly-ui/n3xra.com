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

    const payload = await request.json().catch(() => ({}));
    const deleteScope = String(payload?.scope || "full").trim().toLowerCase();
    const deleteApp = String(payload?.app || "").trim().toLowerCase();

    let { data: ownedOrganizations, error: ownedOrganizationsError } = await adminClient
      .from("organizations")
      .select("id, name, subscription_tier, account_status, cancel_at_period_end, logo_storage_path")
      .eq("owner_user_id", user.id);

    if (ownedOrganizationsError && String(ownedOrganizationsError.message || "").includes("logo_storage_path")) {
      const fallbackResult = await adminClient
        .from("organizations")
        .select("id, name, subscription_tier, account_status, cancel_at_period_end")
        .eq("owner_user_id", user.id);
      ownedOrganizations = fallbackResult.data;
      ownedOrganizationsError = fallbackResult.error;
    }

    if (ownedOrganizationsError) {
      return jsonResponse({ error: ownedOrganizationsError.message }, 400);
    }

    const paidOwnedOrganizations = (ownedOrganizations || []).filter((org) =>
      ["starter", "organization"].includes(String(org.subscription_tier || "")) &&
      !["canceled", "suspended"].includes(String(org.account_status || "active")) &&
      !Boolean(org.cancel_at_period_end)
    );
    if (paidOwnedOrganizations.length) {
      return jsonResponse({ error: "Cancel paid libraries before deleting this account." }, 400);
    }

    const { data: musicProfile, error: musicProfileError } = await adminClient
      .from("music_profiles")
      .select("plan, account_status, cancel_at_period_end")
      .eq("user_id", user.id)
      .maybeSingle();

    if (musicProfileError) {
      return jsonResponse({ error: musicProfileError.message }, 400);
    }

    const hasActivePaidMusicPlan =
      ["creator", "studio"].includes(String(musicProfile?.plan || "free")) &&
      !["canceled", "suspended"].includes(String(musicProfile?.account_status || "active")) &&
      !Boolean(musicProfile?.cancel_at_period_end);

    if (hasActivePaidMusicPlan) {
      return jsonResponse({ error: "Cancel your paid AI Music plan before deleting this account." }, 400);
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

      const logoStoragePaths = (ownedOrganizations || [])
        .map((org) => org.logo_storage_path)
        .filter((path): path is string => Boolean(path));

      if (logoStoragePaths.length) {
        const { error: logoStorageError } = await adminClient.storage.from("organization-assets").remove(logoStoragePaths);
        if (logoStorageError) {
          return jsonResponse({ error: logoStorageError.message }, 400);
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

    if (deleteScope === "app" && deleteApp === "records") {
      const { error: detachReviewsError } = await adminClient
        .from("reviews")
        .update({ user_id: null })
        .eq("app", "records")
        .eq("user_id", user.id);
      if (detachReviewsError && !String(detachReviewsError.message || "").toLowerCase().includes("reviews")) {
        return jsonResponse({ error: detachReviewsError.message }, 400);
      }

      const { error: membershipDeleteError } = await adminClient
        .from("organization_memberships")
        .delete()
        .eq("user_id", user.id);
      if (membershipDeleteError) {
        return jsonResponse({ error: membershipDeleteError.message }, 400);
      }
      return jsonResponse({ ok: true, scope: "app", app: "records" });
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
