// GET /api/admin/site-copy — full rows (key/label/value) for the admin editor.
import { json, serverError } from "../../../_lib/http.js";

export async function onRequestGet({ env }) {
  try {
    const res = await env.DB.prepare("SELECT key, label, value FROM site_copy ORDER BY key").all();
    return json(res.results);
  } catch (err) {
    return serverError(err);
  }
}
