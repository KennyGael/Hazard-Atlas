# 🌍 Hazard Atlas — Recall Reporting Tool

## 🔗 Live Deployment
**Production URL:** 👉 https://www.kennygael.tech

This application is deployed behind a **load balancer** that distributes traffic across **two backend web servers** for reliability and scalability.

- **Load Balancer (Public Entry Point):**
  - https://www.kennygael.tech

- **Backend Servers (behind the load balancer):**
  - http://web-01.kennygael.tech
  - http://web-02.kennygael.tech

---

## 📌 Project Overview

Hazard Atlas is a **full-stack web application** that integrates **two public APIs** to fetch, unify, geocode, and visualize **FDA food and drug recalls** on an interactive map.

**Assignment Focus:**  
Demonstrates API integration, backend data unification, rate-limited geocoding, and production-style deployment using a load-balanced architecture.

---

## 🏗️ Deployment & Infrastructure

### Architecture Overview

```

```
            ┌────────────────────┐
            │   Load Balancer     │
            │ www.kennygael.tech  │
            └─────────┬──────────┘
                      │
      ┌───────────────┴───────────────┐
      │                               │
```

┌────────────────────┐        ┌────────────────────┐
│  web-01 server     │        │  web-02 server     │
│  Node.js + Express │        │  Node.js + Express │
│  Serves API + UI   │        │  Serves API + UI   │
└────────────────────┘        └────────────────────┘

````

### Deployment Details

- Single public entry point via a load balancer
- Incoming traffic is distributed across two identical backend servers
- Each backend server runs the same Node.js + Express application
- Improves availability, fault tolerance, and horizontal scalability
- Environment variables used for secrets and configuration

---

## 🎯 APIs Integrated

### 1. openFDA API — Recall Data

- **Base URL:** https://api.fda.gov/
- **Endpoints:**
  - `/food/enforcement.json`
  - `/drug/enforcement.json`
- **Data Range:** 2020–2024
- **Features:**
  - Filtering by date, classification, and firm name
  - Up to 250 records per request
- **Authentication:** Optional API key
- **Rate Limits:** 240 requests/min (higher with API key)

---

### 2. Nominatim (OpenStreetMap) — Geocoding

- **Base URL:** https://nominatim.openstreetmap.org/
- **Purpose:** Converts addresses to latitude and longitude
- **Features:**
  - Free and open-source
  - No authentication required
- **Rate Limits:** ~1 request per second

---

## 🚀 Getting Started (Local Development)

### 1. Install Dependencies

```bash
npm install
````

### 2. (Optional) Set openFDA API Key

```bash
export OPENFDA_API_KEY=your_key_here
```

Or create a `.env` file (do not commit):

```env
OPENFDA_API_KEY=your_key_here
```

> The server automatically loads environment variables using `dotenv`.

---

### 3. Start the Application

```bash
npm start
```

Open in browser:

```
http://localhost:3000
```

---

## ⚙️ Backend Design Notes

* **Endpoint:** `/api/recalls`
* Fetches recall data from both:

  * Food enforcement reports
  * Drug enforcement reports
* Normalizes both datasets into a unified response
* Adds a `type` field (`Food` or `Drug`)
* Date range: `2020-01-01 → 2024-12-31`
* API key (if provided) is appended server-side to protect credentials

---

## 🗺️ Frontend & Geocoding Logic

* Frontend fetches unified recall data from `/api/recalls`
* Client-side geocoding performed using Nominatim
* Implements:

  * Request queue with ~1.1 second delay
  * Local caching in browser storage
* Cached under:

```
localStorage["hazardatlas_geocache_v1"]
```

---

## 🧭 User Experience Features

* Filter recalls by type (All / Food / Drug)
* Filter by classification (Class I / II / III)
* Sort by recall date or hazard severity
* Interactive map:

  * Clicking a recall focuses the corresponding map marker

---

## ❗ Error Handling

* API failures
* Network errors
* Geocoding issues

Errors are displayed clearly in the UI status area.

---

## 🔮 Future Improvements

* Server-side geocoding with persistent cache
* Pagination for large result sets
* CSV export of filtered data
* Monitoring, logging, and health checks
