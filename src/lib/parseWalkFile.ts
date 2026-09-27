import GPXParser from "gpxparser";
import FitParser from "fit-file-parser";
import pako from "pako";
import { Buffer } from "buffer";
import type { Walk } from "./walkTypes";

type FitRecord = { position_lat?: number; position_long?: number; distance?: number };
type FitSession = { sport?: string | number; total_distance?: number; start_time?: string | Date };
type FitData = { records?: FitRecord[]; sessions?: FitSession[] };

function validDate(value: unknown, fallback: number): string {
  const date = value ? new Date(value as string | Date) : new Date(fallback);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(fallback).toISOString();
}

export async function parseWalkFile(file: File): Promise<Walk[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".fit") || name.endsWith(".fit.gz")) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const content = name.endsWith(".gz") ? pako.ungzip(bytes) : bytes;
    const parser = new FitParser({
      force: true,
      speedUnit: "km/h",
      lengthUnit: "km",
      temperatureUnit: "celsius",
      elapsedRecordField: true,
      mode: "list",
    });
    const data = await parser.parseAsync(Buffer.from(content)) as FitData;
    const records = data.records ?? [];
    const session = data.sessions?.[0];
    const sport = String(session?.sport ?? "walking").toLowerCase();
    if (!["walking", "hiking", "11", "17"].includes(sport)) return [];

    const points: [number, number][] = [];
    for (const record of records) {
      if (record.position_lat == null || record.position_long == null) continue;
      let latitude = record.position_lat;
      let longitude = record.position_long;
      if (Math.abs(latitude) > 180) latitude *= 180 / 2 ** 31;
      if (Math.abs(longitude) > 180) longitude *= 180 / 2 ** 31;
      if (Number.isFinite(latitude) && Number.isFinite(longitude) &&
          Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
        points.push([latitude, longitude]);
      }
    }
    if (points.length < 2) return [];
    const distanceKm = session?.total_distance ?? records.at(-1)?.distance ?? 0;
    const distanceMiles = distanceKm * 0.621371;
    return [{
      id: file.name,
      name: file.name,
      date: validDate(session?.start_time, file.lastModified),
      points,
      distanceMiles: Number.isFinite(distanceMiles) ? distanceMiles : 0,
      steps: Math.round((Number.isFinite(distanceMiles) ? distanceMiles : 0) * 2000),
    }];
  }

  if (!name.endsWith(".gpx") && !name.endsWith(".xml")) return [];
  const gpx = new GPXParser();
  gpx.parse(await file.text());
  const tracks = (gpx.tracks ?? []).filter(track => {
    const type = track.type?.toLowerCase();
    return !type || type.includes("walk") || type.includes("hike");
  });
  return tracks.flatMap((track, index) => {
    const points = track.points
      .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon) &&
        Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180)
      .map(point => [point.lat, point.lon] as [number, number]);
    if (points.length < 2) return [];
    const distanceMiles = track.distance.total * 0.000621371;
    const miles = Number.isFinite(distanceMiles) ? distanceMiles : 0;
    return [{
      id: file.name + (tracks.length > 1 ? `-${index}` : ""),
      name: track.name || file.name,
      date: validDate(track.points[0]?.time, file.lastModified),
      points,
      distanceMiles: miles,
      steps: Math.round(miles * 2000),
    }];
  });
}
