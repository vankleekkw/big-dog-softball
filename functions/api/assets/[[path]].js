// GET /api/assets/* — serves objects out of R2 (ASSETS_BUCKET). Public,
// read-only; needed because the admin photo-upload endpoint stores objects
// in R2 and photo_url needs something browsers can actually load. Not an
// R2 custom domain -- just a thin proxy through the binding.
import { notFound, serverError } from "../../_lib/http.js";

export async function onRequestGet({ params, env }) {
  try {
    const key = Array.isArray(params.path) ? params.path.join("/") : params.path;
    if (!key) return notFound("Not found.");

    const object = await env.ASSETS_BUCKET.get(key);
    if (!object) return notFound("Not found.");

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "public, max-age=86400");

    return new Response(object.body, { headers });
  } catch (err) {
    return serverError(err);
  }
}
