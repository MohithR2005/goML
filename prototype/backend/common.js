import pg from "pg";
import { createClient } from "redis";
import amqp from "amqplib";
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
});
export const redis = createClient({ url: process.env.REDIS_URL });
redis.on("error", (err) =>
  console.error(JSON.stringify({ event: "redis-error", message: err.message })),
);
export const STOCK = "{sale}:stock";
export const STREAM = "{sale}:outbox";
export const key = (id) => `{sale}:attempt:${id}`;
export const QUEUE = "checkout";
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const log = (event, details = {}) =>
  console.log(
    JSON.stringify({ time: new Date().toISOString(), event, ...details }),
  );
export async function connect() {
  await redis.connect();
  await pool.query("SELECT 1");
}
export async function broker() {
  const connection = await amqp.connect(process.env.AMQP_URL, {
    heartbeat: 10,
  });
  connection.on("error", (err) =>
    log("broker-error", { message: err.message }),
  );
  connection.on("close", () => process.exit(1));
  const channel = await connection.createConfirmChannel();
  await channel.assertQueue("checkout.failed", { durable: true });
  await channel.assertQueue("checkout.retry", {
    durable: true,
    arguments: {
      "x-message-ttl": 2000,
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": QUEUE,
    },
  });
  await channel.assertQueue(QUEUE, { durable: true });
  return { connection, channel };
}
export function publish(channel, queue, payload, headers = {}) {
  return new Promise((resolve, reject) =>
    channel.sendToQueue(
      queue,
      Buffer.from(JSON.stringify(payload)),
      {
        persistent: true,
        contentType: "application/json",
        messageId: payload.attemptId,
        headers,
      },
      (err) => (err ? reject(err) : resolve()),
    ),
  );
}
