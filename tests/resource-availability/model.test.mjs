import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPayload,summarize,validate,validateReview,currentApproval,osfmText} from '../../availability-app/src/lib/model.ts';
const form=(extra={})=>({...emptyPayload(),contactName:'Demo',contactPhone:'541-555-0100',contactEmail:'demo@example.com',...extra});
const cycle={id:'c1',revision:2,roster:[{id:'a1'},{id:'a2'}]};
const response=(agency,extra={},version=1,submitted=true)=>({id:agency+version,agency_id:agency,cycle_id:'c1',version,submitted_at:submitted?'2026-09-07T16:00:00Z':null,payload:form(extra)});
test('one response per agency; latest draft replaces earlier submission; unrelated periods excluded',()=>{
  const rows=[response('a1',{type1:2,simultaneous:2}),response('a1',{type1:1,simultaneous:1},2),response('a2',{},1,false),{...response('a2',{type1:99}),'cycle_id':'old'}];
  const s=summarize(cycle,rows);assert.equal(s.submitted.length,1);assert.equal(s.totals.type1,1);assert.equal(s.missing[0].id,'a2');assert.equal(s.complete,false);
  rows.push(response('a1',{},3,false));assert.equal(summarize(cycle,rows).submitted.length,0);
});
test('zero-resource submission completes an agency; shared crews and trainees stay distinct',()=>{
  const s=summarize(cycle,[response('a1',{type1:1,type6:1,simultaneous:1,trainees:1,notes:'One crew',leaderDetails:'Trainee'}),response('a2')]);
  assert.equal(s.complete,true);assert.equal(s.constrained.length,1);assert.equal(s.totals.qualified,0);assert.equal(s.totals.trainees,1);assert.equal(s.totals.simultaneous,1);
});
test('rejects invalid counts, unstaffed overstatements, missing qualifications and contact',()=>{
  assert.match(validate(form({type1:1.5})),/whole numbers/);assert.match(validate(form({type1:NaN})),/whole numbers/);
  assert.match(validate(form({simultaneous:1})),/exceed/);assert.match(validate(form({type1:2,simultaneous:1})),/shared staffing/);
  assert.match(validate(form({qualified:1})),/leader names/);assert.match(validate(form({contactEmail:'bad'})),/contact/);assert.equal(validate(form()),null);
});
test('drafts allow unfinished contact details but still reject invalid counts',()=>{
  assert.equal(validate(emptyPayload(),false,false),null);
  assert.match(validate({...emptyPayload(),type1:-1},false,false),/whole numbers/);
  assert.match(validate(emptyPayload()),/contact/);
});
test('review rejects excessive equipment and teams and demands documented missing reports',()=>{
  const rows=[response('a1',{type1:2,simultaneous:1,qualified:1,leaderDetails:'Qualified',notes:'Shared crew'})];
  const p=form({type1:2,qualified:1,teams:1,confirmed:true,reason:'Missing agency followed up'});
  assert.match(validateReview(cycle,rows,p),/simultaneous/);p.type1=1;p.reason='';assert.match(validateReview(cycle,rows,p),/missing reports/);
  p.reason='Missing agency unavailable; one staffed engine selected.';assert.equal(validateReview(cycle,rows,p),null);
  p.teams=2;assert.match(validateReview(cycle,rows,p),/qualified leader/);
});
test('approval expires with any new revision; exported text uses the approved snapshot',()=>{
  const a={id:'review',cycle_id:'c1',revision:1,payload:form({type1:1}),snapshot:{startDate:'2026-09-07',endDate:'2026-09-13'}};
  assert.equal(currentApproval(cycle,[a]),undefined);assert.equal(currentApproval({...cycle,revision:1},[a]),a);
  assert.match(osfmText(a),/Type 1 engines: 1/);assert.match(osfmText(a),/2026-09-07 through 2026-09-13/);
});

test('Klamath/Lake review excludes Harney resources but keeps them in local collection',()=>{
  const c={...cycle,roster:[{id:'a1',county:'Klamath'},{id:'a2',county:'Harney'}]};
  const rows=[response('a1'),response('a2',{type1:5,simultaneous:5})];
  assert.equal(summarize(c,rows).totals.type1,5);
  assert.match(validateReview(c,rows,form({type1:1,confirmed:true})),/exceeds submitted/);
  assert.equal(validateReview(c,rows,form({confirmed:true})),null);
});
test('shared form requires a name; OSFM reviewer still requires phone and email',()=>{
  assert.equal(validate({...emptyPayload(),contactName:'Reporter'}),null);
  assert.match(validate({...emptyPayload(),contactName:'Reporter',confirmed:true},true),/contact/);
});
