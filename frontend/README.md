# ANUBHAV frontend

React, TypeScript, Vite, Tailwind CSS, and Leaflet UI for the ANUBHAV offset-well intelligence prototype. All well, event, correlation, alert, evidence, knowledge, and document data is loaded from the FastAPI backend; the frontend does not include fallback fixture records.

## Run locally

Start the API and PostgreSQL from the repository root:

```bash
docker compose up --build
```

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` requests to `http://localhost:8000`. The initial active well is ANB-01 when present. ANB-06, ANB-08, and ANB-10 are selectable alternative seeded scenarios. The initial search radius is 20 km so the dashboard includes the four ANB-01 offset wells; change the radius and depth window in the header to recalculate API results.

Leaflet tiles use OpenStreetMap's public tile service and include attribution. Map markers and well details still render when tiles are unavailable.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
