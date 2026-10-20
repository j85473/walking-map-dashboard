# Downtown Minneapolis Walking Map

A full-stack Next.js web application designed to track, map, and analyze walking routes to help traverse every street in downtown Minneapolis.

## Why I Built This

I created this project to visualize urban walkability and gamify the experience of exploring my own city. By combining raw GPS data parsing with spatial grid mapping, I can precisely track which streets I've conquered and automatically generate novel routes to help me finish walking the entire downtown grid.

## Features

- **Activity Parsing**: Automatically parses and extracts GPS coordinates from `.gpx`, `.xml`, `.fit`, and compressed `.fit.gz` files (e.g., from Garmin or Strava exports).
- **Interactive Heatmap**: Visualizes all logged walks on an interactive Leaflet map, with green-to-purple intensity controls and street-aligned lines in the mapped downtown area.
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

`POST /api/plan-walk` builds a connected graph from the complete bundled downtown street network and matches the current unfinished sections to its edges. It searches for a loop of seven estimated miles or less, ranking routes by unique new mileage divided by total walking distance. Finishing more sections breaks efficiency ties. Repeated edges add walking distance but receive no extra progress credit. Stops act as route anchors: one connected leg can finish several unfinished fragments without consuming two stops for every fragment.

The bounded search considers up to 192 anchors and keeps 96 alternatives per round. Each plan fits in one Google Maps route: up to nine intermediate stops on desktop, or three in mobile browsers. Home is always both origin and destination. Google Maps chooses its own pedestrian paths, so the graph's coverage and distance are estimates rather than a guarantee of the globally optimal tour or Google's exact path. Home is outside the bundled downtown grid; its access legs are estimated at 1.3 times straight-line distance, included in the total cost, and awarded no speculative new-mile credit. Planning never marks streets as walked; progress changes only after a recorded walk is uploaded.

## M70 production

The production URL is [http://100.107.116.123:3005](http://100.107.116.123:3005) on Joseph's Tailscale network. The application runs under its own `walking-dashboard` system account and uses the `walking_map` schema in M70's PostgreSQL database through a separate database login. Database credentials and GPS tracks stay on the M70, outside Git. The Pi deployment script and PM2 configuration have been retired.

Pushes to `main` trigger the [Verify Walking Dashboard](.github/workflows/verify.yml) GitHub Actions workflow. The M70 checks GitHub every five minutes and activates the exact commit only after its lint, test, and build checks succeed. It builds into a new release directory, switches the `/opt/walking-dashboard` symlink, checks `/api/health`, and restores the previous release if health fails. The timer and web app are supervised by systemd.

The one-time host setup is `sudo bash scripts/deployment/bootstrap-m70.sh` from a checkout on the M70. It backs up the existing `walking_map` schema before enabling a new writer, creates a restricted database login, and installs the service and timer. It never runs `prisma db push` against the production database. The M70's walking records came from the September 2026 whole-database migration; compare them with the Pi before any future import if the Pi comes back online. Do not restore the Pi's copy over newer M70 walks.

Useful checks on the M70:

```bash
systemctl status walking-dashboard.service walking-dashboard-update.timer
journalctl -u walking-dashboard-update.service -n 80 --no-pager
curl -fsS http://100.107.116.123:3005/api/health
cat /var/lib/walking-dashboard/active-revision
```
