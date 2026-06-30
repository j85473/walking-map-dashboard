const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./public/downtown-streets.geojson', 'utf8'));

function getDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
  return R * c; 
}

function getMidpoint(coords) {
  let sumLon = 0, sumLat = 0;
  coords.forEach(pt => { sumLon += pt[0]; sumLat += pt[1]; });
  return [sumLon / coords.length, sumLat / coords.length];
}

const HOME_LON = -93.2858;
const HOME_LAT = 44.9609;
const MAX_WAYPOINTS = 9; 

let currentLon = HOME_LON;
let currentLat = HOME_LAT;
let totalDistance = 0;
const waypoints = [];
const availableFeatures = [...data.features];

while (waypoints.length < MAX_WAYPOINTS && availableFeatures.length > 0) {
  let bestFeatureIndex = -1;
  let shortestDist = Infinity;
  let bestMidpoint = [0, 0];

  // Force waypoints to be at least 0.3 miles apart to stretch the route!
  for (let i = 0; i < availableFeatures.length; i++) {
    const feature = availableFeatures[i];
    if (feature.geometry.type !== 'LineString') continue;
    
    const midpoint = getMidpoint(feature.geometry.coordinates);
    const dist = getDistanceMiles(currentLat, currentLon, midpoint[1], midpoint[0]);
    
    if (dist >= 0.3 && dist < shortestDist) {
      shortestDist = dist;
      bestFeatureIndex = i;
      bestMidpoint = midpoint;
    }
  }

  // Fallback
  if (bestFeatureIndex === -1) {
    shortestDist = Infinity;
    for (let i = 0; i < availableFeatures.length; i++) {
      const feature = availableFeatures[i];
      if (feature.geometry.type !== 'LineString') continue;
      const midpoint = getMidpoint(feature.geometry.coordinates);
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
  totalDistance += shortestDist;
  currentLon = bestMidpoint[0];
  currentLat = bestMidpoint[1];
  availableFeatures.splice(bestFeatureIndex, 1);
}

const returnHomeDist = getDistanceMiles(currentLat, currentLon, HOME_LAT, HOME_LON);
totalDistance += returnHomeDist;

console.log("Waypoints count:", waypoints.length);
console.log("Estimated Straight-Line Distance:", totalDistance.toFixed(2), "miles");
console.log("Real Walking Distance (est 1.3x):", (totalDistance * 1.3).toFixed(2), "miles");

const homeStr = "2121+Garfield+Ave+S,+Minneapolis,+MN";
const wpStrings = waypoints.map(wp => `${wp[1]},${wp[0]}`).join('|');
const url = `https://www.google.com/maps/dir/?api=1&origin=${homeStr}&destination=${homeStr}&waypoints=${wpStrings}&travelmode=walking`;
console.log(url);
