"use client";
// Commissioner seed override (settings.playoffs.manualSeedingAllowed): pick a team for each playoff seed.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListOrdered, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/client";
import { buttonClass } from "@/components/ui/core";
import type { SeedingView } from "@/lib/playoffs/view";
import { setPlayoffSeedsAction } from "@/lib/playoffs/actions";
import { cn } from "@/lib/utils";

export function SeedEditor({ seeding, byes }: { seeding: SeedingView; byes: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState<string[]>(seeding.current);
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(seeding.options.map((o) => [o.id, o])), [seeding.options]);
  const dupes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const id of picks) seen.set(id, (seen.get(id) ?? 0) + 1);
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [picks]);
  const unchanged = picks.join("|") === seeding.current.join("|");
  const run = (teamIds: string[] | null) =>
    start(async () => {
      const res = await setPlayoffSeedsAction({ teamIds });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });

  if (!seeding.open) {
    return (
      <p className="flex items-start gap-2 text-[13px] text-muted">
        <Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          {seeding.manual ? "Seeds were set by the commissioner. " : "Seeds follow the standings. "}
          {seeding.reason}
        </span>
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] text-muted">{seeding.manual ? "Seeds were set by the commissioner." : "Seeds follow the standings."} You can change them until the first playoff kickoff.</span>
      <button
        type="button"
        className={buttonClass("secondary", "md")}
        onClick={() => {
          setPicks(seeding.current);
          setOpen(true);
        }}
      >
        <ListOrdered size={15} aria-hidden /> Set seeds
      </button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title="Set playoff seeds"
        footer={
          <>
            {seeding.manual && (
              <button type="button" disabled={pending} className={buttonClass("ghost", "md", "mr-auto")} onClick={() => run(null)}>
                Reset to standings
              </button>
            )}
            <button type="button" disabled={pending} className={buttonClass("secondary", "md")} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" disabled={pending || dupes.size > 0 || unchanged} className={buttonClass("primary", "md")} onClick={() => run(picks)}>
              {pending && <Loader2 size={14} className="animate-spin" aria-hidden />}
              Save &amp; rebuild bracket
            </button>
          </>
        }
      >
        <p className="mb-3 text-[14px] text-muted">
          Pick the team for each seed. Saving replaces the unplayed bracket and notifies the league.{byes > 0 && ` Seeds 1–${byes} get first-round byes.`}
        </p>
        <ol className="space-y-2">
          {picks.map((id, i) => {
            const fromStandings = seeding.standingsSeeds[i];
            const differs = fromStandings && fromStandings !== id;
            return (
              <li key={i} className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-2">
                <label htmlFor={`seed-${i}`} className={cn("numeral text-right text-[17px] font-semibold", i < byes ? "text-ink" : "text-muted")}>
                  #{i + 1}
                </label>
                <div className="min-w-0">
                  <select
                    id={`seed-${i}`}
                    className={cn("input w-full", dupes.has(id) && "border-loss ring-1 ring-loss")}
                    value={id}
                    disabled={pending}
                    onChange={(e) => setPicks((cur) => cur.map((x, k) => (k === i ? e.target.value : x)))}
                    aria-invalid={dupes.has(id) || undefined}
                  >
                    {seeding.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.rank}. {o.name} ({o.record})
                      </option>
                    ))}
                  </select>
                  {differs && <div className="mt-0.5 truncate text-[12px] text-muted">Standings seed: {byId.get(fromStandings)?.name ?? "—"}</div>}
                </div>
              </li>
            );
          })}
        </ol>
        {dupes.size > 0 && <p className="mt-3 text-sm font-semibold text-loss">A team can only hold one seed.</p>}
      </Modal>
    </div>
  );
}
