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

export function getAppUrl(path = "/app") {
  const normalizedPath = String(path || "/app").startsWith("/") ? String(path || "/app") : `/${path}`;
  return `${window.location.origin}${normalizedPath}`;
}

export function hasSupabaseAuthCallbackParams() {
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash);
  if (hashParams.has("access_token") || hashParams.has("refresh_token") || hashParams.has("type")) return true;
  const code = String(params.get("code") || "").trim();
  if (code.length < 16) return false;

  const requestedSignup = String(params.get("signup") || params.get("mode") || "").toLowerCase();
  return requestedSignup !== "invite" && !params.has("invite") && !params.has("invite_code");
}

export function getSupabaseAuthCallbackType() {
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash);
  return String(hashParams.get("type") || params.get("type") || "").trim().toLowerCase();
}

function cleanAuthCallbackUrl({ removeCode = false, removeHash = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  if (removeCode) {
    params.delete("code");
    params.delete("type");
  }

  const search = params.toString();
  const hash = removeHash ? "" : window.location.hash;
  const cleanUrl = `${window.location.origin}${window.location.pathname}${search ? `?${search}` : ""}${hash || ""}`;
  window.history.replaceState({}, document.title, cleanUrl);
}

export async function consumeAuthCallbackSessionIfPresent(supabase) {
  if (!supabase || !hasSupabaseAuthCallbackParams()) return null;

  const hashParams = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash);
  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    cleanAuthCallbackUrl({ removeHash: true });
    return data?.session || null;
  }

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return null;

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;

  cleanAuthCallbackUrl({ removeCode: true });
  return data?.session || null;
}

export async function exchangeAuthCodeForSessionIfPresent(supabase) {
  return consumeAuthCallbackSessionIfPresent(supabase);
}

export async function getSessionOrNull(supabase) {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data?.session || null;
}
