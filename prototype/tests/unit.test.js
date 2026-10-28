import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { validateAttempt, percentile } from "../backend/domain.js";
test("only the known product, one unit and UUID v4 identifiers are accepted", () => {
  const valid = {
    attemptId: randomUUID(),
    customerId: randomUUID(),
    productId: "aurora-one",
    quantity: 1,
  };
  assert.equal(validateAttempt(valid), true);
  for (const changed of [
    { quantity: 2 },
    { quantity: 0 },
    { productId: "other" },
    { attemptId: "bad" },
    { customerId: "" },
  ])
    assert.equal(validateAttempt({ ...valid, ...changed }), false);
});
test("latency percentile uses nearest rank without mutating samples", () => {
  const samples = [100, 1, 20, 5];
  assert.equal(percentile(samples, 95), 100);
  assert.equal(percentile(samples, 50), 5);
  assert.deepEqual(samples, [100, 1, 20, 5]);
});
