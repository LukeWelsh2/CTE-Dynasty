// Human-readable descriptions of the job registry's croner patterns (times are America/New_York).

function at(h: number, m: number) {
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} ET`;
}

export function describeCron(pattern: string): string {
  const parts = pattern.trim().split(/\s+/);
  if (parts.length === 6) {
    const [sec, ...rest] = parts;
    if (rest.every((p) => p === "*")) {
      const m = /^\*\/(\d+)$/.exec(sec);
      if (m) return `Every ${m[1]} seconds`;
    }
    return pattern;
  }
  if (parts.length !== 5) return pattern;
  const [min, hour, dom, mon, dow] = parts;
  const anyDay = dom === "*" && mon === "*" && dow === "*";
  if (!anyDay) return pattern;
  const everyMin = /^\*\/(\d+)$/.exec(min);
  if (everyMin && hour === "*") return `Every ${everyMin[1]} minutes`;
  if (min === "*" && hour === "*") return "Every minute";
  if (/^\d+$/.test(min) && hour === "*") return Number(min) === 0 ? "Hourly" : `Hourly at :${min.padStart(2, "0")}`;
  const everyHour = /^\*\/(\d+)$/.exec(hour);
  if (/^\d+$/.test(min) && everyHour) return `Every ${everyHour[1]} hours at :${min.padStart(2, "0")}`;
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) return `Daily at ${at(Number(hour), Number(min))}`;
  return pattern;
}
