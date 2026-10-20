import type { FeatureCollection, Position } from "geojson";

export type Coordinate = [number, number]; // longitude, latitude
export type StreetNode = { point: Coordinate; adjacent: { node: number; edge: number }[] };
export type StreetEdge = { start: number; end: number; key: string; miles: number };
export type StreetGraph = { nodes: StreetNode[]; edges: StreetEdge[]; nodeByKey: Map<string, number>; directed: boolean };

export function pointKey(point: Coordinate) {
  return `${point[0].toFixed(7)},${point[1].toFixed(7)}`;
}

export function edgeKey(start: Coordinate, end: Coordinate) {
  return [pointKey(start), pointKey(end)].sort().join("|");
}

export function distanceMiles(a: Coordinate, b: Coordinate) {
  const radians = Math.PI / 180;
  const h = Math.sin((b[1] - a[1]) * radians / 2) ** 2 +
    Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin((b[0] - a[0]) * radians / 2) ** 2;
  return 7917.6 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function validCoordinates(raw: Position[]): Coordinate[] {
  if (!Array.isArray(raw) || raw.some(point => !Array.isArray(point) || point.length < 2 ||
    !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)) return [];
  const coordinates: Coordinate[] = [];
  for (const point of raw) {
    const coordinate: Coordinate = [point[0], point[1]];
    if (!coordinates.length || pointKey(coordinates.at(-1)!) !== pointKey(coordinate)) coordinates.push(coordinate);
  }
  return coordinates;
}

export function buildStreetGraph(network: FeatureCollection): StreetGraph {
  const nodes: StreetNode[] = [], edges: StreetEdge[] = [];
  let directed = false;
  const nodeByKey = new Map<string, number>(), seenEdges = new Set<string>();
  const nodeFor = (point: Coordinate) => {
    const key = pointKey(point);
    let index = nodeByKey.get(key);
    if (index === undefined) {
      index = nodes.length;
      nodeByKey.set(key, index);
      nodes.push({ point, adjacent: [] });
    }
    return index;
  };
  for (const feature of network.features) {
    if (feature.geometry?.type !== "LineString") continue;
    const tags = feature.properties;
    if (/^(motorway|motorway_link|trunk|trunk_link|construction|proposed)$/.test(tags?.highway ?? "") ||
        /^(no|private|use_sidepath)$/.test(tags?.foot ?? "") ||
        (/^(no|private)$/.test(tags?.access ?? "") && !/^(yes|designated|permissive)$/.test(tags?.foot ?? ""))) continue;
    const coordinates = validCoordinates(feature.geometry.coordinates);
    for (let index = 1; index < coordinates.length; index++) {
      const a = coordinates[index - 1], b = coordinates[index], key = edgeKey(a, b);
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      const start = nodeFor(a), end = nodeFor(b), edge = edges.length;
      edges.push({ start, end, key, miles: distanceMiles(a, b) });
      if (tags?.["oneway:foot"] === "yes" || tags?.["oneway:foot"] === "-1") directed = true;
      // Ordinary road one-way rules apply to cars, not pedestrians.
      if (tags?.["oneway:foot"] !== "-1") nodes[start].adjacent.push({ node: end, edge });
      if (tags?.["oneway:foot"] !== "yes") nodes[end].adjacent.push({ node: start, edge });
    }
  }
  return { nodes, edges, nodeByKey, directed };
}

class MinHeap {
  values: [number, number][] = [];
  push(value: [number, number]) {
    let index = this.values.length;
    this.values.push(value);
    while (index) {
      const parent = (index - 1) >> 1;
      if (this.values[parent][0] <= value[0]) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }
  pop(): [number, number] {
    const first = this.values[0], last = this.values.pop()!;
    if (this.values.length) {
      let index = 0;
      while (index * 2 + 1 < this.values.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.values.length && this.values[child + 1][0] < this.values[child][0]) child++;
        if (this.values[child][0] >= last[0]) break;
        this.values[index] = this.values[child];
        index = child;
      }
      this.values[index] = last;
    }
    return first;
  }
}

export function shortestPaths(graph: StreetGraph, start: number) {
  const distances = new Float64Array(graph.nodes.length).fill(Infinity);
  const previousNodes = new Int32Array(graph.nodes.length).fill(-1);
  const previousEdges = new Int32Array(graph.nodes.length).fill(-1);
  const heap = new MinHeap();
  distances[start] = 0;
  heap.push([0, start]);
  while (heap.values.length) {
    const [cost, node] = heap.pop();
    if (cost > distances[node] + 1e-10) continue;
    for (const next of graph.nodes[node].adjacent) {
      const proposed = cost + graph.edges[next.edge].miles;
      if (proposed < distances[next.node] - 1e-10) {
        distances[next.node] = proposed;
        previousNodes[next.node] = node;
        previousEdges[next.node] = next.edge;
        heap.push([proposed, next.node]);
      }
    }
  }
  return { distances, previousNodes, previousEdges };
}
