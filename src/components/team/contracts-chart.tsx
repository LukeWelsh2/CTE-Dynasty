"use client";
// Future cap commitments by season: stacked contracts + dead money vs the cap (recharts), theme-aware.
import { useEffect, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtMoney } from "@/lib/utils";

export interface CommitmentPoint {
  season: number;
  contracts: number;
  dead: number;
  cap: number;
}

// validated palettes (light on #fff panel, dark on the dark panel)
// v3 tokens: the one blue (--c-accent), live/loss red, hairline grid, muted axis, panel surface
const PALETTE = {
  light: { contracts: "#0b5cd5", dead: "#d01f2b", grid: "#eceef1", axis: "#5c616b", surface: "#ffffff", ref: "#101114" },
  dark: { contracts: "#5b9bf7", dead: "#f2555a", grid: "#26282c", axis: "#9ba1aa", surface: "#161719", ref: "#f2f3f5" },
};

function useDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export function ContractsChart({ data }: { data: CommitmentPoint[] }) {
  const dark = useDark();
  const c = dark ? PALETTE.dark : PALETTE.light;
  const max = Math.max(...data.map((d) => Math.max(d.cap, d.contracts + d.dead)), 1);
  const step = niceStep(max / 4);
  const top = Math.ceil((max * 1.06) / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const capsVary = new Set(data.map((d) => d.cap)).size > 1;
  const anyDead = data.some((d) => d.dead > 0);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[12px] text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.contracts }} /> Contracts
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.dead }} /> Dead money
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: c.ref }} /> Salary cap
        </span>
      </div>
      <div className="h-48 w-full sm:h-56" role="img" aria-label={`Cap commitments by season: ${data.map((d) => `${d.season} ${fmtMoney(d.contracts + d.dead)} of ${fmtMoney(d.cap)}`).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="season" tickLine={false} axisLine={false} tick={{ fill: c.axis, fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} width={44} tick={{ fill: c.axis, fontSize: 12 }} tickFormatter={(v: number) => `$${v}`} domain={[0, top]} ticks={ticks} />
            <Tooltip
              cursor={{ fill: dark ? "rgb(255 255 255 / 0.05)" : "rgb(15 23 42 / 0.05)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as CommitmentPoint;
                const total = p.contracts + p.dead;
                return (
                  <div className="rounded-xl bg-raised px-3 py-2 text-[13px] text-ink shadow-pop">
                    <div className="mb-1 font-semibold">{label} season</div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted">Contracts</span>
                      <span className="tabular-nums">{fmtMoney(p.contracts)}</span>
                    </div>
                    {p.dead > 0 && (
                      <div className="flex justify-between gap-4">
                        <span className="text-muted">Dead money</span>
                        <span className="tabular-nums">{fmtMoney(p.dead)}</span>
                      </div>
                    )}
                    <div className="mt-1 flex justify-between gap-4 border-t border-line pt-1">
                      <span className="text-muted">Cap space</span>
                      <span className="font-bold tabular-nums">{fmtMoney(p.cap - total)}</span>
                    </div>
                  </div>
                );
              }}
            />
            {!capsVary && <ReferenceLine y={data[0]?.cap ?? 0} stroke={c.ref} strokeDasharray="5 4" strokeWidth={1.5} label={{ value: `Cap ${fmtMoney(data[0]?.cap ?? 0)}`, position: "insideTopRight", fill: c.axis, fontSize: 12 }} />}
            <Bar dataKey="contracts" stackId="cap" fill={c.contracts} stroke={c.surface} strokeWidth={2} radius={anyDead ? [0, 0, 0, 0] : [4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} />
            <Bar dataKey="dead" stackId="cap" fill={c.dead} stroke={c.surface} strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} />
            {capsVary && <Line dataKey="cap" type="stepAfter" stroke={c.ref} strokeDasharray="5 4" strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}
