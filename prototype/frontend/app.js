const $ = (id) => document.getElementById(id);
let customer = sessionStorage.getItem("customer") || crypto.randomUUID();
sessionStorage.setItem("customer", customer);
let attempt = sessionStorage.getItem("attempt"),
  state = attempt ? "pending" : "ready",
  inFlight = false,
  pollTimer,
  delay = 1500,
  product,
  clockOffset = 0;
const labels = {
  ready: [
    "Ready when you are",
    "The server will reserve a unit if one is available.",
  ],
  submitting: ["Sending your request…", "Please keep this page open."],
  pending: [
    "Your place is reserved. Processing…",
    "Your order is not confirmed yet.",
  ],
  confirmed: [
    "It’s yours. Order confirmed.",
    "Your order and inventory change have been committed together.",
  ],
  unavailable: [
    "This drop is fully reserved",
    "Some units may still be processing. No order was created for this attempt.",
  ],
  failed: [
    "This purchase could not be completed",
    "Check the outcome before starting another attempt.",
  ],
  uncertain: [
    "Checking your purchase outcome…",
    "A connection problem does not mean your order failed.",
  ],
};
function setState(next, detail) {
  state = next;
  $("feedback").dataset.state = next;
  $("status-title").textContent = labels[next][0];
  $("status-detail").textContent = detail || labels[next][1];
  $("attempt-label").textContent = attempt ? `Attempt ${attempt}` : "";
  $("recover").hidden = !["uncertain"].includes(next);
  renderBuy();
}
function renderBuy() {
  let opens = product ? product.saleStart - (Date.now() + clockOffset) : 0;
  let disabled =
    inFlight ||
    !product ||
    opens > 0 ||
    ["pending", "submitting", "uncertain", "confirmed", "failed"].includes(
      state,
    ) ||
    product.available === 0;
  $("buy").disabled = disabled;
  $("buy").textContent =
    state === "confirmed"
      ? "Order confirmed ✓"
      : opens > 0
        ? "Sale opens soon"
        : state === "pending" || state === "submitting"
          ? "Processing your purchase…"
          : product?.available === 0
            ? "Currently unavailable"
            : "Reserve Aurora One ↗";
  if (product)
    $("sale-label").textContent =
      opens > 0
        ? `Opens in ${Math.ceil(opens / 1000)} seconds`
        : "Sale is live";
}
async function request(url, options = {}) {
  const c = new AbortController(),
    timer = setTimeout(() => c.abort(), 12000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: c.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Customer-ID": customer,
        ...options.headers,
      },
    });
    const data = await res.json();
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}
async function metrics() {
  try {
    const { res, data } = await request("/api/product");
    if (!res.ok) throw Error(data.error);
    product = data;
    clockOffset = data.serverTime - Date.now();
    $("availability").textContent = `${data.available ?? "—"} / 500`;
    $("stock-bar").style.width = `${(data.available || 0) / 5}%`;
    for (const name of ["available", "pending", "confirmed"])
      $("m-" + name).textContent = data[name] ?? "—";
    $("integrity").textContent = data.conserved
      ? "✓ Stock + confirmed orders = 500"
      : "⚠ Inventory conservation check failed";
    $("db-stock").textContent =
      `Database stock: ${data.stock}. Failed attempts: ${data.failed}. Pending is derived from reserved tokens and final results.`;
    $("updated").textContent = "Updated " + new Date().toLocaleTimeString();
    renderBuy();
  } catch {
    $("updated").textContent = "Service unavailable — retry refresh";
    if (!product)
      $("status-detail").textContent =
        "Start all Docker services, then refresh this page.";
  }
}
function schedule() {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = setTimeout(poll, delay + Math.random() * 500);
  delay = Math.min(5000, delay * 1.3);
}
async function poll() {
  if (!attempt || ["confirmed", "failed", "unavailable"].includes(state))
    return;
  try {
    const { res, data } = await request("/api/attempts/" + attempt);
    if (res.ok) {
      setState(
        data.status,
        data.orderId
          ? `Order ${data.orderId}. Saved in PostgreSQL.`
          : undefined,
      );
      if (["confirmed", "failed"].includes(data.status)) {
        await metrics();
        return;
      }
    } else if (res.status === 404) {
      setState(
        "uncertain",
        "The attempt is not recorded yet. Retry with the same identifier.",
      );
      return;
    } else {
      setState("uncertain");
      if (res.status === 429)
        delay = Math.max(
          delay,
          Number(res.headers.get("Retry-After") || 5) * 1000,
        );
    }
  } catch {
    setState("uncertain");
  }
  schedule();
}
async function submit() {
  if (inFlight) return;
  inFlight = true;
  clearTimeout(pollTimer);
  attempt = attempt || crypto.randomUUID();
  sessionStorage.setItem("attempt", attempt);
  setState("submitting");
  try {
    const { res, data } = await request("/api/checkout", {
      method: "POST",
      body: JSON.stringify({
        attemptId: attempt,
        customerId: customer,
        productId: "aurora-one",
        quantity: 1,
      }),
    });
    if (res.status === 202) {
      setState("pending");
      delay = 1500;
      schedule();
    } else if (data.status === "unavailable") {
      setState("unavailable");
    } else if (data.code === "not_open") {
      setState("ready", data.error);
    } else if (res.status === 429) {
      setState(
        "uncertain",
        `Rate limited. Wait ${res.headers.get("Retry-After") || 60} seconds before retrying this attempt.`,
      );
    } else if (res.status >= 500) {
      setState("uncertain");
      schedule();
    } else {
      setState("failed", data.error);
    }
  } catch {
    setState("uncertain");
    schedule();
  } finally {
    inFlight = false;
    renderBuy();
    await metrics();
  }
}
$("buy").addEventListener("click", submit);
$("recover").addEventListener("click", submit);
$("refresh").addEventListener("click", metrics);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(pollTimer);
  else {
    metrics();
    if (["pending", "uncertain"].includes(state)) schedule();
  }
});
setInterval(() => {
  if (product && Date.now() + clockOffset < product.saleStart + 1500)
    renderBuy();
}, 1000);
setState(state);
await metrics();
if (attempt) poll();
