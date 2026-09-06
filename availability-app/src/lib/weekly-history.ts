import {equipment,type Agency,type Cycle,type Snapshot} from './model.ts';
export interface ArchivedReport {id:string;source_created_at:string|null;agency_name:string|null;submitted_by:string|null;raw:Record<string,unknown>}
export const agencyKey=(name:string)=>name.trim().toLowerCase();
export function reportingMonday(timestamp:string):string {
 const day=timestamp.slice(0,10);const d=new Date(`${day}T12:00:00Z`);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==day)throw new Error('A historical report has an invalid reporting date.');
 d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);
}
export function historyCycles(cycles:Cycle[],rows:ArchivedReport[]):Cycle[]{
 const result=[...cycles];for(const start of new Set(rows.map(r=>reportingMonday(r.source_created_at||'')))){
 if(result.some(c=>c.start_date<=start&&c.end_date>=start))continue;
 const end=new Date(`${start}T12:00:00Z`);end.setUTCDate(end.getUTCDate()+6);
 result.push({id:`history:${start}`,start_date:start,end_date:end.toISOString().slice(0,10),due_at:'',duty_name:'Not recorded',roster:[],revision:0,closed:true,historical:true});
 }return result.sort((a,b)=>b.start_date.localeCompare(a.start_date));
}
export const reportsInWeek=(cycle:Cycle,rows:ArchivedReport[])=>rows.filter(r=>{const d=(r.source_created_at||'').slice(0,10);return d>=cycle.start_date&&d<=cycle.end_date;});
const numeric=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
export function weeklyHistory(cycle:Cycle,data:Snapshot,osfm=false){
 const rows=reportsInWeek(cycle,data.archivedReports||[]);const agencies=new Map(data.agencies.map(a=>[agencyKey(a.name),a]));
 const grouped=new Map<string,ArchivedReport[]>();const unassigned:ArchivedReport[]=[];
 for(const row of rows){const a=row.agency_name&&agencies.get(agencyKey(row.agency_name));if(!a){unassigned.push(row);continue;}grouped.set(a.id,[...(grouped.get(a.id)||[]),row]);}
 const selected=[...grouped].map(([id,versions])=>{
 versions.sort((a,b)=>(b.source_created_at||'').localeCompare(a.source_created_at||'')||String(b.raw['Modified On']||'').localeCompare(String(a.raw['Modified On']||''))||b.id.localeCompare(a.id));
 const row=versions[0]!;const agency=data.agencies.find(a=>a.id===id)!;
 return {agency,versions,row,counts:{type1:numeric(row.raw['Type 1']),type3:numeric(row.raw['Type 3']),type6:numeric(row.raw['Type 6']),tender:numeric(row.raw.Tender)},simultaneous:null as number|null,qualified:null as number|null,trainees:null as number|null,extraCrew:null as number|null,live:false};
 });
 // A saved N3XRA submission supersedes the imported report for that agency/week.
 // Drafts do not erase a submitted historical report.
 for(const report of data.responses.filter(r=>r.cycle_id===cycle.id&&r.submitted_at)){
 const agency=data.agencies.find(a=>a.id===report.agency_id);if(!agency)continue;
 const prior=selected.findIndex(r=>r.agency.id===agency.id);const p=report.payload;
 const item={agency,versions:prior>=0?selected[prior]!.versions:[],row:{id:report.id,source_created_at:report.submitted_at,agency_name:agency.name,submitted_by:p.contactName,raw:{...p}},counts:{type1:p.type1,type3:p.type3,type6:p.type6,tender:p.tender},simultaneous:p.simultaneous,qualified:p.qualified,trainees:p.trainees,extraCrew:p.extraCrew,live:true};
 if(prior>=0)selected[prior]=item;else selected.push(item);
 }
 const included=selected.filter(r=>!osfm||['Klamath','Lake'].includes(r.agency.county)).sort((a,b)=>a.agency.name.localeCompare(b.agency.name));
 const issues=included.flatMap(r=>equipment.filter(k=>r.counts[k]!==null&&(!Number.isInteger(r.counts[k])||r.counts[k]!<0||r.counts[k]!>999)).map(k=>({agency:r.agency.name,field:k,value:r.counts[k]})));
 const total=(field:typeof equipment[number])=>!included.length||issues.some(i=>i.field===field)||included.some(r=>r.counts[field]===null)?null:included.reduce((n,r)=>n+r.counts[field]!,0);
 const personnel=(field:'simultaneous'|'qualified'|'trainees'|'extraCrew')=>!included.length||included.some(r=>r[field]===null)?null:included.reduce((n,r)=>n+r[field]!,0);
 return {rows,included,unassigned,issues,totals:Object.fromEntries(equipment.map(k=>[k,total(k)])) as Record<typeof equipment[number],number|null>,simultaneous:personnel('simultaneous'),qualified:personnel('qualified'),trainees:personnel('trainees'),extraCrew:personnel('extraCrew')};
}
