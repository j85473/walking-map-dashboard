import type { FeatureCollection } from "geojson";
import { isWalkableStreet } from "../../lib/walkableStreets.ts";
import { buildStreetGraph, distanceMiles, edgeKey, pointKey, shortestPaths, validCoordinates, type Coordinate } from "./streetGraph.ts";

export const WALK_HOME = {
  address: "2121 Garfield Ave S, Minneapolis, MN",
  coordinates: [-93.2864753, 44.9613767] as Coordinate,
};

export type WalkSection = { name: string; coordinates: Coordinate[]; miles: number };
export type WalkPlan = {
  url: string;
  // Already-open tabs use the first entry; it also contains the entire loop.
  mobileUrls: [string];
  waypoints: Coordinate[];
  sections: WalkSection[];
  targetSegments: WalkSection[];
  networkPath: Coordinate[];
  novelMiles: number;
  estimatedMiles: number;
  coverageFraction: number;
};

type NovelSegment = WalkSection & { key: string };
type RemainingSection = WalkSection & { edgeIds: number[] };
type Leg = { miles: number; novel: number[]; path: number[] };
type State = { stops: number[]; miles: number; novelMiles: number; closed: number[]; covered: Set<number>; score: number };

export function googleMapsWaypointLimit(userAgent: string, maxTouchPoints = 0): 3 | 9 {
  return /Android|iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) ? 3 : 9;
}

function remainingSections(collection: FeatureCollection) {
  const segments: NovelSegment[] = [], sections: RemainingSection[] = [];
  const edgeIds = new Map<string, number>(), seen = new Set<string>();
  for (const feature of collection.features) {
    if (feature.geometry?.type !== "LineString" || !isWalkableStreet(feature)) continue;
    const coordinates = validCoordinates(feature.geometry.coordinates);
    if (coordinates.length < 2) continue;
    const name = String(feature.properties?.name || "Unnamed street"), ids = new Set<number>();
    let miles = 0;
    for (let index = 1; index < coordinates.length; index++) {
      const a = coordinates[index - 1], b = coordinates[index], key = edgeKey(a, b), length = distanceMiles(a, b);
      let id = edgeIds.get(key);
      if (id === undefined) {
        id = segments.length;
        edgeIds.set(key, id);
        segments.push({ name, key, coordinates: [a, b], miles: length });
      }
      ids.add(id);
      miles += length;
    }
    const identity = [...ids].sort((a, b) => a - b).join(",");
    if (miles < 0.00001 || seen.has(identity)) continue;
    seen.add(identity);
    sections.push({ name, coordinates, miles, edgeIds: [...ids] });
  }
  return { segments, sections, edgeIds };
}

function compare(a: State, b: State) {
  return b.score - a.score || b.closed.length - a.closed.length || b.novelMiles - a.novelMiles ||
    a.miles - b.miles || a.stops.length - b.stops.length;
}

/** Optimize progress per mile over connected streets. A waypoint is an anchor
 * on a continuous route, not a reservation for one isolated street fragment.
 * Every leg is routed on the full street graph and contributes unique novel
 * edges. Retracing an edge costs distance but earns no additional progress.
 * The bounded search is a heuristic, not a globally optimal tour guarantee.
 */
export function generateWalkPlan(
  unwalkedGeoJSON: FeatureCollection,
  options: { maxMiles?: number; maxWaypoints?: number; streetNetwork?: FeatureCollection } = {},
): WalkPlan | null {
  const maxMiles = options.maxMiles ?? 7, requestedWaypoints = options.maxWaypoints ?? 9;
  const maxWaypoints = Math.min(9, Math.floor(requestedWaypoints));
  if (!Number.isFinite(maxMiles) || maxMiles <= 0 || !Number.isFinite(requestedWaypoints) || maxWaypoints < 1 ||
      !unwalkedGeoJSON || !Array.isArray(unwalkedGeoJSON.features)) return null;
  const { segments, sections, edgeIds } = remainingSections(unwalkedGeoJSON);
  if (!sections.length) return null;
  const graph = buildStreetGraph(options.streetNetwork ?? unwalkedGeoJSON);
  const homeNode = graph.nodeByKey.get(pointKey(WALK_HOME.coordinates));
  const candidateNodes = new Set<number>();
  for (const section of sections) {
    for (let index = 0; index < section.coordinates.length; index++) {
      const node = graph.nodeByKey.get(pointKey(section.coordinates[index]));
      if (node !== undefined && node !== homeNode &&
          (index === 0 || index === section.coordinates.length - 1 || graph.nodes[node].adjacent.length > 2) &&
          distanceMiles(WALK_HOME.coordinates, graph.nodes[node].point) * 2 <= maxMiles) candidateNodes.add(node);
    }
  }
  // Bound worst-case work while retaining every anchor in smaller inventories.
  const candidates = [...candidateNodes];
  if (candidates.length > 192) candidates.sort((a, b) =>
    distanceMiles(WALK_HOME.coordinates, graph.nodes[a].point) - distanceMiles(WALK_HOME.coordinates, graph.nodes[b].point));
  const anchors = [homeNode ?? -1, ...candidates.slice(0, 192)];
  if (anchors.length < 2) return null;
  const pairs: (Leg | undefined)[][] = Array.from({ length: anchors.length }, () => []);
  const novelForEdge = graph.edges.map(edge => edgeIds.get(edge.key));
  for (let a = 0; a < anchors.length; a++) {
    if (anchors[a] === -1) continue;
    const paths = shortestPaths(graph, anchors[a]);
    pairs[a][a] = { miles: 0, novel: [], path: [anchors[a]] };
    for (let b = 0; b < anchors.length; b++) {
      if (a === b || (!graph.directed && b < a) || anchors[b] === -1 || !Number.isFinite(paths.distances[anchors[b]])) continue;
      const path = [anchors[b]], novel: number[] = [];
      let current = anchors[b];
      while (current !== anchors[a]) {
        const id = novelForEdge[paths.previousEdges[current]];
        if (id !== undefined) novel.push(id);
        current = paths.previousNodes[current];
        path.push(current);
      }
      pairs[a][b] = { miles: paths.distances[anchors[b]], novel, path: path.reverse() };
      if (!graph.directed) pairs[b][a] = { miles: paths.distances[anchors[b]], novel, path: [...path].reverse() };
    }
  }
  if (homeNode === undefined) {
    // The bundled downtown grid ends before home. Estimate these two access
    // legs, include both in cost, and award them no speculative new mileage.
    for (let a = 1; a < anchors.length; a++) {
      const leg = { miles: distanceMiles(WALK_HOME.coordinates, graph.nodes[anchors[a]].point) * 1.3, novel: [], path: [] };
      pairs[0][a] = pairs[a][0] = leg;
    }
  }
  const measure = (stops: number[]): State | null => {
    let miles = 0;
    const covered = new Set<number>();
    for (let index = 1; index < stops.length; index++) {
      const leg = pairs[stops[index - 1]][stops[index]];
      if (!leg) return null;
      miles += leg.miles;
      if (miles > maxMiles) return null;
      for (const id of leg.novel) covered.add(id);
    }
    if (!covered.size || miles <= 0) return null;
    let novelMiles = 0;
    for (const id of covered) novelMiles += segments[id].miles;
    const closed: number[] = [];
    sections.forEach((section, index) => { if (section.edgeIds.every(id => covered.has(id))) closed.push(index); });
    // Optimize actual progress per total mile. Completions break efficiency
    // ties; their count cannot disguise an inefficient walk with tiny gaps.
    return { stops, miles, novelMiles, covered, closed, score: novelMiles / miles };
  };
  const beamWidth = 96;
  let best: State | null = null;
  const keep = (state: State | null, beam: State[]) => {
    if (!state) return;
    if (state.closed.length && (!best || compare(state, best) < 0)) best = state;
    if (beam.length === beamWidth && compare(state, beam.at(-1)!) >= 0) return;
    beam.push(state);
    beam.sort(compare);
    if (beam.length > beamWidth) beam.pop();
  };
  for (let a = 1; a < anchors.length; a++) keep(measure([0, a, 0]), []);
  let beam: State[] = [];
  if (maxWaypoints >= 2) for (let a = 1; a < anchors.length; a++) for (let b = 1; b < anchors.length; b++) {
    if (a !== b && (graph.directed || a < b)) keep(measure([0, a, b, 0]), beam);
  }
  for (let round = 3; round <= maxWaypoints && beam.length; round++) {
    const next: State[] = [], seen = new Set<string>();
    for (const state of beam) for (let anchor = 1; anchor < anchors.length; anchor++) {
      if (state.stops.includes(anchor)) continue;
      for (let position = 1; position < state.stops.length; position++) {
        const stops = [...state.stops];
        stops.splice(position, 0, anchor);
        const forward = stops.join(","), reverse = [...stops].reverse().join(",");
        const identity = graph.directed ? forward : [forward, reverse].sort()[0];
        if (seen.has(identity)) continue;
        seen.add(identity);
        keep(measure(stops), next);
      }
    }
    beam = next;
  }
  // TypeScript cannot follow assignments made inside keep().
  const chosen = best as State | null;
  if (!chosen) return null;
  const waypoints = chosen.stops.slice(1, -1).map(index => graph.nodes[anchors[index]].point);
  const params = new URLSearchParams({ api: "1", origin: WALK_HOME.address, destination: WALK_HOME.address,
    travelmode: "walking", waypoints: waypoints.map(([lon, lat]) => `${lat},${lon}`).join("|") });
  const url = `https://www.google.com/maps/dir/?${params}`;
  const networkPath: Coordinate[] = [];
  for (let index = 1; index < chosen.stops.length; index++) {
    for (const node of pairs[chosen.stops[index - 1]][chosen.stops[index]]!.path) {
      const point = graph.nodes[node].point;
      if (!networkPath.length || pointKey(networkPath.at(-1)!) !== pointKey(point)) networkPath.push(point);
    }
  }
  return {
    url, mobileUrls: [url], waypoints, networkPath,
    sections: chosen.closed.map(index => {
      const { name, coordinates, miles } = sections[index];
      return { name, coordinates, miles };
    }),
    targetSegments: [...chosen.covered].map(index => {
      const { name, coordinates, miles } = segments[index];
      return { name, coordinates, miles };
    }),
    novelMiles: chosen.novelMiles, estimatedMiles: chosen.miles, coverageFraction: chosen.novelMiles / chosen.miles,
  };
}

export function generateWalkUrl(unwalkedGeoJSON: FeatureCollection): string | null {
  return generateWalkPlan(unwalkedGeoJSON)?.url ?? null;
}
