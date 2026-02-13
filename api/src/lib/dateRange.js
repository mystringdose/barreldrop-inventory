const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MIN_TZ_OFFSET_MINUTES = -840;
const MAX_TZ_OFFSET_MINUTES = 840;

function parseTimezoneOffset(tzOffsetMinutes) {
  if (tzOffsetMinutes === undefined || tzOffsetMinutes === null || tzOffsetMinutes === "") {
    return null;
  }

  const parsed = Number(tzOffsetMinutes);
  if (!Number.isFinite(parsed)) return null;

  const rounded = Math.trunc(parsed);
  if (rounded < MIN_TZ_OFFSET_MINUTES || rounded > MAX_TZ_OFFSET_MINUTES) {
    return null;
  }

  return rounded;
}

function parseDateOnlyBoundary(value, boundary, tzOffsetMinutes) {
  const [y, m, d] = value.split("-").map((part) => Number(part));
  const check = new Date(Date.UTC(y, m - 1, d));
  if (
    check.getUTCFullYear() !== y
    || check.getUTCMonth() !== m - 1
    || check.getUTCDate() !== d
  ) {
    return null;
  }

  const baseUtc = boundary === "end"
    ? Date.UTC(y, m - 1, d, 23, 59, 59, 999)
    : Date.UTC(y, m - 1, d, 0, 0, 0, 0);

  if (!Number.isFinite(baseUtc)) return null;

  if (tzOffsetMinutes === null) {
    return boundary === "end"
      ? new Date(y, m - 1, d, 23, 59, 59, 999)
      : new Date(y, m - 1, d, 0, 0, 0, 0);
  }

  // Browser timezone offset minutes (Date.getTimezoneOffset()) maps local day boundaries to UTC.
  return new Date(baseUtc + tzOffsetMinutes * 60 * 1000);
}

function parseBoundaryValue(value, boundary, tzOffsetMinutes) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (DATE_ONLY_PATTERN.test(raw)) {
    return parseDateOnlyBoundary(raw, boundary, tzOffsetMinutes);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function buildDateRange({ start, end, tzOffsetMinutes } = {}) {
  const range = {};
  const offset = parseTimezoneOffset(tzOffsetMinutes);

  const parsedStart = parseBoundaryValue(start, "start", offset);
  const parsedEnd = parseBoundaryValue(end, "end", offset);

  if (parsedStart) range.$gte = parsedStart;
  if (parsedEnd) range.$lte = parsedEnd;

  return Object.keys(range).length ? range : null;
}
