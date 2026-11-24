"use client";
// Commissioner forms: create the rookie draft for a season, create a salary auction.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, StatGrid } from "@/components/ui/core";
import { createAuctionDraftAction, createRookieDraftAction } from "@/lib/draft/actions";

export function CreateRookieDraftForm({ seasons, timezone, defaultStart }: { seasons: number[]; timezone: string; defaultStart: string }) {
  const router = useRouter();
  const [season, setSeason] = useState(seasons[0]);
  const [start, setStart] = useState(defaultStart);
  const [pending, run] = useTransition();
  if (!seasons.length) return <p className="text-[13px] text-muted">Rookie drafts exist for every season with tradable picks.</p>;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const res = await createRookieDraftAction({ season, startTime: start || null });
          if (!res.ok) toast.error(res.error);
          else {
            toast.success(res.message ?? "Created");
            router.refresh();
          }
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="label">Season</span>
          <select className="input" value={season} onChange={(e) => setSeason(Number(e.target.value))}>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Start (optional)</span>
          <input type="datetime-local" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
      </div>
      <p className="text-[13px] text-muted">Numbers every {season} pick from the order above. Times: {timezone.replace("_", " ")}. The order stays editable until the draft starts.</p>
      <Button type="submit" size="md" className="w-full sm:w-auto" disabled={pending}>
        {pending ? "Creating…" : `Create ${season} rookie draft`}
      </Button>
    </form>
  );
}

export function CreateAuctionForm({
  seasons,
  defaultOrder,
  rules,
  note,
  timezone,
  defaultKind,
}: {
  seasons: number[];
  defaultOrder: "RANDOM" | "REVERSE_STANDINGS" | "CUSTOM";
  /** the league's auction settings (settings.draft.auction) as label / value pairs */
  rules: { label: string; value: React.ReactNode; sub?: string }[];
  note?: string;
  timezone: string;
  defaultKind: "STARTUP" | "FREE_AGENT";
}) {
  const router = useRouter();
  const [season, setSeason] = useState(seasons[0]);
  const [kind, setKind] = useState<"STARTUP" | "FREE_AGENT">(defaultKind);
  const [name, setName] = useState(`${seasons[0]} ${defaultKind === "STARTUP" ? "Salary Auction" : "Free Agent Auction"}`);
  const [order, setOrder] = useState(defaultOrder);
  const [start, setStart] = useState("");
  const [pending, run] = useTransition();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const res = await createAuctionDraftAction({ name, kind, season, nominationOrder: order, startTime: start || null });
          if (!res.ok) toast.error(res.error);
          else {
            toast.success(res.message ?? "Created");
            router.refresh();
          }
        });
      }}
    >
      <label className="block">
        <span className="label">Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="label">Type</span>
          <select
            className="input"
            value={kind}
            onChange={(e) => {
              const k = e.target.value as "STARTUP" | "FREE_AGENT";
              setKind(k);
              setName(`${season} ${k === "STARTUP" ? "Salary Auction" : "Free Agent Auction"}`);
            }}
          >
            <option value="FREE_AGENT">Free-agent auction</option>
            <option value="STARTUP">Startup auction</option>
          </select>
        </label>
        <label>
          <span className="label">Season</span>
          <select
            className="input"
            value={season}
            onChange={(e) => {
              const s = Number(e.target.value);
              setSeason(s);
              setName(`${s} ${kind === "STARTUP" ? "Salary Auction" : "Free Agent Auction"}`);
            }}
          >
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Nomination order</span>
          <select className="input" value={order} onChange={(e) => setOrder(e.target.value as typeof order)}>
            <option value="RANDOM">Random</option>
            <option value="REVERSE_STANDINGS">Reverse standings</option>
            <option value="CUSTOM">Custom (set it next)</option>
          </select>
        </label>
        <label>
          <span className="label">Start (optional)</span>
          <input type="datetime-local" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
      </div>
      <div className="rounded-lg bg-sunken px-3 py-3">
        <StatGrid cols={3} items={rules.map((r) => ({ label: r.label, value: r.value, sub: r.sub }))} />
      </div>
      <p className="text-[13px] text-muted">
        {note ? `${note} ` : ""}Change these in League Settings → Draft before the auction starts. Times: {timezone.replace("_", " ")}.
      </p>
      <Button type="submit" size="md" className="w-full sm:w-auto" disabled={pending}>
        {pending ? "Creating…" : "Create auction"}
      </Button>
    </form>
  );
}
