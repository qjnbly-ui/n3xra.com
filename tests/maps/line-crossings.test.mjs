import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../../maps-app/src/lib/line-crossings.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { prepareCrossings } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const lines = [{id:'a', coordinates:[[-.001,0],[.001,0]]}, {id:'b',coordinates:[[0,-.001],[0,.001]]}];
const connection = (coordinate) => ({feature_id:'a',connected_feature_id:'b',geometry:{coordinates:coordinate}});
test('unconnected crossing has a gap on exactly one line without changing original coordinates', () => {
  const original = JSON.stringify(lines);
  const result = prepareCrossings(lines, []);
  assert.equal(result.junctions.length, 0);
  assert.equal(result.atZoom(18).get('a').length, 2);
  assert.equal(result.atZoom(18).get('b').length, 1);
  assert.equal(JSON.stringify(lines), original);
  const width = zoom => {const parts=result.atZoom(zoom).get('a');return parts[1][0][0]-parts[0].at(-1)[0];};
  assert.ok(Math.abs(width(18)/width(19)-2)<1e-6);
});
test('saved junction keeps both lines whole and deduplicates reciprocal records', () => {
  const result=prepareCrossings(lines,[connection([0,0]), {...connection([0,0]),feature_id:'b',connected_feature_id:'a'}]);
  assert.equal(result.junctions.length,1);
  assert.equal(result.atZoom(18).get('a').length,1);
});
test('a connection elsewhere does not erase the unconnected crossing', () => {
  assert.equal(prepareCrossings(lines,[connection([.001,.001])]).atZoom(18).get('a').length,2);
});
test('crossing at an interior vertex is cut on both sides of that vertex', () => {
  const result=prepareCrossings([{id:'a',coordinates:[[-.001,0],[0,0],[.001,0]]},lines[1]],[]).atZoom(18).get('a');
  assert.equal(result.length,2);
  assert.ok(result[0].at(-1)[0]<0 && result[1][0][0]>0);
});
test('hidden counterpart and collinear overlaps do not produce junctions or gaps', () => {
  assert.equal(prepareCrossings([lines[0]],[connection([0,0])]).junctions.length,0);
  assert.equal(prepareCrossings([lines[0],{id:'b',coordinates:[[-.0005,0],[.0005,0]]}],[]).atZoom(18).get('a').length,1);
});
