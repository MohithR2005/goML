# Screenshots and Word evidence

`evidence.docx` contains eight screenshots with explanations, captured from actual local runs on 28 October 2026 beginning at 22:24 IST.

1. `01-services-running.png` — Docker Compose service status.
2. `02-fresh-sale.png` — storefront with 500 available units.
3. `03-load-test-results.png` — 1,000 attempts at concurrency 50; 500 accepted, 500 unavailable, zero unexpected errors.
4. `04-sale-completed.png` — settled metrics with 500 confirmed orders.
5. `05-database-verification.png` — SQL inventory conservation and duplicate-order checks.
6. `06-pending-worker-stopped.png` — accepted reservation while the worker is unavailable.
7. `07-confirmed-after-restart.png` — same attempt confirmed after restart and browser reload.
8. `08-duplicate-delivery-test.png` — six deliveries produce one order.

Service status, test summaries and SQL output are displayed in an explicitly labelled evidence viewer; they are not terminal screenshots. Storefront and observer screenshots show the live application. Supporting output uses the prefix `capture-1793206457294-` in `../raw-results/`.

The demo was reset to 500 units, zero orders and zero pending attempts after capture. These local tests do not establish capacity for 100,000 concurrent requests.

Packaging note: the individual PNG files are not included in this checkout. The eight captures are embedded in evidence.docx.
