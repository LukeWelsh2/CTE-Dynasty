// GET /api/upload/<file> → serves an uploaded image from public/uploads (signed-in users only).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getApiUser } from "@/lib/auth/session";
import { IMAGE_MIME, UPLOAD_NAME, type ImageExt } from "@/lib/profiles/images";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!UPLOAD_NAME.test(file)) return new Response("Not found", { status: 404 });
  const user = await getApiUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  try {
    const data = await readFile(path.join(process.cwd(), "public", "uploads", file));
    const ext = file.split(".").pop() as ImageExt;
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": IMAGE_MIME[ext],
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
