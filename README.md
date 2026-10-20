# Downtown Minneapolis Walking Map

A full-stack Next.js web application designed to track, map, and analyze walking routes to help traverse every street in downtown Minneapolis.

## Why I Built This

I created this project to visualize urban walkability and gamify the experience of exploring my own city. By combining raw GPS data parsing with spatial grid mapping, I can precisely track which streets I've conquered and automatically generate novel routes to help me finish walking the entire downtown grid.

## Features

- **Activity Parsing**: Automatically parses and extracts GPS coordinates from `.gpx`, `.xml`, `.fit`, and compressed `.fit.gz` files (e.g., from Garmin or Strava exports).
- **Interactive Heatmap**: Visualizes all logged walks on an interactive Leaflet map, with green-to-purple intensity controls and street-aligned lines in the mapped downtown area.
- **Mobile Map**: Fills the available screen with the map. A bottom arrow opens and closes the scrollable dashboard controls in portrait or landscape.
- **Current Location**: Tap **My location** and allow browser access to show a live blue dot and accuracy circle. Tap again to recenter. The dot updates while the page is visible without moving the map away from where you pan. Current location stays in the browser; it is not saved as a walk or sent to the dashboard API.
- **Striding Progress**: Uses spatial grids and Haversine distance calculations to estimate downtown street mileage explored and remaining.
- **Next Walk Generator**: Plans a loop from home through unfinished streets and back home, prioritizing unique new mileage per total mile walked. Counts progress along connected streets between stops, shows the targets and estimated efficiency, and opens the whole walk in one Google Maps link.
- **Database Integration**: Synchronizes walk data, dates, distances, and step counts to a PostgreSQL database via Prisma ORM for persistent storage.

> [!NOTE]
> **Privacy Note:** Uploaded route files (`.gpx`, `.fit`, etc.), local SQLite databases, and personal walk data are explicitly excluded from this repository. GPS tracks and activity logs should only be stored securely in a local or private database to protect location privacy.

## Tech Stack

- **Framework**: Next.js (App Router), React
- **Map Rendering**: Leaflet, react-leaflet, canvas route overlay
- **Data Processing**: GPXParser, fit-file-parser, pako
- **Database**: PostgreSQL, Prisma ORM
- **Styling**: Tailwind CSS, Lucide Icons

## Local development

Install dependencies and generate the Prisma client:
```bash
npm ci
npx prisma generate
```

Set `DATABASE_URL` in an ignored `.env.local` file for a PostgreSQL database with the `walking_map` schema, then run:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the dashboard.

The server renders totals from a database aggregate. `/api/dashboard` computes street progress and matches nearby GPS samples to the bundled downtown street centerlines using full tracks. The heatmap draws those matched sections on streets and uses five-meter-simplified GPS traces beyond the mapped downtown area. The full points remain in PostgreSQL and can be exported through `/api/walks`. The browser uploads up to 20 validated walks per request, splitting batches below the API body limit, and refreshes the map once after the selection finishes. Snapshots are cached for five minutes and invalidated after an upload. `npm run lint`, `npm test`, and `npm run build` are the verification checks.

Downtown completion stops at I-94 along its southern edge. `src/lib/downtownBoundary.ts` follows the northern carriageway's curve and clips crossing streets at the boundary. Streets south of the freeway do not count toward completion, appear as remaining targets, or earn new-street credit in planned walks. The full street inventory remains available for route access from home, with shared nodes where a street crosses the cutoff. Recorded walks, lifetime totals, and the heatmap keep their original scope. The other downtown limits remain defined by the bundled inventory.

Completion and route access share the pedestrian eligibility rules in `src/lib/walkableStreets.ts`. They exclude motorway and trunk roads, prohibited foot access, and private access without explicit pedestrian permission. Six Washington Avenue South ramp segments beside U.S. Bank Stadium retain their verified OpenStreetMap `foot=no` tags, including [way 77705844](https://www.openstreetmap.org/way/77705844) and [way 131707294](https://www.openstreetmap.org/way/131707294). The acquisition script preserves `foot`, `access`, and `oneway:foot` so a later inventory refresh cannot silently discard those restrictions.

`POST /api/plan-walk` builds a connected graph from the complete bundled downtown street network and matches the current unfinished sections to its edges. It searches for a loop of seven estimated miles or less, ranking routes by unique new mileage divided by total walking distance. Finishing more sections breaks efficiency ties. Repeated edges add walking distance but receive no extra progress credit. Stops act as route anchors: one connected leg can finish several unfinished fragments without consuming two stops for every fragment.

The bounded search considers up to 192 anchors and keeps 96 alternatives per round. Each plan fits in one Google Maps route: up to nine intermediate stops on desktop, or three in mobile browsers. Home is always both origin and destination. Google Maps chooses its own pedestrian paths, so the graph's coverage and distance are estimates rather than a guarantee of the globally optimal tour or Google's exact path. Home is outside the bundled downtown grid; its access legs are estimated at 1.3 times straight-line distance, included in the total cost, and awarded no speculative new-mile credit. Planning never marks streets as walked; progress changes only after a recorded walk is uploaded.

## M70 production

The production URL is [https://m70.tail35f283.ts.net:8443](https://m70.tail35f283.ts.net:8443) on Joseph's Tailscale network. Use this HTTPS address for browser location access; the original [HTTP address](http://100.107.116.123:3005) still works for viewing walks, but mobile browsers block geolocation there. Location requires permission for this site and device location services. The application runs under its own `walking-dashboard` system account and uses the `walking_map` schema in M70's PostgreSQL database through a separate database login. Database credentials and GPS tracks stay on the M70, outside Git. The Pi deployment script and PM2 configuration have been retired.

To enable private HTTPS on M70, run `sudo bash /opt/walking-dashboard/scripts/deployment/enable-https-m70.sh` after activating a verified release. This adds a loopback socket proxy for the existing Tailscale-only app listener and a Tailscale Serve HTTPS listener on port 8443. It preserves existing Serve applications and rejects a conflicting listener. The socket is enabled at boot; Serve runs in background mode. This uses private Tailscale Serve, with no public Funnel endpoint.

Pushes to `main` trigger the [Verify Walking Dashboard](.github/workflows/verify.yml) GitHub Actions workflow. The M70 checks GitHub every five minutes and activates the exact commit only after its lint, test, and build checks succeed. It builds into a new release directory, switches the `/opt/walking-dashboard` symlink, checks `/api/health`, and restores the previous release if health fails. The timer and web app are supervised by systemd.

The one-time host setup is `sudo bash scripts/deployment/bootstrap-m70.sh` from a checkout on the M70. It backs up the existing `walking_map` schema before enabling a new writer, creates a restricted database login, and installs the service and timer. It never runs `prisma db push` against the production database. The M70's walking records came from the September 2026 whole-database migration; compare them with the Pi before any future import if the Pi comes back online. Do not restore the Pi's copy over newer M70 walks.

Useful checks on the M70:

```bash
systemctl status walking-dashboard.service walking-dashboard-update.timer
journalctl -u walking-dashboard-update.service -n 80 --no-pager
curl -fsS http://100.107.116.123:3005/api/health
cat /var/lib/walking-dashboard/active-revision
```
