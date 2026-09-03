import { useEffect, useMemo, useState } from "react";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import "../styles/maps-admin.css";

declare global {
  interface Window {
    RECORDS_APP_CONFIG?: { supabaseUrl?: string; supabaseAnonKey?: string };
  }
}

type RequestStatus = "pending" | "approved" | "declined";

interface AccessRequest {
  id: string;
  user_id: string;
  requester_email: string;
  status: RequestStatus;
  admin_note: string | null;
  requested_at: string;
  reviewed_at: string | null;
}

const statusLabel: Record<RequestStatus, string> = {
  pending: "Pending approval",
  approved: "Approved",
  declined: "Declined",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function revealAdminWorkspace(): void {
  const reveal = () => document.body.classList.remove("portal-loading");
  if (document.body.classList.contains("product-native-admin")) {
    reveal();
    return;
  }
  document.addEventListener("n3xra:product-shell-ready", reveal, { once: true });
}

export default function MapsAdmin() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [adminUser, setAdminUser] = useState<User | null>(null);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<"all" | RequestStatus>("pending");
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("Opening Maps administration…");
  const [saving, setSaving] = useState(false);

  const selected = requests.find((request) => request.id === selectedId) || null;
  const visibleRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    return requests.filter((request) => {
      if (filter !== "all" && request.status !== filter) return false;
      return !query || request.requester_email.toLowerCase().includes(query);
    });
  }, [filter, requests, search]);

  const loadRequests = async (supabase = client) => {
    if (!supabase) return;
    setMessage("Loading Maps access requests…");
    const { data, error } = await supabase
      .from("maps_access_requests")
      .select("id,user_id,requester_email,status,admin_note,requested_at,reviewed_at")
      .order("requested_at", { ascending: false });
    if (error) throw error;
    const next = (data || []) as AccessRequest[];
    setRequests(next);
    setSelectedId((current) => next.some((request) => request.id === current) ? current : next[0]?.id || "");
    setMessage(`${next.length} Maps access request${next.length === 1 ? "" : "s"}.`);
  };

  useEffect(() => {
    const config = window.RECORDS_APP_CONFIG || {};
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      setMessage("N3XRA Maps is not connected to Supabase.");
      revealAdminWorkspace();
      return;
    }
    const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
    setClient(supabase);
    void (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session?.user) {
        window.location.assign(`/account/?next=${encodeURIComponent("/maps/admin/")}`);
        return;
      }
      setAdminUser(data.session.user);
      await loadRequests(supabase);
      revealAdminWorkspace();
    })().catch((error: unknown) => {
      console.warn("Maps administration could not open.", error);
      setMessage(error instanceof Error ? error.message : "Maps administration could not open.");
      revealAdminWorkspace();
    });
  }, []);

  useEffect(() => {
    setNote(selected?.admin_note || "");
  }, [selectedId]);

  const decide = async (status: "approved" | "declined") => {
    if (!client || !adminUser || !selected || saving) return;
    const verb = status === "approved" ? "approve" : "decline";
    if (!window.confirm(`${verb[0]?.toUpperCase()}${verb.slice(1)} Maps access for ${selected.requester_email}?`)) return;
    setSaving(true);
    setMessage(`${status === "approved" ? "Approving" : "Declining"} request…`);
    const { error } = await client
      .from("maps_access_requests")
      .update({
        status,
        admin_note: note.trim() || null,
        reviewed_by: adminUser.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", selected.id);
    setSaving(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    await loadRequests(client);
    setMessage(status === "approved" ? "Maps access approved." : "Maps access declined.");
  };

  return (
    <section className="maps-admin-workspace">
      <header className="maps-admin-heading">
        <div><p>MASTER ADMINISTRATION</p><h1>N3XRA Maps</h1><span>Review early-access requests before customers can create a Maps workspace.</span></div>
        <button type="button" onClick={() => void loadRequests()} disabled={!client || saving}>Refresh</button>
      </header>

      <div className="maps-admin-metrics" aria-label="Maps request summary">
        <article><span>Pending</span><strong>{requests.filter((request) => request.status === "pending").length}</strong></article>
        <article><span>Approved</span><strong>{requests.filter((request) => request.status === "approved").length}</strong></article>
        <article><span>Total requests</span><strong>{requests.length}</strong></article>
      </div>

      <div className="maps-admin-controls">
        <label><span>Find an account</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by email" /></label>
        <label><span>Status</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="all">All requests</option></select></label>
      </div>

      <div className="maps-admin-layout">
        <aside className="maps-admin-list" aria-label="Maps access requests">
          {visibleRequests.length ? visibleRequests.map((request) => (
            <button type="button" className={request.id === selectedId ? "is-selected" : ""} onClick={() => setSelectedId(request.id)} key={request.id}>
              <span><strong>{request.requester_email}</strong><small>Requested {formatDate(request.requested_at)}</small></span>
              <em data-status={request.status}>{statusLabel[request.status]}</em>
            </button>
          )) : <div className="maps-admin-empty"><strong>No requests in this view</strong><p>New Maps early-access requests will appear here.</p></div>}
        </aside>

        <section className="maps-admin-detail">
          {selected ? <>
            <header><div><p>ACCESS REQUEST</p><h2>{selected.requester_email}</h2><span>Submitted {formatDate(selected.requested_at)}</span></div><em data-status={selected.status}>{statusLabel[selected.status]}</em></header>
            <dl><div><dt>Current status</dt><dd>{statusLabel[selected.status]}</dd></div><div><dt>Reviewed</dt><dd>{formatDate(selected.reviewed_at)}</dd></div><div><dt>Workspace</dt><dd>Not created</dd></div></dl>
            <div className="maps-admin-boundary"><strong>Approval grants product access only.</strong><p>No organization, customer, layer, pin, or example data will be created by this decision.</p></div>
            <label className="maps-admin-note"><span>Administrator note</span><textarea rows={5} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional internal context for this decision" /></label>
            <footer><button className="is-decline" type="button" onClick={() => void decide("declined")} disabled={saving}>Decline</button><button className="is-approve" type="button" onClick={() => void decide("approved")} disabled={saving}>Approve access</button></footer>
          </> : <div className="maps-admin-empty"><strong>Select an access request</strong><p>Choose an account to review its Maps request.</p></div>}
        </section>
      </div>
      <p className="maps-admin-message" role="status" aria-live="polite">{message}</p>
    </section>
  );
}
