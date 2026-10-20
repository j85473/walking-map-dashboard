"use client";

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { StridingResult } from '../utils/streetMatcher';

export default function RemainingStreetsLayer({ stridingResult }: { stridingResult: StridingResult | null }) {
  const map = useMap();
  const data = stridingResult?.unwalkedGeoJSON;
  useEffect(() => {
    if (!data?.features.length) return;
    const layer = L.geoJSON(data, { style: {
      color: '#ef4444', weight: 4, opacity: 0.8, lineCap: 'round', lineJoin: 'round',
    } }).addTo(map);
    // Replace whenever geometry changes, even if rounded mileage is unchanged.
    return () => { map.removeLayer(layer); };
  }, [map, data]);
  return null;
}
