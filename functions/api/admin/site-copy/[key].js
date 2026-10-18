// /api/admin/site-copy/:key — PATCH { value }, updates one row.
import { json, badRequest, notFound, serverError } from "../../../_lib/http.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const key = params.key;
    const body = await request.json().catch(() => ({}));
    if (typeof body.value !== "string") return badRequest("`value` is required.");

    const res = await env.DB
      .prepare("UPDATE site_copy SET value = ? WHERE key = ?")
      .bind(body.value, key)
      .run();
    if (res.meta.changes === 0) return notFound("Unknown site_copy key.");

    const row = await env.DB.prepare("SELECT key, label, value FROM site_copy WHERE key = ?").bind(key).first();
    return json(row);
  } catch (err) {
    return serverError(err);
  }
}
