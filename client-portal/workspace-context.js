const keys = {
  client: "n3xra-client-workspace-context",
  admin: "n3xra-admin-workspace-context",
};

export function readWorkspaceContext(scope, userId) {
  try {
    const context = JSON.parse(localStorage.getItem(keys[scope]) || "{}");
    return !context.userId || context.userId === userId ? context : {};
  } catch {
    return {};
  }
}

export function writeWorkspaceContext(scope, userId, values) {
  const context = { ...readWorkspaceContext(scope, userId), ...values, userId };
  Object.keys(context).forEach((key) => {
    if (context[key] === undefined || context[key] === null || context[key] === "") delete context[key];
  });
  localStorage.setItem(keys[scope], JSON.stringify(context));
  return context;
}

export function projectContext(project) {
  const website = Array.isArray(project?.client_websites) ? project.client_websites[0] : project?.client_websites;
  return {
    projectId: project?.id,
    requestId: project?.request_id,
    proposalId: project?.proposal_id,
    websiteId: project?.managed_website_id || website?.id,
    name: project?.name || website?.name,
  };
}
