# Hazard Atlas — Recall Reporting Tool
Deployment : wwww.kennygael.tech
A full-stack web application that integrates **two public APIs** to fetch, unify, geocode, and visualize FDA food and drug recalls on an interactive map.

**Assignment Focus:** Demonstrates API integration, data unification, and real-time geocoding using third-party services.

## 🎯 APIs Integrated

### 1. **openFDA API** — Recall Data

- **Endpoint:** `https://api.fda.gov/`
- **Data:** Food & Drug recalls (2020–2024)
- **Features:**
  - `/food/enforcement.json` — Food recalls
  - `/drug/enforcement.json` — Drug recalls
  - Filtering by date range, classification, firm name
  - Up to 250 records per endpoint (500 total)
- **Authentication:** Optional API key (free signup at [open.fda.gov](https://open.fda.gov))
- **Rate Limits:** 240 req/min (or 10,000+ with API key)

### 2. **Nominatim (OpenStreetMap)** — Geocoding

- **Endpoint:** `https://nominatim.openstreetmap.org/`
- **Function:** Converts addresses → latitude/longitude coordinates
- **Features:**
  - Free, open-source geocoding
  - Client-side caching in browser localStorage
  - Polite usage (1.1s rate limit between requests)
- **Authentication:** None required
- **Rate Limits:** 1 request/second (free tier)

## 🚀 Getting Started

### 1. Install Dependencies

```bash
cd /path/to/Hazard-Atlas
npm install
```

### 2. (Optional) Set an openFDA API key to increase rate limits / reliability

```bash
export OPENFDA_API_KEY=your_key_here
```

Alternatively, create a local `.env` file in the project root with the key (do not commit this file):

```bash
# .env (example)
OPENFDA_API_KEY=your_key_here
```

Note: The server loads `.env` automatically when present using `dotenv`.

### 3. Start the server

```bash
npm start
# then open http://localhost:3000 in your browser
```

## Notes and design choices

- Backend: `index.js` exposes `/api/recalls` which requests up to 1000 records each from the Food and Drug openFDA enforcement endpoints in the date range 2020-01-01 → 2024-12-31. The backend tags each record with `type: 'Food' | 'Drug'` and returns a unified array.
- API key: If you have an `OPENFDA_API_KEY` it will be appended to the openFDA requests from the server; this keeps keys out of the frontend.
- Frontend: `public/app.js` fetches the unified data and performs geocoding client-side using Nominatim. Geocoding uses a simple queue with an approx 1.1s interval between requests and caches results in `localStorage` under the key `hazardatlas_geocache_v1` to avoid repeat requests.
- Rate limits: Nominatim and open data sources have usage policies. For large volumes, consider adding a server-side geocoding cache or using a commercial geocoding API with an API key.

## UX behavior

- Filter by recall type (All / Food Only / Drug Only).
- Filter by classification (Class I / II / III where available).
- Sort by date or hazard level.
- Click a list item to focus and open the related map marker.

## Errors

- API failures and geocoding errors are displayed in the UI status area.

## Next improvements (optional)

- Server-side geocoding with a persistent cache (file or DB).
- Batch/pagination handling if results exceed 1000 per endpoint.
- Export filtered results as CSV.
