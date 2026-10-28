import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import amqp from "amqplib";
import pg from "pg";
import { waitReady } from "./wait-ready.js";
const base = process.env.BASE_URL || "http://localhost:8080";
const out = process.env.EVIDENCE_DIR || "/evidence";
const report = {
  startedAt: new Date().toISOString(),
  test: "broker-redelivery-after-commit",
};
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let connection;
const metrics = async () => {
  const r = await fetch(base + "/api/metrics");
  assert.equal(r.status, 200);
  return r.json();
};
try {
  await waitReady(base);
  report.before = await metrics();
  assert.equal(report.before.available, 500, "Use a fresh sale");
  const payload = {
    attemptId: randomUUID(),
    customerId: randomUUID(),
    productId: "aurora-one",
    quantity: 1,
  };
  const response = await fetch(base + "/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 202);
  for (let i = 0; i < 60; i++) {
    if ((await metrics()).confirmed === 1) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal((await metrics()).confirmed, 1);
  connection = await amqp.connect(process.env.AMQP_URL);
  const channel = await connection.createConfirmChannel();
  for (let i = 0; i < 5; i++)
    await new Promise((resolve, reject) =>
      channel.sendToQueue(
        "checkout",
        Buffer.from(JSON.stringify(payload)),
        { persistent: true },
        (err) => (err ? reject(err) : resolve()),
      ),
    );
  let deliveries = 0;
  for (let i = 0; i < 60; i++) {
    const {
      rows: [receipt],
    } = await pool.query(
      "SELECT delivery_count FROM attempts WHERE attempt_id=$1",
      [payload.attemptId],
    );
    deliveries = receipt.delivery_count;
    if (deliveries >= 6) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(deliveries >= 6, "Duplicate messages did not finish processing");
  report.after = await metrics();
  const {
    rows: [row],
  } = await pool.query(
    "SELECT count(*)::int AS n FROM orders WHERE attempt_id=$1",
    [payload.attemptId],
  );
  assert.equal(row.n, 1);
  assert.equal(report.after.confirmed, 1);
  assert.equal(report.after.stock, 499);
  assert.equal(report.after.available, 499);
  report.duplicateBrokerDeliveries = 5;
  report.recordedDeliveries = deliveries;
  report.ordersForAttempt = row.n;
  report.passed = true;
} catch (err) {
  report.passed = false;
  report.failure = err.message;
  process.exitCode = 1;
} finally {
  if (connection) await connection.close();
  await pool.end();
}
await mkdir(out, { recursive: true });
await writeFile(
  out + "/redelivery-" + Date.now() + ".json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
