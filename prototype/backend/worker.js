import { randomUUID } from "node:crypto";
import {
  pool,
  redis,
  connect,
  broker,
  publish,
  QUEUE,
  key,
  sleep,
  log,
} from "./common.js";
import { validateAttempt } from "./domain.js";
await connect();
const { channel } = await broker();
await channel.prefetch(
  Math.max(1, Number(process.env.WORKER_CONCURRENCY || 4)),
);
async function processAttempt(data) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serializes duplicate deliveries of this attempt; unrelated attempts remain concurrent.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      data.attemptId,
    ]);
    const existing = await client.query(
      "SELECT status FROM attempts WHERE attempt_id=$1",
      [data.attemptId],
    );
    if (existing.rowCount) {
      await client.query(
        "UPDATE attempts SET delivery_count=delivery_count+1 WHERE attempt_id=$1",
        [data.attemptId],
      );
      await client.query("COMMIT");
      return existing.rows[0].status;
    }
    const update = await client.query(
      "UPDATE inventory SET stock=stock-1 WHERE product_id=$1 AND stock>0 RETURNING stock",
      [data.productId],
    );
    const status = update.rowCount ? "confirmed" : "failed";
    await client.query(
      "INSERT INTO attempts(attempt_id,customer_id,product_id,status,reason) VALUES($1,$2,$3,$4,$5)",
      [
        data.attemptId,
        data.customerId,
        data.productId,
        status,
        update.rowCount ? null : "No database stock available",
      ],
    );
    if (update.rowCount)
      await client.query(
        "INSERT INTO orders(order_id,attempt_id,customer_id,product_id) VALUES($1,$2,$3,$4)",
        [randomUUID(), data.attemptId, data.customerId, data.productId],
      );
    await client.query("COMMIT");
    return status;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}
await channel.consume(
  QUEUE,
  async (message) => {
    if (!message) return;
    let data;
    try {
      data = JSON.parse(message.content.toString());
      if (!validateAttempt(data)) throw new Error("Invalid queued payload");
      await sleep(Math.max(0, Number(process.env.WORKER_DELAY_MS || 0)));
      const status = await processAttempt(data);
      // Status reads query SQL first; this cache write is not required for correctness.
      try {
        await redis.set(
          key(data.attemptId),
          JSON.stringify({ ...data, status }),
        );
      } catch (err) {
        log("status-cache-error", { message: err.message });
      }
      channel.ack(message);
      log("processed", { attemptId: data.attemptId, status });
    } catch (err) {
      const retries = Number(message.properties.headers?.retries || 0);
      try {
        await publish(
          channel,
          retries < 5 ? "checkout.retry" : "checkout.failed",
          data || { raw: message.content.toString() },
          { retries: retries + 1 },
        );
        channel.ack(message);
        log(retries < 5 ? "worker-retry" : "requires-recovery", {
          attemptId: data?.attemptId,
          message: err.message,
          retries,
        });
      } catch {
        channel.nack(message, false, true);
        await sleep(1000);
      }
    }
  },
  { noAck: false },
);
log("worker-ready");
