// Image upload validation (pure): file type is decided by magic bytes, never by the client's name or MIME.

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export type ImageExt = "png" | "jpg" | "webp" | "gif";

export const IMAGE_MIME: Record<ImageExt, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** Detect png / jpeg / webp / gif from the first bytes of a file. */
export function sniffImage(bytes: Uint8Array): ImageExt | null {
  const b = bytes;
  const at = (i: number, ...vals: number[]) => vals.every((v, k) => b[i + k] === v);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "jpg";
  if (b.length >= 6 && (at(0, 0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || at(0, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) return "gif";
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  return null;
}

/** Stored upload file names: 32 hex chars + a known extension. Anything else is rejected (no path tricks). */
export const UPLOAD_NAME = /^[a-f0-9]{32}\.(png|jpg|webp|gif)$/;

export function uploadUrl(name: string) {
  return `/api/upload/${name}`;
}

/** True for URLs this app serves for uploaded images */
export function isUploadUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const m = url.match(/^\/api\/upload\/([^/?#]+)$/);
  return !!m && UPLOAD_NAME.test(m[1]);
}
