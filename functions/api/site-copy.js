// GET /api/site-copy — public site-wide copy blocks, as a { key: value } map.
import { json, serverError } from "../_lib/http.js";

export async function onRequestGet({ env }) {
  try {
    const res = await env.DB.prepare("SELECT key, value FROM site_copy").all();
    const map = {};
    for (const row of res.results) map[row.key] = row.value;
    return json(map);
  } catch (err) {
    return serverError(err);
  }
}
