# CTE Dynasty — developer guide

Dynasty salary-cap fantasy football league site (CBS-Fantasy-style layout, original branding).
Stack: Next.js 15 App Router + React 19 + TypeScript (strict) + Tailwind 3 + Prisma 6 / PostgreSQL.
Live updates use Server-Sent Events; background jobs run in-process (croner) from `src/instrumentation.ts`.

Full architecture & module map: `docs/ARCHITECTURE.md`. UI/IA research: `docs/research/cbs-layout.md`
(each section ends with a "CTE … spec"), rules catalog: `docs/research/rules-catalog.md`,
valuation/simulation methods: `docs/research/trade-value-and-sim.md`.

## Commands
- `npm run dev` (port 3000) · `npm run typecheck` · `npm test` (node:test via tsx, files in `tests/*.test.ts`)
- `npm run sync:all` pulls NFL players/schedule/stats/projections/news · `npm run db:seed` builds the demo league
- `npm run job -- <name>` runs a background job once (list: `npm run job`)
- `node scripts/dev-check.mjs /path1 /path2 --shots <dir> [--mobile]` logs in (commish@ctedynasty.local / ctedynasty) and loads pages, printing status + runtime errors
- In this cloud container outbound HTTP from Node needs `NODE_USE_ENV_PROXY=1` (proxy); not needed elsewhere.

## Conventions
- Pages are async **server components** under `src/app/(league)/…` (the group layout renders the app shell and requires login + league membership). Get context with `const ctx = await getLeagueContext()` from `@/lib/league` → `{ user, league, settings, member, myTeam, isCommish, season, week, nfl }`.
- Next 15: `params` and `searchParams` are Promises — `const { id } = await params`.
- Mutations are **server actions** in `src/lib/<module>/actions.ts` (`"use server"`), validated with zod (v4: use `.issues`), returning `{ ok: true, message? } | { ok: false, error }`. Authorize with `assertLeagueMember()`, `assertTeamManager(teamId)`, `assertCommissioner()` from `@/lib/league`. Call `revalidatePath(...)` after writes.
- Roster changes go through `@/lib/roster-ops` (`addPlayerToTeam`, `dropPlayerFromTeam`, `movePlayer`, `adjustFaab`) so Transactions, dead money and waivers stay consistent. Validate with `validateRoster`/`capSummary` from `@/lib/roster`.
- League rules: always read `ctx.settings` (typed `LeagueSettings`, `src/lib/settings/schema.ts`). Never hardcode roster slots, scoring, cap, FAB budget, deadlines, etc.
- Fantasy points: `calcPoints(stats, position, settings.scoring)` (`@/lib/scoring/engine`); helpers in `@/lib/points` (`weekPoints`, `seasonPoints`, `restOfSeasonProjection`). Team/matchup scores & win probability: `@/lib/scoreboard`. Lineups: `@/lib/lineup`. Standings: `@/lib/standings`. Picks: `@/lib/picks`.
- Live events: server `publish(topic, type, data)` from `@/lib/realtime/bus`; client `useLiveEvents([topic], handler)` from `@/lib/realtime/client`. Topics `league:<id>`, `chat:<channelId>`, `draft:<draftId>`, `user:<userId>`. Payload types in `@/lib/realtime/events`.
- Notifications (in-app + phone push + email): `notify({ userIds, leagueId, type, title, body, url })` from `@/lib/notify`. Chat system posts: `postSystemMessage(leagueId, body, { channel, kind })` from `@/lib/chat-system`. Commissioner actions must write an `AuditLog` row.
- UI kit: `@/components/ui/core` (Panel, PageHeader, Button/ButtonLink, Badge, PosBadge, InjuryTag, PlayerLink, PlayerHeadshot, TeamLogo, NflLogo, StatTile, TabLinks, EmptyState, Alert, Field) and `@/components/ui/client` (Modal, SubmitButton, ActionButton, Dropdown, ClientTabs, Toggle). Dense tables use the `.tbl` class; inputs use `.input`/`.label`. Use theme tokens (`bg-panel`, `bg-sunken`, `text-ink`, `text-muted`, `border-line`, `brand-*`, `gold-*`) so dark mode works. Wrap wide tables in `overflow-x-auto`; every page must work at 390px wide.
- No new npm dependencies, no external fonts/CDNs/scripts. Images only from sleepercdn.com / a.espncdn.com (or /public).
- Times display in the league timezone (`settings.general.timezone`, default America/New_York).
- `prisma/schema.prisma` is shared: don't change it casually; schema changes need `npx prisma db push` and must be additive.
