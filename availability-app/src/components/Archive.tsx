import {useEffect,useState} from 'react';
import type {Store,ArchivePage} from '../lib/store';
const display=(v:unknown):string=>v==null||v===''?'Not provided':typeof v==='boolean'?(v?'Yes':'No'):typeof v==='object'?JSON.stringify(v):String(v);
export default function Archive({store}:{store:Store|null}){
 const [year,setYear]=useState('');const [agency,setAgency]=useState('');const [from,setFrom]=useState('');const [to,setTo]=useState('');const [page,setPage]=useState(0);
 const [data,setData]=useState<ArchivePage|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;setData(null);setError('');if(!store)return;setBusy(true);store.archive({year,agency,from,to,page}).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e.message||'Past reports could not be loaded.');}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[store,year,agency,from,to,page]);
 const [options,setOptions]=useState<{years:string[];agencies:string[]}>({years:[],agencies:[]});
 useEffect(()=>{if(data)setOptions({years:[...new Set(data.batches.flatMap(b=>b.metadata.years||[]))].sort().reverse(),agencies:[...new Set(data.batches.flatMap(b=>b.metadata.agencies||[]))].sort()});},[data]);
 return <section className="panel archive"><h2>Past reports</h2><p>Original availability reports. These do not change this week’s availability.</p><div className="fields four">
 <label>Year<select value={year} onChange={e=>{setYear(e.target.value);setPage(0);}}><option value="">All years</option>{options.years.map(y=><option key={y}>{y}</option>)}</select></label>
 <label>Agency<select value={agency} onChange={e=>{setAgency(e.target.value);setPage(0);}}><option value="">All agencies</option><option value="__missing">Agency not provided</option>{options.agencies.map(a=><option key={a}>{a}</option>)}</select></label>
 <label>From<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(0);}}/></label><label>Through<input type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(0);}}/></label></div>
 {error&&<p className="notice error" role="alert">{error}</p>}{busy&&<p role="status">Loading past reports…</p>}{!store&&<p>Sign in through the portal to view past reports.</p>}
 {data&&<><p role="status">{data.total.toLocaleString()} reports{data.total>0?` · Showing ${page*50+1}–${Math.min((page+1)*50,data.total)}`:''}</p><div className="archive-list">{data.rows.map(r=><details key={r.id}><summary><strong>{r.agency_name||'Agency not provided'}</strong><span>{r.source_created_at?.replace('T',' ').slice(0,16)||'Date not provided'} · {r.submitted_by||'Name not provided'}</span></summary><dl className="saved-values">{Object.entries(r.raw).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{display(v)}</dd></div>)}</dl></details>)}</div><div className="action-row"><button className="button" disabled={busy||page===0} onClick={()=>setPage(p=>p-1)}>Previous</button><button className="button" disabled={busy||(page+1)*50>=data.total} onClick={()=>setPage(p=>p+1)}>Next</button></div>
 {data.batches.some(b=>b.metadata.comments?.length)&&<details className="archive-comments"><summary>Sheet comments</summary>{data.batches.flatMap(b=>b.metadata.comments||[]).map((c,i)=><article key={i}><p className="preserve">{c.text}</p><small>{c.author} · {c.date}</small></article>)}</details>}</>}
 </section>;
}
