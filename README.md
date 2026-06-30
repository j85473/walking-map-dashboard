# Downtown Minneapolis Walking Map

A full-stack Next.js web application designed to track, map, and analyze walking routes to help traverse every street in downtown Minneapolis.

## Why I Built This

I created this project to visualize urban walkability and gamify the experience of exploring my own city. By combining raw GPS data parsing with spatial grid mapping, I can precisely track which streets I've conquered and automatically generate novel routes to help me finish walking the entire downtown grid.

## Features

- **Activity Parsing**: Automatically parses and extracts GPS coordinates from `.gpx`, `.xml`, `.fit`, and compressed `.fit.gz` files (e.g., from Garmin or Strava exports).
- **Interactive Heatmap**: Visualizes all logged walks on an interactive Leaflet map, featuring dynamic color intensity and opacity controls.
- **Striding Progress**: Uses spatial grids and Haversine distance calculations to compare your GPS tracks against public downtown street GeoJSON data, calculating exact miles walked vs. miles remaining.
- **Next Walk Generator**: Algorithmically generates novel walking routes (up to 9 waypoints) prioritizing unwalked streets, and exports directly to Google Maps navigation.
- **Database Integration**: Synchronizes walk data, dates, distances, and step counts to a PostgreSQL database via Prisma ORM for persistent storage.

> [!NOTE]
> **Privacy Note:** Uploaded route files (`.gpx`, `.fit`, etc.), local SQLite databases, and personal walk data are explicitly excluded from this repository. GPS tracks and activity logs should only be stored securely in a local or private database to protect location privacy.

## Tech Stack

- **Framework**: Next.js (App Router), React
- **Map Rendering**: Leaflet, react-leaflet, leaflet.heat
- **Data Processing**: GPXParser, fit-file-parser, pako
- **Database**: PostgreSQL, Prisma ORM
- **Styling**: Tailwind CSS, Lucide Icons

## Getting Started

First, install dependencies and set up the database:
```bash
npm install
npx prisma generate
npx prisma db push
```

Then, run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the dashboard.
