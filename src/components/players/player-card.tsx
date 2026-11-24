"use client";
// Player quick card: opens from a headshot (or any child) anywhere in the app and loads
// /api/players/[id]/card. Bottom sheet on phones, centered dialog on desktop.
import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/client";
import { Alert, Badge, InjuryTag, NflLogo, PlayerHeadshot, PosBadge, buttonClass } from "@/components/ui/core";
import { PlayerActionButton, WatchStar } from "@/components/players/player-actions";
import { CategoryBadge, GameCell, OwnerTag } from "@/components/players/tags";
import type { CardData } from "@/lib/players/profile";
import { fmtCalendarDate, sourceLabel } from "@/lib/players/format";
import { cn, fmtPts, heightDisplay, ordinal, timeAgo } from "@/lib/utils";

/** Wrap a headshot (or anything) to open the player's quick card */
export function PlayerCardButton({ playerId, playerName, children, className }: { playerId: string; playerName: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500", className)} aria-label={`Open player card for ${playerName}`}>
        {children}
      </button>
      {open && <PlayerCardModal playerId={playerId} onClose={() => setOpen(false)} />}
    </>
  );
}

export function PlayerCardModal({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const [data, setData] = useState<CardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/players/${encodeURIComponent(playerId)}/card`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Could not load player");
        if (alive) setData(j as CardData);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [playerId]);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={data ? "Player card" : "Loading…"}
      footer={
        <>
          <button type="button" onClick={onClose} className={buttonClass("secondary")}>
            Close
          </button>
          <Link href={`/players/${playerId}`} className={buttonClass("primary")} onClick={onClose}>
            Full profile <ExternalLink size={13} />
          </Link>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      {!data && !error && (
        <div className="flex items-center justify-center py-16 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      )}
      {data && <CardBody d={data} onDone={onClose} />}
    </Modal>
  );
}

function CardBody({ d, onDone }: { d: CardData; onDone: () => void }) {
  const p = d.player;
  const f = d.fantasy;
  const tw = f.thisWeek;
  const bio = [
    p.age ? `Age ${p.age}` : null,
    p.height || p.weight ? `${heightDisplay(p.height)}${p.weight ? ` · ${p.weight} lbs` : ""}` : null,
    p.college,
    p.yearsExp === 0 ? "Rookie" : p.yearsExp ? `${ordinal(p.yearsExp + 1)} season` : null,
  ].filter(Boolean);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex gap-3">
        <PlayerHeadshot player={p} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="font-display text-xl font-extrabold leading-tight">{p.fullName}</h3>
            <InjuryTag status={d.injury.status} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <PosBadge pos={p.position} />
            {p.number !== null && <span>#{p.number}</span>}
            {p.team && <NflLogo abbr={p.team} size={16} />}
            <span>{p.teamName}</span>
            {p.depthChartPosition && p.depthChartOrder && <span>· Depth {p.depthChartPosition}{p.depthChartOrder}</span>}
          </div>
          <div className="mt-0.5 text-xs text-muted">{bio.join(" · ")}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PlayerActionButton
              playerId={p.id}
              playerName={p.fullName}
              action={f.action}
              blockedReason={f.blockedReason}
              pendingClaim={f.pendingClaim}
              ownerTeamId={f.owner?.teamId}
              size="sm"
              onDone={onDone}
            />
            <WatchStar playerId={p.id} watched={f.watched} playerName={p.fullName} className="rounded-md border border-line p-1.5" />
          </div>
        </div>
      </div>

      <div className="rounded-md border border-line bg-sunken/60 px-3 py-2">
        {f.owner ? (
          <div className="flex flex-wrap items-center gap-2">
            <OwnerTag owner={f.owner} full />
            <span className="text-xs text-muted">
              ${f.owner.salary} · {f.owner.contractYears} yr{f.owner.contractYears === 1 ? "" : "s"} (thru {f.owner.thru}){f.owner.status !== "ACTIVE" && ` · ${f.owner.status}`}
            </span>
          </div>
        ) : f.waiver ? (
          <div className="text-xs">
            <Badge tone="amber">On waivers</Badge> <span className="text-muted">{f.waiver.processAtLabel ? `Claims process ${f.waiver.processAtLabel}` : f.waiver.reason}</span>
          </div>
        ) : (
          <div className="text-xs">
            <Badge tone="green">Free agent</Badge> <span className="text-muted">Available to add now</span>
          </div>
        )}
        {d.injury.status && (
          <div className="mt-1.5 text-xs">
            <span className="font-semibold text-loss">{d.injury.status}</span>
            {d.injury.bodyPart && <span className="text-muted"> · {d.injury.bodyPart}</span>}
            {d.injury.returnDate && <span className="text-muted"> · est. return {fmtCalendarDate(d.injury.returnDate)}</span>}
            {d.injury.note && <p className="mt-0.5 text-muted">{d.injury.note}</p>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label={`Week ${tw.week}`} value={tw.bye ? "BYE" : <GameCell game={tw.game} kickoffLabel={tw.game?.kickoffLabel} />} />
        <Tile label="Proj / Actual" value={`${fmtPts(tw.proj, 1)} / ${tw.pts === null ? "—" : fmtPts(tw.pts, 1)}`} />
        <Tile label="Season pts" value={fmtPts(f.seasonPts, 1)} sub={f.posRank ? `#${f.posRank.rank} ${f.posRank.pos}` : undefined} />
        <Tile label="Avg / last 3" value={`${fmtPts(f.avg, 1)} / ${fmtPts(f.last3, 1)}`} sub={`${f.games} games`} />
      </div>
      {tw.game && (tw.game.spread || tw.game.overUnder) && (
        <p className="-mt-2 text-[11px] text-muted">
          Line: {tw.game.spread ? `${p.team} ${tw.game.spread}` : ""}
          {tw.game.overUnder ? ` · O/U ${tw.game.overUnder}` : ""}
          {tw.game.broadcast ? ` · ${tw.game.broadcast}` : ""}
        </p>
      )}

      <section>
        <h4 className="label">Season stats</h4>
        <div className="flex flex-wrap gap-1.5">
          {d.seasonLine.map((s) => (
            <span key={s.key} className="rounded border border-line px-2 py-1 text-xs" title={s.label}>
              <span className="text-muted">{s.short}</span> <b className="tabular-nums">{s.value}</b>
            </span>
          ))}
        </div>
      </section>

      <section>
        <h4 className="label">Last 5 games</h4>
        {d.last5.length ? (
          <table className="tbl tbl-compact text-xs">
            <thead>
              <tr>
                <th>Wk</th>
                <th>Opp</th>
                <th>Result</th>
                <th>Stats</th>
                <th className="num">FPTS</th>
              </tr>
            </thead>
            <tbody>
              {d.last5.map((g) => (
                <tr key={g.week}>
                  <td>{g.week}</td>
                  <td className="whitespace-nowrap">{g.opp}</td>
                  <td className={cn("whitespace-nowrap", g.result?.startsWith("W") ? "text-win" : g.result?.startsWith("L") ? "text-loss" : "")}>{g.result ?? "—"}</td>
                  <td className="text-muted">{g.line || "—"}</td>
                  <td className="num font-semibold">{fmtPts(g.pts, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-muted">No games played this season.</p>
        )}
      </section>

      <section>
        <h4 className="label">Latest news</h4>
        {d.news.length ? (
          <ul className="space-y-2">
            {d.news.map((n) => (
              <li key={n.id} className="rounded-md border border-line p-2">
                <div className="flex items-center gap-1.5 text-[11px] text-muted">
                  <CategoryBadge category={n.category} /> {timeAgo(n.publishedAt)} · {sourceLabel(n.source)}
                </div>
                <p className="mt-0.5 font-semibold leading-snug">{n.headline}</p>
                {(n.analysis || n.summary) && <p className="mt-0.5 line-clamp-3 text-xs text-muted">{n.analysis ?? n.summary}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">No recent news for this player.</p>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-md border border-line px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 font-display text-base font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
