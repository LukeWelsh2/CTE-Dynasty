import Link from "next/link";
import { BookOpen, Lightbulb, Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { lastFantasyWeek } from "@/lib/league-week";
import { ButtonLink, PageHeader, Panel, PosBadge } from "@/components/ui/core";
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
    <div className="space-y-2 text-[15px] leading-relaxed text-ink">
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
    <details className="group mt-3 rounded-md border border-line">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold uppercase tracking-wide text-brand-700 hover:bg-sunken dark:text-brand-300">Every {meta.label.toLowerCase()} setting</summary>
      <div className="overflow-x-auto border-t border-line">
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

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28">
      <Panel title={title}>{children}</Panel>
    </section>
  );
}

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

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        kicker={league.name}
        title="League Rulebook"
        subtitle={latest ? `Last updated ${fmtDateTime(latest.createdAt, tz, { withYear: true, dateOnly: true })}${latestBy ? ` by ${latestBy.name}` : ""} · version ${league.settingsVersion}` : `Original league settings · version ${league.settingsVersion}`}
        actions={
          <>
            <ButtonLink href="/rules/suggestions" variant="secondary" size="sm">
              <Lightbulb size={14} /> Suggest a rule change
            </ButtonLink>
            {isCommish && (
              <ButtonLink href="/commissioner/settings" variant="primary" size="sm">
                <Pencil size={14} /> Edit rules
              </ButtonLink>
            )}
          </>
        }
      />

      <nav aria-label="Rulebook sections" className="mb-4 flex flex-wrap gap-1.5">
        {TOC.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="chip hover:bg-sunken">
            {label}
          </a>
        ))}
      </nav>

      <div className="space-y-4">
        {(s.general.commissionerMessage || constitution.length > 0) && (
          <Panel title="From the commissioner">
            {s.general.commissionerMessage && <p className="mb-3 rounded-md border-l-4 border-gold-500 bg-gold-300/10 px-3 py-2 text-[15px] italic text-ink">{s.general.commissionerMessage}</p>}
            {constitution.length > 0 && (
              <div className="space-y-2 text-[15px] leading-relaxed">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
                  <BookOpen size={13} /> League constitution
                </h3>
                {constitution.map((p, i) => (
                  <p key={i} className="whitespace-pre-line">
                    {p}
                  </p>
                ))}
              </div>
            )}
          </Panel>
        )}

        <Section id="basics" title="League basics">
          <Prose lines={basicsProse(s, rc)} />
          <AllSettings section="general" value={s.general} lk={lk} only={["identity", "season", "divisions", "managers"]} />
        </Section>

        <Section id="rosters" title="Rosters & lineups">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Starting lineup ({starters})</h3>
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
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Roster limits by position</h3>
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

        <Section id="scoring" title="Scoring">
          <Prose lines={scoringProse(s)} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {statGroups.map((g) => {
              const rows = STAT_CATALOG.filter((st) => st.group === g && st.key !== "pts_allow" && st.key !== "yds_allow" && ((s.scoring.rules[st.key] ?? 0) !== 0 || overridesFor(st.key).length));
              if (!rows.length) return null;
              return (
                <div key={g}>
                  <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{g}</h3>
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
                              {g === "Kicking" && st.key === "fgm" && s.scoring.useFieldGoalDistance && <span className="ml-1 text-[11px] text-muted">(no distance recorded)</span>}
                              {ov.length > 0 && (
                                <span className="ml-1.5 inline-flex flex-wrap gap-1">
                                  {ov.map((o) => (
                                    <span key={o.pos} className="rounded bg-gold-300/30 px-1 text-[10px] font-bold text-gold-600 dark:text-gold-300">
                                      {o.pos === "DEF" ? "DST" : o.pos} {o.v}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </td>
                            <td className="num whitespace-nowrap font-semibold">
                              {per > 0 ? "+" : ""}
                              {per}
                              {yardish && <span className="ml-1 text-[11px] font-normal text-muted">(1 per {Math.round(1 / Math.abs(per))})</span>}
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
          <p className="mt-2 text-xs text-muted">Stats not listed score 0. Gold tags are position-specific values that replace the base value for that position.</p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {s.scoring.bonuses.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Milestone bonuses</h3>
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
                          {b.positions && b.positions.length > 0 && <span className="ml-1 text-[11px] text-muted">({b.positions.map((p) => (p === "DEF" ? "DST" : p)).join(", ")})</span>}
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
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Field goals by distance</h3>
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
                  <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{title as string}</h3>
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

        <Section id="matchups" title="Matchups, schedule & standings">
          <Prose lines={matchupProse(s, rc)} />
          {s.matchups.rivalries.length > 0 && (
            <p className="mt-2 text-sm">
              <span className="font-semibold">Rivalries:</span> {s.matchups.rivalries.map(([a, b]) => `${rc.teamNames.get(a) ?? "?"} vs ${rc.teamNames.get(b) ?? "?"}`).join(" · ")}
            </p>
          )}
          <AllSettings section="matchups" value={s.matchups} lk={lk} />
          <AllSettings section="standings" value={s.standings} lk={lk} />
        </Section>

        <Section id="playoffs" title="Playoffs">
          <Prose lines={playoffProse(s, rc)} />
          <p className="mt-2 text-xs text-muted">Fantasy season ends in Week {lastFantasyWeek(s)}.</p>
          <AllSettings section="playoffs" value={s.playoffs} lk={lk} />
        </Section>

        <Section id="cap" title="Salary cap & dead money">
          <Prose lines={capProse(s)} />
          <AllSettings section="salaryCap" value={s.salaryCap} lk={lk} />
        </Section>

        <Section id="contracts" title="Contracts, franchise tags & rookie scale">
          <Prose lines={contractProse(s)} />
          {scaleRounds.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Rookie salary scale</h3>
              <div className="overflow-x-auto">
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-sunken">Round</th>
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
                        <td className="sticky left-0 bg-panel font-semibold">Rd {r}</td>
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

        <Section id="waivers" title="Waivers & free agency">
          <Prose lines={waiverProse(s)} />
          {undroppable.length > 0 && (
            <p className="mt-2 text-sm">
              <span className="font-semibold">Undroppable:</span> {undroppable.map((p) => p.fullName).join(", ")}
            </p>
          )}
          <AllSettings section="waivers" value={s.waivers} lk={lk} />
        </Section>

        <Section id="trades" title="Trades & draft-pick trading">
          <Prose lines={tradeProse(s)} />
          <AllSettings section="trades" value={s.trades} lk={lk} />
        </Section>

        <Section id="draft" title="Rookie draft & salary auction">
          <Prose lines={draftProse(s)} />
          {s.draft.rookie.orderMethod === "LOTTERY" && s.draft.rookie.lottery.odds.length > 0 && (
            <div className="mt-3 max-w-sm">
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Lottery odds for the first pick</h3>
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

        <Section id="fun" title="Fun & custom rules">
          {niche.length > 0 ? <Prose lines={niche} /> : <p className="text-sm text-muted">No side games or special weeks this season.</p>}
          {s.niche.rivalryTrophies.length > 0 && (
            <p className="mt-2 text-sm">
              <span className="font-semibold">Rivalry trophies:</span> {s.niche.rivalryTrophies.map((t) => `${t.name} (${rc.teamNames.get(t.teamA) ?? "?"} vs ${rc.teamNames.get(t.teamB) ?? "?"})`).join(" · ")}
            </p>
          )}
          <h3 className="mb-1.5 mt-4 text-xs font-bold uppercase tracking-wide text-muted">League rules</h3>
          {customRules.length ? (
            <ol className="space-y-2">
              {customRules.map((r, i) => (
                <li key={r.id} className="rounded-md border border-line px-3 py-2">
                  <div className="font-semibold">
                    {i + 1}. {r.title}
                    {r.since ? <span className="ml-2 text-xs font-normal text-muted">since {r.since}</span> : null}
                  </div>
                  <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{r.description}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">No custom rules yet.</p>
          )}
          {retiredRules.length > 0 && <p className="mt-2 text-xs text-muted">Retired rules: {retiredRules.map((r) => r.title).join(", ")}.</p>}
          <AllSettings section="niche" value={s.niche} lk={lk} />
        </Section>

        <Section id="dues" title="Dues & payouts">
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
            <div className="mt-3 overflow-hidden rounded-md border border-line">
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
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Recent commissioner actions</h3>
              {audit.length ? (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {audit.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5 text-sm">
                      <span>
                        <span className="font-medium">{auditLabel(a.action)}</span> <span className="text-xs text-muted">· {a.actor?.name ?? "System"}</span>
                      </span>
                      <span className="text-xs text-muted">{fmtDateTime(a.createdAt, tz, { dateOnly: true })}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No commissioner actions yet.</p>
              )}
            </div>
          )}
          {latest?.note && <p className="mt-3 text-xs text-muted">Latest change note: “{latest.note}”</p>}
        </Section>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-line px-4 py-3 text-sm">
          <span className="text-muted">Think a rule should change?</span>
          <Link href="/rules/suggestions" className="link font-semibold">
            Propose it on the rule suggestion board →
          </Link>
        </div>
      </div>
    </div>
  );
}
