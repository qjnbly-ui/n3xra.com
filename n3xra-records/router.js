import {
  createBrowserSupabase,
  exchangeAuthCodeForSessionIfPresent,
  hasConfig,
  getSessionOrNull,
} from "/shared/lib/supabase-client.js";

async function route() {
  if (!hasConfig()) {
    window.location.replace("/n3xra-records/login");
    return;
  }

  const supabase = createBrowserSupabase();
  try {
    const session = await exchangeAuthCodeForSessionIfPresent(supabase) || await getSessionOrNull(supabase);
    if (!session?.user) {
      window.location.replace("/n3xra-records/login");
      return;
    }

    window.location.replace("/n3xra-records/library");
  } catch {
    window.location.replace("/n3xra-records/login");
  }
}

route();
