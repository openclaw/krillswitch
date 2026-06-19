// Eval endpoint benchmark: p50/p95/p99 latency, throughput, and the
// Server-Timing hit/miss processing split, written to a dated results file.
//
// Usage:
//   pnpm bench                                  # local stack on :8787
//   TARGET_URL=https://… TARGET_LABEL=workers-dev pnpm bench
//
// Runs under node (autocannon is node-only); pinned in devDependencies.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import autocannon from "autocannon";

const TARGET_URL = process.env.TARGET_URL ?? "http://localhost:8787";
const TARGET_LABEL = process.env.TARGET_LABEL ?? "local";
const EVAL_KEY = process.env.EVAL_KEY ?? "ks_clawhub_development_local";
const DURATION_S = Number(process.env.DURATION_S ?? 15);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 25);
const COLD_SAMPLES = Number(process.env.COLD_SAMPLES ?? 8);
const ERROR_RATE_THRESHOLD = Number(process.env.ERROR_RATE_THRESHOLD ?? 0.01);
// The in-isolate config cache TTL (CONFIG_CACHE_TTL_MS in core) plus margin.
const CACHE_TTL_MARGIN_MS = 1200;

const REQUEST_BODY = JSON.stringify({ context: { key: "bench-user" } });
const REQUEST_HEADERS = {
  authorization: `Bearer ${EVAL_KEY}`,
  "content-type": "application/json",
};

function quantile(sorted, q) {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function parseServerTiming(header) {
  if (!header) return null;
  const cache = header.match(/cache;desc=(\w+)/)?.[1];
  const evalMs = header.match(/eval;dur=([\d.]+)/)?.[1];
  const configMs = header.match(/config;dur=([\d.]+)/)?.[1];
  const totalMs = header.match(/total;dur=([\d.]+)/)?.[1];
  if (!cache || evalMs === undefined) return null;
  return {
    cache,
    evalMs: Number(evalMs),
    configMs: Number(configMs),
    totalMs: Number(totalMs),
  };
}

async function sampleOnce() {
  const start = performance.now();
  const response = await fetch(`${TARGET_URL}/v1/eval`, {
    method: "POST",
    headers: REQUEST_HEADERS,
    body: REQUEST_BODY,
  });
  const roundTripMs = performance.now() - start;
  await response.arrayBuffer();
  return {
    status: response.status,
    roundTripMs,
    timing: parseServerTiming(response.headers.get("server-timing")),
  };
}

function summarizeTimings(samples) {
  const hits = samples.filter((s) => s.timing?.cache === "hit");
  const misses = samples.filter((s) => s.timing?.cache === "miss");
  const stats = (group, pick) => {
    const sorted = group.map(pick).sort((a, b) => a - b);
    return {
      count: sorted.length,
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
      max: sorted.at(-1) ?? Number.NaN,
    };
  };
  return {
    hit: {
      processing: stats(hits, (s) => s.timing.totalMs),
      evalOnly: stats(hits, (s) => s.timing.evalMs),
      roundTrip: stats(hits, (s) => s.roundTripMs),
    },
    miss: {
      processing: stats(misses, (s) => s.timing.totalMs),
      roundTrip: stats(misses, (s) => s.roundTripMs),
    },
  };
}

console.log(`target: ${TARGET_URL} (${TARGET_LABEL})`);

// Warm-up: prove the target answers before loading it.
const probe = await sampleOnce();
if (probe.status !== 200) {
  console.error(`probe failed with status ${probe.status}; aborting`);
  process.exit(1);
}

// Scenario 1 — sustained load across many 1s cache windows, with a
// sampler alongside recording the Server-Timing hit/miss split.
console.log(
  `sustained: ${CONNECTIONS} connections for ${DURATION_S}s + sampler...`,
);
const samples = [];
let samplerActive = true;
const sampler = (async () => {
  while (samplerActive) {
    try {
      samples.push(await sampleOnce());
    } catch {
      // Sampler errors surface through autocannon's own error count.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
})();

const load = await autocannon({
  url: `${TARGET_URL}/v1/eval`,
  method: "POST",
  headers: REQUEST_HEADERS,
  body: REQUEST_BODY,
  duration: DURATION_S,
  connections: CONNECTIONS,
});
samplerActive = false;
await sampler;

// Scenario 2 — cold path: spaced beyond the cache TTL so every request
// pays the D1 read.
console.log(`cold: ${COLD_SAMPLES} samples spaced ${CACHE_TTL_MARGIN_MS}ms...`);
const coldSamples = [];
for (let i = 0; i < COLD_SAMPLES; i++) {
  await new Promise((resolve) => setTimeout(resolve, CACHE_TTL_MARGIN_MS));
  coldSamples.push(await sampleOnce());
}

// Scenario 3 — miss cadence: an unloaded ~150ms sampler for 10s should see
// one miss per second (the per-isolate D1 read budget), everything else hits.
console.log("miss cadence: 10s unloaded sampler...");
const cadenceSamples = [];
const cadenceEnd = Date.now() + 10_000;
while (Date.now() < cadenceEnd) {
  cadenceSamples.push(await sampleOnce());
  await new Promise((resolve) => setTimeout(resolve, 150));
}
const cadenceMisses = cadenceSamples.filter(
  (s) => s.timing?.cache === "miss",
).length;

const totalRequests = load.requests.total;
const errorCount = load.errors + load.non2xx;
const errorRate = totalRequests === 0 ? 1 : errorCount / totalRequests;
const split = summarizeTimings(samples);
const coldStats = summarizeTimings(coldSamples);
const missesInSamples = samples.filter(
  (s) => s.timing?.cache === "miss",
).length;

const result = {
  date: new Date().toISOString(),
  target: { url: TARGET_URL, label: TARGET_LABEL },
  tool: { name: "autocannon", version: "8.0.0" },
  parameters: {
    durationS: DURATION_S,
    connections: CONNECTIONS,
    coldSamples: COLD_SAMPLES,
  },
  sustained: {
    requestsTotal: totalRequests,
    rps: load.requests.average,
    latencyMs: {
      p50: load.latency.p50,
      p95: load.latency.p97_5 ?? load.latency.p99,
      p99: load.latency.p99,
      max: load.latency.max,
    },
    errors: errorCount,
    errorRate,
  },
  serverTimingSplit: {
    note: "sampled every ~100ms during sustained load; Workers timers only advance on I/O, so hit-path processing of 0ms means no I/O occurred during evaluation",
    samples: samples.length,
    missesObserved: missesInSamples,
    expectedMissCeiling: DURATION_S + 1,
    ...split,
  },
  coldPath: coldStats,
  missCadence: {
    note: "unloaded sampler for 10s; misses ≈ elapsed seconds proves at most one D1 read per second per environment in this isolate",
    samples: cadenceSamples.length,
    misses: cadenceMisses,
    expected: "≈10 (±2)",
  },
};

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "results");
mkdirSync(dir, { recursive: true });
const stamp = result.date.slice(0, 10);
const file = path.join(dir, `${stamp}-${TARGET_LABEL}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`wrote ${file}`);
console.log(
  `sustained: ${result.sustained.rps} rps, p50 ${result.sustained.latencyMs.p50}ms, p99 ${result.sustained.latencyMs.p99}ms, errors ${errorCount}`,
);
console.log(
  `hit processing p95 ${split.hit.processing.p95}ms over ${split.hit.processing.count} samples; misses observed ${missesInSamples} (ceiling ${DURATION_S + 1})`,
);
console.log(
  `miss cadence: ${cadenceMisses} misses across ${cadenceSamples.length} unloaded samples in 10s (expect ≈10)`,
);

if (errorRate > ERROR_RATE_THRESHOLD) {
  console.error(
    `error rate ${(errorRate * 100).toFixed(2)}% exceeds threshold ${(ERROR_RATE_THRESHOLD * 100).toFixed(2)}%`,
  );
  process.exit(1);
}
