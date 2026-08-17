import { originFor, requireAdmin, response } from "../_shared/website-billing.ts";

Deno.serve(async (request) => {
  const origin = originFor(request);
  if (request.method === "OPTIONS") return response({ ok: true }, 200, origin);
  try {
    const { admin, authUser } = await requireAdmin(request);
    const input = await request.json();
    const proposalId = String(input.proposal_id || "").trim();
    if (!proposalId) return response({ error: "Proposal is required." }, 400, origin);

    const { data: proposal, error: proposalError } = await admin
      .from("website_proposals")
      .select("id,request_id,project_id,client_user_id,status,current_version_id,title")
      .eq("id", proposalId)
      .single();
    if (proposalError || proposal?.status !== "approved" || !proposal.current_version_id) {
      return response({ error: "Only an approved proposal can be prepared for billing." }, 409, origin);
    }

    const { data: existing } = await admin
      .from("website_billing_snapshots")
      .select("*")
      .eq("proposal_version_id", proposal.current_version_id)
      .maybeSingle();
    if (existing) return response({ snapshot: existing, reused: true }, 200, origin);

    const [{ data: version, error: versionError }, { data: items, error: itemError }, { data: project }, { data: requestRow }] = await Promise.all([
      admin.from("website_proposal_versions").select("*").eq("id", proposal.current_version_id).single(),
      admin.from("website_proposal_line_items").select("*").eq("version_id", proposal.current_version_id).order("sort_order"),
      proposal.project_id
        ? admin.from("website_projects").select("id").eq("id", proposal.project_id).maybeSingle()
        : admin.from("website_projects").select("id").eq("proposal_id", proposal.id).maybeSingle(),
      admin.from("website_service_requests").select("referral_code,offer_code,partner_application_id").eq("id", proposal.request_id).single(),
    ]);
    if (versionError || itemError || !version || !project) throw new Error(versionError?.message || itemError?.message || "Approved proposal data is incomplete.");
    if (version.recurring_interval === "quarterly") return response({ error: "Quarterly website service is not supported in Stage 1. Update the proposal to monthly or yearly." }, 409, origin);

    const recurringItems = (items || []).filter((item: Record<string, unknown>) => item.billing_type === "recurring");
    const serviceItem = recurringItems.find((item: Record<string, unknown>) => ["maintenance", "hosting"].includes(String(item.category)));
    const recurring = recurringItems.reduce(
      (sum: number, item: Record<string, unknown>) => sum + Math.round(Number(item.quantity) * Number(item.unit_amount_cents)),
      0,
    );
    const interval = serviceItem ? String(serviceItem.recurring_interval || "") : null;
    let plan = "none";
    if (serviceItem) {
      const serviceAmount = Math.round(Number(serviceItem.quantity) * Number(serviceItem.unit_amount_cents));
      const serviceName = String(serviceItem.name || "").toLowerCase();
      if (serviceName.includes("starter+") || serviceName.includes("starter plus")) plan = "starter_plus";
      else if (serviceName.includes("starter")) plan = "starter";
      else if (serviceName.includes("advanced")) plan = "advanced";
      else if ((interval === "monthly" && serviceAmount === 2500) || (interval === "yearly" && serviceAmount === 27000)) plan = "starter";
      else if ((interval === "monthly" && [3500, 4000].includes(serviceAmount)) || (interval === "yearly" && serviceAmount === 43200)) plan = "starter_plus";
      else if ((interval === "monthly" && serviceAmount === 5000) || (interval === "yearly" && serviceAmount === 54000)) plan = "advanced";
      else return response({ error: "The recurring service amount does not match a supported website plan." }, 409, origin);
    } else if (recurring) {
      return response({ error: "A recurring website plan line is required before add-on billing can be prepared." }, 409, origin);
    }
    const total = Number(version.total_cents || 0);
    const initialOutsideCategories = new Set(["domain", "email", "ssl_cdn", "integration"]);
    const initialOutsideTotal = (items || [])
      .filter((item: Record<string, unknown>) => item.billing_type === "one_time" && initialOutsideCategories.has(String(item.category)))
      .reduce((sum: number, item: Record<string, unknown>) => sum + Math.round(Number(item.quantity) * Number(item.unit_amount_cents)), 0);
    const deposit = Number(version.deposit_cents || 0);
    const due = deposit > 0 ? Math.min(total, deposit + initialOutsideTotal) : total;
    if (total === 0 && recurring === 0) return response({ error: "This proposal has no billable amount." }, 409, origin);

    const normalizedCode = requestRow?.referral_code ? String(requestRow.referral_code).toUpperCase() : null;
    const offerCode = requestRow?.offer_code ? String(requestRow.offer_code).toUpperCase() : null;
    const { data: snapshot, error: insertError } = await admin.from("website_billing_snapshots").insert({
      project_id: project.id,
      proposal_id: proposal.id,
      proposal_version_id: version.id,
      client_user_id: proposal.client_user_id,
      service_plan: plan,
      recurring_interval: interval,
      one_time_total_cents: total,
      amount_due_now_cents: due,
      remaining_build_balance_cents: total - due,
      recurring_cents: recurring,
      recurring_start_policy: version.recurring_start_policy || "immediate",
      complimentary_months: Number(version.complimentary_months || 0),
      review_notice_days: Number(version.review_notice_days || 45),
      discount_cents: Number(version.discount_cents || 0),
      referral_code: normalizedCode,
      offer_code: offerCode,
      partner_application_id: requestRow?.partner_application_id || null,
      annual_partner_qualifying: Boolean(requestRow?.partner_application_id && interval === "yearly"),
      prepared_by_user_id: authUser.id,
    }).select().single();
    if (insertError) throw new Error(insertError.message);

    const snapshotItems = (items || []).map((item: Record<string, unknown>) => ({
      snapshot_id: snapshot.id,
      proposal_line_item_id: item.id,
      category: item.category,
      name: item.name,
      description: item.description,
      billing_type: item.billing_type,
      quantity: item.quantity,
      unit_amount_cents: item.unit_amount_cents,
      total_amount_cents: Math.round(Number(item.quantity) * Number(item.unit_amount_cents)),
      recurring_interval: item.recurring_interval,
      included_in_initial_checkout: item.billing_type === "recurring"
        ? version.recurring_start_policy !== "review_required"
        : due === total || initialOutsideCategories.has(String(item.category)),
      sort_order: item.sort_order,
    }));
    if (snapshotItems.length) {
      const { error } = await admin.from("website_billing_snapshot_items").insert(snapshotItems);
      if (error) throw new Error(error.message);
    }
    const now = new Date().toISOString();
    await admin.from("website_project_milestones").update({ status: "complete", completed_at: now }).eq("project_id", project.id).eq("stage", "agreement");
    await admin.from("website_project_milestones").update({ status: "in_progress", completed_at: null }).eq("project_id", project.id).eq("stage", "billing");
    return response({ snapshot }, 200, origin);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unable to prepare billing." }, 400, origin);
  }
});
