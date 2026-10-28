import http from "node:http";
import { readFile } from "node:fs/promises";
import { pool, redis, connect, STOCK, STREAM, key, log } from "./common.js";
import { PRODUCT_ID, INITIAL_STOCK, UUID, validateAttempt } from "./domain.js";
await connect();
// Initial creation only. Never rebuild tokens from SQL stock after Redis data loss.
// Once initialized, a missing token key makes checkout fail closed.
const bootstrap = await pool.connect();
try {
  await bootstrap.query("BEGIN");
  const {
    rows: [state],
  } = await bootstrap.query(
    "SELECT admission_initialized FROM system_state WHERE id=1 FOR UPDATE",
  );
  if (!state.admission_initialized) {
    await redis.set(STOCK, String(INITIAL_STOCK), { NX: true });
    await bootstrap.query(
      "UPDATE system_state SET admission_initialized=true WHERE id=1",
    );
  }
  await bootstrap.query("COMMIT");
} catch (err) {
  await bootstrap.query("ROLLBACK");
  throw err;
} finally {
  bootstrap.release();
}
const reserve = await readFile(
  new URL("./reserve.lua", import.meta.url),
  "utf8",
);
const start = Date.parse(process.env.SALE_START || "2026-10-28T00:00:00Z");
if (!Number.isFinite(start))
  throw new Error("SALE_START must be an ISO timestamp");
const assets = new Map([
  ["/", "index.html"],
  ["/app.js", "app.js"],
  ["/styles.css", "styles.css"],
]);
const types = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
};
function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 4096) throw new Error("Body too large");
  }
  return JSON.parse(text);
}
async function stats() {
  const {
    rows: [row],
  } = await pool.query(
    `SELECT stock, initial_stock,
    (SELECT count(*)::int FROM orders) AS confirmed,
    (SELECT count(*)::int FROM attempts WHERE status='failed') AS failed
    FROM inventory WHERE product_id=$1`,
    [PRODUCT_ID],
  );
  const tokens = await redis.get(STOCK);
  return {
    ...row,
    available: tokens === null ? null : Number(tokens),
    pending:
      tokens === null
        ? null
        : Math.max(
            0,
            INITIAL_STOCK - Number(tokens) - row.confirmed - row.failed,
          ),
    conserved: row.stock + row.confirmed === row.initial_stock,
    serverTime: Date.now(),
    saleStart: start,
  };
}
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  );
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && assets.has(url.pathname)) {
      const file = assets.get(url.pathname);
      const data = await readFile(
        new URL("../frontend/" + file, import.meta.url),
      );
      res.writeHead(200, {
        "Content-Type": types[file.split(".").pop()],
        "Cache-Control": "no-cache",
      });
      return res.end(data);
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      await pool.query("SELECT 1");
      await redis.ping();
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/metrics")
      return send(res, 200, await stats());
    if (req.method === "GET" && url.pathname === "/api/product")
      return send(res, 200, {
        id: PRODUCT_ID,
        name: "Aurora One",
        price: 29999,
        ...(await stats()),
      });
    if (req.method === "POST" && url.pathname === "/api/checkout") {
      let data;
      try {
        data = await body(req);
      } catch {
        return send(res, 400, { error: "Invalid JSON or body too large" });
      }
      if (!validateAttempt(data))
        return send(res, 400, {
          error:
            "Expected valid UUID v4 attemptId/customerId, productId and quantity: 1",
        });
      const limitKey = `{sale}:rate:${data.customerId}:${Math.floor(Date.now() / 60000)}`;
      const hits = await redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],120) end; return n",
        { keys: [limitKey], arguments: [] },
      );
      if (hits > Number(process.env.RATE_LIMIT || 60))
        return send(
          res,
          429,
          { error: "Too many requests. Wait before retrying." },
          { "Retry-After": "60" },
        );
      if (Date.now() < start)
        return send(res, 409, {
          error: "Sale has not started",
          code: "not_open",
        });
      const result = await redis.eval(reserve, {
        keys: [STOCK, key(data.attemptId), STREAM],
        arguments: [data.attemptId, data.customerId, data.productId],
      });
      if (result[0] === "unavailable")
        return send(res, 409, {
          status: "unavailable",
          error: "All units are reserved or sold.",
        });
      if (result[0] === "conflict")
        return send(res, 409, {
          error: "Attempt ID belongs to different purchase details.",
        });
      if (result[0] === "uninitialized")
        return send(res, 503, {
          error: "Inventory admission unavailable. Operator recovery required.",
        });
      log("checkout-accepted", {
        attemptId: data.attemptId,
        repeated: result[0] === "existing",
      });
      return send(res, 202, {
        attemptId: data.attemptId,
        status: "pending",
        statusUrl: `/api/attempts/${data.attemptId}`,
      });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/attempts/")) {
      const id = url.pathname.split("/").pop(),
        customer = req.headers["x-customer-id"];
      if (!UUID.test(id) || !UUID.test(customer))
        return send(res, 400, {
          error: "Valid attempt and customer IDs required",
        });
      const { rows } = await pool.query(
        `SELECT a.status,a.reason,o.order_id AS "orderId",a.created_at AS "createdAt"
        FROM attempts a LEFT JOIN orders o USING(attempt_id) WHERE a.attempt_id=$1 AND a.customer_id=$2`,
        [id, customer],
      );
      if (rows[0]) return send(res, 200, { attemptId: id, ...rows[0] });
      const stored = await redis.get(key(id));
      if (stored) {
        const data = JSON.parse(stored);
        if (data.customerId === customer)
          return send(res, 200, { attemptId: id, status: data.status });
      }
      return send(res, 404, {
        error:
          "Attempt not found. If a submission timed out, retry using the same ID.",
      });
    }
    send(res, 404, { error: "Not found" });
  } catch (err) {
    log("request-error", { message: err.message });
    if (!res.headersSent)
      send(
        res,
        503,
        {
          error:
            "Service temporarily unavailable. Preserve the attempt ID and retry.",
        },
        { "Retry-After": "3" },
      );
    else res.end();
  }
});
// Keep pooled connections alive across slow local bursts rather than closing
// an idle socket while a client is preparing to reuse it.
server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;
server.listen(8080, "0.0.0.0", () => log("api-listening", { port: 8080 }));
