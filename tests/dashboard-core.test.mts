import test from "node:test";
import assert from "node:assert/strict";
import { simplifyTrack } from "../src/lib/simplifyTrack.ts";
import { validateWalk } from "../src/lib/walkValidation.ts";

const baseWalk = {
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
