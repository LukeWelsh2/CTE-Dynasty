// Weekly recap email: responsive, inline-styled, table-based HTML (works in Gmail / Outlook / Apple Mail)
// plus a plain-text alternative. Wrapped in the branded emailLayout(). Every interpolated string is escaped
// and team colors are validated before they reach a style attribute.
import { emailLayout } from "@/lib/email";
import { fmtNum, ordinalWord, previewGameNote, recapGameLine } from "./compute";
import type { RecapContent, RecapMatchup, RecapSide, RecapTeam } from "./types";

export interface RecapEmail {
  subject: string;
  html: string;
  text: string;
}

export interface RenderOptions {
  /** personalize for a manager: adds a "Your week" box for this team */
  teamId?: string | null;
  appUrl?: string;
}

const NAVY = "#0b1f3a";
const GOLD = "#f5b301";
const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#dbe1ea";
const SUNKEN = "#f6f8fb";
const WIN = "#16a34a";
const LOSS = "#dc2626";
const BRAND = "#1d4ed8";

export function escapeHtml(s: string | number | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only #rgb / #rrggbb colors reach inline styles. */
export function safeColor(c: string | null | undefined, fallback = BRAND): string {
  return c && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()) ? c.trim() : fallback;
}

function appBase(opts: RenderOptions): string {
  return (opts.appUrl ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const optPct = (p: number | null) => (p === null ? "—" : pct(p));
const signedPct = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(Math.round(d * 100))}`;

function teamOf(c: RecapContent, id: string | null | undefined): RecapTeam {
  return (id && c.teams[id]) || { id: id ?? "", name: "Unknown team", abbrev: "?", logoUrl: null, primaryColor: BRAND, secondaryColor: GOLD, owner: null, record: null, rank: null };
}

function section(title: string, inner: string): string {
  return `<tr><td style="padding:22px 0 0 0">
<div style="font-size:12px;letter-spacing:1.5px;font-weight:700;color:${MUTED};text-transform:uppercase;border-bottom:2px solid ${GOLD};padding-bottom:6px;margin-bottom:10px">${escapeHtml(title)}</div>
${inner}
</td></tr>`;
}

function button(href: string, label: string, primary = true): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${primary ? BRAND : "#ffffff"};color:${primary ? "#ffffff" : BRAND};border:1px solid ${BRAND};padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:0 8px 8px 0">${escapeHtml(label)}</a>`;
}

function swatch(t: RecapTeam, size = 12): string {
  return `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:3px;background:${safeColor(t.primaryColor)};vertical-align:middle;margin-right:6px"></span>`;
}

function teamCell(c: RecapContent, side: RecapSide, bold: boolean): string {
  const t = teamOf(c, side.teamId);
  return `<td style="padding:6px 8px;border-left:4px solid ${safeColor(t.primaryColor)};font-size:14px;${bold ? "font-weight:700;" : ""}color:${INK}">${escapeHtml(t.name)}${
    t.record ? ` <span style="color:${MUTED};font-weight:400;font-size:12px">(${escapeHtml(t.record)})</span>` : ""
  }</td>
<td align="right" style="padding:6px 8px;font-size:15px;font-variant-numeric:tabular-nums;${bold ? `font-weight:700;color:${INK}` : `color:${MUTED}`}">${fmtNum(side.score, c.decimals)}</td>`;
}

/** A multi-week playoff game's standing after this week (empty for single-week games). */
export function gameLineFor(c: RecapContent, m: RecapMatchup): string {
  if (!m.game) return "";
  return recapGameLine(m.game, { id: m.home.teamId, name: teamOf(c, m.home.teamId).name }, { id: m.away.teamId, name: teamOf(c, m.away.teamId).name }, c.decimals);
}

function matchupTable(c: RecapContent, m: RecapMatchup): string {
  const homeWon = m.winnerTeamId === m.home.teamId;
  const awayWon = m.winnerTeamId === m.away.teamId;
  const label = m.rivalry ?? m.label;
  const game = gameLineFor(c, m);
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:8px;margin-bottom:10px;border-collapse:separate;overflow:hidden">
${label ? `<tr><td colspan="2" style="background:${SUNKEN};padding:4px 8px;font-size:11px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:1px">${escapeHtml(label)}</td></tr>` : ""}
<tr>${teamCell(c, m.away, awayWon)}</tr>
<tr>${teamCell(c, m.home, homeWon)}</tr>
${game ? `<tr><td colspan="2" style="padding:5px 8px;font-size:12px;font-weight:700;color:${INK};background:#fff7e0;border-top:1px solid ${LINE}">${m.game!.decided ? "" : `Week ${m.game!.leg} of ${m.game!.legs} · `}${escapeHtml(game)}</td></tr>` : ""}
<tr><td colspan="2" style="padding:6px 8px 8px 8px;font-size:13px;line-height:1.45;color:#334155;border-top:1px solid ${LINE}">${escapeHtml(m.blurb)}</td></tr>
</table>`;
}

function probBar(c: RecapContent, awayId: string, awayProb: number | null, homeId: string): string {
  if (awayProb === null) return `<div style="font-size:12px;color:${MUTED}">Win probabilities appear once projections are posted.</div>`;
  const a = Math.max(3, Math.min(97, Math.round(awayProb * 100)));
  return `<table width="100%" cellpadding="0" cellspacing="0" style="height:8px;border-radius:4px;overflow:hidden;border-collapse:collapse"><tr>
<td width="${a}%" style="background:${safeColor(teamOf(c, awayId).primaryColor)};height:8px;font-size:0;line-height:0">&nbsp;</td>
<td width="${100 - a}%" style="background:${safeColor(teamOf(c, homeId).primaryColor, GOLD)};height:8px;font-size:0;line-height:0">&nbsp;</td>
</tr></table>`;
}

function smallTable(headers: { label: string; align?: "left" | "right" | "center" }[], rows: string[][]): string {
  const th = headers
    .map((h) => `<th align="${h.align ?? "left"}" style="padding:6px 8px;background:${SUNKEN};font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};border-bottom:1px solid ${LINE}">${escapeHtml(h.label)}</th>`)
    .join("");
  const tr = rows
    .map(
      (r) =>
        `<tr>${r
          .map((cell, i) => `<td align="${headers[i]?.align ?? "left"}" style="padding:6px 8px;font-size:13px;color:${INK};border-bottom:1px solid #eef1f6;font-variant-numeric:tabular-nums">${cell}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:8px;border-collapse:separate;overflow:hidden"><tr>${th}</tr>${tr}</table>`;
}

function yourWeek(c: RecapContent, teamId: string): string {
  const t = c.teams[teamId];
  if (!t) return "";
  const m = c.matchups.find((x) => x.home.teamId === teamId || x.away.teamId === teamId);
  const st = c.standings.find((s) => s.teamId === teamId);
  const eff = c.efficiency.find((e) => e.teamId === teamId);
  const award = c.awards.filter((a) => a.teamId === teamId);
  const lines: string[] = [];
  if (m) {
    const me = m.home.teamId === teamId ? m.home : m.away;
    const opp = m.home.teamId === teamId ? m.away : m.home;
    const g = m.game ?? null;
    if (g) {
      // a week of a multi-week playoff game: the game's standing on its combined score
      const mine = m.home.teamId === teamId ? g.homeTotal : g.awayTotal;
      const theirs = m.home.teamId === teamId ? g.awayTotal : g.homeTotal;
      const res = g.decided ? (g.winnerTeamId === teamId ? "Beat" : "Lost to") : mine > theirs ? "Leading" : mine < theirs ? "Trailing" : "Level with";
      const color = g.decided ? (g.winnerTeamId === teamId ? WIN : LOSS) : INK;
      lines.push(
        `<b style="color:${color}">${res}</b> ${escapeHtml(teamOf(c, opp.teamId).name)} ${fmtNum(mine, c.decimals)}–${fmtNum(theirs, c.decimals)} ${g.decided ? `over ${g.legs} weeks` : `after week ${g.leg} of ${g.legs}`} (this week ${fmtNum(me.score, c.decimals)}–${fmtNum(opp.score, c.decimals)})`,
      );
    } else {
      const res = m.winnerTeamId === null ? "Tied" : m.winnerTeamId === teamId ? "Beat" : "Lost to";
      lines.push(
        `<b style="color:${m.winnerTeamId === teamId ? WIN : m.winnerTeamId === null ? INK : LOSS}">${res}</b> ${escapeHtml(teamOf(c, opp.teamId).name)} ${fmtNum(me.score, c.decimals)}–${fmtNum(opp.score, c.decimals)}`,
      );
    }
    if (me.top) lines.push(`Top performer: ${escapeHtml(me.top.name)} (${fmtNum(me.top.points, c.decimals)})`);
  }
  if (eff) lines.push(`Lineup efficiency ${pct(eff.efficiency)} · ${fmtNum(eff.pointsLeft, c.decimals)} pts left on the bench`);
  if (st) {
    const mv = st.change > 0 ? ` (up ${st.change})` : st.change < 0 ? ` (down ${-st.change})` : "";
    lines.push(`Now ${ordinalWord(st.rank)} in the standings${mv}`);
  }
  if (award.length) lines.push(`Awards: ${award.map((a) => escapeHtml(a.title)).join(", ")}`);
  if (!lines.length) return "";
  return `<tr><td style="padding:16px 0 0 0"><table width="100%" cellpadding="0" cellspacing="0" style="background:${SUNKEN};border:1px solid ${LINE};border-left:4px solid ${safeColor(t.primaryColor)};border-radius:8px">
<tr><td style="padding:12px 14px">
<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:${MUTED};text-transform:uppercase">Your week · ${escapeHtml(t.name)}</div>
<div style="font-size:14px;line-height:1.6;color:${INK};margin-top:4px">${lines.join("<br/>")}</div>
</td></tr></table></td></tr>`;
}

/** Render the recap email (HTML + plain text). Personalize with opts.teamId. */
export function renderRecapEmail(content: RecapContent, leagueName: string, opts: RenderOptions = {}): RecapEmail {
  const c = content;
  const base = appBase(opts);
  const recapUrl = `${base}/recaps/${c.week}${c.season ? `?season=${c.season}` : ""}`;
  const scoringUrl = `${base}/scoring?week=${c.week}`;
  const n = (x: number) => fmtNum(x, c.decimals);
  const parts: string[] = [];

  parts.push(`<tr><td>
<div style="font-size:12px;font-weight:700;letter-spacing:1.5px;color:${MUTED};text-transform:uppercase">${escapeHtml(leagueName)} · ${escapeHtml(c.weekLabel)} · ${c.season}</div>
<div style="font-size:24px;line-height:1.25;font-weight:800;color:${INK};margin:6px 0 10px 0">${escapeHtml(c.headline)}</div>
<div style="font-size:15px;line-height:1.6;color:#334155">${escapeHtml(c.intro)}</div>
${c.specialNote ? `<div style="margin-top:10px;padding:8px 10px;background:#fff7e0;border:1px solid #f5d77a;border-radius:6px;font-size:13px;color:#7a5600">${escapeHtml(c.specialNote)}</div>` : ""}
<div style="margin-top:14px">${button(recapUrl, "Read the full recap")}${button(scoringUrl, "Box scores", false)}</div>
</td></tr>`);

  if (opts.teamId) parts.push(yourWeek(c, opts.teamId));

  // at a glance
  parts.push(
    section(
      "Week at a glance",
      `<table width="100%" cellpadding="0" cellspacing="0"><tr>${[
        ["High", n(c.stats.highScore)],
        ["Low", n(c.stats.lowScore)],
        ["Average", n(c.stats.average)],
        ["Efficiency", pct(c.stats.averageEfficiency)],
      ]
        .map(
          ([k, v]) =>
            `<td width="25%" align="center" style="padding:8px 4px;border:1px solid ${LINE};background:${SUNKEN}"><div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px">${k}</div><div style="font-size:18px;font-weight:700;color:${INK};font-variant-numeric:tabular-nums">${v}</div></td>`,
        )
        .join("")}</tr></table>`,
    ),
  );

  // matchup of the week
  const motw = c.matchupOfWeek ? c.matchups.find((m) => m.id === c.matchupOfWeek!.matchupId) : null;
  if (motw && c.matchupOfWeek) {
    parts.push(
      section(
        "Matchup of the Week",
        `<div style="display:inline-block;background:${GOLD};color:${NAVY};font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;padding:3px 8px;border-radius:4px;margin-bottom:8px">${escapeHtml(c.matchupOfWeek.reasonLabel)}</div>
${matchupTable(c, { ...motw, blurb: c.matchupOfWeek.summary })}`,
      ),
    );
  }

  // awards
  if (c.awards.length) {
    const cards = c.awards
      .map((a) => {
        const t = teamOf(c, a.teamId);
        return `<tr><td style="padding:0 0 8px 0"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-left:4px solid ${safeColor(t.primaryColor)};border-radius:8px">
<tr><td style="padding:10px 12px">
<div style="font-size:11px;font-weight:800;letter-spacing:1.2px;color:#b07d00;text-transform:uppercase">${escapeHtml(a.title)}</div>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:15px;font-weight:700;color:${INK};padding-top:2px">${escapeHtml(t.name)}</td><td align="right" style="font-size:17px;font-weight:800;color:${NAVY};white-space:nowrap">${escapeHtml(a.value)}</td></tr></table>
<div style="font-size:13px;line-height:1.45;color:#475569;margin-top:2px">${escapeHtml(a.detail)}</div>
</td></tr></table></td></tr>`;
      })
      .join("");
    parts.push(section("Weekly awards", `<table width="100%" cellpadding="0" cellspacing="0">${cards}</table>`));
  }

  // scoreboard
  if (c.matchups.length) parts.push(section("Final scores", c.matchups.map((m) => matchupTable(c, m)).join("")));

  // efficiency
  if (c.efficiency.length) {
    parts.push(
      section(
        "Lineup efficiency",
        smallTable(
          [{ label: "#" }, { label: "Team" }, { label: "Actual", align: "right" }, { label: "Optimal", align: "right" }, { label: "Eff.", align: "right" }],
          c.efficiency.map((e, i) => {
            const t = teamOf(c, e.teamId);
            return [String(i + 1), `${swatch(t, 10)}${escapeHtml(t.name)}`, n(e.starterPoints), n(e.optimalPoints), `<b>${pct(e.efficiency)}</b>`];
          }),
        ) + `<div style="font-size:12px;color:${MUTED};margin-top:6px">Optimal = best possible lineup in hindsight using actual points from players on the roster.</div>`,
      ),
    );
  }

  // top performers
  if (c.topPerformers.length) {
    parts.push(
      section(
        "Top NFL performers",
        smallTable(
          [{ label: "Player" }, { label: "Fantasy owner" }, { label: "Pts", align: "right" }],
          c.topPerformers.map((p) => {
            const owner = p.ownerTeamId ? teamOf(c, p.ownerTeamId) : null;
            return [
              `<b>${escapeHtml(p.name)}</b> <span style="color:${MUTED};font-size:12px">${escapeHtml(p.position)}${p.nflTeam ? " · " + escapeHtml(p.nflTeam) : ""}</span>${
                p.statLine ? `<br/><span style="color:${MUTED};font-size:12px">${escapeHtml(p.statLine)}</span>` : ""
              }`,
              owner ? `${escapeHtml(owner.name)}${p.started ? "" : ` <span style="color:${LOSS};font-size:12px">(benched)</span>`}` : `<span style="color:${MUTED}">Free agent</span>`,
              `<b>${n(p.points)}</b>`,
            ];
          }),
        ),
      ),
    );
  }

  // standings movement
  if (c.standings.length) {
    parts.push(
      section(
        "Standings",
        smallTable(
          [{ label: "#" }, { label: "", align: "center" }, { label: "Team" }, { label: "Record", align: "right" }, { label: "PF", align: "right" }],
          c.standings.map((s) => {
            const t = teamOf(c, s.teamId);
            const mv = s.change > 0 ? `<span style="color:${WIN}">&#9650;${s.change}</span>` : s.change < 0 ? `<span style="color:${LOSS}">&#9660;${-s.change}</span>` : `<span style="color:${MUTED}">–</span>`;
            const rec = s.ties ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`;
            const taco = c.lastPlace?.teamId === s.teamId ? ` <span style="color:${MUTED};font-size:12px">(${escapeHtml(c.lastPlace.trophy)})</span>` : "";
            return [String(s.rank), mv, `${swatch(t, 10)}${escapeHtml(t.name)}${taco}`, rec, n(s.pointsFor)];
          }),
        ),
      ),
    );
  }

  // playoff odds
  if (c.playoffOdds && c.playoffOdds.rows.length) {
    const movers = [...c.playoffOdds.rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6);
    parts.push(
      section(
        "Playoff odds movers",
        smallTable(
          [{ label: "Team" }, { label: "Before", align: "right" }, { label: "Now", align: "right" }, { label: "Change", align: "right" }],
          movers.map((r) => {
            const t = teamOf(c, r.teamId);
            const color = r.delta > 0.005 ? WIN : r.delta < -0.005 ? LOSS : MUTED;
            return [`${swatch(t, 10)}${escapeHtml(t.name)}`, pct(r.before), `<b>${pct(r.after)}</b>`, `<span style="color:${color};font-weight:700">${signedPct(r.delta)}</span>`];
          }),
        ),
      ),
    );
  }

  // transactions
  const tx = c.transactions;
  if (tx.trades.length || tx.moves.length) {
    const trades = tx.trades
      .map(
        (tr) =>
          `<div style="border:1px solid ${LINE};border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:13px;line-height:1.5;color:${INK}">${
            tr.status === "REVERSED" ? `<div style="font-size:11px;font-weight:700;color:${LOSS};text-transform:uppercase">Reversed by the commissioner</div>` : ""
          }${tr.sides.map((s) => `<div>${swatch(teamOf(c, s.teamId), 10)}<b>${escapeHtml(teamOf(c, s.teamId).name)}</b> receives ${escapeHtml(s.received.join(", ") || "nothing")}</div>`).join("")}</div>`,
      )
      .join("");
    const counts =
      tx.adds || tx.drops
        ? `${tx.adds} add${tx.adds === 1 ? "" : "s"}, ${tx.drops} drop${tx.drops === 1 ? "" : "s"}${tx.faabSpent ? `, $${tx.faabSpent} FAB spent` : ""}`
        : "No adds or drops";
    const summary = `<div style="font-size:13px;color:#334155;line-height:1.5">${counts}${
      tx.biggestFaab ? `. Biggest splash: ${escapeHtml(teamOf(c, tx.biggestFaab.teamId).name)} paid $${tx.biggestFaab.amount} for ${escapeHtml(tx.biggestFaab.player?.name ?? "a player")}` : ""
    }${tx.mostActiveTeamId ? `. Most active: ${escapeHtml(teamOf(c, tx.mostActiveTeamId).name)}` : ""}.</div>`;
    parts.push(section("Trades & transactions", trades + summary));
  }

  // next week
  if (c.nextWeek && (c.nextWeek.matchups.length || c.nextWeek.marquee.length)) {
    const nw = c.nextWeek;
    const proj = (x: number) => (x > 0 ? n(x) : "—");
    const games = nw.matchups
      .map((m) => {
        const a = teamOf(c, m.away.teamId);
        const h = teamOf(c, m.home.teamId);
        const lead = previewGameNote(c, m);
        return `<div style="border:1px solid ${LINE};border-radius:8px;padding:8px 10px;margin-bottom:8px">
${lead ? `<div style="font-size:12px;font-weight:700;color:${INK};margin-bottom:4px">${escapeHtml(lead)}</div>` : ""}
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:13px;font-weight:700;color:${INK}">${escapeHtml(a.name)}</td>
<td align="right" style="font-size:13px;color:${MUTED};white-space:nowrap">${proj(m.away.projected)} proj · <b style="color:${INK}">${optPct(m.away.winProb)}</b></td></tr>
<tr><td style="font-size:13px;font-weight:700;color:${INK}">${escapeHtml(h.name)}</td>
<td align="right" style="font-size:13px;color:${MUTED};white-space:nowrap">${proj(m.home.projected)} proj · <b style="color:${INK}">${optPct(m.home.winProb)}</b></td></tr></table>
<div style="margin-top:6px">${probBar(c, m.away.teamId, m.away.winProb, m.home.teamId)}</div></div>`;
      })
      .join("");
    const marquee = nw.marquee.length
      ? `<div style="font-size:12px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:1px;margin:10px 0 6px 0">NFL games to watch</div>` +
        smallTable(
          [{ label: "Game" }, { label: "Line", align: "right" }, { label: "O/U", align: "right" }, { label: "Starters", align: "right" }],
          nw.marquee.map((g) => [`<b>${escapeHtml(g.away)} @ ${escapeHtml(g.home)}</b>`, escapeHtml(g.oddsDetails ?? (g.spread !== null ? String(g.spread) : "—")), g.overUnder !== null ? String(g.overUnder) : "—", String(g.starters)]),
        )
      : "";
    const note = nw.historical
      ? `<div style="font-size:12px;color:${MUTED};margin:0 0 8px 0">Pre-game projections: this recap was written after Week ${nw.week} kicked off.</div>`
      : "";
    parts.push(section(`Week ${nw.week} preview`, note + games + marquee));
  }

  // injuries
  if (c.injuries.length) {
    parts.push(
      section(
        "Injuries to watch",
        smallTable(
          [{ label: "Player" }, { label: "Team" }, { label: "Status", align: "right" }],
          c.injuries.slice(0, 12).map((r) => [
            `<b>${escapeHtml(r.player.name)}</b> <span style="color:${MUTED};font-size:12px">${escapeHtml(r.player.position)}${r.player.nflTeam ? " · " + escapeHtml(r.player.nflTeam) : ""}${r.bodyPart ? " · " + escapeHtml(r.bodyPart) : ""}</span>`,
            escapeHtml(teamOf(c, r.teamId).name),
            `<b style="color:${/^q/i.test(r.status) ? "#b45309" : LOSS}">${escapeHtml(r.status)}</b>`,
          ]),
        ),
      ),
    );
  }

  parts.push(`<tr><td style="padding:22px 0 0 0" align="center">${button(recapUrl, `Open the ${c.weekLabel} recap`)}</td></tr>`);

  const body = `<table width="100%" cellpadding="0" cellspacing="0" style="font-family:Segoe UI,Helvetica,Arial,sans-serif">${parts.join("\n")}</table>`;
  const title = `${escapeHtml(c.weekLabel)} Recap`;
  const html = emailLayout(
    title,
    body,
    `You are receiving this because you manage a team in ${escapeHtml(leagueName)}. Turn weekly recap emails off in your notification settings: <a href="${escapeHtml(`${base}/settings/notifications`)}" style="color:${BRAND}">${escapeHtml(`${base}/settings/notifications`)}</a>.`,
  );
  return { subject: `${leagueName} ${c.weekLabel} Recap: ${c.headline}`, html, text: renderRecapText(c, leagueName, { ...opts, appUrl: base }) };
}

/** Plain-text alternative of the recap email. */
export function renderRecapText(c: RecapContent, leagueName: string, opts: RenderOptions = {}): string {
  const base = appBase(opts);
  const n = (x: number) => fmtNum(x, c.decimals);
  const name = (id: string | null | undefined) => teamOf(c, id).name;
  const out: string[] = [];
  out.push(`${leagueName} · ${c.weekLabel} Recap (${c.season})`, "", c.headline.toUpperCase(), "", c.intro);
  if (c.specialNote) out.push("", c.specialNote);
  if (opts.teamId && c.teams[opts.teamId]) {
    const m = c.matchups.find((x) => x.home.teamId === opts.teamId || x.away.teamId === opts.teamId);
    if (m) {
      const me = m.home.teamId === opts.teamId ? m.home : m.away;
      const opp = m.home.teamId === opts.teamId ? m.away : m.home;
      const g = m.game ?? null;
      if (g) {
        const mine = m.home.teamId === opts.teamId ? g.homeTotal : g.awayTotal;
        const theirs = m.home.teamId === opts.teamId ? g.awayTotal : g.homeTotal;
        const res = g.decided ? (g.winnerTeamId === opts.teamId ? "Beat" : "Lost to") : mine > theirs ? "Leading" : mine < theirs ? "Trailing" : "Level with";
        out.push("", `YOUR WEEK: ${res} ${name(opp.teamId)} ${n(mine)}-${n(theirs)} ${g.decided ? `over ${g.legs} weeks` : `after week ${g.leg} of ${g.legs}`} (this week ${n(me.score)}-${n(opp.score)}) · efficiency ${pct(me.efficiency)}`);
      } else out.push("", `YOUR WEEK: ${m.winnerTeamId === null ? "Tied" : m.winnerTeamId === opts.teamId ? "Beat" : "Lost to"} ${name(opp.teamId)} ${n(me.score)}-${n(opp.score)} · efficiency ${pct(me.efficiency)}`);
    }
  }
  if (c.matchupOfWeek) {
    out.push("", `MATCHUP OF THE WEEK (${c.matchupOfWeek.reasonLabel})`, c.matchupOfWeek.summary);
  }
  if (c.awards.length) {
    out.push("", "AWARDS");
    for (const a of c.awards) out.push(`- ${a.title}: ${name(a.teamId)} (${a.value}). ${a.detail}`);
  }
  if (c.matchups.length) {
    out.push("", "FINAL SCORES");
    for (const m of c.matchups) {
      const game = gameLineFor(c, m);
      out.push(`- ${name(m.away.teamId)} ${n(m.away.score)} @ ${name(m.home.teamId)} ${n(m.home.score)}${game ? ` (${game})` : ""}. ${m.blurb}`);
    }
  }
  if (c.efficiency.length) {
    out.push("", "LINEUP EFFICIENCY");
    c.efficiency.forEach((e, i) => out.push(`${i + 1}. ${name(e.teamId)} ${pct(e.efficiency)} (${n(e.starterPoints)} of ${n(e.optimalPoints)})`));
  }
  if (c.topPerformers.length) {
    out.push("", "TOP NFL PERFORMERS");
    for (const p of c.topPerformers) out.push(`- ${p.name} (${p.position}${p.nflTeam ? " " + p.nflTeam : ""}) ${n(p.points)} — ${p.ownerTeamId ? name(p.ownerTeamId) + (p.started ? "" : " (benched)") : "free agent"}`);
  }
  if (c.standings.length) {
    out.push("", "STANDINGS");
    for (const s of c.standings) out.push(`${s.rank}. ${name(s.teamId)} ${s.ties ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`}${s.change ? ` (${s.change > 0 ? "up" : "down"} ${Math.abs(s.change)})` : ""}`);
  }
  if (c.playoffOdds?.rows.length) {
    out.push("", "PLAYOFF ODDS");
    for (const r of [...c.playoffOdds.rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6)) out.push(`- ${name(r.teamId)} ${pct(r.before)} -> ${pct(r.after)}`);
  }
  if (c.transactions.trades.length) {
    out.push("", "TRADES");
    for (const t of c.transactions.trades) out.push(`- ${t.status === "REVERSED" ? "[reversed] " : ""}${t.sides.map((s) => `${name(s.teamId)} receives ${s.received.join(", ") || "nothing"}`).join("; ")}`);
  }
  if (c.nextWeek?.matchups.length) {
    out.push("", `WEEK ${c.nextWeek.week} PREVIEW`);
    const side = (s: { projected: number; winProb: number | null }) => (s.projected > 0 ? `${n(s.projected)}${s.winProb === null ? "" : `, ${pct(s.winProb)}`}` : "no projection yet");
    for (const m of c.nextWeek.matchups) {
      const note = previewGameNote(c, m);
      out.push(`- ${name(m.away.teamId)} (${side(m.away)}) @ ${name(m.home.teamId)} (${side(m.home)})${note ? ` [${note}]` : ""}`);
    }
  }
  if (c.injuries.length) {
    out.push("", "INJURIES TO WATCH");
    for (const r of c.injuries.slice(0, 12)) out.push(`- ${r.player.name} (${r.player.position}) ${r.status} — ${name(r.teamId)}`);
  }
  out.push("", `Full recap: ${base}/recaps/${c.week}?season=${c.season}`, `Box scores: ${base}/scoring?week=${c.week}`);
  return out.join("\n");
}
