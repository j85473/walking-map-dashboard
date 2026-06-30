"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";

interface HeatmapLayerProps {
  points: [number, number][];
}

export default function HeatmapLayer({ points }: HeatmapLayerProps) {
  const map = useMap();

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let heatLayer: any = null;
    let timeoutId: NodeJS.Timeout;

    const addLayer = () => {
      const size = map.getSize();
      if (size.x === 0 || size.y === 0) {
        // Wait for CSS flexbox to size the container to prevent Canvas IndexSizeError
        timeoutId = setTimeout(addLayer, 50);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      heatLayer = (L as any).heatLayer(points, {
        radius: 5,
        blur: 8,
        maxZoom: 16,
        max: 1.0,
        gradient: {
          0.2: '#10b981', // Emerald Green
          0.4: '#eab308', // Yellow
          0.6: '#f97316', // Orange
          0.8: '#ef4444', // Red
          1.0: '#a855f7'  // Purple
        }
      });

      heatLayer.addTo(map);
    };

    addLayer();

    return () => {
      clearTimeout(timeoutId);
      if (heatLayer) {
        map.removeLayer(heatLayer);
      }
    };
  }, [map, points]);

  return null;
}
