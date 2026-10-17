// Gates every /api/admin/* request (Pages Functions middleware runs for all
// routes under this directory, deeper nesting included). Fails closed: see
// functions/_lib/auth.js for the exact rules.
import { verifyAccessJwt } from "../../_lib/auth.js";
import { errorResponse } from "../../_lib/http.js";

export async function onRequest(context) {
  const { request, env, next } = context;
  const result = await verifyAccessJwt(request, env);
  if (!result.ok) {
    return errorResponse(result.error, result.status);
  }
  context.data = context.data || {};
  context.data.accessPayload = result.payload;
  return next();
}
