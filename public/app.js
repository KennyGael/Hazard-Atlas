// App: fetch unified recalls, geocode (Nominatim), show Leaflet map, filters, sorting, list
(function () {
  const API = "/api/recalls";
  const messages = document.getElementById("messages");
  const countEl = document.getElementById("count");
  const listEl = document.getElementById("list");
  const sampleBanner = document.getElementById("sampleBanner");

  let rawResults = [];
  let markers = new Map();
  let map, markersLayer;

  function showMessage(msg, isError) {
    messages.textContent = msg || "";
    messages.style.color = isError ? "#ff8b8b" : "";
  }

  function initMap() {
    map = L.map("map").setView([39.5, -98.35], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
  }

  function classificationClass(cl) {
    if (!cl) return "class-III";
    const c = String(cl).toUpperCase();
    // check longer tokens first to avoid accidental matches (e.g. "III" contains "I")
    if (c.includes("III")) return "class-III";
    if (c.includes("II")) return "class-II";
    if (c.includes("I")) return "class-I";
    return "class-III";
  }

  // Return inline SVG for types (medical-related icons)
  function getTypeIcon(type, size = 16, fill = "#ffffff") {
    // Use Ionicons components for list icons (user requested).
    if (type === "Drug") {
      return `<ion-icon name="medical-outline" style="color:${fill};font-size:${size}px;vertical-align:middle"></ion-icon>`;
    }
    return `<ion-icon name="fast-food-outline" style="color:${fill};font-size:${size}px;vertical-align:middle"></ion-icon>`;
  }

  function markerColorForClass(cl) {
    if (!cl) return "#3ddc84";
    const c = String(cl).toUpperCase();
    // check longest first so 'III' doesn't match 'I'
    if (c.includes("III")) return "#3ddc84";
    if (c.includes("II")) return "#ffb84d";
    if (c.includes("I")) return "#ff4d4d";
    return "#3ddc84";
  }

  // Create an SVG pin (teardrop) with a white head. The visible icon will be overlaid
  // using an <ion-icon> element in the marker HTML so Ionicons render crisply.
  function makePinSVG(color, size = 44) {
    const view = size;
    const cx = view / 2;
    const cy = Math.round(view * 0.32);
    const innerR = Math.round(view * 0.18);
    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view} ${view}" width="${size}" height="${size}" aria-hidden="true">
        <path d="M${view / 2} 2 C${view / 2 - 8} 2 ${view / 2 - 14} 8 ${
      view / 2 - 14
    } ${view / 2} C${view / 2 - 14} ${view - 6} ${view / 2} ${view - 2} ${
      view / 2
    } ${view - 2} C${view / 2} ${view - 2} ${view / 2 + 14} ${view - 6} ${
      view / 2 + 14
    } ${view / 2} C${view / 2 + 14} 8 ${view / 2 + 8} 2 ${
      view / 2
    } 2 Z" fill="${color}"/>
        <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="#ffffff" />
      </svg>
    `;
  }

  // Backwards-compatible alias used elsewhere: produce same pin without embedding icons
  function makePinSVGNoIcon(color, size = 44) {
    return makePinSVG(color, size);
  }

  // Local storage geocache
  const GEO_KEY = "hazardatlas_geocache_v1";
  let geocache = {};
  try {
    geocache = JSON.parse(localStorage.getItem(GEO_KEY) || "{}");
  } catch (e) {
    geocache = {};
  }

  function saveGeocache() {
    localStorage.setItem(GEO_KEY, JSON.stringify(geocache));
  }

  // Geocode with Nominatim. Respect gentle rate limit via simple queue with 1100ms interval
  const geocodeQueue = [];
  let geocodeRunning = false;
  function enqueueGeocode(q, cb) {
    geocodeQueue.push({ q, cb });
    if (!geocodeRunning) runGeomQueue();
  }
  async function runGeomQueue() {
    geocodeRunning = true;
    while (geocodeQueue.length) {
      const { q, cb } = geocodeQueue.shift();
      try {
        const cached = geocache[q];
        if (cached) {
          cb(null, cached);
        } else {
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            q
          )}&limit=1`;
          const resp = await fetch(url, {
            headers: { "User-Agent": "Hazard-Atlas-RecallTool/1.0 (local)" },
          });
          if (!resp.ok) throw new Error("Geocode failed " + resp.status);
          const data = await resp.json();
          const hit = Array.isArray(data) && data.length ? data[0] : null;
          const val = hit
            ? { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon) }
            : null;
          geocache[q] = val;
          saveGeocache();
          cb(null, val);
        }
      } catch (err) {
        cb(err);
      }
      // wait to be polite
      await new Promise((r) => setTimeout(r, 1100));
    }
    geocodeRunning = false;
  }

  function constructAddress(rec) {
    const parts = [rec.address_1, rec.city, rec.state, rec.country].filter(
      Boolean
    );
    return parts.join(", ");
  }

  function clearMarkers() {
    markersLayer.clearLayers();
    markers.clear();
  }

  function addMarkerFor(rec, lat, lon) {
    if (!lat || !lon) return null;
    const color = markerColorForClass(rec.classification);
    // create SVG pin marker (no embedded icon) and overlay an <ion-icon> centered in the head
    const svg = makePinSVGNoIcon(color, 48);
    // marker html: only the colored pin SVG (no icon overlay)
    const html = `<div style="width:36px;height:48px;line-height:0">${svg}</div>`;
    const icon = L.divIcon({
      className: "hazard-pin",
      html,
      iconSize: [36, 48],
      iconAnchor: [18, 46],
    });
    const m = L.marker([lat, lon], { icon }).addTo(markersLayer);
    const popupHtml = `<strong>${
      rec.product_description || "No product"
    }</strong><br/><small>${rec.recalling_firm || ""}</small><br/><em>${
      rec.classification || ""
    }</em>`;
    m.bindPopup(popupHtml);
    m.on("click", () => highlightListItem(rec.id));
    markers.set(rec.id, m);
    return m;
  }

  function highlightListItem(id) {
    const prev = document.querySelector(".item.active");
    if (prev) prev.classList.remove("active");
    const el = document.querySelector(`.item[data-id="${id}"]`);
    if (el) {
      el.classList.add("active");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const m = markers.get(id);
    if (m) {
      m.openPopup();
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 8));
    }
  }

  function renderList(items) {
    listEl.innerHTML = "";
    items.forEach((rec) => {
      const div = document.createElement("div");
      div.className = "item " + classificationClass(rec.classification);
      div.dataset.id = rec.id;
      const markerColor = markerColorForClass(rec.classification);
      const iconHtml = `<span class="list-icon" style="background:${markerColor}">${getTypeIcon(
        rec.type,
        14,
        "#ffffff"
      )}</span>`;
      
      // Format date nicely
      const dateStr = rec.raw_report_date 
        ? rec.raw_report_date.slice(0, 4) + "-" + rec.raw_report_date.slice(4, 6) + "-" + rec.raw_report_date.slice(6, 8)
        : "N/A";
      
      div.innerHTML = `
        <div class="title">${iconHtml}<span>${
        rec.product_description || "—"
      }</span></div>
        <div class="meta">
          <strong>${rec.recalling_firm || "Unknown Firm"}</strong><br/>
          ${rec.reason_for_recall ? `<small>${rec.reason_for_recall}</small><br/>` : ""}
          ${dateStr} <span class="badge ${classificationClass(rec.classification)}">${
        rec.classification || "N/A"
      }</span>
        </div>
      `;
      div.addEventListener("click", () => {
        highlightListItem(rec.id);
      });
      listEl.appendChild(div);
    });
  }

  function applyFiltersAndRender() {
    const searchTerm = (
      (document.getElementById("search") &&
        document.getElementById("search").value) ||
      ""
    )
      .trim()
      .toLowerCase();
    const type = document.querySelector('input[name="type"]:checked').value;
    const classSel = document.getElementById("classification").value;
    const sort = document.getElementById("sort").value;
    const limitSel = document.getElementById("limit")
      ? document.getElementById("limit").value
      : "45";

    let items = rawResults.slice();
    if (type !== "All") items = items.filter((i) => i.type === type);
    if (classSel !== "All")
      items = items.filter(
        (i) => (i.classification || "").toUpperCase() === classSel.toUpperCase()
      );

    if (searchTerm) {
      items = items.filter((i) =>
        ((i.product_description || "") + " " + (i.recalling_firm || ""))
          .toLowerCase()
          .includes(searchTerm)
      );
    }

    // Sorting
    items.sort((a, b) => {
      if (sort === "date_desc")
        return (b.report_date || "").localeCompare(a.report_date || "");
      if (sort === "date_asc")
        return (a.report_date || "").localeCompare(b.report_date || "");
      if (sort === "class_desc")
        return String(a.classification || "").localeCompare(
          b.classification || ""
        );
      if (sort === "class_asc")
        return String(b.classification || "").localeCompare(
          a.classification || ""
        );
      return 0;
    });

    // Apply limit selection
    let visible = items;
    if (limitSel !== "all") visible = items.slice(0, Number(limitSel));

    // Update list
    countEl.textContent =
      visible.length +
      (items.length > visible.length
        ? ` (showing ${visible.length} of ${items.length})`
        : "");
    renderList(visible);

    // Clear markers and add markers only for visible items that have been geocoded or that can be geocoded
    clearMarkers();
    visible.forEach((rec) => {
      // prefer explicit coordinates if present
      if (rec.lat && rec.lon) {
        addMarkerFor(rec, rec.lat, rec.lon);
        return;
      }
      const addr = constructAddress(rec);
      if (!addr) return; // skip
      const key = addr;
      const cached = geocache[key];
      if (cached) {
        addMarkerFor(rec, cached.lat, cached.lon);
      } else {
        enqueueGeocode(key, (err, val) => {
          if (err) {
            console.warn("Geocode err", err);
            return;
          }
          if (val) {
            addMarkerFor(rec, val.lat, val.lon);
          }
        });
      }
    });

    // If we added markers, adjust map to show them
    try {
      const layers = markersLayer.getLayers();
      if (layers && layers.length) {
        const bounds = markersLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
        }
      }
    } catch (e) {
      console.warn("Fit bounds failed:", e);
    }
  }

  async function loadData() {
    showMessage("Loading recalls...");
    try {
      const resp = await fetch(API);
      if (!resp.ok) throw new Error("Server error " + resp.status);
      const data = await resp.json();
      rawResults = Array.isArray(data.results) ? data.results : [];
      // show banner if server indicates we're using sample fallback
      if (data.using_sample && sampleBanner)
        sampleBanner.classList.remove("hidden");
      else if (sampleBanner) sampleBanner.classList.add("hidden");

      if (!rawResults.length) {
        showMessage("No recalls found for the given range.", true);
        return;
      }

      // Batch queue all unique addresses for background geocoding
      const addressSet = new Set();
      rawResults.forEach((r) => {
        if (!r.lat || !r.lon) {
          const addr = constructAddress(r);
          if (addr) addressSet.add(addr);
        }
      });

      showMessage(
        `Loaded ${rawResults.length} recalls. Geocoding ${addressSet.size} locations...`
      );

      // Queue all addresses for geocoding in background (don't wait for completion)
      Array.from(addressSet).forEach((addr) => {
        enqueueGeocode(addr, () => {
          // Geocoding complete for this address, re-render to show the new marker
          applyFiltersAndRender();
        });
      });

      // Render immediately with cached/pre-existing coordinates
      showMessage(`Loaded ${rawResults.length} recalls`);

      // Populate classification dropdown
      const set = new Set();
      rawResults.forEach((r) => set.add(r.classification || "N/A"));
      const sel = document.getElementById("classification");
      Array.from(set)
        .sort()
        .forEach((cl) => {
          const option = document.createElement("option");
          option.value = cl;
          option.textContent = cl;
          sel.appendChild(option);
        });

      applyFiltersAndRender();
    } catch (err) {
      console.error(err);
      showMessage("Failed to load recalls: " + err.message, true);
    }
  }

  function attachControls() {
    document.querySelectorAll('input[name="type"]').forEach((el) =>
      el.addEventListener("change", () => {
        updateTypePills();
        applyFiltersAndRender();
      })
    );
    document
      .getElementById("classification")
      .addEventListener("change", applyFiltersAndRender);
    document
      .getElementById("sort")
      .addEventListener("change", applyFiltersAndRender);
    const limitEl = document.getElementById("limit");
    if (limitEl) limitEl.addEventListener("change", applyFiltersAndRender);
    const searchEl = document.getElementById("search");
    if (searchEl)
      searchEl.addEventListener("input", () => {
        applyFiltersAndRender();
      });
  }

  function updateTypePills() {
    const inputs = Array.from(
      document.querySelectorAll('.type-pills input[name="type"]')
    );
    inputs.forEach((inp) => {
      const label = inp.closest("label");
      if (!label) return;
      if (inp.checked) label.classList.add("active");
      else label.classList.remove("active");
    });
  }

  // Init
  initMap();
  attachControls();
  // reflect initial active pill state
  updateTypePills();
  loadData();
})();
