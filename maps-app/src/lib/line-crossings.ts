type Point = [number, number];
export interface CrossingLine { id: string; coordinates: Point[] }
export interface CrossingConnection { feature_id: string; connected_feature_id: string; geometry: { coordinates: unknown } }
const project = ([lng, lat]: Point): Point => [lng / 360, -Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360)) / (2 * Math.PI)];
const unproject = ([x, y]: Point): Point => [x * 360, (2 * Math.atan(Math.exp(-y * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI];
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const interpolate = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Display-only geometry. Never write these shortened lines back to asset records. */
export function prepareCrossings(lines: CrossingLine[], connections: CrossingConnection[]) {
  const paths = lines.map(line => {
    const points = line.coordinates.map(project);
    const lengths = [0];
    points.slice(1).forEach((p, i) => lengths.push(lengths[i]! + distance(points[i]!, p)));
    return { ...line, points, lengths, cuts: [] as number[] };
  });
  const visible = new Set(lines.map(line => line.id));
  const junctions = connections.filter(c => visible.has(c.feature_id) && visible.has(c.connected_feature_id))
    .flatMap(c => Array.isArray(c.geometry.coordinates) && typeof c.geometry.coordinates[0] === 'number'
      ? [{ ...c, point: project(c.geometry.coordinates as Point) }] : []);
  const segments = paths.flatMap(path => path.points.slice(1).map((b, i) => ({ path, a: path.points[i]!, b, i })))
    .sort((a, b) => Math.min(a.a[0], a.b[0]) - Math.min(b.a[0], b.b[0]));
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!;
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j]!;
      if (Math.min(b.a[0], b.b[0]) > Math.max(a.a[0], a.b[0])) break;
      if (a.path.id === b.path.id || Math.min(a.a[1], a.b[1]) > Math.max(b.a[1], b.b[1]) || Math.min(b.a[1], b.b[1]) > Math.max(a.a[1], a.b[1])) continue;
      const rx = a.b[0] - a.a[0], ry = a.b[1] - a.a[1];
      const sx = b.b[0] - b.a[0], sy = b.b[1] - b.a[1];
      const det = rx * sy - ry * sx;
      if (Math.abs(det) < 1e-24) continue; // Collinear overlaps are not crossings.
      const dx = b.a[0] - a.a[0], dy = b.a[1] - a.a[1];
      const t = (dx * sy - dy * sx) / det, u = (dx * ry - dy * rx) / det;
      if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) continue;
      const point = interpolate(a.a, a.b, Math.max(0, Math.min(1, t)));
      const connected = junctions.some(c => ((c.feature_id === a.path.id && c.connected_feature_id === b.path.id) || (c.feature_id === b.path.id && c.connected_feature_id === a.path.id)) && distance(c.point, point) < 1e-8);
      if (connected) continue;
      // Stable choice for visual separation only; does not imply elevation.
      const cut = a.path.id < b.path.id ? a : b;
      const fraction = cut === a ? t : u;
      cut.path.cuts.push(cut.path.lengths[cut.i]! + distance(cut.a, cut.b) * Math.max(0, Math.min(1, fraction)));
    }
  }
  return {
    junctions: junctions.filter((c, i, all) => all.findIndex(other => distance(other.point, c.point) < 1e-10) === i)
      .map(c => ({ featureId: c.feature_id, coordinate: unproject(c.point) })),
    atZoom(zoom: number): Map<string, Point[][]> {
      const halfGap = 9 / (512 * 2 ** zoom);
      return new Map(paths.map(path => {
        if (!path.cuts.length) return [path.id, [path.coordinates]];
        const intervals = path.cuts.sort((a,b) => a-b).map(c => [Math.max(0, c-halfGap), Math.min(path.lengths.at(-1)!, c+halfGap)]);
        const pieces: Point[][] = [];
        let piece: Point[] = [];
        for (let i = 0; i < path.points.length - 1; i++) {
          const start = path.lengths[i]!, end = path.lengths[i+1]!;
          if (end === start) continue;
          let cursor = start;
          const append = (from: number, to: number) => {
            if (to <= from) return;
            if (!piece.length) piece.push(unproject(interpolate(path.points[i]!, path.points[i+1]!, (from-start)/(end-start))));
            piece.push(unproject(interpolate(path.points[i]!, path.points[i+1]!, (to-start)/(end-start))));
          };
          for (const [lo, hi] of intervals) {
            if (hi! <= cursor || lo! >= end) continue;
            append(cursor, Math.min(lo!, end));
            if (piece.length > 1) pieces.push(piece);
            piece = [];
            cursor = Math.max(cursor, Math.min(hi!, end));
          }
          append(cursor, end);
        }
        if (piece.length > 1) pieces.push(piece);
        return [path.id, pieces];
      }));
    },
  };
}
