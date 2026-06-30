import { FeatureCollection, LineString } from 'geojson';

// Haversine distance in miles
function getDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8; // Radius of the earth in miles
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
  const d = R * c; // Distance in miles
  return d;
}

// Find the midpoint of a LineString
function getMidpoint(coords: number[][]): [number, number] {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1) return [coords[0][0], coords[0][1]];
  
  // For simplicity, take the geometric average of all points in the segment
  let sumLon = 0;
  let sumLat = 0;
  coords.forEach(pt => {
    sumLon += pt[0];
    sumLat += pt[1];
  });
  return [sumLon / coords.length, sumLat / coords.length];
}

export function generateWalkUrl(unwalkedGeoJSON: FeatureCollection): string | null {
  if (!unwalkedGeoJSON || unwalkedGeoJSON.features.length === 0) {
    return null;
  }

  // Default starting coordinates (US Bank Stadium, Minneapolis)
  const HOME_LON = -93.2575;
  const HOME_LAT = 44.9735;
  
  // Mobile Google Maps strictly limits to 9 waypoints
  const MAX_WAYPOINTS = 9; 
  
  let currentLon = HOME_LON;
  let currentLat = HOME_LAT;
  const waypoints: [number, number][] = [];
  
  const availableFeatures = [...unwalkedGeoJSON.features];

  while (waypoints.length < MAX_WAYPOINTS && availableFeatures.length > 0) {
    let bestFeatureIndex = -1;
    let shortestDist = Infinity;
    let bestMidpoint: [number, number] = [0, 0];

    // To force a long 5-7 mile walk on just 9 waypoints, we must space them far apart.
    // We look for the closest street that is at least 0.35 miles away.
    for (let i = 0; i < availableFeatures.length; i++) {
      const feature = availableFeatures[i];
      if (feature.geometry.type !== 'LineString') continue;
      
      const geom = feature.geometry as LineString;
      const midpoint = getMidpoint(geom.coordinates);
      const dist = getDistanceMiles(currentLat, currentLon, midpoint[1], midpoint[0]);
      
      // If we are starting from home, we just want the closest edge of downtown.
      // But once we are in downtown, we force the waypoints to be spaced out.
      const minSpacing = waypoints.length === 0 ? 0 : 0.35;

      if (dist >= minSpacing && dist < shortestDist) {
        shortestDist = dist;
        bestFeatureIndex = i;
        bestMidpoint = midpoint;
      }
    }

    // Fallback if no streets are 0.35 miles away
    if (bestFeatureIndex === -1) {
      shortestDist = Infinity;
      for (let i = 0; i < availableFeatures.length; i++) {
        const feature = availableFeatures[i];
        if (feature.geometry.type !== 'LineString') continue;
        const geom = feature.geometry as LineString;
        const midpoint = getMidpoint(geom.coordinates);
        const dist = getDistanceMiles(currentLat, currentLon, midpoint[1], midpoint[0]);
        if (dist < shortestDist) {
          shortestDist = dist;
          bestFeatureIndex = i;
          bestMidpoint = midpoint;
        }
      }
    }

    if (bestFeatureIndex === -1) break;

    waypoints.push(bestMidpoint);
    currentLon = bestMidpoint[0];
    currentLat = bestMidpoint[1];
    
    // Remove the feature so we don't pick it again
    availableFeatures.splice(bestFeatureIndex, 1);
  }

  if (waypoints.length === 0) return null;

  // Build Google Maps URL
  const homeStr = "US+Bank+Stadium,+Minneapolis,+MN";
  const wpStrings = waypoints.map(wp => `${wp[1]},${wp[0]}`).join('|');
  
  const url = `https://www.google.com/maps/dir/?api=1&origin=${homeStr}&destination=${homeStr}&waypoints=${wpStrings}&travelmode=walking`;
  return url;
}
