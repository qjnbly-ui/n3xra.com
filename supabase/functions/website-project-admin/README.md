# Website project administration

## GitHub repository provisioning

The `provision-website-github` action creates one private organization repository from the standard N3XRA website template. The action is manual, platform-admin-only, lifecycle-gated, leased, and retry-safe.

Configure these Supabase Edge Function secrets before enabling the action in production:

- `GITHUB_APP_CLIENT_ID`: GitHub App client ID. `GITHUB_APP_ID` is accepted as a fallback.
- `GITHUB_APP_PRIVATE_KEY`: complete GitHub App PEM private key. A value containing escaped `\n` line breaks is accepted.
- `GITHUB_APP_INSTALLATION_ID`: installation ID for the N3XRA GitHub organization.
- `GITHUB_ORGANIZATION`: organization that owns generated client repositories.
- `GITHUB_TEMPLATE_OWNER`: owner of the standard website template repository.
- `GITHUB_TEMPLATE_REPOSITORY`: template repository name without `.git`.
- `GITHUB_API_VERSION`: optional GitHub REST API version; defaults to `2026-03-10`.

The GitHub App installation needs repository **Administration: write** and **Contents: read** permissions. The source repository must be marked as a template. Install the App so it can access the template and repositories it creates; organization-wide repository access is the simplest reliable configuration.

## Vercel preview provisioning

The `provision-website-vercel` action becomes available only after the GitHub repository is ready. It creates or safely recovers one Vercel project, connects the private GitHub repository, starts an explicit Preview deployment, and stores the generated `vercel.app` URL. It never assigns a production domain.

Required production secrets:

- `VERCEL_ACCESS_TOKEN`: Vercel access token scoped to the N3XRA team.
- `VERCEL_TEAM_ID`: Vercel team ID receiving managed website projects.
- `VERCEL_TEAM_SLUG`: Team slug used for the administrator project link.

Provisioning deliberately does not promote a deployment to production, connect a domain, or modify DNS. Those remain separate future approval stages.
