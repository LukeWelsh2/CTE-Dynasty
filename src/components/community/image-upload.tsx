"use client";
// Image picker for profile photo, cover banner and team logo. Uploads to POST /api/upload (server checks
// size + magic bytes), then saves the returned URL with the matching server action.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { buttonClass } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { setProfileImageAction, setTeamLogoAction } from "@/lib/profiles/actions";

const MAX = 2 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

async function uploadImage(file: File): Promise<string> {
  if (file.size > MAX) throw new Error("Images must be 2 MB or smaller.");
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("Choose a PNG, JPEG, WebP or GIF image.");
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
  if (!res.ok || !json?.ok || !json.url) throw new Error(json?.error ?? `Upload failed (${res.status})`);
  return json.url;
}

export type UploadTarget = { kind: "avatar" } | { kind: "cover" } | { kind: "logo"; teamId: string };

function useImageSaver(target: UploadTarget) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const save = (url: string | null) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const res = target.kind === "logo" ? await setTeamLogoAction({ teamId: target.teamId, url }) : await setProfileImageAction({ kind: target.kind, url });
        if (!res.ok) {
          toast.error(res.error);
          resolve(false);
          return;
        }
        if (res.message) toast.success(res.message);
        router.refresh();
        resolve(true);
      }),
    );
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadImage(file);
      await save(url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { pick, remove: () => save(null), working: busy || pending };
}

/** Square / round image with "change" and "remove" controls (avatar, team logo). */
export function ImageUpload({
  target,
  current,
  label,
  fallback,
  round = false,
  size = 96,
  hint,
  textClassName,
}: {
  target: UploadTarget;
  current: string | null;
  label: string;
  fallback: React.ReactNode;
  round?: boolean;
  size?: number;
  hint?: string;
  /** extra classes for the label/buttons column (e.g. to clear an overlapping cover) */
  textClassName?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { pick, remove, working } = useImageSaver(target);
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={working}
        className={cn("group relative shrink-0 overflow-hidden ring-1 ring-line focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500", round ? "rounded-full border-4 border-panel bg-panel" : "rounded-lg")}
        style={{ width: size, height: size }}
        aria-label={`Change ${label.toLowerCase()}`}
      >
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center">{fallback}</span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Camera size={20} />
        </span>
        {working && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
            <Loader2 size={20} className="animate-spin" />
          </span>
        )}
      </button>
      <div className={cn("min-w-0", textClassName)}>
        <div className="text-sm font-semibold">{label}</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => input.current?.click()} disabled={working}>
            <ImagePlus size={14} /> {current ? "Replace" : "Upload"}
          </button>
          {current && (
            <button type="button" className={buttonClass("ghost", "sm", "text-loss")} onClick={() => remove()} disabled={working}>
              <Trash2 size={12} /> Remove
            </button>
          )}
        </div>
        {hint !== "" && <p className="mt-1 text-[12px] text-muted">{hint ?? "PNG, JPEG, WebP or GIF · up to 2 MB"}</p>}
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={`${label} file`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void pick(f);
        }}
      />
    </div>
  );
}

/** Wide cover banner with an overlaid change button. */
export function CoverUpload({ current, fallbackStyle }: { current: string | null; fallbackStyle: React.CSSProperties }) {
  const input = useRef<HTMLInputElement>(null);
  const { pick, remove, working } = useImageSaver({ kind: "cover" });
  return (
    <div className="relative h-32 overflow-hidden rounded-card bg-sunken ring-1 ring-line/70 sm:h-40">
      {current ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={current} alt="Cover banner" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full" style={fallbackStyle} />
      )}
      {working && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
          <Loader2 className="animate-spin" />
        </div>
      )}
      <div className="absolute bottom-2 right-2 flex gap-1.5">
        {current && (
          <button type="button" onClick={() => remove()} disabled={working} className="inline-flex h-9 items-center gap-1.5 rounded-control bg-black/60 px-3 text-[13px] font-semibold text-white hover:bg-black/75">
            <Trash2 size={14} /> Remove
          </button>
        )}
        <button type="button" onClick={() => input.current?.click()} disabled={working} className="inline-flex h-9 items-center gap-1.5 rounded-control bg-black/60 px-3 text-[13px] font-semibold text-white hover:bg-black/75">
          <Camera size={14} /> {current ? "Change cover" : "Add cover photo"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Cover banner file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void pick(f);
        }}
      />
    </div>
  );
}
