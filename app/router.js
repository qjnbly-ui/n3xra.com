import { createBrowserSupabase, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";
import { isPlatformAdminEmail } from "./lib/orgs.js";

async function route() {
  if (!hasConfig()) {
    window.location.replace("./login.html");
    return;
  }

  const supabase = createBrowserSupabase();
  try {
    const session = await getSessionOrNull(supabase);
    if (!session?.user) {
      window.location.replace("./login.html");
      return;
    }

    window.location.replace(isPlatformAdminEmail(session.user.email) ? "./admin.html" : "./dashboard.html");
  } catch {
    window.location.replace("./login.html");
  }
}

route();
