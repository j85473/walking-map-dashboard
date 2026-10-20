/** Shared pedestrian eligibility for completion targets and route access. Road
 * names and primary/secondary classifications do not establish foot access.
 */
export function isWalkableStreet(feature: { properties?: Record<string, unknown> | null }) {
  const tags = feature.properties ?? {};
  const highway = String(tags.highway ?? "").trim().toLowerCase();
  const foot = String(tags.foot ?? "").trim().toLowerCase();
  const access = String(tags.access ?? "").trim().toLowerCase();
  if (/^(motorway|motorway_link|trunk|trunk_link|construction|proposed)$/.test(highway)) return false;
  if (/^(no|private|use_sidepath)$/.test(foot)) return false;
  if (/^(no|private)$/.test(access) && !/^(yes|designated|permissive)$/.test(foot)) return false;
  return true;
}
