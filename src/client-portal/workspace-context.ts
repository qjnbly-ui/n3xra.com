type WorkspaceScope = "client" | "admin";
type WorkspaceContext = Record<string, unknown> & { userId?: string; websiteId?: string; name?: string };

const keys: Record<WorkspaceScope, string> = {
  client: "n3xra-client-workspace-context",
  admin: "n3xra-admin-workspace-context",
};

export function readWorkspaceContext(scope: WorkspaceScope, userId: string): WorkspaceContext {
  try {
    const context = JSON.parse(localStorage.getItem(keys[scope]) || "{}") as WorkspaceContext;
    return !context.userId || context.userId === userId ? context : {};
  } catch {
    return {};
  }
}

export function writeWorkspaceContext(scope: WorkspaceScope, userId: string, values: WorkspaceContext): WorkspaceContext {
  const context: WorkspaceContext = { ...readWorkspaceContext(scope, userId), ...values, userId };
  Object.keys(context).forEach((key) => {
    if (context[key] === undefined || context[key] === null || context[key] === "") delete context[key];
  });
  localStorage.setItem(keys[scope], JSON.stringify(context));
  window.dispatchEvent(new CustomEvent("n3xra:workspace-context-change", { detail: { scope, context } }));
  return context;
}

export function projectContext(project: any): WorkspaceContext {
  const website = Array.isArray(project?.client_websites) ? project.client_websites[0] : project?.client_websites;
  return {
    projectId: project?.id,
    requestId: project?.request_id,
    proposalId: project?.proposal_id,
    websiteId: project?.managed_website_id || website?.id,
    name: project?.name || website?.name,
  };
}
