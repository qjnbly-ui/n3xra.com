// Configured by the platform owner using an identity verified in GitHub.
// Never infer deployment identity from an unrelated N3XRA login email.
export function gitCommitIdentity(env: NodeJS.ProcessEnv = process.env) {
  const name = String(env.N3XRA_BUILD_GIT_AUTHOR_NAME || "").trim();
  const email = String(env.N3XRA_BUILD_GIT_AUTHOR_EMAIL || "").trim();
  if (!name || /[\r\n\0<>]/.test(name) || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) {
    throw new Error("Checkpoint author is not configured. Connect a verified GitHub commit identity in the Build Studio worker settings before saving.");
  }
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
}
