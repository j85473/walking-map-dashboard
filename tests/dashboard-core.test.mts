import test from "node:test";
import assert from "node:assert/strict";
import { simplifyTrack } from "../src/lib/simplifyTrack.ts";
import { validateWalk } from "../src/lib/walkValidation.ts";
import { makeUploadBatches } from "../src/lib/uploadBatches.ts";
import type { Walk } from "../src/lib/walkTypes.ts";

const baseWalk: Walk = {
  id: "morning.gpx",
  name: "Morning walk",
  date: "2026-09-27T12:00:00.000Z",
  distanceMiles: 2.3,
  steps: 4600,
  points: [[44.97, -93.26], [44.971, -93.261]],
};

test("route simplification removes redundant samples but retains endpoints and bends", () => {
  const straight: [number, number][] = Array.from({ length: 101 }, (_, i) => [44.97 + i * 0.00001, -93.26]);
  assert.deepEqual(simplifyTrack(straight), [straight[0], straight.at(-1)]);
  const corner: [number, number][] = [[44.97, -93.26], [44.9705, -93.26], [44.9705, -93.2595]];
  assert.deepEqual(simplifyTrack(corner), corner);
});

test("walk validation preserves valid data and rejects malformed GPS", () => {
  assert.deepEqual(validateWalk(baseWalk), baseWalk);
  assert.equal(validateWalk({ ...baseWalk, points: [[44.97, -93.26], [Infinity, -93.261]] }), null);
  assert.equal(validateWalk({ ...baseWalk, points: [[44.97, -93.26], [91, -93.261]] }), null);
  assert.equal(validateWalk({ ...baseWalk, points: [[44.97, -93.26]] }), null);
  assert.equal(validateWalk({ ...baseWalk, date: "not a date" }), null);
});

test("GPX file parser returns a dated route suitable for upload", async () => {
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>River walk</name><type>walking</type><trkseg><trkpt lat="44.9700" lon="-93.2600"><time>2026-09-27T12:00:00Z</time></trkpt><trkpt lat="44.9710" lon="-93.2610"><time>2026-09-27T12:02:00Z</time></trkpt></trkseg></trk></gpx>`;
  const file = new File([gpx], "river.gpx", { type: "application/gpx+xml" });
  const { parseWalkFile } = await import("../src/lib/parseWalkFile.ts");
  const walks = await parseWalkFile(file);
  assert.equal(walks.length, 1);
  assert.equal(walks[0].name, "River walk");
  assert.equal(walks[0].date, "2026-09-27T12:00:00.000Z");
  assert.deepEqual(walks[0].points, [[44.97, -93.26], [44.971, -93.261]]);
  assert.ok(validateWalk(walks[0]));
});

test("heatmap snaps nearby GPS samples to street geometry without extending the whole street", async () => {
  const { buildStreetHeatmap } = await import("../src/lib/streetHeatmap.ts");
  const streets = [{
    type: "Feature" as const,
    properties: { id: 1, name: "Test Street", highway: "residential" },
    geometry: { type: "LineString" as const, coordinates: [[-93.260, 44.970], [-93.258, 44.970]] as [number, number][] },
  }];
  const walk = { ...baseWalk, points: [
    [44.97009, -93.25992], [44.97009, -93.25982], [44.97009, -93.25972],
  ] as [number, number][] };
  const heatmap = buildStreetHeatmap([walk], streets);
  assert.ok(heatmap.segments.length > 0);
  assert.equal(heatmap.unmatchedRoutes.length, 0);
  assert.ok(heatmap.segments.every(segment => segment.start[0] === 44.970 && segment.end[0] === 44.970));
  assert.ok(heatmap.segments.every(segment => segment.end[1] < -93.2594));
  assert.ok(heatmap.segments.every(segment => segment.visits === 1));
});

test("heatmap counts walks once per street section and preserves off-network routes", async () => {
  const { buildStreetHeatmap } = await import("../src/lib/streetHeatmap.ts");
  const streets = [{
    type: "Feature" as const,
    properties: { id: 1, name: "Test Street", highway: "residential" },
    geometry: { type: "LineString" as const, coordinates: [[-93.260, 44.970], [-93.258, 44.970]] as [number, number][] },
  }];
  const nearby = [[44.97005, -93.2599], [44.97005, -93.2598], [44.97005, -93.2597]] as [number, number][];
  const remote = [[44.99, -93.27], [44.9901, -93.2701]] as [number, number][];
  const heatmap = buildStreetHeatmap([
    { ...baseWalk, id: "a", points: nearby },
    { ...baseWalk, id: "b", points: nearby },
    { ...baseWalk, id: "c", points: remote },
  ], streets);
  assert.ok(heatmap.segments.every(segment => segment.visits === 2));
  assert.deepEqual(heatmap.unmatchedRoutes, [remote]);
});

test("upload batches honor both the walk count and UTF-8 request size", () => {
  const items = Array.from({ length: 5 }, (_, fileIndex) => ({
    fileIndex,
    walk: { ...baseWalk, id: `walk-${fileIndex}`, name: `Walk ${fileIndex}` },
  }));
  const byCount = makeUploadBatches(items, 100_000, 2);
  assert.deepEqual(byCount.batches.map(batch => batch.items.length), [2, 2, 1]);
  assert.deepEqual(byCount.batches.flatMap(batch => JSON.parse(batch.body).map((walk: { id: string }) => walk.id)), items.map(item => item.walk.id));

  const oneItemBytes = new TextEncoder().encode(JSON.stringify([items[0].walk])).byteLength;
  const bySize = makeUploadBatches(items, oneItemBytes, 20);
  assert.deepEqual(bySize.batches.map(batch => batch.items.length), [1, 1, 1, 1, 1]);
  assert.ok(bySize.batches.every(batch => new TextEncoder().encode(batch.body).byteLength <= oneItemBytes));

  const oversized = makeUploadBatches(items, oneItemBytes - 1, 20);
  assert.equal(oversized.batches.length, 0);
  assert.equal(oversized.oversized.length, items.length);
});
