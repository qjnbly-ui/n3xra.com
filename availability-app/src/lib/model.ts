export const equipment = ['type1', 'type3', 'type6', 'tender'] as const;
export type Equipment = typeof equipment[number];
export const labels: Record<Equipment, string> = { type1: 'Type 1 engines', type3: 'Type 3 engines', type6: 'Type 6 engines', tender: 'Water tenders' };
export type Payload = Record<Equipment, number> & {
  simultaneous: number; qualified: number; trainees: number; extraCrew: number;
  prepo: boolean; conflag: boolean; outOfState: boolean;
  overhead?: string[]; crewDetails?: string; leaderDetails: string; notes: string; contactName: string; contactPhone: string; contactEmail: string;
  teams: number; reason: string; confirmed: boolean;
};
export interface Agency { id: string; name: string; county: string; active?: boolean; version?: number }
export interface Cycle { id: string; start_date: string; end_date: string; due_at: string; duty_name: string; roster: Agency[]; revision: number; closed: boolean }
export interface Response { id: string; cycle_id: string; agency_id: string; payload: Payload; version: number; submitted_at: string | null; updated_at: string }
export interface Approval { id: string; cycle_id: string; revision: number; payload: Payload; approved_at: string; snapshot: { roster: Agency[]; responses: Response[]; startDate: string; endDate: string; missing: number } }
export interface Delivery { id: string; approval_id: string; reference: string; recorded_at: string }
export interface History { id: string; cycle_id: string | null; agency_id: string | null; action: string; created_at: string; actor_id?:string; payload?:{input?:{payload?:Payload};result?:{payload?:Payload};before?:unknown} }
export interface ContactRecord {id:string;name:string;phone:string;email:string;user_id?:string|null;source:string;active:boolean;version:number}
export interface DutyAssignment {id:string;start_date:string;end_date:string|null;contact_id:string;backup_contact_id:string|null;active:boolean;version:number}
export interface Snapshot {
  workspace: { id: string; organization_id: string; name: string };
  context: { admin: boolean; reviewer: boolean; members: { id: string; email: string }[] };
  contacts?: ContactRecord[]; rotation?: DutyAssignment[];
  agencies: Agency[]; cycles: Cycle[]; responses: Response[]; approvals: Approval[]; deliveries: Delivery[]; history: History[];
  assignments: { agency_id: string; user_id: string }[]; reviewers: { user_id: string }[];
}
export const emptyPayload = (): Payload => ({ type1: 0, type3: 0, type6: 0, tender: 0, simultaneous: 0, qualified: 0, trainees: 0, extraCrew: 0, prepo: false, conflag: false, outOfState: false, leaderDetails: '', notes: '', contactName: '', contactPhone: '', contactEmail: '', teams: 0, reason: '', confirmed: false });
export function totalEquipment(p: Pick<Payload, Equipment>): number { return equipment.reduce((n,k) => n+p[k],0); }
export function summarize(c: Cycle, responses: Response[]) {
  // Only the latest submitted response for each expected agency is counted.
  const latest = new Map<string, Response>();
  for (const r of responses) if (r.cycle_id === c.id && c.roster.some(a=>a.id===r.agency_id) && (!latest.has(r.agency_id) || latest.get(r.agency_id)!.version < r.version)) latest.set(r.agency_id,r);
  const submitted = [...latest.values()].filter(r=>r.submitted_at);
  const totals = emptyPayload();
  for (const r of submitted) for (const k of [...equipment,'qualified','trainees','extraCrew','simultaneous'] as const) totals[k] += r.payload[k];
  const constrained = submitted.filter(r=>totalEquipment(r.payload)>r.payload.simultaneous);
  return { submitted, totals, constrained, missing: c.roster.filter(a=>!submitted.some(r=>r.agency_id===a.id)), complete: c.roster.length>0 && submitted.length===c.roster.length };
}
export function validate(p: Payload, review = false, complete = true): string | null {
  const counts: (Equipment|'qualified'|'teams'|'trainees'|'extraCrew'|'simultaneous')[] = [...equipment,'qualified',...(review ? ['teams'] as const : ['trainees','extraCrew','simultaneous'] as const)];
  for (const k of counts) if (!Number.isInteger(p[k]) || p[k]<0 || p[k]>999) return 'Use whole numbers from 0 to 999.';
  if (complete && (!p.contactName.trim() || (review && (p.contactPhone.trim().length<7 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.contactEmail))))) return 'Complete the reporting contact name, phone, and email.';
  if (p.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.contactEmail)) return 'Check the contact email address.';
  if (review) { if(p.teams>p.qualified) return 'Each reported team needs a qualified leader.'; if(!p.confirmed) return 'Confirm staffing, leaders, and deployment restrictions.'; }
  else {
    if(p.simultaneous>totalEquipment(p)) return 'Simultaneous resources cannot exceed equipment options.';
    if(complete && p.simultaneous<totalEquipment(p) && !p.notes.trim()) return 'Explain the shared staffing or deployment limit.';
    if(complete && p.qualified+p.trainees>0 && !p.leaderDetails.trim()) return 'List leader names, qualifications, and contact information.';
  }
  return null;
}
export function validateReview(c: Cycle, responses: Response[], p: Payload): string | null {
  const invalid=validate(p,true); if(invalid) return invalid;
  const summary=summarize(osfmCycle(c),responses);
  for(const k of [...equipment,'qualified'] as const) if(p[k]>summary.totals[k]) return `Reviewed ${k==='qualified'?'leaders':labels[k]} exceeds submitted availability.`;
  if(totalEquipment(p)>summary.totals.simultaneous) return 'Reviewed equipment exceeds simultaneous deployment capacity.';
  if((summary.missing.length || summary.constrained.length) && !p.reason.trim()) return 'Explain missing reports and shared staffing decisions.';
  return null;
}
export function currentApproval(c: Cycle, approvals: Approval[]): Approval | undefined { return approvals.find(a=>a.cycle_id===c.id && a.revision===c.revision); }
export function formatDate(value: string): string { return new Date(value.length===10?`${value}T12:00:00Z`:value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/Los_Angeles'}); }
export function formatTime(value: string): string { return new Date(value).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Los_Angeles',timeZoneName:'short'}); }
export function osfmText(a: Approval): string {
  const p=a.payload;
  return [`Klamath/Lake resource availability`,`${a.snapshot.startDate} through ${a.snapshot.endDate}`,...equipment.map(k=>`${labels[k]}: ${p[k]}`),`Qualified task force / strike team leaders: ${p.qualified}`,`Task forces / strike teams: ${p.teams}`,`Out of state: ${p.outOfState?'Yes':'No'}`,`Prepositioning up to 72 hours: ${p.prepo?'Yes':'No'}`,`Notes: ${p.notes}`,`Sender: ${p.contactName}`,`24-hour phone: ${p.contactPhone}`,`Email: ${p.contactEmail}`].join('\n');
}

// Harney participates in local collection but is not part of the state Klamath/Lake entry.
export function osfmCycle(c:Cycle):Cycle{return {...c,roster:c.roster.filter(a=>a.county!=='Harney')};}
