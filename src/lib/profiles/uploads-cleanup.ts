// Deletes uploaded images in public/uploads that nothing references any more (abandoned uploads: picked
// in the image picker but never saved, or left behind by a failed save). Files younger than `minAgeMs`
// are kept so an upload that is about to be attached is never removed. Safe to run repeatedly.
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { UPLOAD_NAME, uploadUrl } from "@/lib/profiles/images";

export async function cleanupOrphanUploads(opts: { minAgeMs?: number; now?: number; dir?: string } = {}): Promise<string> {
  const dir = opts.dir ?? path.join(process.cwd(), "public", "uploads");
  const now = opts.now ?? Date.now();
  const minAge = opts.minAgeMs ?? 24 * 3600_000;
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => UPLOAD_NAME.test(n));
  } catch {
    return "no uploads folder";
  }
  if (!names.length) return "no uploads";
  const old: string[] = [];
  for (const n of names) {
    const s = await stat(path.join(dir, n)).catch(() => null);
    if (s && now - s.mtimeMs >= minAge) old.push(n);
  }
  if (!old.length) return `uploads: ${names.length}, none old enough to check`;
  const urls = old.map(uploadUrl);
  const [users, covers, teams, leagues] = await Promise.all([
    db.user.findMany({ where: { avatarUrl: { in: urls } }, select: { avatarUrl: true } }),
    db.managerProfile.findMany({ where: { coverUrl: { in: urls } }, select: { coverUrl: true } }),
    db.team.findMany({ where: { logoUrl: { in: urls } }, select: { logoUrl: true } }),
    db.league.findMany({ where: { logoUrl: { in: urls } }, select: { logoUrl: true } }),
  ]);
  const used = new Set<string>([...users.map((u) => u.avatarUrl), ...covers.map((c) => c.coverUrl), ...teams.map((t) => t.logoUrl), ...leagues.map((l) => l.logoUrl)].filter((x): x is string => !!x));
  let removed = 0;
  for (const n of old) {
    if (used.has(uploadUrl(n))) continue;
    await unlink(path.join(dir, n)).then(
      () => removed++,
      () => null,
    );
  }
  return `uploads: ${names.length}, orphans removed: ${removed}`;
}
