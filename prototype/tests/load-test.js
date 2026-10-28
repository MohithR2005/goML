import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { percentile } from "../backend/domain.js";
import { waitReady } from "./wait-ready.js";
const base = process.env.BASE_URL || "http://localhost:8080";
const total = Number(process.env.REQUESTS || 1000),
  concurrency = Number(process.env.CONCURRENCY || 50);
const out =
  process.env.EVIDENCE_DIR ||
  new URL("../../evidence/raw-results/", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
  );
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, body) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, data: await r.json() };
}
await waitReady(base);
const before = (await api("/api/metrics")).data;
assert.equal(
  before.confirmed,
  0,
  "Use a fresh sale: confirmed orders already exist.",
);
assert.equal(
  before.available,
  500,
  "Use a fresh sale: tokens have already been reserved.",
);
assert.ok(Date.now() >= before.saleStart, "Sale must be open");
const report = {
  startedAt: new Date().toISOString(),
  base,
  requests: total,
  concurrency,
  before,
  checks: {},
  samples: [],
};
let cursor = 0;
const started = performance.now();
try {
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < total) {
        const index = cursor++;
        const payload = {
          attemptId: randomUUID(),
          customerId: randomUUID(),
          productId: "aurora-one",
          quantity: 1,
        };
        const begin = performance.now();
        try {
          const result = await api("/api/checkout", payload);
          report.samples.push({
            index,
            ...payload,
            httpStatus: result.status,
            latencyMs: performance.now() - begin,
          });
        } catch (err) {
          report.samples.push({
            index,
            ...payload,
            httpStatus: 0,
            latencyMs: performance.now() - begin,
            error: err.message,
              cause: err.cause?.code || err.cause?.message,
          });
        }
      }
    }),
  );
  report.submissionDurationMs = Math.round(performance.now() - started);
  const accepted = report.samples.filter((s) => s.httpStatus === 202);
  report.accepted = accepted.length;
  report.unavailable = report.samples.filter(
    (s) => s.httpStatus === 409,
  ).length;
  report.errors = report.samples.filter(
    (s) => ![202, 409].includes(s.httpStatus),
  ).length;
  report.latencyMs = {
    p50: percentile(
      report.samples.map((s) => s.latencyMs),
      50,
    ),
    p95: percentile(
      report.samples.map((s) => s.latencyMs),
      95,
    ),
    p99: percentile(
      report.samples.map((s) => s.latencyMs),
      99,
    ),
  };
  assert.equal(report.errors, 0, "Unexpected HTTP or transport failures");
  assert.equal(
    accepted.length,
    Math.min(total, 500),
    "Wrong number of reservations",
  );
  const first = accepted[0];
  assert.ok(first, "No accepted attempt");
  const duplicateResults = await Promise.all(
    Array.from({ length: 10 }, () =>
      api("/api/checkout", {
        attemptId: first.attemptId,
        customerId: first.customerId,
        productId: "aurora-one",
        quantity: 1,
      }),
    ),
  );
  assert.ok(
    duplicateResults.every((r) => r.status === 202),
    "Duplicate request did not retain its reservation",
  );
  const conflict = await api("/api/checkout", {
    attemptId: first.attemptId,
    customerId: randomUUID(),
    productId: "aurora-one",
    quantity: 1,
  });
  assert.equal(
    conflict.status,
    409,
    "Mismatched attempt owner was not rejected",
  );
  const deadline = Date.now() + 120000;
  let final;
  do {
    final = (await api("/api/metrics")).data;
    if (final.pending === 0) break;
    await wait(1000);
  } while (Date.now() < deadline);
  report.after = final;
  assert.equal(final.pending, 0, "Processing did not settle");
  assert.equal(final.confirmed, accepted.length);
  assert.equal(final.stock, 500 - accepted.length);
  assert.equal(final.failed, 0);
  assert.equal(final.conserved, true);
  const response = await fetch(base + "/api/attempts/" + first.attemptId, {
    headers: { "X-Customer-ID": first.customerId },
  });
  assert.equal((await response.json()).status, "confirmed");
  const wrong = await fetch(base + "/api/attempts/" + first.attemptId, {
    headers: { "X-Customer-ID": randomUUID() },
  });
  assert.equal(wrong.status, 404);
  report.checks = {
    noOverselling: true,
    inventoryConservation: true,
    duplicateRetries: true,
    conflictingIdentityRejected: true,
    otherCustomerStatusHidden: true,
    allAcceptedSettled: true,
  };
  report.passed = true;
} catch (err) {
  report.passed = false;
  report.failure = err.message;
  process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
report.totalDurationMs = Math.round(performance.now() - started);
await mkdir(out, { recursive: true });
const path = out + "/load-" + Date.now() + ".json";
await writeFile(path, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    { ...report, samples: `${report.samples.length} raw samples in ${path}` },
    null,
    2,
  ),
);
