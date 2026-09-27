"use client";

import { MapContainer, TileLayer, ZoomControl, Polyline } from "react-leaflet";
import type { Walk, ColorOpacities } from '@/lib/walkTypes';
import LineHeatmapLayer from "./LineHeatmapLayer";
import RemainingStreetsLayer from "./RemainingStreetsLayer";
import type { StridingResult } from "../utils/streetMatcher";

// Minneapolis coordinates
const center = [44.9778, -93.2650];

interface MapProps {
  walks: Walk[];
  activeWalkId?: string | null;
  opacities: ColorOpacities;
  viewRemaining: boolean;
  stridingResult: StridingResult | null;
}

export default function Map({ walks, activeWalkId, opacities, viewRemaining, stridingResult }: MapProps) {
  const activeWalk = activeWalkId ? walks.find(w => w.id === activeWalkId) : null;
  return (
    <MapContainer 
      center={center as [number, number]} 
      zoom={14} 
      className="map-container"
      zoomControl={false}
      preferCanvas={true}
    >
      {/* Full-coverage basemap keeps routes legible while panning. */}
      <TileLayer
        className="map-tiles"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      
      {/* Traffic-Style Heatmap Layer OR Remaining Streets Layer */}
      {!activeWalkId && !viewRemaining && <LineHeatmapLayer walks={walks} opacities={opacities} />}
      {!activeWalkId && viewRemaining && <RemainingStreetsLayer stridingResult={stridingResult} />}

      {/* Selected Route Layer (Rendered on top) */}
      {activeWalk && (
        <Polyline 
          key={activeWalk.id} 
          positions={activeWalk.points} 
          pathOptions={{ 
            color: '#22d3ee', // Cyan highlight
            weight: 6,
            opacity: 1.0, 
            lineCap: 'round',
            lineJoin: 'round',
          }} 
        />
      )}
      
      <ZoomControl position="bottomright" />
    </MapContainer>
  );
}
