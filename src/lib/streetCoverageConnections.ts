import { pointKey } from "../app/utils/streetGraph.ts";
import { isWalkableStreet } from "./walkableStreets.ts";

type Segment = {
  start: [number, number]; end: [number, number];
  x1: number; y1: number; dx: number; dy: number; lengthSquared: number;
  bins: number; offset: number;
  feature: { properties?: Record<string, unknown> | null };
};
export type StreetMatch = { segment: number; fraction: number; x: number; y: number };
type Node = { x: number; y: number; edges: { node: number; segment: number; meters: number }[] };

/** Connect consecutive matches through a short, walkable junction path. Every
 * node must stay within the GPS corridor. This credits actual through movement
 * across OSM splits and sidewalk-offset corners, not unrelated nearby streets.
 */
export function createStreetCoverageConnector(segments: Segment[], matchMeters: number) {
  const nodes: Node[] = [], nodeByKey = new Map<string, number>();
  const endpoints: [number, number][] = [];
  const nodeFor = (point: [number, number], x: number, y: number) => {
    const key = pointKey([point[1], point[0]]);
    let node = nodeByKey.get(key);
    if (node === undefined) {
      node = nodes.length;
      nodes.push({ x, y, edges: [] });
      nodeByKey.set(key, node);
    }
    return node;
  };
  for (const [index, segment] of segments.entries()) {
    const a = nodeFor(segment.start, segment.x1, segment.y1);
    const b = nodeFor(segment.end, segment.x1 + segment.dx, segment.y1 + segment.dy);
    endpoints.push([a, b]);
    if (!isWalkableStreet(segment.feature)) continue;
    const meters = Math.sqrt(segment.lengthSquared), direction = segment.feature.properties?.["oneway:foot"];
    if (direction !== "-1") nodes[a].edges.push({ node: b, segment: index, meters });
    if (direction !== "yes") nodes[b].edges.push({ node: a, segment: index, meters });
  }

  const mark = (segment: Segment, from: number, to: number, bins: Set<number>) => {
    const a = Math.min(segment.bins - 1, Math.floor(Math.min(from, to) * segment.bins));
    const b = Math.min(segment.bins - 1, Math.floor(Math.max(from, to) * segment.bins));
    for (let bin = a; bin <= b; bin++) bins.add(segment.offset + bin);
  };

  return (previous: StreetMatch, current: StreetMatch, walkedBins: Set<number>): boolean => {
    const dx = current.x - previous.x, dy = current.y - previous.y;
    const gpsSquared = dx * dx + dy * dy;
    // Dense walking fixes support corner transitions. A sparse jump does not.
    if (gpsSquared > 30 * 30 || previous.segment === current.segment) return false;
    const maxMeters = Math.min(60, Math.sqrt(gpsSquared) + matchMeters * 2);
    const corridorSquared = matchMeters * matchMeters;
    const inCorridor = (node: number) => {
      const point = nodes[node];
      const t = gpsSquared ? Math.max(0, Math.min(1,
        ((point.x - previous.x) * dx + (point.y - previous.y) * dy) / gpsSquared)) : 0;
      return (point.x - previous.x - t * dx) ** 2 + (point.y - previous.y - t * dy) ** 2 <= corridorSquared;
    };
    const source = segments[previous.segment], target = segments[current.segment];
    if (!isWalkableStreet(source.feature) || !isWalkableStreet(target.feature)) return false;
    const sourceLength = Math.sqrt(source.lengthSquared), targetLength = Math.sqrt(target.lengthSquared);
    const sourceDirection = source.feature.properties?.["oneway:foot"], targetDirection = target.feature.properties?.["oneway:foot"];
    const starts = [
      { node: endpoints[previous.segment][0], meters: previous.fraction * sourceLength, allowed: sourceDirection !== "yes" },
      { node: endpoints[previous.segment][1], meters: (1 - previous.fraction) * sourceLength, allowed: sourceDirection !== "-1" },
    ];
    const ends = [
      { node: endpoints[current.segment][0], meters: current.fraction * targetLength, allowed: targetDirection !== "-1" },
      { node: endpoints[current.segment][1], meters: (1 - current.fraction) * targetLength, allowed: targetDirection !== "yes" },
    ];
    const distance = new Map<number, number>(), predecessor = new Map<number, { node: number; segment: number }>();
    const queue: { node: number; meters: number }[] = [];
    for (const start of starts) {
      if (!start.allowed || start.meters > maxMeters || !inCorridor(start.node)) continue;
      if (start.meters >= (distance.get(start.node) ?? Infinity)) continue;
      distance.set(start.node, start.meters); queue.push(start);
    }
    let bestMeters = maxMeters + 1e-8, finish = -1;
    while (queue.length) {
      let nearest = 0;
      for (let index = 1; index < queue.length; index++) if (queue[index].meters < queue[nearest].meters) nearest = index;
      const [step] = queue.splice(nearest, 1);
      if (step.meters !== distance.get(step.node) || step.meters >= bestMeters) continue;
      for (const end of ends) {
        if (end.allowed && end.node === step.node && step.meters + end.meters < bestMeters) {
          bestMeters = step.meters + end.meters; finish = step.node;
        }
      }
      for (const edge of nodes[step.node].edges) {
        const meters = step.meters + edge.meters;
        if (meters >= bestMeters || meters > maxMeters || meters >= (distance.get(edge.node) ?? Infinity) || !inCorridor(edge.node)) continue;
        distance.set(edge.node, meters); predecessor.set(edge.node, { node: step.node, segment: edge.segment });
        queue.push({ node: edge.node, meters });
      }
    }
    if (finish < 0) return false;
    mark(target, finish === endpoints[current.segment][0] ? 0 : 1, current.fraction, walkedBins);
    let root = finish;
    while (predecessor.has(root)) {
      const edge = predecessor.get(root)!;
      mark(segments[edge.segment], 0, 1, walkedBins);
      root = edge.node;
    }
    mark(source, previous.fraction, root === endpoints[previous.segment][0] ? 0 : 1, walkedBins);
    return true;
  };
}
