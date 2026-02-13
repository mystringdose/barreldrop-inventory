const EPSILON = Number.EPSILON;

export function roundNumber(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;

  const factor = 10 ** precision;
  return Math.round((num + EPSILON) * factor) / factor;
}

export function roundMoney(value) {
  return roundNumber(value, 2);
}
