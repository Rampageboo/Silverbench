type ErrorBody = {
  message?: unknown;
  detail?: unknown;
  error?: unknown;
};

function nestedMessage(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const body = value as ErrorBody;
  if (typeof body.message === "string" && body.message.trim()) return body.message.trim();
  if (typeof body.detail === "string" && body.detail.trim()) return body.detail.trim();
  if (typeof body.error === "string" && body.error.trim()) return body.error.trim();
  if (body.error && typeof body.error === "object") return nestedMessage(body.error);
  return "";
}

/** Convert backend, browser, and arbitrary thrown values into a user-facing message. */
export function errMessage(value: unknown, fallback = "Unknown error") {
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  if (typeof value === "string" && value.trim()) return value.trim();
  const nested = nestedMessage(value);
  if (nested) return nested;
  try {
    const serialized = JSON.stringify(value);
    if (serialized && serialized !== "{}" && serialized !== "null") return serialized;
  } catch {
    // Ignore non-serializable thrown values.
  }
  return fallback;
}
