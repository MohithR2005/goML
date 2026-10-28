# Test evidence

Measured local verification on 28 October 2026. Raw outputs, including unsuccessful earlier runs, are retained in `raw-results/`.

## Run record

| Item | Measured value |
| --- | --- |
| Run date and timezone | 28 October 2026, 11:28:45–11:29:08 IST |
| Runtime | Docker Desktop Linux containers; Node 22.23.4 |
| Docker resources | 8 CPUs exposed; 3,921,354,752 bytes memory (about 3.65 GiB) |
| Request count / concurrency | 1,000 attempts / 50 concurrent HTTP requests |
| Worker delay / concurrency | 60 ms outside the transaction / 4 messages |
| Accepted / unavailable / unexpected failures | 500 / 500 / 0 |
| Final orders / remaining stock / pending | 500 / 0 / 0 |
| Admission p50 / p95 / p99 latency | 193.56 / 356.93 / 415.10 ms |
| Submission duration | 4.214 seconds |
| Total run duration, including settlement and extra checks | 22.982 seconds |
| Duplicate HTTP requests | Ten retries did not create additional reservations or orders |
| Conflicting identity and status isolation | Mismatched attempt owner rejected; another demo customer could not retrieve the status |
| Broker redelivery | Five duplicates plus original delivery: six recorded deliveries, one order, stock 499 |
| Worker outage recovery | Pending while stopped; one confirmed order after restart; stock 499 |
| Dispatcher outage recovery | Reservation remained pending in Redis while dispatcher was stopped; one order after restart |

Passing load-run file: `raw-results/load-1793167148686.json`. SQL verification in `raw-results/database-verification.txt` independently records 500 orders, zero stock, conservation true and no duplicate attempt IDs.

Broker test: `raw-results/redelivery-1793167341136.json`. Worker outage: `raw-results/recovery-worker-1793167389109.json`.

Dispatcher outage: `raw-results/recovery-dispatcher-1793167437150.json`.

## Earlier failures and corrections

- `load-1793166714171.json`: failed with 11 transport errors. It admitted 500 reservations, but the test did not complete its remaining assertions. This run occurred during initial service startup. RabbitMQ readiness was strengthened and the HTTP keep-alive timeout increased before the subsequent passing run. The exact cause of each socket failure was not captured, so these changes are not a proven individual root-cause diagnosis.
- `redelivery-1793167220557.json`: failed before checkout because the API had not finished starting. An API health check, `docker compose ... --wait`, and test-side readiness polling were added. The subsequent redelivery test passed.
- Initial RabbitMQ startup encountered a cookie permission error. The local volume ownership was repaired, and Compose now runs the broker and health check as the same `rabbitmq` user with a stable hostname.

## Verification scope

Unit tests passed (2). JavaScript syntax checks passed. Browser layout checks at 1440 px and 390 px reported no JavaScript page errors or horizontal mobile overflow. The frontend's three uncompressed source assets total approximately 21 KB after formatting; no claim is made that the 1.5-second interactivity target was measured or achieved.

Admission latency is not final order latency. These results demonstrate this local run only, not 100,000 concurrent users, high availability, power-loss survival, authenticated access or every possible crash boundary.

The Docker engine became unavailable during the final browser purchase/reload check, so that particular check was not completed. Earlier desktop/mobile layout inspection passed, and the API integration tests above completed before the engine stopped. The final fresh-inventory reset could not be performed; the last verified state was one recovery-test order and 499 units. Restart Docker and reset the demo before another full load test.

## Suggested screenshots

1. Fresh storefront with 500 available tokens.
2. Pending checkout while the worker is stopped, then the same attempt confirmed after restart.
3. Load-test terminal summary with request count, concurrency and assertions.
4. Refreshed observer panel after all processing settles.
5. SQL inventory-conservation result and empty duplicate-order query result.

Save screenshots in `evidence/screenshots/`. Keep generated JSON in `evidence/raw-results/`. Do not submit browser preview/mock data as concurrency evidence. A local run is not a proof of 100,000-request capacity.

## Latest screenshot capture — 28 October 2026, 22:24 IST

This run supersedes the earlier incomplete final browser check and reset described above. Docker was available, and all six services were running.

- Load test: 1,000 attempts at concurrency 50, 500 accepted, 500 unavailable, zero unexpected failures; all assertions passed. Admission p50 220.4 ms, p95 611.45 ms, p99 685.47 ms; total test duration 13.698 seconds.
- Final load-test database: 500 orders, zero stock, zero pending attempts; inventory conserved and no duplicate purchase-attempt IDs.
- Browser recovery: a reservation remained pending while the worker was stopped, then confirmed after restart. Reload retained the same attempt and confirmed result, with no captured page errors.
- Broker redelivery: original message plus five duplicate deliveries resulted in six recorded deliveries but only one order and one inventory decrement; passed.
- After capture, the demo was restored to 500 units, zero confirmed orders and zero pending attempts.

Eight screenshots and explanations are in `screenshots/evidence.docx`. Supporting raw outputs and the capture manifest use the prefix `capture-1793206457294-` in `raw-results/`. Output screenshots use an explicitly labelled evidence viewer rather than a terminal. The earlier failures remain documented for transparency.
