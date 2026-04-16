import { createBrowserSupabase, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";
import { isPlatformAdminEmail } from "./lib/orgs.js";

async function route() {
  if (!hasConfig()) {
    window.location.replace("./login");
    return;
  }

  const supabase = createBrowserSupabase();
  try {
    const session = await getSessionOrNull(supabase);
    if (!session?.user) {
      window.location.replace("./login");
      return;
    }

    window.location.replace(isPlatformAdminEmail(session.user.email) ? "./admin" : "./dashboard");
  } catch {
    window.location.replace("./login");
  }
}

route();
