// POST /api/admin/players/:id/photo — multipart upload -> R2, sets photo_url.
import { json, badRequest, notFound, serverError, parseId } from "../../../../_lib/http.js";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function onRequestPost({ request, env, params }) {
  try {
    const id = parseId(params.id);
    if (id == null) return badRequest("Invalid player id.");

    const player = await env.DB.prepare("SELECT id FROM players WHERE id = ?").bind(id).first();
    if (!player) return notFound("Player not found.");

    const form = await request.formData().catch(() => null);
    if (!form) return badRequest("Expected multipart/form-data.");

    const file = form.get("photo") || form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") {
      return badRequest("Missing `photo` file field.");
    }

    const contentType = file.type || "application/octet-stream";
    if (!ALLOWED_TYPES.has(contentType)) {
      return badRequest(`Unsupported image type: ${contentType}`);
    }

    const ext = contentType.split("/")[1] || "jpg";
    const key = `players/${id}-${Date.now()}.${ext}`;

    await env.ASSETS_BUCKET.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType },
    });

    const photoUrl = `/api/assets/${key}`;
    await env.DB.prepare("UPDATE players SET photo_url = ? WHERE id = ?").bind(photoUrl, id).run();

    return json({ photo_url: photoUrl });
  } catch (err) {
    return serverError(err);
  }
}
