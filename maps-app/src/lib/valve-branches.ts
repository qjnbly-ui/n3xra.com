type Point = [number, number];
export interface ValveBranch { featureId: string; side: "start" | "end"; direction: string; coordinates: Point[] }
const distance = (a: Point,b: Point) => Math.hypot((a[0]-b[0])*Math.cos(a[1]*Math.PI/180),a[1]-b[1])*111_195;

/** Split a display path at the junction, not the saved asset geometry. */
export function valveBranches(lines: { id: string; coordinates: Point[] }[], junction: Point): ValveBranch[] {
  return lines.flatMap(line => {
    let best: { i: number; point: Point; distance: number } | null = null;
    for (let i=0;i<line.coordinates.length-1;i++) {
      const a=line.coordinates[i]!,b=line.coordinates[i+1]!;
      const scale=Math.cos(junction[1]*Math.PI/180);
      const dx=(b[0]-a[0])*scale,dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,(((junction[0]-a[0])*scale*dx)+(junction[1]-a[1])*dy)/(dx*dx+dy*dy || 1)));
      const point: Point=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];
      const d=distance(point,junction);
      if (!best || d<best.distance) best={i,point,distance:d};
    }
    if (!best || best.distance>0.5) return [];
    const sides = [
      {side:"start" as const,coordinates:[best.point,...line.coordinates.slice(0,best.i+1).reverse()]},
      {side:"end" as const,coordinates:[best.point,...line.coordinates.slice(best.i+1)]},
    ];
    return sides.flatMap(branch => {
      const next=branch.coordinates.find(p=>distance(p,branch.coordinates[0]!)>0.15);
      if (!next) return [];
      const origin=branch.coordinates[0]!;
      const angle=(Math.atan2((next[0]-origin[0])*Math.cos(origin[1]*Math.PI/180),next[1]-origin[1])*180/Math.PI+360)%360;
      return [{featureId:line.id,...branch,direction:["north","northeast","east","southeast","south","southwest","west","northwest"][Math.round(angle/45)%8]!}];
    });
  });
}
