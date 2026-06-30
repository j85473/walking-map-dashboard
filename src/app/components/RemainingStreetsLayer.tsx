import { GeoJSON } from 'react-leaflet';
import type { StridingResult } from '../utils/streetMatcher';

export default function RemainingStreetsLayer({ stridingResult }: { stridingResult: StridingResult | null }) {
  if (!stridingResult || !stridingResult.unwalkedGeoJSON || stridingResult.unwalkedGeoJSON.features.length === 0) return null;

  return (
    <GeoJSON 
      key={`remaining-streets-${stridingResult.walkedMiles}`} // Force re-render if data changes
      data={stridingResult.unwalkedGeoJSON}
      style={{
        color: '#ef4444', // Bright red
        weight: 4,
        opacity: 0.8,
        lineCap: 'round',
        lineJoin: 'round'
      }}
    />
  );
}
