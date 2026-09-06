import type {Agency, Cycle, Snapshot} from './model';
// Exact choices from the live 2026 weekly Smartsheet form, read September 5, 2026.
export const reportingAgencies:Agency[] = [
  {
    "id": "20260000-0000-4000-8000-000000000001",
    "name": "Bly RFPD",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000002",
    "name": "Bonanza RFPD",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000003",
    "name": "Central Cascades Fire & EMS",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000004",
    "name": "Chemult RFPD",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000005",
    "name": "Chiloquin-Agency Lk RFPD",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000006",
    "name": "Christmas Valley RFPD",
    "county": "Lake",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000007",
    "name": "Crescent RFPD",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000008",
    "name": "Keno RFPD",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000009",
    "name": "Kingsley Field FD",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000010",
    "name": "Klamath County FD3",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000011",
    "name": "Klamath County FD4",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000012",
    "name": "Klamath County FD5",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000013",
    "name": "Klamath County FD1",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000014",
    "name": "Lakeview Fire",
    "county": "Lake",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000015",
    "name": "Malin RFPD",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000016",
    "name": "Merrill RFPD",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000017",
    "name": "New Pine Creek RFPD",
    "county": "Lake",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000018",
    "name": "Oregon Outback RFPD",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000019",
    "name": "Paisley F.D.",
    "county": "Lake",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000020",
    "name": "Rocky Point Fire & EMS",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000021",
    "name": "Silver Lake RFPD",
    "county": "Lake",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000022",
    "name": "Thomas Creek-Westside RFPD",
    "county": "Lake",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000023",
    "name": "Walker Range Fire Patrol",
    "county": "Klamath",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000024",
    "name": "Burns F.D.",
    "county": "Harney",
    "active": true
  },
  {
    "id": "20260000-0000-4000-8000-000000000025",
    "name": "Hines F.D.",
    "county": "Harney",
    "active": true
  }
];
export const overheadOptions = ['IC','Liaison','Safety','PIO','Operations','Logistics','Planning','Div/Group Supervisor','Resource Unit Leader','Situation Unit Leader','Communication Unit Leader','Task Force/Strike Team Leader'];
// Klamath/Lake Response Guide 2026. End dates are inclusive.
export const dutyRotation = [
  {
    "start": "2026-03-30",
    "end": "2026-04-12",
    "name": "David Blair"
  },
  {
    "start": "2026-04-13",
    "end": "2026-04-26",
    "name": "Nate Hussey"
  },
  {
    "start": "2026-04-27",
    "end": "2026-05-10",
    "name": "Mark Belcastro"
  },
  {
    "start": "2026-05-11",
    "end": "2026-05-17",
    "name": "Matt Hitchcock"
  },
  {
    "start": "2026-05-18",
    "end": "2026-05-24",
    "name": "Brent Knutson"
  },
  {
    "start": "2026-05-25",
    "end": "2026-06-07",
    "name": "Steven Stacey"
  },
  {
    "start": "2026-06-08",
    "end": "2026-06-21",
    "name": "Matt Chavarria"
  },
  {
    "start": "2026-06-22",
    "end": "2026-07-05",
    "name": "Nate Hussey"
  },
  {
    "start": "2026-07-06",
    "end": "2026-07-19",
    "name": "David Blair"
  },
  {
    "start": "2026-07-20",
    "end": "2026-08-02",
    "name": "Mark Belcastro"
  },
  {
    "start": "2026-08-03",
    "end": "2026-08-09",
    "name": "Matt Hitchcock"
  },
  {
    "start": "2026-08-10",
    "end": "2026-08-16",
    "name": "Brent Knutson"
  },
  {
    "start": "2026-08-17",
    "end": "2026-08-30",
    "name": "Nate Hussey"
  },
  {
    "start": "2026-08-31",
    "end": "2026-09-13",
    "name": "Matt Chavarria"
  },
  {
    "start": "2026-09-14",
    "end": "2026-09-27",
    "name": "Nate Hussey"
  },
  {
    "start": "2026-09-28",
    "end": "2026-10-11",
    "name": "David Blair"
  },
  {
    "start": "2026-10-12",
    "end": "2026-10-25",
    "name": "Mark Belcastro"
  },
  {
    "start": "2026-10-26",
    "end": "2026-11-01",
    "name": "Matt Hitchcock"
  },
  {
    "start": "2026-11-02",
    "end": "2026-11-09",
    "name": "Brent Knutson"
  },
  {
    "start": "2026-11-10",
    "end": "2026-12-31",
    "name": "David Blair"
  }
];
export function pacificDate(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function dutyFor(date:string){return dutyRotation.find(r=>r.start<=date&&r.end>=date)?.name||'';}

// Read-only local layout data uses source configuration, never invented submissions.
export function referenceReview(): Snapshot {
  const cycles:Cycle[]=[];
  for(let date=new Date('2026-03-30T12:00:00Z');date.toISOString().slice(0,10)<='2026-11-09';date.setUTCDate(date.getUTCDate()+7)){
    const start=date.toISOString().slice(0,10);const end=new Date(date);end.setUTCDate(end.getUTCDate()+6);
    cycles.push({id:start,start_date:start,end_date:end.toISOString().slice(0,10),duty_name:dutyFor(start),due_at:`${start}T${start<'2026-11-01'?'17':'18'}:00:00Z`,roster:reportingAgencies,revision:0,closed:false});
  }
  const contacts=[...new Set(dutyRotation.map(d=>d.name))].map((name,i)=>({id:`reference-contact-${i}`,name,phone:'',email:'',source:'2026 response guide',active:true,version:1}));
  const rotation=dutyRotation.map((d,i)=>({id:`reference-duty-${i}`,start_date:d.start,end_date:d.start==='2026-11-10'?null:d.end,contact_id:contacts.find(c=>c.name===d.name)!.id,backup_contact_id:null,active:true,version:1}));
  return {contacts,rotation,workspace:{id:'',organization_id:'',name:'Klamath County Fire Defense Board'},context:{admin:false,reviewer:true,members:[]},agencies:reportingAgencies,cycles:cycles.reverse(),responses:[],approvals:[],deliveries:[],history:[],assignments:[],reviewers:[]};
}
