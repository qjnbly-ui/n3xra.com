import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

// Exercise the actual workspace calculation without mounting React or mocking its logic.
const source = readFileSync(new URL('../../maps-app/src/components/MapsWorkspace.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'calculateIncidentIsolation');
assert.ok(fn, 'Workspace isolation function must exist');
const js = ts.transpileModule(`export ${fn.getText(tree)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { calculateIncidentIsolation: calculate } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

function fixture() {
  const layers = [
    { id: 'main', system_type: 'potable_water', standard_key: 'water-main' },
    { id: 'meter', system_type: 'potable_water', standard_key: 'water-meter' },
  ];
  const features = ['supply', 'a', 'b'].map(id => ({ id, layer_id: 'main', geometry_type: 'line', start_endpoint_type: 'dead_end', end_endpoint_type: 'dead_end' }));
  features.push(...['m1', 'm2'].map(id => ({ id, layer_id: 'meter', geometry_type: 'point', customer_reference: id })));
  return {
    layers, features,
    connections: [{ feature_id: 'a', connected_feature_id: 'b', endpoint: 'junction:test', connected_fraction: 0.5 }],
    devices: [{ device_feature_id: 'v1', line_a_feature_id: 'supply', line_b_feature_id: 'a' }],
    points: [{ point_feature_id: 'm1', line_feature_id: 'a', line_fraction: 0.5 }, { point_feature_id: 'm2', line_feature_id: 'b', line_fraction: 0.5 }],
  };
}
function run(f, actions = []) {
  return calculate({ id: 'incident', feature_id: 'a' }, f.features, f.layers, f.connections, f.devices, f.points, actions);
}
test('closing the boundary valve keeps both connected branch meters in the predicted area', () => {
  const result = run(fixture(), [{ incident_id: 'incident', valve_feature_id: 'v1', status: 'closed' }]);
  assert.deepEqual(result.affectedMeterIds.sort(), ['m1', 'm2']);
  assert.deepEqual(result.requiredValveIds, ['v1']);
  assert.equal(result.isolatedFeatureIds.includes('supply'), false);
  assert.equal(result.topologyComplete, true);
});
test('a crossing without a saved connection does not include the other meter', () => {
  const f = fixture(); f.connections = [];
  assert.deepEqual(run(f).affectedMeterIds, ['m1']);
});
test('an inoperable valve expands the estimate to the next usable valve', () => {
  const f = fixture();
  f.features.push({ id: 'upstream', layer_id: 'main', geometry_type: 'line', start_endpoint_type: 'source', end_endpoint_type: 'dead_end' });
  f.devices.push({ device_feature_id: 'v2', line_a_feature_id: 'upstream', line_b_feature_id: 'supply' });
  const result = run(f, [{ incident_id: 'incident', valve_feature_id: 'v1', status: 'inoperable' }]);
  assert.deepEqual(result.requiredValveIds, ['v2']);
  assert.ok(result.isolatedFeatureIds.includes('supply'));
  assert.equal(result.isolatedFeatureIds.includes('upstream'), false);
});
test('an alternate connection around a valve prevents it being treated as an isolation boundary', () => {
  const f = fixture();
  f.connections.push({ feature_id: 'b', connected_feature_id: 'supply', endpoint: 'junction:loop', connected_fraction: 0.5 });
  const result = run(f);
  assert.deepEqual(result.requiredValveIds, []);
  assert.equal(result.topologyComplete, false);
});
test('unknown main endpoints keep the estimate incomplete', () => {
  const f = fixture(); f.features.find(x => x.id === 'b').end_endpoint_type = 'unknown';
  const result = run(f);
  assert.equal(result.topologyComplete, false);
  assert.equal(result.openEndpoints.length, 1);
});
