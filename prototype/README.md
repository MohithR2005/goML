# Aurora flash-sale prototype

A focused full-stack application for the case study: 500 smartphones, many competing checkout requests, no duplicate committed orders for a purchase attempt, and no negative database stock. The storefront includes a separate observer panel for inspecting real database outcomes.

## Quick start — Docker Desktop

Prerequisite: Docker Desktop running with Linux containers. No local PostgreSQL, Redis, RabbitMQ, Node or npm installation is needed for the basic app or load test. The first build needs internet access to download images and npm packages.

In PowerShell:

```powershell
git clone https://github.com/MohithR2005/goML.git
cd goML/prototype
Copy-Item .env.example .env
docker compose up --build -d --wait
docker compose ps
```

Open **http://localhost:8080**. Wait for all infrastructure services to report healthy and app containers to be running. The default sale timestamp is in the past so the Buy button works immediately. To demonstrate a future opening, change `SALE_START` in `.env` to an ISO timestamp including timezone, for example `2026-10-28T18:00:00+05:30`, then recreate the app services with `docker compose up -d`.

If PowerShell cannot find Docker, reopen it after installing Docker Desktop, or run:

```powershell
$env:Path += ';C:\Program Files\Docker\Docker\resources\bin'
```

The phone illustration is made with CSS. No external images, fonts, scripts, or paid APIs are needed. This is a fictional product, not an actual sale. No payment is collected.

## Implemented stack

| Component | Implementation |
| --- | --- |
| Frontend | Semantic HTML, plain JavaScript ES modules, responsive CSS; same-origin Fetch |
| API | Node.js 22 native HTTP server; JSON validation; Redis-backed per-demo-customer rate limit |
| Admission | Redis 7.4 Lua reservation and Redis Streams outbox |
| Queue | RabbitMQ durable queues, persistent messages, publisher confirmations |
| Worker | Node.js, bounded prefetch, explicit acknowledgements and bounded retry queue |
| Database | PostgreSQL 16, transactions, conditional stock update, unique attempt ID |
| Packaging | Docker Compose, named persistent volumes, committed npm lockfile |
| Tests | Node built-in test runner, HTTP concurrency test, service-stop recovery tests |

The prototype uses plain JavaScript rather than the Preact/TypeScript proposed earlier. No actual CDN, external load balancer, authentication service, payment integration or autoscaling cluster is deployed locally. Those belong in a separately labelled production proposal.

## How checkout works

1. Browser creates a UUID v4 customer identifier and purchase-attempt identifier. It disables repeated clicks and reuses the attempt ID on retry or refresh in the same tab.
2. API validates product, quantity and sale time. Each attempt requests exactly one unit. One customer may make multiple distinct attempts; a one-phone-per-person policy is not implemented.
3. One Redis Lua operation checks for a repeated attempt, checks available tokens, decrements once, records the reservation and appends its payload to a Redis Stream. Redis is configured with AOF `appendfsync always` and `noeviction`.
4. Only after that reservation/outbox operation succeeds does the API return `202 Accepted`. Here durable acceptance means the Redis outbox, not completed RabbitMQ publication and not a confirmed purchase.
5. A single dispatcher reads the outbox, publishes a persistent RabbitMQ message, waits for publisher confirmation and acknowledges the stream entry. Its stable consumer identity allows pending stream entries to be replayed after restart. A crash after publishing but before stream acknowledgement can cause duplicate delivery by design.
6. A worker uses a PostgreSQL transaction-scoped advisory lock for the attempt ID and checks for a recorded result. It conditionally decrements stock, checks the affected row, writes the attempt and order, then commits. A unique order attempt ID provides a further database constraint. It acknowledges the RabbitMQ message after the commit.
7. Browser polls the status endpoint using the same customer and attempt identifiers, backing off with jitter, and stops at a final result. SQL results take precedence over the Redis status cache.

Stock and order writes occur in the same transaction. Therefore, with only these application write paths, `database stock + confirmed orders = 500`. The Redis token count can reach zero before database stock reaches zero because reservations may still be processing. These counters measure different stages.

The queue does not remove row locks. It bounds concurrency. SQL still guards final stock even if admission state is wrong. Querying an attempt uses one joined SQL query rather than one query per related record.

## UI behavior

- Each browser tab keeps its active attempt in `sessionStorage`; reload resumes it.
- A timeout is shown as uncertain. The recovery button resubmits the same attempt rather than creating a fresh purchase.
- One active purchase attempt per browser tab is a deliberate UI simplification. Use a new tab or clear session storage for another independent attempt.
- Metrics refresh on initial load, checkout changes, returning to the tab, or pressing Refresh. The observer panel does not poll globally every second.
- Status polling pauses while the page is hidden and resumes when visible.
- Keyboard focus, semantic buttons, live feedback, mobile layout and reduced dependencies are included.

## Tests and evidence

### Unit checks

```powershell
docker compose exec api node --test tests/unit.test.js
```

These check input validation and percentile calculations. They do not prove concurrency safety.

### Concurrent checkout and duplicate attempts

Run on a **fresh sale before clicking Buy**. If you have already purchased, reset using the dedicated instructions below.

```powershell
docker compose exec -e BASE_URL=http://localhost:8080 -e EVIDENCE_DIR=/evidence api node tests/load-test.js
```

Defaults: 1,000 independent purchase attempts, 50 concurrent HTTP requests. It then sends ten retries of an accepted attempt and one conflicting-identity request. It waits up to two minutes for workers to settle. Assertions check 500 admissions, 500 confirmed orders, zero remaining database stock, zero pending attempts, inventory conservation and status isolation. A failed assertion causes a nonzero exit code and is recorded.

Results and individual request samples are written to `../evidence/raw-results/load-<timestamp>.json` via the container bind mount. API latency measures admission response time, not final order completion; the report also records total duration until processing settles. Test conditions and results are local, not proof of the case study's 100,000-concurrent-request target.

Optional parameters, again on a fresh sale:

```powershell
docker compose exec -e REQUESTS=2000 -e CONCURRENCY=100 -e EVIDENCE_DIR=/evidence api node tests/load-test.js
```

Do not run parallel load-test processes against the same fresh sale. The script refuses an already-used inventory. Failure evidence is preserved; never relabel it as a passing run.

### Database verification

```powershell
docker compose exec postgres psql -U flashsale -d flashsale -c "SELECT stock, initial_stock, (SELECT count(*) FROM orders) AS orders, stock + (SELECT count(*) FROM orders) = initial_stock AS conserved FROM inventory;"
docker compose exec postgres psql -U flashsale -d flashsale -c "SELECT attempt_id, count(*) FROM orders GROUP BY attempt_id HAVING count(*) > 1;"
```

After the default successful settled test, the first query should show stock 0, orders 500, conserved true. The second should return no rows. These are expected values, not pre-populated measured results.

### Worker / dispatcher outage recovery

The automated recovery script requires Node.js 22+ and Docker on the host PATH because it stops and starts a Compose service. It changes only this project's `worker` or `dispatcher`. Run from `prototype/` on a fresh sale; it restores the service in `finally` even if assertions fail.

```powershell
node tests/recovery-test.js
```

It stops the worker, submits an attempt, verifies a pending reservation, starts the worker and verifies exactly one committed order. Reset before testing the dispatcher:

```powershell
$env:RECOVERY_SERVICE = 'dispatcher'
node tests/recovery-test.js
Remove-Item Env:RECOVERY_SERVICE
```

This proves an outage/resume path, not every possible crash instruction boundary. For a manual demo without host Node: stop the selected service, click Buy, observe Pending, start the service, then observe confirmation and verify SQL.

### Queue redelivery after a commit

The `tests/redelivery-test.js` integration test directly republishes the same valid purchase message after it has already committed. Run on a fresh sale:

```powershell
docker compose exec -e EVIDENCE_DIR=/evidence api node tests/redelivery-test.js
```

It verifies that five duplicate broker messages still leave exactly one order and one inventory decrement.

## Logs, queue and troubleshooting

```powershell
docker compose logs --tail=80 api dispatcher worker
docker compose ps
```

RabbitMQ UI: **http://localhost:15672**. Default local credentials: `flashsale` / `flashsale-local-only` (or the password set in `.env`). Do not reuse these credentials for public deployments. Ports are bound to loopback; databases are reachable only on the Compose network.

- Pending never resolves: inspect dispatcher/worker logs and the `checkout`, `checkout.retry`, `checkout.failed` queues.
- Startup errors: ensure Docker Desktop uses Linux containers; wait for health checks. Initial downloads can take time.
- Port conflict: set `APP_PORT` to a free port, then recreate services. Change `BASE_URL` for host-side tests.
- Redis data loss: the API fails admission closed if the stock key is missing after first initialization. It never blindly reconstructs tokens from SQL stock. Accepted-but-lost records require operator reconciliation from available durable data/backups.
- Exhausted retries: after five delayed retry attempts, work is placed in `checkout.failed` for inspection. Its reservation remains held; the demo does not automatically cancel or restock unknown outcomes. After repairing the cause, an operator can republish inspected messages. No operator recovery UI is implemented.
- The stream keeps acknowledged records for this small demo. A production retention policy must preserve recovery requirements.

## Stop and reset

Stop without deleting data:

```powershell
docker compose down
```

For a **fresh test only**, the following deletes this Compose project's PostgreSQL, Redis and RabbitMQ named volumes, including all demo orders and reservations. Evidence files on the host remain:

```powershell
docker compose down -v
docker compose up -d
```

Open a fresh browser tab or clear this site's session storage after resetting. Do not reset one database independently while leaving the other services' state intact.

For repeated local tests, this faster alternative clears the dedicated demo tables, Redis database and three queues while retaining infrastructure volumes. It also deletes all demo orders and reservations; do not run it against another environment or while a test/browser checkout is active:

```powershell
docker compose stop api dispatcher worker
docker compose run --rm --no-deps api node tests/reset-demo.js --confirm-reset
docker compose up -d
```

## Limits and production follow-up

- This is a single-machine, single-node deployment, not a high-availability guarantee. Disk loss, Redis failover, broker replication and cross-region consistency are outside the implemented scope.
- Demo customer IDs are browser-generated, not authenticated identities. Header matching hides accidental cross-customer lookups but is not production authorization. Rate limits keyed by these IDs can be bypassed. Production needs authentication, abuse controls, gateway limits and TLS.
- The worker uses database locks for correctness. It does not claim to eliminate locks or achieve 100,000 concurrent requests.
- No payment, cancellation, automatic reservation expiry or automatic stock release is implemented. These require a coordinated state machine to avoid late completion racing cancellation.
- No queue position or invented wait-time estimate is shown.
- No CDN, load balancer, Preact, TypeScript, autoscaling, WebSockets or SSE is implemented. The report should not claim otherwise.
- The 60 ms worker delay makes Pending observable; it is configurable and occurs outside the SQL transaction. Set it to 0 for performance experiments and record the value.
- Source asset size is recorded separately from browser performance. The <1.5 s interactivity target is not considered achieved without a measured device/network profile.

## Source map

`backend/reserve.lua` — reservation + outbox atomic operation.
`backend/dispatcher.js` — recoverable Redis-to-RabbitMQ publication.
`backend/worker.js` — transactional stock/order processing and message retries.
`backend/server.js` — HTTP API, static frontend, status, metrics and first-time bootstrap.
`database/init.sql` — inventory, attempts, orders and constraints.
`frontend/app.js` — purchase state and bounded polling.

## Technical references

- Redis scripting: https://redis.io/docs/latest/develop/programmability/eval-intro/
- RabbitMQ acknowledgements and publisher confirms: https://www.rabbitmq.com/docs/confirms
- PostgreSQL locking: https://www.postgresql.org/docs/16/explicit-locking.html

The assessment message provided in this workspace prohibits AI-generated submissions. This code is AI-assisted reference work; do not misrepresent its authorship.

