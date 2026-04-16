import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

export function getConfig() {
  return window.RECORDS_APP_CONFIG || {};
}

export function hasConfig() {
  const config = getConfig();
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

export function createBrowserSupabase() {
  const config = getConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
  return createClient(config.supabaseUrl, config.supabaseAnonKey);
}

export async function getSessionOrNull(supabase) {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data?.session || null;
}
