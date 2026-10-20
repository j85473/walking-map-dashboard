import type { FeatureCollection } from "geojson";

type Coordinate = [number, number]; // longitude, latitude
type Boundary = readonly (readonly [number, number])[];

// Joe's southern downtown limit follows I-94, rather than the old coarse crop.
// Northern carriageway from OpenStreetMap, retrieved 2026-10-20 and simplified
// to within one meter. OSM ways: 138749257, 734269754, 740040050, 740040049,
// 188375378, 46638992, 46638991, 46638984, 46638985. Other limits stay as bundled.
export const DOWNTOWN_SOUTH_BOUNDARY: Boundary = [
  [-93.2874978, 44.9652169], [-93.2873211, 44.9650752],
  [-93.2868759, 44.9648285], [-93.2865272, 44.9646842],
  [-93.286259, 44.9646121], [-93.2859693, 44.9645666],
  [-93.2854972, 44.9645362], [-93.2850546, 44.9645489],
  [-93.2846201, 44.9645926], [-93.284121, 44.9646729],
  [-93.2835515, 44.9648025], [-93.2780077, 44.9663432],
  [-93.2769726, 44.9666045], [-93.2766843, 44.9666583],
  [-93.2757797, 44.9667873], [-93.2752593, 44.966834],
  [-93.2746976, 44.9668633], [-93.2737066, 44.9668419],
  [-93.2732353, 44.9668076], [-93.2721915, 44.9666956],
  [-93.2715329, 44.9665999], [-93.269346, 44.9661592],
  [-93.2687632, 44.9660792], [-93.2681715, 44.9660487],
  [-93.2644423, 44.966024], [-93.2594118, 44.9660368],
  [-93.2584623, 44.9660672], [-93.2580653, 44.9660976],
  [-93.2573196, 44.9661811], [-93.2567081, 44.9662076],
  [-93.2559732, 44.9661697], [-93.2544389, 44.9660027],
  [-93.2537523, 44.9659875], [-93.2531086, 44.9660293],
  [-93.251193, 44.9663023],
];

function southernLatitude(longitude: number, boundary: Boundary) {
  if (longitude <= boundary[0][0]) return boundary[0][1];
  for (let index = 1; index < boundary.length; index++) {
    const a = boundary[index - 1], b = boundary[index];
    if (longitude <= b[0]) return a[1] + (b[1] - a[1]) * (longitude - a[0]) / (b[0] - a[0]);
  }
  return boundary[boundary.length - 1][1];
}

export function isInsideDowntownSouthBoundary(point: readonly number[], boundary: Boundary = DOWNTOWN_SOUTH_BOUNDARY) {
  return point[1] >= southernLatitude(point[0], boundary) - 1e-10;
}

function interpolate(a: Coordinate, b: Coordinate, fraction: number): Coordinate {
  if (fraction === 0) return a;
  if (fraction === 1) return b;
  return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
}

/** Split at actual intersections, including crossings between sparse OSM nodes.
 * Keep both sides for routing, with shared junctions at the boundary. Only the
 * downtown pieces earn completion credit. Never modify the original inventory.
 */
export function splitDowntownStreetNetwork(streets: FeatureCollection, boundary: Boundary = DOWNTOWN_SOUTH_BOUNDARY) {
  const completionNetwork: FeatureCollection = { ...streets, features: [] };
  const routingNetwork: FeatureCollection = { ...streets, features: [] };
  // Extend the cutoff horizontally beyond its surveyed range. The bundled
  // inventory supplies the existing western, northern and eastern limits.
  const extended: Boundary = [[-180, boundary[0][1]], ...boundary, [180, boundary[boundary.length - 1][1]]];
  for (const feature of streets.features) {
    if (feature.geometry?.type !== "LineString") continue;
    const coordinates = feature.geometry.coordinates as Coordinate[];
    const pieces: { inside: boolean; coordinates: Coordinate[] }[] = [];
    for (let index = 1; index < coordinates.length; index++) {
      const a = coordinates[index - 1], b = coordinates[index];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      if (dx === 0 && dy === 0) continue;
      const cuts = [0, 1];
      for (let edge = 1; edge < extended.length; edge++) {
        const c = extended[edge - 1], d = extended[edge];
        const ex = d[0] - c[0], ey = d[1] - c[1];
        const denominator = dx * ey - dy * ex;
        if (Math.abs(denominator) < 1e-16) continue;
        const cx = c[0] - a[0], cy = c[1] - a[1];
        const t = (cx * ey - cy * ex) / denominator;
        const u = (cx * dy - cy * dx) / denominator;
        if (t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) cuts.push(t);
      }
      cuts.sort((x, y) => x - y);
      for (let cut = 1; cut < cuts.length; cut++) {
        if (cuts[cut] - cuts[cut - 1] < 1e-9) continue;
        const start = interpolate(a, b, cuts[cut - 1]), end = interpolate(a, b, cuts[cut]);
        const inside = isInsideDowntownSouthBoundary(interpolate(a, b, (cuts[cut - 1] + cuts[cut]) / 2), boundary);
        const previous = pieces[pieces.length - 1];
        if (previous && previous.inside === inside) previous.coordinates.push(end);
        else pieces.push({ inside, coordinates: [start, end] });
      }
    }
    for (const piece of pieces) {
      const clipped = { ...feature, geometry: { type: "LineString" as const, coordinates: piece.coordinates } };
      routingNetwork.features.push(clipped);
      if (piece.inside) completionNetwork.features.push(clipped);
    }
  }
  return { completionNetwork, routingNetwork };
}
