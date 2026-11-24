// POST /api/upload (multipart, field "file") → { ok, url }
// Signed-in users only; ≤ 2 MB; PNG / JPEG / WebP / GIF verified by magic bytes. Saved as
// public/uploads/<random>.<ext> and served by GET /api/upload/<file> (works for files added after build).
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getApiUser } from "@/lib/auth/session";
import { RateLimiter, sharedLimiter } from "@/lib/chat/rate-limit";
import { IMAGE_MIME, MAX_UPLOAD_BYTES, sniffImage, uploadUrl } from "@/lib/profiles/images";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = () => sharedLimiter("upload", () => new RateLimiter(1000, { count: 20, windowMs: 10 * 60_000 }));

function err(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  const user = await getApiUser();
  if (!user) return err("Sign in to upload images.", 401);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return err("Images must be 2 MB or smaller.", 413);
  const rl = limiter().check(user.id);
  if (!rl.ok) return err("Too many uploads — try again in a few minutes.", 429);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err("Send the image as multipart form data in a field named “file”.", 400);
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return err("Choose an image to upload.", 400);
  if (file.size === 0) return err("That file is empty.", 400);
  if (file.size > MAX_UPLOAD_BYTES) return err("Images must be 2 MB or smaller.", 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return err("Images must be 2 MB or smaller.", 413);
  const ext = sniffImage(bytes);
  if (!ext) return err("Only PNG, JPEG, WebP or GIF images are allowed.", 415);

  const name = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes, { flag: "wx" });
  return Response.json({ ok: true, url: uploadUrl(name), type: IMAGE_MIME[ext], size: bytes.byteLength });
}
