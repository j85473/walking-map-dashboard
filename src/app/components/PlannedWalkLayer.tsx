"use client";

import { useEffect } from "react";
import { Polyline, Popup, useMap } from "react-leaflet";
import { WALK_HOME, type WalkPlan } from "../utils/routeGenerator";

export default function PlannedWalkLayer({ plan }: { plan: WalkPlan }) {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = [WALK_HOME.coordinates, ...plan.sections.flatMap(section => section.coordinates)]
      .map(([lon, lat]) => [lat, lon]);
    map.fitBounds(points, { padding: [45, 45], maxZoom: 15, animate: false });
  }, [map, plan]);

  // Highlight the actual targets. Connectors are chosen by Google Maps, so
  // drawing straight lines between these sections would imply a false route.
  return plan.sections.map((section, index) => <Polyline
    key={index}
    positions={section.coordinates.map(([lon, lat]) => [lat, lon])}
    pathOptions={{ color: "#22d3ee", weight: 7, opacity: 1 }}
  ><Popup>{index + 1}. {section.name} · {section.miles.toFixed(2)} mi to walk</Popup></Polyline>);
}
