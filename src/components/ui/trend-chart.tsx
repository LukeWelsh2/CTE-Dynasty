"use client";
// TrendChart: the one chart for change over time on detail views (weekly scores, odds history, projections).
// A thin wrapper around recharts with the v3 look: no vertical gridlines, faint horizontal ones, small grey axis
// labels, the highlighted series in the interactive blue, others in greys, a crosshair tooltip on a raised card.
// Re-exported from @/components/ui/client.
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const PALETTE = {
  light: { accent: "#0b5cd5", series: ["#0b5cd5", "#101114", "#8a9099", "#c3c8d0"], grid: "#eceef1", text: "#5c616b", ref: "#c3c8d0", panel: "#ffffff" },
  dark: { accent: "#5b9bf7", series: ["#5b9bf7", "#f2f3f5", "#9ba1aa", "#4a4e56"], grid: "#26282c", text: "#9ba1aa", ref: "#4a4e56", panel: "#161719" },
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

export type TrendSeries = {
  /** key in each data row */
  key: string;
  label: string;
  /** explicit color (team color); defaults to the palette: first series blue, then near-black, greys */
  color?: string;
  /** dashed line (projections, averages) */
  dashed?: boolean;
};

export function TrendChart({
  data,
  x,
  series,
  kind = "line",
  height = 180,
  yFormat = (v) => String(v),
  xFormat = (v) => String(v),
  yDomain,
  referenceY,
  referenceLabel,
  className,
  ariaLabel,
}: {
  data: Record<string, number | string | null>[];
  /** key of the x value in each row (week number, date label) */
  x: string;
  series: TrendSeries[];
  kind?: "line" | "bar";
  height?: number;
  yFormat?: (v: number) => string;
  xFormat?: (v: number | string) => string;
  yDomain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
  /** a horizontal reference line (league average, 50%) */
  referenceY?: number;
  referenceLabel?: string;
  className?: string;
  ariaLabel: string;
}) {
  const dark = useDark();
  const c = dark ? PALETTE.dark : PALETTE.light;
  const colorOf = (s: TrendSeries, i: number) => s.color ?? c.series[i % c.series.length]!;
  const axis = { stroke: c.text, fontSize: 12, tickLine: false, axisLine: false } as const;
  const tooltip = (
    <Tooltip
      cursor={kind === "line" ? { stroke: c.ref, strokeWidth: 1 } : { fill: dark ? "rgba(255,255,255,0.04)" : "rgba(16,17,20,0.04)" }}
      contentStyle={{
        background: c.panel,
        border: "none",
        borderRadius: 10,
        boxShadow: dark ? "0 0 0 1px rgba(255,255,255,0.1), 0 12px 28px -8px rgba(0,0,0,0.8)" : "0 0 0 1px rgba(16,17,20,0.08), 0 12px 28px -8px rgba(16,17,20,0.2)",
        fontSize: 13,
        padding: "8px 10px",
      }}
      labelStyle={{ color: c.text, fontWeight: 600, marginBottom: 2 }}
      itemStyle={{ padding: 0 }}
      labelFormatter={(v) => xFormat(v as number | string)}
      formatter={(v, name) => [yFormat(Number(v)), name]}
    />
  );
  return (
    <div className={className} role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey={x} {...axis} tickFormatter={xFormat} interval="preserveStartEnd" minTickGap={8} />
            <YAxis {...axis} tickFormatter={yFormat} width={44} domain={yDomain} />
            {tooltip}
            {referenceY != null && <ReferenceLine y={referenceY} stroke={c.ref} strokeDasharray="3 3" label={referenceLabel ? { value: referenceLabel, fill: c.text, fontSize: 11, position: "insideTopRight" } : undefined} />}
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={colorOf(s, i)} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            ))}
          </BarChart>
        ) : (
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey={x} {...axis} tickFormatter={xFormat} interval="preserveStartEnd" minTickGap={8} />
            <YAxis {...axis} tickFormatter={yFormat} width={44} domain={yDomain} />
            {tooltip}
            {referenceY != null && <ReferenceLine y={referenceY} stroke={c.ref} strokeDasharray="3 3" label={referenceLabel ? { value: referenceLabel, fill: c.text, fontSize: 11, position: "insideTopRight" } : undefined} />}
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={colorOf(s, i)}
                strokeWidth={i === 0 ? 2.25 : 1.75}
                strokeDasharray={s.dashed ? "4 3" : undefined}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: c.panel }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
