const { createHash } = require("node:crypto");
const { apiError, downloadStorageObject, serviceRequest } = require("./_website-proposal-ai-supabase");

const MAX_SELECTED_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 25 * 1024 * 1024;

function one(rows, message) {
  const value = Array.isArray(rows) ? rows[0] : null;
  if (!value) throw apiError(message, 404);
  return value;
}

function source(sourceType, sourceId, label, authority, status, updatedAt, content, defaultIncluded = true) {
  return {
    key: `${sourceType}:${sourceId}`,
    source_type: sourceType,
    source_id: String(sourceId),
    label,
    authority,
    status,
    updated_at: updatedAt || null,
    default_included: defaultIncluded,
    content,
  };
}

function safeRequest(request) {
  if (!request) return null;
  return {
    id: request.id,
    status: request.status,
    business_name: request.business_name,
    project_type: request.project_type,
    primary_goal: request.primary_goal,
    audience: request.audience,
    requested_pages: request.requested_pages || [],
    requested_features: request.requested_features || [],
    service_plan: request.service_plan,
    budget_range: request.budget_range,
    target_launch_date: request.target_launch_date,
    additional_notes: request.additional_notes,
    updated_at: request.updated_at,
  };
}

function safeProject(project) {
  if (!project) return null;
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    current_stage: project.current_stage,
    target_start_date: project.target_start_date,
    target_launch_date: project.target_launch_date,
    client_summary: project.client_summary,
    managed_website_id: project.managed_website_id,
    updated_at: project.updated_at,
  };
}

function safeOperational(records = {}) {
  return {
    website: records.website ? {
      id: records.website.id, name: records.website.name, live_url: records.website.live_url,
      status: records.website.status, updated_at: records.website.updated_at,
    } : null,
    domains: (records.domains || []).map((row) => ({
      id: row.id, domain_name: row.domain_name, registrar: row.registrar, dns_provider: row.dns_provider,
      status: row.status, ownership: row.ownership, is_primary: row.is_primary, updated_at: row.updated_at,
    })),
    repositories: (records.repositories || []).map((row) => ({
      id: row.id, provider: row.provider, full_name: row.full_name, html_url: row.html_url,
      default_branch: row.default_branch, visibility: row.visibility, access_status: row.access_status,
      updated_at: row.updated_at,
    })),
    services: (records.services || []).map((row) => ({
      id: row.id, service_type: row.service_type, name: row.name, provider: row.provider,
      status: row.status, ownership: row.ownership, plan_name: row.plan_name,
      public_url: row.public_url, client_summary: row.client_summary, updated_at: row.updated_at,
    })),
  };
}

function selectAssetVersions(assets, versions) {
  const byAsset = new Map();
  for (const version of versions) {
    const values = byAsset.get(version.asset_id) || [];
    values.push(version);
    byAsset.set(version.asset_id, values);
  }
  return assets.flatMap((asset) => {
    if (asset.status === "archived") return [];
    const candidates = (byAsset.get(asset.id) || []).filter((version) => !["rejected", "archived"].includes(version.status));
    const publishedCurrent = candidates.find((version) => version.id === asset.current_version_id && version.status === "published");
    const newestApproved = candidates.filter((version) => version.status === "approved")
      .sort((a, b) => b.version_number - a.version_number)[0];
    const preferred = publishedCurrent || newestApproved || null;
    return candidates.map((version) => ({
      id: version.id,
      file_key: `asset_version:${version.id}`,
      source_type: "asset_version",
      source_id: version.id,
      asset_id: asset.id,
      label: asset.label,
      category: asset.category,
      status: version.status,
      filename: version.original_filename,
      mime_type: version.mime_type,
      size_bytes: version.size_bytes,
      storage_bucket: version.storage_bucket,
      storage_path: version.storage_path,
      updated_at: version.updated_at,
      default_included: preferred?.id === version.id,
      ai_supported: /^(image\/|text\/|application\/(pdf|json|xml|msword|vnd\.openxmlformats-officedocument\.|vnd\.ms-excel|vnd\.ms-powerpoint))/.test(String(version.mime_type || "").toLowerCase()),
    }));
  });
}

async function loadProposalCopilotContext(proposalId, selections = {}) {
  const proposal = one(await serviceRequest(
    `website_proposals?select=*&id=eq.${encodeURIComponent(proposalId)}&limit=1`,
  ), "This proposal no longer exists.");
  const versionRows = await serviceRequest(
    `website_proposal_versions?select=*&proposal_id=eq.${encodeURIComponent(proposal.id)}&order=version_number.desc`,
  );
  const baseVersion = (versionRows || []).find((row) => row.status === "draft") || (versionRows || [])[0];
  if (!baseVersion) throw apiError("Save the first proposal draft before using Copilot.", 409);
  const lineItems = await serviceRequest(
    `website_proposal_line_items?select=*&version_id=eq.${encodeURIComponent(baseVersion.id)}&order=sort_order.asc,created_at.asc`,
  );
  const request = proposal.request_id ? one(await serviceRequest(
    `website_service_requests?select=*&id=eq.${encodeURIComponent(proposal.request_id)}&limit=1`,
  ), "The linked website request no longer exists.") : null;

  const projectRows = await serviceRequest(
    `website_projects?select=*&proposal_id=eq.${encodeURIComponent(proposal.id)}&limit=1`,
  );
  const project = projectRows?.[0] || null;
  const onboardingQuery = project?.id
    ? `website_onboardings?select=*&or=(proposal_id.eq.${proposal.id},project_id.eq.${project.id})&limit=1`
    : `website_onboardings?select=*&proposal_id=eq.${encodeURIComponent(proposal.id)}&limit=1`;
  const onboarding = (await serviceRequest(onboardingQuery))?.[0] || null;
  const onboardingResponse = onboarding ? (await serviceRequest(
    `website_onboarding_responses?select=*&onboarding_id=eq.${encodeURIComponent(onboarding.id)}&limit=1`,
  ))?.[0] || null : null;
  const currentDecision = proposal.current_version_id ? (await serviceRequest(
    `website_proposal_decisions?select=id,version_id,decision,client_message,created_at&proposal_id=eq.${encodeURIComponent(proposal.id)}&version_id=eq.${encodeURIComponent(proposal.current_version_id)}&limit=1`,
  ))?.[0] || null : null;

  let onboardingAuthority = "pending";
  let onboardingStatus = onboarding?.status || "not_started";
  if (onboarding?.status === "approved" && onboardingResponse) {
    const modifiedAfterApproval = !onboarding.reviewed_at
      || new Date(onboardingResponse.updated_at).getTime() > new Date(onboarding.reviewed_at).getTime();
    onboardingAuthority = modifiedAfterApproval ? "pending" : "implementation";
    if (modifiedAfterApproval) onboardingStatus = "modified_after_approval";
  }

  let operational = { website: null, domains: [], repositories: [], services: [] };
  let fileOptions = [];
  const assetVersionStates = new Map();
  if (project?.managed_website_id) {
    const websiteId = encodeURIComponent(project.managed_website_id);
    const [websites, domains, repositories, services, assets] = await Promise.all([
      serviceRequest(`client_websites?select=id,name,live_url,status,updated_at&id=eq.${websiteId}&limit=1`),
      serviceRequest(`website_domains?select=id,domain_name,registrar,dns_provider,status,ownership,is_primary,updated_at&website_id=eq.${websiteId}`),
      serviceRequest(`website_repositories?select=id,provider,full_name,html_url,default_branch,visibility,access_status,updated_at&website_id=eq.${websiteId}`),
      serviceRequest(`website_services?select=id,service_type,name,provider,status,ownership,plan_name,public_url,client_summary,updated_at&website_id=eq.${websiteId}`),
      serviceRequest(`website_assets?select=id,label,category,status,current_version_id,updated_at&website_id=eq.${websiteId}`),
    ]);
    operational = safeOperational({ website: websites?.[0], domains, repositories, services });
    const assetIds = (assets || []).map((asset) => asset.id);
    const assetVersions = assetIds.length ? await serviceRequest(
      `website_asset_versions?select=id,asset_id,version_number,status,storage_bucket,storage_path,original_filename,mime_type,size_bytes,updated_at&asset_id=in.(${assetIds.join(",")})&order=version_number.desc`,
    ) : [];
    for (const version of assetVersions || []) assetVersionStates.set(version.id, version.status);
    fileOptions = selectAssetVersions(assets || [], assetVersions || []);
  }

  if (onboarding) {
    const onboardingFiles = await serviceRequest(
      `website_onboarding_files?select=id,asset_version_id,category,storage_bucket,storage_path,original_filename,mime_type,size_bytes,created_at&onboarding_id=eq.${encodeURIComponent(onboarding.id)}&order=created_at.desc`,
    );
    const representedVersions = new Set(fileOptions.map((file) => file.id));
    fileOptions.push(...(onboardingFiles || []).filter((file) => {
      if (!file.asset_version_id) return true;
      if (["rejected", "archived"].includes(assetVersionStates.get(file.asset_version_id))) return false;
      return !representedVersions.has(file.asset_version_id);
    }).map((file) => ({
      id: file.id,
      file_key: `onboarding_file:${file.id}`,
      source_type: "onboarding_file",
      source_id: file.id,
      label: file.original_filename,
      category: file.category,
      status: onboardingStatus,
      filename: file.original_filename,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      storage_bucket: file.storage_bucket,
      storage_path: file.storage_path,
      updated_at: file.created_at,
      default_included: onboardingAuthority === "implementation" && !["legal"].includes(file.category),
      ai_supported: /^(image\/|text\/|application\/(pdf|json|xml|msword|vnd\.openxmlformats-officedocument\.|vnd\.ms-excel|vnd\.ms-powerpoint))/.test(String(file.mime_type || "").toLowerCase()),
    })));
  }

  const baseline = {
    proposal: { id: proposal.id, title: proposal.title, status: proposal.status, updated_at: proposal.updated_at },
    version: baseVersion,
    line_items: lineItems || [],
  };
  const sources = [
    source("proposal", proposal.id, `Proposal v${baseVersion.version_number}`, "contractual", baseVersion.status, baseVersion.updated_at, baseline, true),
  ];
  if (request) sources.push(source("website_request", request.id, "Website request", "intake", request.status, request.updated_at, safeRequest(request), true));
  if (currentDecision?.decision === "changes_requested" && currentDecision.client_message) sources.push(source(
    "proposal_change_request", currentDecision.id, "Current client change request", "pending_intent", "unresolved",
    currentDecision.created_at, { version_id: currentDecision.version_id, client_message: currentDecision.client_message }, true,
  ));
  if (onboarding && onboardingResponse) sources.push(source(
    "onboarding_response", onboarding.id, "Onboarding response", onboardingAuthority, onboardingStatus,
    onboardingResponse.updated_at, { answers: onboardingResponse.answers, form_version: onboardingResponse.form_version },
    onboardingAuthority === "implementation",
  ));
  if (project) sources.push(source("website_project", project.id, "Website project", "operational", project.status, project.updated_at, safeProject(project), true));
  if (operational.website) sources.push(source("website_operations", operational.website.id, "Current website operations", "operational", operational.website.status, operational.website.updated_at, operational, true));
  const approvedAssetSummary = fileOptions.filter((file) => file.default_included).map((file) => ({
    id: file.source_id,
    label: file.label,
    category: file.category,
    status: file.status,
    filename: file.filename,
    mime_type: file.mime_type,
  }));
  if (approvedAssetSummary.length) sources.push(source(
    "website_assets",
    project?.managed_website_id || proposal.id,
    "Approved website assets",
    "implementation",
    "approved",
    fileOptions.filter((file) => file.default_included).map((file) => file.updated_at).filter(Boolean).sort().at(-1),
    { assets: approvedAssetSummary },
    true,
  ));

  const selectedSourceKeys = Array.isArray(selections.sourceKeys) ? new Set(selections.sourceKeys.map(String)) : null;
  const includedSources = sources.filter((item) => item.source_type === "proposal"
    || (selectedSourceKeys ? selectedSourceKeys.has(item.key) : item.default_included));
  const selectedFileKeys = Array.isArray(selections.fileKeys) ? new Set(selections.fileKeys.map(String)) : new Set();
  const selectedFiles = fileOptions.filter((file) => selectedFileKeys.has(file.file_key));

  return {
    proposalBaseline: baseline,
    intakeSummary: request ? safeRequest(request) : null,
    approvedOnboarding: onboardingResponse ? {
      onboarding_id: onboarding.id,
      authority: onboardingAuthority,
      status: onboardingStatus,
      answers: onboardingResponse.answers,
      updated_at: onboardingResponse.updated_at,
    } : null,
    operationalSummary: { project: safeProject(project), ...operational },
    assets: fileOptions.filter((file) => file.source_type === "asset_version"),
    sourceOptions: sources.map(({ content, ...item }) => item),
    fileOptions: fileOptions.map(({ storage_bucket, storage_path, ...item }) => item),
    includedSources,
    selectedFiles,
  };
}

async function materializeSelectedFiles(files) {
  if (files.length > MAX_SELECTED_FILES) throw apiError(`Select no more than ${MAX_SELECTED_FILES} files.`, 400);
  const output = [];
  let totalBytes = 0;
  for (const file of files) {
    if (Number(file.size_bytes || 0) > MAX_FILE_BYTES) throw apiError(`${file.filename} is larger than 10 MB.`, 400);
    const bytes = await downloadStorageObject(file.storage_bucket, file.storage_path);
    if (bytes.length > MAX_FILE_BYTES) throw apiError(`${file.filename} is larger than 10 MB.`, 400);
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_FILE_BYTES) throw apiError("Selected files exceed the 25 MB Proposal Copilot limit.", 400);
    output.push({ ...file, bytes, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return output;
}

function buildSourceManifest(context, instructionSource, files = []) {
  return [
    instructionSource,
    ...context.includedSources.map(({ content, default_included, key, ...item }) => item),
    ...files.map((file) => ({
      source_type: file.source_type,
      source_id: file.source_id,
      label: file.label,
      authority: file.status === "published" || file.status === "approved" ? "implementation" : "selected_file",
      status: file.status,
      updated_at: file.updated_at,
      filename: file.filename,
      mime_type: file.mime_type,
      size_bytes: file.bytes.length,
      sha256: file.sha256,
    })),
  ];
}

function evidenceSources(context, instructionSource, instruction) {
  const values = new Map([[`${instructionSource.source_type}:${instructionSource.source_id}`, { text: instruction, authority: "admin_instruction" }]]);
  for (const item of context.includedSources) {
    values.set(item.key, { text: JSON.stringify(item.content), authority: item.authority });
  }
  return values;
}

module.exports = {
  buildSourceManifest,
  evidenceSources,
  loadProposalCopilotContext,
  materializeSelectedFiles,
  selectAssetVersions,
};
