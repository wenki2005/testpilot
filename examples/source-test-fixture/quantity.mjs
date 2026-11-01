export function normalizeQuantity(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return Math.min(n, 999);
}
