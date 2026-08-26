export function getAdminSession(options?: { redirect?: boolean; force?: boolean }): Promise<{
  allowed: boolean;
  supabase: any;
  session: { access_token: string; user: { id: string } } | null;
}>;
