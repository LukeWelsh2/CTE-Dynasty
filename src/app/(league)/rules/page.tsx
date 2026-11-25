// /rules — League rulebook. Main question: "What are our rules?" Summary: starters · scoring · cap · playoffs.
// Primary: the chapters as collapsed rows (expand in place; a URL hash like /rules#scoring opens its chapter), each
// with plain-language prose (≤70ch), the key tables, and every raw setting one more tap away.
import { ChevronDown, Lightbulb, Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { lastFantasyWeek } from "@/lib/league-week";
import { ButtonLink, Collapsible, ListRow, PageHeader, Panel, PosBadge, SummaryStrip } from "@/components/ui/core";
import { LeagueTabs } from "@/components/community/bits";
import { DetailsHashOpener } from "@/components/community/details-hash";
import { STAT_CATALOG, STAT_GROUPS } from "@/lib/settings/stat-catalog";
import { SECTION_BY_KEY, SECTION_LABELS, formatFieldValue, getAt, type EditableSection, type FormatLookups, type SettingsSection } from "@/lib/commissioner/settings-meta";
import { COMBO_STATS } from "@/lib/commissioner/settings-validate";
import {
  basicsProse,
  capProse,
  contractProse,
  draftProse,
  keeperProse,
  lineupProse,
  matchupProse,
  nicheProse,
  playoffProse,
  rosterProse,
  scoringProse,
  tradeProse,
  waiverProse,
  type RulebookContext,
} from "@/lib/commissioner/rulebook";
import { auditLabel } from "@/lib/commissioner/dashboard";
import { fmtDateTime } from "@/lib/commissioner/time";
import { loadLedger } from "@/lib/commissioner/ledger-data";
import { LedgerTable } from "@/components/commissioner/ledger-table";

export const metadata = { title: "League Rules" };

const sectionNames = (keys: string[]) => keys.map((k) => (SECTION_LABELS[k as SettingsSection] ?? k).toLowerCase()).join(", ");

const HIDDEN_FIELDS: Partial<Record<EditableSection, string[]>> = {
  general: ["commissionerMessage", "constitution", "duesPaidTeamIds"],
  niche: ["custom"],
};

function Prose({ lines }: { lines: string[] }) {
  return (
    <div className="max-w-[70ch] space-y-2 text-[15px] leading-relaxed text-ink">
      {lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </div>
  );
}

function AllSettings({ section, value, lk, only }: { section: EditableSection; value: unknown; lk: FormatLookups; only?: string[] }) {
  const meta = SECTION_BY_KEY[section];
  const hidden = new Set(HIDDEN_FIELDS[section] ?? []);
  const groups = meta.groups.filter((g) => !only || only.includes(g.id));
  return (
    <details className="group/set mt-3 overflow-hidden rounded-card bg-sunken/60">
      <summary className="flex min-h-11 cursor-pointer select-none list-none items-center gap-2 px-3 text-[14px] font-semibold text-brand-600 hover:bg-sunken dark:text-brand-400 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate">Every {meta.label.toLowerCase()} setting</span>
        <ChevronDown size={16} className="shrink-0 transition-transform duration-200 group-open/set:rotate-180" aria-hidden />
      </summary>
      <div className="overflow-x-auto border-t border-line/70 bg-panel">
        <table className="tbl tbl-compact">
          <tbody>
            {groups.map((g) => (
              <RowsForGroup
                key={g.id}
                title={g.title}
                // settings nothing applies yet (catalog `notEnforced`) aren't league rules, so the rulebook leaves them out
                fields={g.fields.filter((f) => !hidden.has(f.path) && !f.notEnforced && !["slots", "positionLimits", "rookieScale"].includes(f.kind))}
                value={value}
                lk={lk}
              />
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function RowsForGroup({ title, fields, value, lk }: { title: string; fields: (typeof SECTION_BY_KEY)["general"]["groups"][number]["fields"]; value: unknown; lk: FormatLookups }) {
  if (!fields.length) return null;
  return (
    <>
      <tr className="group-row">
        <td colSpan={2}>{title}</td>
      </tr>
      {fields.map((f) => (
        <tr key={f.path}>
          <td className="w-1/2 text-muted">{f.label}</td>
          <td className="font-medium">{formatFieldValue(f, getAt(value, f.path), lk)}</td>
        </tr>
      ))}
    </>
  );
}

/** A rulebook chapter: a collapsed row (title + short meta) that expands in place. */
function Section({ id, title, meta, children }: { id: string; title: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <details id={id} className="group/ch scroll-mt-4 border-t border-line/70 first:border-t-0">
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-4 py-2 transition-colors hover:bg-sunken/70 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink sm:text-sm">{title}</span>
        {meta != null && <span className="numeral max-w-[45%] shrink-0 truncate text-[13px] text-muted">{meta}</span>}
        <ChevronDown size={18} className="-mr-1 shrink-0 text-faint transition-transform duration-200 group-open/ch:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 pb-5 pt-1">{children}</div>
    </details>
  );
}

const H3 = ({ children, className }: { children: React.ReactNode; className?: string }) => <h3 className={`eyebrow mb-1.5 ${className ?? ""}`}>{children}</h3>;

const TOC = [
  ["basics", "League basics"],
  ["rosters", "Rosters & lineups"],
  ["scoring", "Scoring"],
  ["matchups", "Matchups & standings"],
  ["playoffs", "Playoffs"],
  ["cap", "Salary cap & dead money"],
  ["contracts", "Contracts"],
  ["keepers", "Keepers"],
  ["waivers", "Waivers & FAB"],
  ["trades", "Trades"],
  ["draft", "Drafts"],
  ["fun", "Fun & custom rules"],
  ["dues", "Dues & payouts"],
  ["commissioner", "Commissioner"],
] as const;

export default async function RulesPage() {
  const ctx = await getLeagueContext();
  const { league, settings: s, season, isCommish } = ctx;
  const tz = s.general.timezone;
  const [teams, latest, audit, undroppable, ledger] = await Promise.all([
    db.team.findMany({ where: { leagueId: league.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.leagueSettingsHistory.findFirst({ where: { leagueId: league.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true, version: true, changedById: true, note: true } }),
    s.commissioner.auditLogVisibleToLeague
      ? db.auditLog.findMany({ where: { leagueId: league.id }, orderBy: { createdAt: "desc" }, take: 12, include: { actor: { select: { name: true } } } })
      : Promise.resolve([]),
    s.waivers.undroppablePlayerIds.length ? db.player.findMany({ where: { id: { in: s.waivers.undroppablePlayerIds } }, select: { id: true, fullName: true, position: true } }) : Promise.resolve([]),
    loadLedger(league.id, season, s),
  ]);
  const latestBy = latest?.changedById ? await db.user.findUnique({ where: { id: latest.changedById }, select: { name: true } }) : null;
  const rc: RulebookContext = { teamNames: new Map(teams.map((t) => [t.id, t.name])), teamCount: teams.length || s.general.teamCount, season };
  const lk: FormatLookups = { teams: rc.teamNames, players: new Map(undroppable.map((p) => [p.id, `${p.fullName} (${p.position})`])), tz };
  const starters = s.roster.slots.reduce((a, x) => a + x.count, 0);
  const statGroups = STAT_GROUPS.filter((g) => g !== "IDP" || s.roster.idpEnabled);
  const overridesFor = (key: string) => Object.entries(s.scoring.positionOverrides).filter(([, m]) => key in m).map(([pos, m]) => ({ pos, v: m[key] }));
  const statLabel = (k: string) => STAT_CATALOG.find((x) => x.key === k)?.label ?? COMBO_STATS.find((x) => x.key === k)?.label ?? k;
  const constitution = s.general.constitution.trim() ? s.general.constitution.trim().split(/\n\s*\n/) : [];
  const customRules = s.niche.custom.filter((r) => r.enabled);
  const retiredRules = s.niche.custom.filter((r) => !r.enabled);
  const paidCount = s.general.duesPaidTeamIds.filter((id) => rc.teamNames.has(id)).length;
  const niche = nicheProse(s);
  const scaleRounds = Object.keys(s.contracts.rookieScale).map(Number).filter((r) => r <= s.draft.rookie.rounds).sort((a, b) => a - b);
  const scalePicks = Math.max(0, ...scaleRounds.map((r) => s.contracts.rookieScale[String(r)].length));

  const presetShort = s.scoring.preset === "HALF_PPR" ? "Half PPR" : s.scoring.preset === "STANDARD" ? "Standard" : s.scoring.preset === "PPR" ? "PPR" : "Custom";
  const lastReg = s.general.firstWeek + s.general.regularSeasonWeeks - 1;
  const leagueType = s.general.leagueType === "DYNASTY" ? "Dynasty" : s.general.leagueType === "KEEPER" ? "Keeper" : "Redraft";
  const updated = latest ? fmtDateTime(latest.createdAt, tz, { withYear: true, dateOnly: true }) : null;

  return (
    <div className="mx-auto max-w-4xl">
      <DetailsHashOpener />
      <LeagueTabs active="rules" />
      <PageHeader
        kicker={league.name}
        title="Rulebook"
        subtitle={`Version ${league.settingsVersion}${updated ? ` · updated ${updated}` : " · original settings"}`}
        actions={
          <>
            <ButtonLink href="/rules/suggestions" variant="secondary" size="md">
              <Lightbulb size={15} /> Suggest a change
            </ButtonLink>
            {isCommish && (
              <ButtonLink href="/commissioner/settings" variant="primary" size="md">
                <Pencil size={15} /> Edit rules
              </ButtonLink>
            )}
          </>
        }
      />

      <SummaryStrip
        items={[
          { label: "Starters", value: String(starters), sub: `${s.roster.benchSize} bench`, title: `${starters} starters · ${s.roster.benchSize} bench · ${s.roster.irSlots} IR · ${s.roster.taxiSlots} taxi` },
          { label: "Scoring", value: presetShort, sub: `${s.scoring.decimals} decimals` },
          s.salaryCap.enabled
            ? { label: "Cap", value: `$${s.salaryCap.cap}`, sub: s.salaryCap.floor ? `floor $${s.salaryCap.floor}` : "no floor" }
            : { label: "Cap", value: "Off", sub: "no salary cap" },
          {
            label: "Playoffs",
            value: s.playoffs.teams ? String(s.playoffs.teams) : "None",
            sub: s.playoffs.teams ? `Wk ${s.playoffs.startWeek}–${lastFantasyWeek(s)}` : undefined,
            title: s.playoffs.teams ? `${s.playoffs.teams} playoff teams` : undefined,
          },
        ]}
      />

      <div className="mt-4 space-y-4">
        {(s.general.commissionerMessage || constitution.length > 0) && (
          <Panel title="From the commissioner">
            {s.general.commissionerMessage && <p className="max-w-[70ch] whitespace-pre-line text-[15px] leading-relaxed text-ink">{s.general.commissionerMessage}</p>}
            {constitution.length > 0 && (
              <div className={s.general.commissionerMessage ? "mt-2 border-t border-line/70" : ""}>
                <Collapsible summary="League constitution" meta={`${constitution.length} part${constitution.length === 1 ? "" : "s"}`}>
                  <div className="max-w-[70ch] space-y-2 text-[15px] leading-relaxed">
                    {constitution.map((p, i) => (
                      <p key={i} className="whitespace-pre-line">
                        {p}
                      </p>
                    ))}
                  </div>
                </Collapsible>
              </div>
            )}
          </Panel>
        )}

        <Panel title="Rules" subtitle="Tap a chapter to read it" noPad>
          <div className="border-t border-line/70">
        <Section id="basics" title="League basics" meta={`${leagueType} · ${rc.teamCount} teams`}>
          <Prose lines={basicsProse(s, rc)} />
          <AllSettings section="general" value={s.general} lk={lk} only={["identity", "season", "divisions", "managers"]} />
        </Section>

        <Section id="rosters" title="Rosters & lineups" meta={`${starters} starters`}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <H3>Starting lineup ({starters})</H3>
              <table className="tbl tbl-compact">
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th className="num">Starters</th>
                    <th>Eligible</th>
                  </tr>
                </thead>
                <tbody>
                  {s.roster.slots.map((sl) => (
                    <tr key={sl.key}>
                      <td>
                        <PosBadge pos={sl.eligible.length === 1 ? sl.eligible[0] : sl.key === "SFLEX" ? "SFLEX" : "FLEX"} className="mr-1.5" />
                        <span className="font-semibold">{sl.label}</span>
                      </td>
                      <td className="num">{sl.count}</td>
                      <td className="text-xs text-muted">{sl.eligible.map((p) => (p === "DEF" ? "DST" : p)).join(", ")}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="font-semibold">Bench</td>
                    <td className="num">{s.roster.benchSize}</td>
                    <td className="text-xs text-muted">Any position</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">IR / Taxi</td>
                    <td className="num">
                      {s.roster.irSlots} / {s.roster.taxiSlots}
                    </td>
                    <td className="text-xs text-muted">Extra spots</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <H3>Roster limits by position</H3>
              {Object.keys(s.roster.positionLimits).length ? (
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th className="num">Min</th>
                      <th className="num">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(s.roster.positionLimits).map(([p, l]) => (
                      <tr key={p}>
                        <td className="font-semibold">{p === "DEF" ? "DST" : p}</td>
                        <td className="num">{l.min}</td>
                        <td className="num">{l.max ?? "No limit"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted">No position limits.</p>
              )}
            </div>
          </div>
          <div className="mt-4">
            <Prose lines={[...rosterProse(s), ...lineupProse(s)]} />
          </div>
          <AllSettings section="roster" value={s.roster} lk={lk} />
          <AllSettings section="lineup" value={s.lineup} lk={lk} />
        </Section>

        <Section id="scoring" title="Scoring" meta={presetShort}>
          <Prose lines={scoringProse(s)} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {statGroups.map((g) => {
              const rows = STAT_CATALOG.filter((st) => st.group === g && st.key !== "pts_allow" && st.key !== "yds_allow" && ((s.scoring.rules[st.key] ?? 0) !== 0 || overridesFor(st.key).length));
              if (!rows.length) return null;
              return (
                <div key={g}>
                  <H3>{g}</H3>
                  <table className="tbl tbl-compact">
                    <thead>
                      <tr>
                        <th>Stat</th>
                        <th className="num">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((st) => {
                        const ov = overridesFor(st.key);
                        const per = s.scoring.rules[st.key] ?? 0;
                        const yardish = /_yd$|yds/.test(st.key) && Math.abs(per) > 0 && Math.abs(per) < 1;
                        return (
                          <tr key={st.key}>
                            <td>
                              {st.label}
                              {g === "Kicking" && st.key === "fgm" && s.scoring.useFieldGoalDistance && <span className="ml-1 text-[12px] text-muted">(no distance recorded)</span>}
                              {ov.length > 0 && (
                                <span className="ml-1.5 inline-flex flex-wrap gap-1">
                                  {ov.map((o) => (
                                    <span key={o.pos} className="rounded-[4px] bg-brand-600/[0.08] px-1 text-[12px] font-semibold text-brand-700 dark:bg-brand-400/15 dark:text-brand-300">
                                      {o.pos === "DEF" ? "DST" : o.pos} {o.v}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </td>
                            <td className="num whitespace-nowrap font-semibold">
                              {per > 0 ? "+" : ""}
                              {per}
                              {yardish && <span className="ml-1 text-[12px] font-normal text-muted">(1 per {Math.round(1 / Math.abs(per))})</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[13px] text-muted">Stats not listed score 0. Blue tags are position-specific values that replace the base value.</p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {s.scoring.bonuses.length > 0 && (
              <div>
                <H3>Milestone bonuses</H3>
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th>Bonus</th>
                      <th>When</th>
                      <th className="num">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.scoring.bonuses.map((b) => (
                      <tr key={b.id}>
                        <td>
                          {b.label}
                          {b.positions && b.positions.length > 0 && <span className="ml-1 text-[12px] text-muted">({b.positions.map((p) => (p === "DEF" ? "DST" : p)).join(", ")})</span>}
                        </td>
                        <td className="text-xs text-muted">
                          {statLabel(b.stat)} ≥ {b.threshold}
                          {b.repeatEvery ? `, again every ${b.repeatEvery}` : ""}
                        </td>
                        <td className="num font-semibold">+{b.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {s.scoring.useFieldGoalDistance && (
              <div>
                <H3>Field goals by distance</H3>
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th>Distance</th>
                      <th className="num">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...s.scoring.fieldGoalsByDistance]
                      .sort((a, b) => a.min - b.min)
                      .map((r) => (
                        <tr key={`${r.min}-${r.max}`}>
                          <td>{r.max >= 99 ? `${r.min}+ yards` : `${r.min}-${r.max} yards`}</td>
                          <td className="num font-semibold">{r.points}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            {[
              ["Team defense: points allowed", s.scoring.pointsAllowedTiers, 999],
              ["Team defense: yards allowed", s.scoring.yardsAllowedTiers, 9999],
            ].map(([title, tiers, top]) => {
              const sorted = [...(tiers as { max: number; points: number }[])].sort((a, b) => a.max - b.max);
              if (!sorted.length) return null;
              return (
                <div key={title as string}>
                  <H3>{title as string}</H3>
                  <table className="tbl tbl-compact">
                    <thead>
                      <tr>
                        <th>Allowed</th>
                        <th className="num">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((t, i) => {
                        const lo = i === 0 ? 0 : sorted[i - 1].max + 1;
                        return (
                          <tr key={t.max}>
                            <td>{t.max >= (top as number) ? `${lo}+` : lo === t.max ? `${lo}` : `${lo}-${t.max}`}</td>
                            <td className="num font-semibold">{t.points > 0 ? `+${t.points}` : t.points}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </Section>

        <Section id="matchups" title="Matchups & standings" meta={`Wk ${s.general.firstWeek}–${lastReg}`}>
          <Prose lines={matchupProse(s, rc)} />
          {s.matchups.rivalries.length > 0 && (
            <p className="mt-2 text-sm">
              <span className="font-semibold">Rivalries:</span> {s.matchups.rivalries.map(([a, b]) => `${rc.teamNames.get(a) ?? "?"} vs ${rc.teamNames.get(b) ?? "?"}`).join(" · ")}
            </p>
          )}
          <AllSettings section="matchups" value={s.matchups} lk={lk} />
          <AllSettings section="standings" value={s.standings} lk={lk} />
        </Section>

        <Section id="playoffs" title="Playoffs" meta={s.playoffs.teams ? `${s.playoffs.teams} teams` : "None"}>
          <Prose lines={playoffProse(s, rc)} />
          <p className="mt-2 text-[13px] text-muted">Fantasy season ends in Week {lastFantasyWeek(s)}.</p>
          <AllSettings section="playoffs" value={s.playoffs} lk={lk} />
        </Section>

        <Section id="cap" title="Salary cap & dead money" meta={s.salaryCap.enabled ? `$${s.salaryCap.cap}` : "Off"}>
          <Prose lines={capProse(s)} />
          <AllSettings section="salaryCap" value={s.salaryCap} lk={lk} />
        </Section>

        <Section id="contracts" title="Contracts & rookie scale">
          <Prose lines={contractProse(s)} />
          {scaleRounds.length > 0 && (
            <div className="mt-3">
              <H3>Rookie salary scale</H3>
              <div className="overflow-x-auto">
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th className="tbl-sticky">Round</th>
                      {Array.from({ length: scalePicks }, (_, i) => (
                        <th key={i} className="num">
                          .{String(i + 1).padStart(2, "0")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scaleRounds.map((r) => (
                      <tr key={r}>
                        <td className="tbl-sticky font-semibold">Rd {r}</td>
                        {Array.from({ length: scalePicks }, (_, i) => (
                          <td key={i} className="num">
                            {s.contracts.rookieScale[String(r)][i] !== undefined ? `$${s.contracts.rookieScale[String(r)][i]}` : `$${s.salaryCap.minSalary}`}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <AllSettings section="contracts" value={s.contracts} lk={lk} />
        </Section>

        <Section id="keepers" title="Keepers">
          <Prose lines={keeperProse(s)} />
          {(s.keepers.windowOpens || s.keepers.deadline) && (
            <p className="mt-2 text-sm">
              {s.keepers.windowOpens && <>Window opens {fmtDateTime(s.keepers.windowOpens, tz, { withYear: true })}. </>}
              {s.keepers.deadline && <>Deadline {fmtDateTime(s.keepers.deadline, tz, { withYear: true })}.</>}
            </p>
          )}
          <AllSettings section="keepers" value={s.keepers} lk={lk} />
        </Section>

        <Section id="waivers" title="Waivers & free agency" meta={s.waivers.type === "FAB" ? `FAB $${s.waivers.faabBudget}` : undefined}>
          <Prose lines={waiverProse(s)} />
          {undroppable.length > 0 && (
            <p className="mt-2 text-sm">
              <span className="font-semibold">Undroppable:</span> {undroppable.map((p) => p.fullName).join(", ")}
            </p>
          )}
          <AllSettings section="waivers" value={s.waivers} lk={lk} />
        </Section>

        <Section id="trades" title="Trades & pick trading" meta={s.trades.enabled ? (s.trades.deadlineWeek ? `Deadline wk ${s.trades.deadlineWeek}` : "No deadline") : "Off"}>
          <Prose lines={tradeProse(s)} />
          <AllSettings section="trades" value={s.trades} lk={lk} />
        </Section>

        <Section id="draft" title="Rookie draft & auction">
          <Prose lines={draftProse(s)} />
          {s.draft.rookie.orderMethod === "LOTTERY" && s.draft.rookie.lottery.odds.length > 0 && (
            <div className="mt-3 max-w-sm">
              <H3>Lottery odds for the first pick</H3>
              <table className="tbl tbl-compact">
                <thead>
                  <tr>
                    <th>Pre-lottery slot</th>
                    <th className="num">Odds</th>
                  </tr>
                </thead>
                <tbody>
                  {s.draft.rookie.lottery.odds.map((o, i) => (
                    <tr key={i}>
                      <td>{i === 0 ? "Worst record" : `#${i + 1}`}</td>
                      <td className="num font-semibold">{o}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(s.draft.rookie.scheduledFor || s.draft.auction.scheduledFor) && (
            <p className="mt-2 text-sm">
              {s.draft.rookie.scheduledFor && <>Rookie draft: {fmtDateTime(s.draft.rookie.scheduledFor, tz, { withYear: true })}. </>}
              {s.draft.auction.scheduledFor && <>Salary auction: {fmtDateTime(s.draft.auction.scheduledFor, tz, { withYear: true })}.</>}
            </p>
          )}
          <AllSettings section="draft" value={s.draft} lk={lk} />
        </Section>

        <Section id="fun" title="Fun & custom rules" meta={customRules.length ? `${customRules.length} custom` : undefined}>
          {niche.length > 0 ? <Prose lines={niche} /> : <p className="text-sm text-muted">No side games or special weeks this season.</p>}
          {s.niche.rivalryTrophies.length > 0 && (
            <p className="mt-2 text-sm">
              <span className="font-semibold">Rivalry trophies:</span> {s.niche.rivalryTrophies.map((t) => `${t.name} (${rc.teamNames.get(t.teamA) ?? "?"} vs ${rc.teamNames.get(t.teamB) ?? "?"})`).join(" · ")}
            </p>
          )}
          <H3 className="mt-4">League rules</H3>
          {customRules.length ? (
            <ol className="space-y-2">
              {customRules.map((r, i) => (
                <li key={r.id} className="rounded-card bg-sunken/60 px-3 py-2.5">
                  <div className="font-semibold">
                    {i + 1}. {r.title}
                    {r.since ? <span className="ml-2 text-[13px] font-normal text-muted">since {r.since}</span> : null}
                  </div>
                  <p className="mt-0.5 max-w-[70ch] whitespace-pre-line text-[15px] text-muted sm:text-sm">{r.description}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">No custom rules yet.</p>
          )}
          {retiredRules.length > 0 && <p className="mt-2 text-[13px] text-muted">Retired rules: {retiredRules.map((r) => r.title).join(", ")}.</p>}
          <AllSettings section="niche" value={s.niche} lk={lk} />
        </Section>

        <Section id="dues" title="Dues & payouts" meta={s.general.leagueDues > 0 ? `$${s.general.leagueDues}` : "Free"}>
          {s.general.leagueDues > 0 ? (
            <p className="text-[15px]">
              Dues are <b>${s.general.leagueDues}</b> per team{s.general.duesDueDate ? `, due ${fmtDateTime(s.general.duesDueDate, tz, { withYear: true, dateOnly: true })}` : ""} ({paidCount} of {rc.teamCount} paid). The pot is ${(s.general.leagueDues * rc.teamCount).toLocaleString()}.
            </p>
          ) : (
            <p className="text-[15px]">This is a free league.</p>
          )}
          {s.general.payouts.length > 0 && (
            <table className="tbl tbl-compact mt-3 max-w-md">
              <thead>
                <tr>
                  <th>Place / award</th>
                  <th className="num">Payout</th>
                </tr>
              </thead>
              <tbody>
                {s.general.payouts.map((p, i) => (
                  <tr key={i}>
                    <td>{p.place}</td>
                    <td className="num font-semibold">{p.amount ? `$${p.amount.toLocaleString()}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(s.niche.weeklyHighScorePrize > 0 || s.waivers.addDropFee > 0 || s.niche.emptyStarterFine > 0) && (
            <p className="mt-2 text-sm text-muted">
              {s.niche.weeklyHighScorePrize > 0 && `The week's top score wins $${s.niche.weeklyHighScorePrize}. `}
              {s.waivers.addDropFee > 0 && `Each add or won waiver claim costs $${s.waivers.addDropFee}. `}
              {s.niche.emptyStarterFine > 0 && `Each empty starting slot in a completed game costs a $${s.niche.emptyStarterFine} fine. `}
              {(s.waivers.addDropFee > 0 || s.niche.emptyStarterFine > 0) && "Fines and fees are collected with dues."}
            </p>
          )}
          {ledger.active && (
            <div className="mt-3 overflow-hidden rounded-card ring-1 ring-line/70">
              <LedgerTable ledger={ledger} settings={s} />
            </div>
          )}
        </Section>

        <Section id="commissioner" title="Commissioner">
          <Prose
            lines={[
              `The commissioner ${s.commissioner.canEditLineups ? "can set lineups for any team" : "does not edit lineups"}${s.commissioner.canEditPastScores ? " and may correct scores for past weeks" : ""}. ${s.commissioner.coCommissionerFullPowers ? "Co-commissioners have full powers." : "Co-commissioners can't change league settings."}${s.commissioner.ownTeamActionsRequireCoCommish ? " Commissioner overrides on the commissioner's own team must be made by a co-commissioner." : ""}`,
              ...(s.commissioner.sectionsRequiringVote.length
                ? [`In-season changes to ${sectionNames(s.commissioner.sectionsRequiringVote)} settings need a league vote: ${s.commissioner.voteThresholdPercent}% of managers must vote yes.`]
                : []),
              ...(s.commissioner.lockedSectionsInSeason.length ? [`These settings are locked during the season: ${sectionNames(s.commissioner.lockedSectionsInSeason)}.`] : []),
              "Every commissioner action is logged, and every settings change is saved as a new version.",
            ]}
          />
          <AllSettings section="commissioner" value={s.commissioner} lk={lk} />
          <AllSettings section="notifications" value={s.notifications} lk={lk} />
          {s.commissioner.auditLogVisibleToLeague && (
            <div className="mt-4">
              <H3>Recent commissioner actions</H3>
              {audit.length ? (
                <ul className="divide-y divide-line/70 overflow-hidden rounded-card bg-sunken/60">
                  {audit.map((a) => (
                    <li key={a.id} className="flex min-h-11 flex-wrap items-center justify-between gap-x-2 px-3 py-1.5 text-[15px] sm:text-sm">
                      <span>
                        <span className="font-medium">{auditLabel(a.action)}</span> <span className="text-[13px] text-muted">· {a.actor?.name ?? "System"}</span>
                      </span>
                      <span className="text-[13px] text-muted">{fmtDateTime(a.createdAt, tz, { dateOnly: true })}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No commissioner actions yet.</p>
              )}
            </div>
          )}
          <p className="mt-3 text-[13px] text-muted">
            {latest ? `Last updated ${updated}${latestBy ? ` by ${latestBy.name}` : ""} · version ${league.settingsVersion}` : `Original league settings · version ${league.settingsVersion}`}
            {latest?.note ? ` · “${latest.note}”` : ""}
          </p>
        </Section>

          </div>
        </Panel>

        <section className="card overflow-hidden">
          <ul>
            <ListRow href="/rules/suggestions" leading={<Lightbulb size={18} className="text-brand-600 dark:text-brand-400" />} title="Think a rule should change?" subtitle="Propose it and the league votes" chevron />
          </ul>
        </section>
      </div>
    </div>
  );
}
