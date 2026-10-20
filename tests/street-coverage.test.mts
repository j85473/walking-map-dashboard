import test from "node:test";
import assert from "node:assert/strict";
import type { FeatureCollection } from "geojson";
import { buildCoverageRoutingNetwork, buildStreetCoverage } from "../src/lib/streetHeatmap.ts";
import type { StreetFeature } from "../src/app/utils/streetMatcher.ts";
import type { Walk } from "../src/lib/walkTypes.ts";
import { distanceMiles, type Coordinate } from "../src/app/utils/streetGraph.ts";
import { generateWalkPlan, WALK_HOME } from "../src/app/utils/routeGenerator.ts";

const a: Coordinate = [-93.26, 44.97], b: Coordinate = [-93.257, 44.97];
const street = (id: number, coordinates: Coordinate[], name = "Test street"): StreetFeature => ({
  type: "Feature", properties: { id, name, highway: "residential" }, geometry: { type: "LineString", coordinates },
});
const walk = (points: [number, number][]): Walk => ({ id: "test", name: "GPS walk", date: "2026-10-20T12:00:00Z", distanceMiles: 1, steps: 2000, points });
const gps = ([lon, lat]: Coordinate): [number, number] => [lat, lon];
const network = (features: StreetFeature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const along = (start: Coordinate, end: Coordinate, count: number): Coordinate[] => Array.from({ length: count }, (_, i) => [
  start[0] + (end[0] - start[0]) * i / (count - 1), start[1] + (end[1] - start[1]) * i / (count - 1),
]);
function onSegment(point: Coordinate, start: Coordinate, end: Coordinate) {
  const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
  return length > 0 && Math.abs((point[0] - start[0]) * dy - (point[1] - start[1]) * dx) / length < 1e-9 &&
    (point[0] - start[0]) * dx + (point[1] - start[1]) * dy >= -1e-12 &&
    (point[0] - end[0]) * dx + (point[1] - end[1]) * dy <= 1e-12;
}
function assertComplement(features: StreetFeature[], analysis: ReturnType<typeof buildStreetCoverage>) {
  const routing = buildCoverageRoutingNetwork(network(features));
  for (const feature of routing.features) {
    assert.equal(feature.geometry?.type, "LineString");
    if (feature.geometry?.type !== "LineString") continue;
    const c = feature.geometry.coordinates as Coordinate[];
    for (let index = 1; index < c.length; index++) {
      const midpoint: Coordinate = [(c[index - 1][0] + c[index][0]) / 2, (c[index - 1][1] + c[index][1]) / 2];
      const colored = analysis.heatmap.segments.some(segment => onSegment(midpoint, [segment.start[1], segment.start[0]], [segment.end[1], segment.end[0]]));
      const remaining = analysis.progress.unwalkedGeoJSON.features.some(feature => feature.geometry.coordinates.slice(1)
        .some((end, i) => onSegment(midpoint, feature.geometry.coordinates[i], end)));
      assert.notEqual(colored, remaining, `Every eligible section must be colored or remaining, exclusively: ${midpoint}`);
    }
  }
}

test("touching an intersection credits only the matched end of a long street", () => {
  const features = [street(1, [a, b])];
  const analysis = buildStreetCoverage([walk([[a[1] - 0.0001, a[0]], gps(a), [a[1] + 0.0001, a[0]]])], features);
  assert.ok(analysis.progress.walkedMiles > 0);
  assert.ok(analysis.progress.walkedMiles < analysis.progress.totalMiles * 0.2);
  assert.ok(analysis.progress.remainingMiles > analysis.progress.totalMiles * 0.8);
  assertComplement(features, analysis);
});

test("a full recorded traversal colors the whole street and leaves no red portions", () => {
  const features = [street(1, [a, b])];
  const analysis = buildStreetCoverage([walk(along(a, b, 80).map(gps))], features);
  assert.equal(analysis.progress.walkedMiles, analysis.progress.totalMiles);
  assert.equal(analysis.progress.remainingMiles, 0);
  assert.equal(analysis.progress.unwalkedGeoJSON.features.length, 0);
  assertComplement(features, analysis);
});

test("one-sided GPS and nearby parallel streets cannot fill each other's gaps", () => {
  const parallel = [a, b].map(([lon, lat]) => [lon, lat + 0.00012] as Coordinate);
  const features = [street(1, [a, b]), street(2, parallel)];
  const analysis = buildStreetCoverage([walk(along(a, b, 80).map(gps))], features);
  assert.ok(analysis.progress.unwalkedGeoJSON.features.every(feature => feature.properties.id === 2));
  assert.ok(analysis.heatmap.segments.every(segment => segment.start[0] === a[1] && segment.end[0] === a[1]));
  assertComplement(features, analysis);
});

test("missing GPS spanning over 120 meters does not invent a completed street", () => {
  const features = [street(1, [a, b])];
  const analysis = buildStreetCoverage([walk([gps(a), gps(b)])], features);
  assert.ok(analysis.progress.remainingMiles > analysis.progress.totalMiles * 0.8);
  assertComplement(features, analysis);
});

test("duplicate edges do not create contradictory layers or invent connectors", () => {
  const repeated = [street(1, [a, b]), street(2, [b, a])];
  const covered = buildStreetCoverage([walk(along(a, b, 80).map(gps))], repeated);
  assert.equal(covered.progress.remainingMiles, 0);
  assert.equal(covered.progress.totalMiles, Number(distanceMiles(a, b).toFixed(2)));
  assertComplement(repeated, covered);
  const c: Coordinate = [a[0], a[1] + 0.001];
  const retraced = buildStreetCoverage([], [street(1, [a, b, a, c])]);
  assert.equal(retraced.progress.unwalkedGeoJSON.features.length, 2);
  assert.ok(retraced.progress.unwalkedGeoJSON.features.every(feature => {
    const points = feature.geometry.coordinates;
    return points.every(point => onSegment(point, a, b)) || points.every(point => onSegment(point, a, c));
  }));
});

test("outside history stays visible while only the downtown subset earns completion", () => {
  const inside = street(1, [a, b]), outside = street(2, [[a[0], a[1] - 0.002], [b[0], b[1] - 0.002]]);
  const features = [inside, outside];
  const analysis = buildStreetCoverage([walk(along(...outside.geometry.coordinates as [Coordinate, Coordinate], 80).map(gps))], features, [inside]);
  assert.ok(analysis.heatmap.segments.length > 0);
  assert.equal(analysis.progress.walkedMiles, 0);
  assert.equal(analysis.progress.totalMiles, Number(distanceMiles(a, b).toFixed(2)));
  assert.ok(analysis.progress.unwalkedGeoJSON.features.every(feature => feature.properties.id === 1));
});

test("planner targets align with partial unwalked sections and avoid already colored bins", () => {
  const start = WALK_HOME.coordinates, end: Coordinate = [start[0] + 0.003, start[1]];
  const features = [street(1, [start, end])];
  const recorded = along(start, end, 80).map(gps);
  const before = structuredClone(features), walks = [walk(recorded.slice(0, 25)), { ...walk(recorded.slice(55)), id: "second" }], originalWalks = structuredClone(walks);
  const analysis = buildStreetCoverage(walks, features);
  const plan = generateWalkPlan(analysis.progress.unwalkedGeoJSON, { maxWaypoints: 3, streetNetwork: buildCoverageRoutingNetwork(network(features)) });
  assert.ok(plan);
  assert.ok(plan.novelMiles > 0);
  const remainingMiles = analysis.progress.unwalkedGeoJSON.features.reduce((sum, feature) => sum + feature.geometry.coordinates.slice(1)
    .reduce((total, point, i) => total + distanceMiles(feature.geometry.coordinates[i], point), 0), 0);
  assert.ok(Math.abs(plan.novelMiles - remainingMiles) < 1e-8);
  for (const target of plan.targetSegments) {
    const midpoint: Coordinate = [(target.coordinates[0][0] + target.coordinates[1][0]) / 2, (target.coordinates[0][1] + target.coordinates[1][1]) / 2];
    assert.ok(!analysis.heatmap.segments.some(segment => onSegment(midpoint, [segment.start[1], segment.start[0]], [segment.end[1], segment.end[0]])));
  }
  assertComplement(features, analysis);
  assert.deepEqual(features, before);
  assert.deepEqual(walks, originalWalks);
});

const meters = (east: number, north: number): Coordinate => [a[0] + east / 78750, a[1] + north / 111132];
const junction = () => [
  street(1, [meters(-100, 0), meters(-4, 0)], "West block"),
  street(2, [meters(-4, 0), meters(0, 0)], "West junction piece"),
  street(3, [meters(0, 0), meters(0, 4)], "North junction piece"),
  street(4, [meters(0, 4), meters(0, 100)], "North block"),
  street(5, [meters(0, 0), meters(100, 0)], "Unused east block"),
];

test("consecutive sidewalk-offset fixes cover connected junction pieces during a turn", () => {
  const features = junction();
  const analysis = buildStreetCoverage([walk([gps(meters(-8, 6)), gps(meters(-6, 8))])], features);
  assert.ok(analysis.progress.unwalkedGeoJSON.features.every(feature => ![2, 3].includes(feature.properties.id)));
  const untouched = analysis.progress.unwalkedGeoJSON.features.filter(feature => feature.properties.id === 5);
  assert.equal(untouched.length, 1);
  assert.deepEqual(untouched[0].geometry.coordinates[0], features[4].geometry.coordinates[0]);
  assert.deepEqual(untouched[0].geometry.coordinates.at(-1), features[4].geometry.coordinates.at(-1));
  assert.ok(analysis.progress.remainingMiles > analysis.progress.totalMiles * 0.8);
  assertComplement(features, analysis);
});

test("straight through movement covers short OSM pieces even without a GPS fix on each piece", () => {
  const features = [
    street(1, [meters(-100, 0), meters(-3, 0)]),
    street(2, [meters(-3, 0), meters(3, 0)]),
    street(3, [meters(3, 0), meters(100, 0)]),
  ];
  const analysis = buildStreetCoverage([walk([gps(meters(-8, 6)), gps(meters(8, 6))])], features);
  assert.ok(analysis.progress.unwalkedGeoJSON.features.every(feature => feature.properties.id !== 2));
  assert.ok(analysis.progress.remainingMiles > analysis.progress.totalMiles * 0.7);
  assertComplement(features, analysis);
});

test("separate walks cannot jointly invent a traversal of the intersection", () => {
  const features = junction();
  const analysis = buildStreetCoverage([walk([gps(meters(-8, 6))]), { ...walk([gps(meters(-6, 8))]), id: "second" }], features);
  for (const id of [2, 3]) assert.ok(analysis.progress.unwalkedGeoJSON.features.some(feature => feature.properties.id === id));
  assertComplement(features, analysis);
});

test("junction inference does not bridge sparse GPS or detour between parallel roads", () => {
  const features = junction();
  const sparse = buildStreetCoverage([walk([gps(meters(-40, 6)), gps(meters(-6, 40))])], features);
  for (const id of [2, 3]) assert.ok(sparse.progress.unwalkedGeoJSON.features.some(feature => feature.properties.id === id));
  const parallel = [
    street(1, [meters(-100, 0), meters(100, 0)]),
    street(2, [meters(-100, 14), meters(100, 14)]),
    street(3, [meters(100, 0), meters(100, 14)]),
  ];
  const analysis = buildStreetCoverage([walk([gps(meters(0, 2)), gps(meters(0, 12))])], parallel);
  assert.ok(analysis.progress.unwalkedGeoJSON.features.some(feature => feature.properties.id === 3));
  assert.ok(analysis.progress.remainingMiles > analysis.progress.totalMiles * 0.8);
  assertComplement(parallel, analysis);
});

test("junction connections respect prohibited foot access and pedestrian direction", () => {
  for (const restriction of [{ foot: "no" }, { "oneway:foot": "-1" }]) {
    const features = junction();
    Object.assign(features[1].properties, restriction);
    const analysis = buildStreetCoverage([walk([gps(meters(-8, 6)), gps(meters(-6, 8))])], features);
    assert.ok(analysis.progress.unwalkedGeoJSON.features.some(feature => feature.properties.id === 3));
    assertComplement(features.filter(feature => feature.properties.foot !== "no"), analysis);
  }
});

test("a short connected detour outside the recorded GPS corridor remains unwalked", () => {
  const features = [
    street(1, [meters(-100, 0), meters(-4, 0)]),
    street(2, [meters(-4, 0), meters(0, 25), meters(4, 0)]),
    street(3, [meters(4, 0), meters(100, 0)]),
  ];
  const analysis = buildStreetCoverage([walk([gps(meters(-8, -10)), gps(meters(8, -10))])], features);
  const connector = analysis.progress.unwalkedGeoJSON.features.find(feature => feature.properties.id === 2);
  assert.ok(connector);
  assert.deepEqual(connector.geometry.coordinates[0], features[1].geometry.coordinates[0]);
  assert.deepEqual(connector.geometry.coordinates.at(-1), features[1].geometry.coordinates.at(-1));
  assertComplement(features, analysis);
});
