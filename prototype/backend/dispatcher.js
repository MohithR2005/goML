import {
  redis,
  connect,
  STREAM,
  broker,
  publish,
  QUEUE,
  sleep,
  log,
} from "./common.js";
await connect();
try {
  await redis.xGroupCreate(STREAM, "dispatch", "0", { MKSTREAM: true });
} catch (err) {
  if (!err.message.includes("BUSYGROUP")) throw err;
}
const { channel } = await broker();
// One dispatcher with a stable consumer ID. Restart replays its own pending entries.
// Horizontal dispatcher scaling requires distinct IDs plus XAUTOCLAIM.
while (true) {
  try {
    let batches = await redis.xReadGroup(
      "dispatch",
      "dispatcher-1",
      { key: STREAM, id: "0" },
      { COUNT: 20 },
    );
    if (!batches?.[0]?.messages.length)
      batches = await redis.xReadGroup(
        "dispatch",
        "dispatcher-1",
        { key: STREAM, id: ">" },
        { COUNT: 20, BLOCK: 2000 },
      );
    for (const batch of batches || [])
      for (const item of batch.messages) {
        const payload = JSON.parse(item.message.payload);
        await publish(channel, QUEUE, payload);
        await redis.xAck(STREAM, "dispatch", item.id);
        log("published", { attemptId: payload.attemptId });
      }
  } catch (err) {
    log("dispatch-retry", { message: err.message });
    await sleep(1000);
  }
}
