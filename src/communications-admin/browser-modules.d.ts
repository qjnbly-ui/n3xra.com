export interface AdminSessionContext {
  allowed: boolean;
  session: { access_token?: string; user?: { id?: string } } | null;
  user: { id?: string } | null;
  admin: { role?: string; status?: string } | null;
}

export function getAdminSession(options?: { redirect?: boolean; force?: boolean }): Promise<AdminSessionContext>;
