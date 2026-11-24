// Shared plumbing for the /api/chat route handlers: auth, channel access, JSON errors.
import "server-only";
import { z } from "zod";
import { getApiUser, type SessionUser } from "@/lib/auth/session";
import { channelForUser, type ChannelAccess } from "@/lib/chat/server";
import { ChatError } from "@/lib/chat/service";

export function jsonError(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, error: message, ...extra }, { status, headers: status === 429 && extra.retryAfterMs ? { "retry-after": String(Math.ceil(Number(extra.retryAfterMs) / 1000)) } : undefined });
}

export function handleError(e: unknown) {
  if (e instanceof ChatError) return jsonError(e.message, e.status, e.retryAfterMs ? { retryAfterMs: e.retryAfterMs } : {});
  if (e instanceof z.ZodError) return jsonError(e.issues[0]?.message ?? "Invalid input", 400);
  console.error("[chat] route error", e);
  return jsonError("Something went wrong", 500);
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 20_000) throw new ChatError("Request too large", 413);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ChatError("Invalid JSON body");
  }
}

/** Run a handler for a signed-in user who can access the channel. */
export async function withChannel(channelId: string, fn: (user: SessionUser, access: ChannelAccess) => Promise<Response>): Promise<Response> {
  const user = await getApiUser();
  if (!user) return jsonError("Sign in required", 401);
  try {
    const access = await channelForUser(user.id, channelId, user.isSiteAdmin);
    if (!access) return jsonError("Channel not found", 404);
    return await fn(user, access);
  } catch (e) {
    return handleError(e);
  }
}
