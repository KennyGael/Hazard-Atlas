require("dotenv").config();
const express = require("express");
const https = require("https");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Helper to transform openFDA report_date (YYYYMMDD) to ISO string
function parseReportDate(val) {
  try {
    const s = String(val);
    if (s.length !== 8) return null;
    const y = s.slice(0, 4);
    const m = s.slice(4, 6);
    const d = s.slice(6, 8);
    return new Date(`${y}-${m}-${d}`).toISOString();
  } catch (e) {
    return null;
  }
}

// Use Node's built-in https module instead of node-fetch for better HTTP/2 and timeout handling
async function fetchOpenFda(endpointUrl, attempts = 3) {
  const apiKey = process.env.OPENFDA_API_KEY;
  // Ensure API key is placed before other query params when possible per openFDA guidance.
  let url = endpointUrl;
  try {
    if (apiKey && !endpointUrl.includes("api_key=")) {
      if (endpointUrl.includes("?")) {
        url = endpointUrl.replace(
          "?",
          `?api_key=${encodeURIComponent(apiKey)}&`
        );
      } else {
        url = `${endpointUrl}?api_key=${encodeURIComponent(apiKey)}`;
      }
    }
  } catch (e) {
    url = endpointUrl;
  }

  const timeoutMs = 30000; // 30s timeout
  attempts = attempts || 3;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: timeoutMs, family: 4 }, (res) => {
          let data = "";
          let resolved = false;

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            if (resolved) return;
            resolved = true;
            try {
              if (res.statusCode >= 400) {
                const snippet =
                  data && data.length > 500 ? data.slice(0, 500) + "..." : data;
                reject(new Error(`HTTP ${res.statusCode}: ${snippet}`));
              } else {
                resolve(JSON.parse(data));
              }
            } catch (err) {
              reject(err);
            }
          });
        });

        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Request timeout"));
        });

        req.on("error", reject);
      });

      console.log(`fetchOpenFda attempt ${attempt}/${attempts} succeeded`);
      return result;
    } catch (err) {
      console.error(
        `fetchOpenFda attempt ${attempt}/${attempts} error:`,
        err.message
      );
      if (attempt === attempts) {
        throw err;
      }
      const backoff = 700 * Math.pow(2, attempt - 1);
      console.warn(`Retrying in ${backoff}ms...`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

app.get("/api/recalls", async (req, res) => {
  // Date range fixed per project spec
  const start = "20200101";
  const end = "20241231";
  const limit = 1000;

  // Build base query URLs (we will page using limit=100 & skip)
  const foodBase = `https://api.fda.gov/food/enforcement.json?search=report_date:[${start}+TO+${end}]`;
  const drugBase = `https://api.fda.gov/drug/enforcement.json?search=report_date:[${start}+TO+${end}]`;

  // Helper: fetch all pages (limit=100) up to maxRecords. openFDA enforces a max limit per request (~100),
  // so we page using `skip` and combine results. Returns array of result objects.
  async function fetchAllOpenFda(baseUrl, maxRecords = 1000, pageSize = 100) {
    const aggregated = [];
    let skip = 0;
    // page until we have enough or endpoint returns fewer than pageSize
    while (aggregated.length < maxRecords) {
      const take = Math.min(pageSize, maxRecords - aggregated.length);
      const url = `${baseUrl}&limit=${take}&skip=${skip}`;
      try {
        const data = await fetchOpenFda(url);
        const page = Array.isArray(data && data.results) ? data.results : [];
        if (!page.length) break;
        aggregated.push(...page);
        if (page.length < take) break;
        skip += page.length;
        // be polite to openFDA
        await new Promise((r) => setTimeout(r, 200));
      } catch (e) {
        // bubble up so caller can record the error and decide how to proceed
        throw e;
      }
    }
    return aggregated;
  }

  try {
    // Fetch endpoints sequentially (helps avoid simultaneous throttling). Use paged fetch
    const errors = [];
    let foodResults = [];
    let drugResults = [];
    try {
      foodResults = await fetchAllOpenFda(foodBase, 250, 500);
    } catch (e) {
      errors.push({
        endpoint: "food",
        reason: String(e && e.message ? e.message : e),
      });
      console.warn(
        "Food endpoint fetch failed (will try drug):",
        e && e.message ? e.message : e
      );
    }

    // small pause before second fetch to reduce chance of rate limits
    await new Promise((r) => setTimeout(r, 250));

    try {
      drugResults = await fetchAllOpenFda(drugBase, 250, 500);
    } catch (e) {
      errors.push({
        endpoint: "drug",
        reason: String(e && e.message ? e.message : e),
      });
      console.warn(
        "Drug endpoint fetch failed:",
        e && e.message ? e.message : e
      );
    }

    const normalize = (item, type) => ({
      id:
        item.serial_number ||
        item.recall_number ||
        type + "_" + Math.random().toString(36).slice(2, 9),
      type,
      report_date: parseReportDate(item.report_date) || null,
      raw_report_date: item.report_date || null,
      classification: item.classification || null,
      product_description:
        item.product_description || item.product_type || null,
      recalling_firm: item.recalling_firm || null,
      reason_for_recall: item.reason_for_recall || null,
      product_quantity: item.product_quantity || null,
      address_1: item.address_1 || item.distribution_pattern || null,
      city: item.city || null,
      state: item.state || null,
      country: item.country || "USA",
      original: item,
    });

    const unified = [
      ...foodResults.map((r) => normalize(r, "Food")),
      ...drugResults.map((r) => normalize(r, "Drug")),
    ];

    const payload = { count: unified.length, results: unified };
    if (errors.length) payload.errors = errors;
    // If both endpoints returned no results, try retries once more before using fallback
    if (!foodResults.length && !drugResults.length) {
      console.error("Both openFDA endpoints returned empty/failed:", errors);

      // If errors suggest network issues (connection refused, TLS errors, timeouts),
      // skip the connectivity test and go straight to fallback to save time
      const hasNetworkError = errors.some(
        (e) =>
          e.reason &&
          (e.reason.includes("ECONNREFUSED") ||
            e.reason.includes("ETIMEDOUT") ||
            e.reason.includes("ENOTFOUND") ||
            e.reason.includes("socket") ||
            e.reason.includes("TLS"))
      );

      if (!hasNetworkError) {
        // Try one more time with quick connectivity test
        console.warn("Attempting one more retry with connectivity check...");
        try {
          const quickTest = `https://api.fda.gov/food/enforcement.json?limit=1`;
          await fetchOpenFda(quickTest, 1);
          console.warn("openFDA reachable — retrying endpoints once more.");
          try {
            const retryFood = await fetchAllOpenFda(foodBase, 500, 50).catch(
              (e) => {
                console.warn(
                  "Food retry failed:",
                  e && e.message ? e.message : e
                );
                return [];
              }
            );
            const retryDrug = await fetchAllOpenFda(drugBase, 500, 50).catch(
              (e) => {
                console.warn(
                  "Drug retry failed:",
                  e && e.message ? e.message : e
                );
                return [];
              }
            );
            if (retryFood.length || retryDrug.length) {
              const unifiedRetry = [
                ...retryFood.map((r) => normalize(r, "Food")),
                ...retryDrug.map((r) => normalize(r, "Drug")),
              ];
              const payload = {
                count: unifiedRetry.length,
                results: unifiedRetry,
                retried: true,
              };
              if (errors.length) payload.errors = errors;
              console.log(`Retry succeeded: ${unifiedRetry.length} results`);
              return res.json(payload);
            }
          } catch (e) {
            console.warn("Retries failed:", e && e.message ? e.message : e);
          }
        } catch (diagErr) {
          console.warn(
            "Connectivity test failed; falling back to sample data."
          );
        }
      } else {
        console.warn("Network error detected; unable to fetch from openFDA.");
      }

      // No fallback — return error directly
      console.error("Both openFDA endpoints failed. Returning error response.");
      return res.status(502).json({
        error: "Both openFDA endpoints failed",
        details: errors,
        message:
          "Unable to fetch food and drug recall data. Please check network connectivity.",
      });
    }
    res.json(payload);
  } catch (err) {
    console.error(
      "Error fetching openFDA:",
      err && err.stack ? err.stack : err
    );
    const details = {
      message: String(err && err.message ? err.message : err),
      stack: err && err.stack ? err.stack : undefined,
    };
    // Return a helpful response for debugging while still including any partial results if available
    return res
      .status(500)
      .json({ error: "Failed to fetch recalls from openFDA", details });
  }
});

// Lightweight diagnostic endpoint to test connectivity to openFDA
app.get("/api/diagnose", async (req, res) => {
  const testUrl = `https://api.fda.gov/food/enforcement.json?limit=1`;
  try {
    const start = Date.now();
    const response = await fetch(testUrl, { timeout: 10000 });
    const elapsed = Date.now() - start;
    if (!response.ok)
      return res.status(502).json({
        ok: false,
        status: response.status,
        statusText: response.statusText,
      });
    return res.json({
      ok: true,
      elapsed_ms: elapsed,
      info: "openFDA reachable (anonymous)",
    });
  } catch (err) {
    console.error("Diagnose error:", err && err.stack ? err.stack : err);
    return res.status(502).json({
      ok: false,
      error: String(err && err.message ? err.message : err),
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `Hazard Atlas Recall Tool server running on http://localhost:${PORT}`
  );
});
