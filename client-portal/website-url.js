export function resolveWebsiteUrl(website, domains = []) {
  const primaryDomain = domains.find((domain) => domain.website_id === website?.id && domain.is_primary)
    || domains.find((domain) => domain.website_id === website?.id);
  const value = website?.live_url || primaryDomain?.domain_name || "";
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function resolveWebsiteRepository(website, repositories = []) {
  return website?.repository_full_name
    || repositories.find((repository) => repository.website_id === website?.id)?.full_name
    || "";
}
