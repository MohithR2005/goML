export const PRODUCT_ID = "aurora-one";
export const INITIAL_STOCK = 500;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateAttempt(body) {
  return (
    body &&
    UUID.test(body.attemptId) &&
    UUID.test(body.customerId) &&
    body.productId === PRODUCT_ID &&
    body.quantity === 1
  );
}
export function percentile(values, percent) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    Math.round(
      sorted[Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1)] * 100,
    ) / 100
  );
}
