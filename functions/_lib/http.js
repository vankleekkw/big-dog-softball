// Small JSON response helpers shared by every API route.

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function errorResponse(message, status = 400) {
  return json({ error: message }, status);
}

export function notFound(message = "Not found") {
  return errorResponse(message, 404);
}

export function badRequest(message = "Bad request") {
  return errorResponse(message, 400);
}

export function serverError(err) {
  const message = err && err.message ? err.message : String(err);
  return errorResponse(message, 500);
}

// Parse a JSON body defensively. Returns {} on empty/invalid body rather
// than throwing, so callers can validate required fields themselves.
export async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

// Parse a numeric route param. Returns null if not a valid integer.
export function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}
