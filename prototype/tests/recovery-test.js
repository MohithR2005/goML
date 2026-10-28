// Run on a fresh sale. Set RECOVERY_SERVICE=dispatcher to test the Redis outbox.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { waitReady } from "./wait-ready.js";
const docker = process.env.DOCKER_BIN || "docker",
  service = process.env.RECOVERY_SERVICE || "worker";
assert.ok(["worker", "dispatcher"].includes(service));
const base = process.env.BASE_URL || "http://localhost:8080",
  report = { service, startedAt: new Date().toISOString() };
const compose = (...args) => {
  const result = spawnSync(docker, ["compose", ...args], {
    cwd: new URL("../", import.meta.url),
    stdio: "inherit",
  });
  if (result.status !== 0) throw Error("Docker command failed");
};
const metrics = async () => {
  const r = await fetch(base + "/api/metrics");
  assert.equal(r.status, 200);
  return r.json();
};
try {
  await waitReady(base);
  report.before = await metrics();
  assert.equal(report.before.available, 500, "Use a fresh sale");
  compose("stop", service);
  const data = {
    attemptId: randomUUID(),
    customerId: randomUUID(),
    productId: "aurora-one",
    quantity: 1,
  };
  const send = () =>
    fetch(base + "/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  assert.equal((await send()).status, 202);
  await new Promise((r) => setTimeout(r, 1500));
  report.whileStopped = await metrics();
  assert.equal(report.whileStopped.pending, 1);
  assert.equal(report.whileStopped.confirmed, 0);
  compose("start", service);
  for (let i = 0; i < 60; i++) {
    report.after = await metrics();
    if (report.after.confirmed === 1) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(report.after.confirmed, 1);
  assert.equal(report.after.stock, 499);
  assert.equal(report.after.available, 499);
  assert.equal(report.after.pending, 0);
  assert.equal((await send()).status, 202);
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal((await metrics()).confirmed, 1);
  report.passed = true;
} catch (err) {
  report.passed = false;
  report.failure = err.message;
  process.exitCode = 1;
} finally {
  try {
    compose("start", service);
  } catch {}
}
const out = new URL("../../evidence/raw-results/", import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(
  new URL(`recovery-${service}-${Date.now()}.json`, out),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
