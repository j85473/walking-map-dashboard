// A five-meter maximum deviation keeps the visible route shape while removing
// redundant GPS samples. Original points remain untouched in PostgreSQL.
export function simplifyTrack(points: [number, number][], toleranceMeters = 5): [number, number][] {
  if (points.length <= 2) return points;

  const count = points.length;
  const latitudeScale = 111_132;
  const longitudeScale = 111_320 * Math.cos(points[0][0] * Math.PI / 180);
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = points[i][1] * longitudeScale;
    y[i] = points[i][0] * latitudeScale;
  }

  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const toleranceSquared = toleranceMeters * toleranceMeters;
  const segments: [number, number][] = [[0, count - 1]];

  while (segments.length > 0) {
    const [first, last] = segments.pop()!;
    const dx = x[last] - x[first];
    const dy = y[last] - y[first];
    const lengthSquared = dx * dx + dy * dy;
    let farthest = -1;
    let farthestDistance = toleranceSquared;

    for (let i = first + 1; i < last; i++) {
      const relativeX = x[i] - x[first];
      const relativeY = y[i] - y[first];
      const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
        (relativeX * dx + relativeY * dy) / lengthSquared));
      const remainingX = relativeX - fraction * dx;
      const remainingY = relativeY - fraction * dy;
      const distanceSquared = remainingX * remainingX + remainingY * remainingY;
      if (distanceSquared > farthestDistance) {
        farthest = i;
        farthestDistance = distanceSquared;
      }
    }

    if (farthest !== -1) {
      keep[farthest] = 1;
      segments.push([first, farthest], [farthest, last]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}
