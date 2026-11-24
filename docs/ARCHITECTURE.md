# CTE Dynasty — Architecture

## Overview

```
Browser ──HTTP──> Next.js (App Router, Node runtime)
   │                 ├─ server components (pages)  ──> Prisma ──> PostgreSQL
   │                 ├─ server actions (mutations)
   │◄──SSE────────── ├─ /api/stream  (live scores, chat, drafts, notifications)
   │                 └─ instrumentation.ts ─> croner scheduler (in-process jobs)
   │                                              ├─ Sleeper API  (players, stats, projections)
   │◄──Web Push──────  web-push (VAPID)          ├─ ESPN API     (schedule, live games, odds, news, injuries)
                       nodemailer (SMTP)          └─ notify(): in-app + push + email (+ optional Twilio SMS)
```

Single Node process (`next start`) — the in-process event bus means live updates work with one instance.
Deploy with Docker (`Dockerfile`, `docker-compose.yml`) on any VPS / Railway / Fly / Render with Postgres.

## Data sources (no API keys)
| Data | Source | Sync |
|---|---|---|
| Every NFL player (bio, team, injury status, depth chart) | `api.sleeper.app/v1/players/nfl` | daily `sync-players` |
| Weekly stats (live during games) | `api.sleeper.app/stats/nfl/{season}/{week}` | `live-scoring` every 20s while games are live; nightly corrections |
| Weekly projections | `api.sleeper.app/projections/nfl/{season}/{week}` | every 6h |
| NFL schedule, game clock/score, spreads, O/U, moneylines | `site.api.espn.com/.../nfl/scoreboard` | hourly + live poller |
| News + injury reports | `site.api.espn.com/.../nfl/news`, `/nfl/injuries` | every 10 min |
| Headshots / logos | `sleepercdn.com`, `a.espncdn.com` | — |

## Foundation modules (`src/lib`)
| File | Purpose / key exports |
|---|---|
| `db.ts` | Prisma client `db` |
| `auth/session.ts` | `getCurrentUser`, `requireUser`, `createSession`, `destroySession`, `hashPassword` |
| `auth/actions.ts` | login/signup(invite code)/forgot/reset/change password, `switchLeagueAction` |
| `league.ts` | `getLeagueContext()`, `requireCommissioner()`, `assertLeagueMember()`, `assertTeamManager()`, `assertCommissioner()` |
| `league-week.ts` | `leagueWeekFor()`, `lastFantasyWeek()` |
| `settings/schema.ts` | `LeagueSettings` type, `DEFAULT_SETTINGS`, `resolveSettings`, `diffSettings`, `expandSlots` |
| `settings/stat-catalog.ts` | `STAT_CATALOG`, `DEFAULT_STAT_COLUMNS`, `normalizePosition` |
| `scoring/engine.ts` | `calcPoints(stats, position, scoring)` → `{points, breakdown}`; `TOUCHDOWN_KEYS` |
| `points.ts` | `weekPoints`, `seasonPoints`, `restOfSeasonProjection` |
| `roster.ts` | `getTeamRoster`, `capSummary`, `capHit`, `salaryInYear` (raises), `validateRoster` (soft caps, offseason roster limit), `rosterLimitProblems`, `activeRosterLimit`, `isIrEligible`, `isTaxiEligible`, `rosterCounts` |
| `roster-rules.ts` | Pure + client-safe: `deadMoneyCharges` (the one dead-money formula, incl. preseason cut %), `capLimit` (hard / soft cap ceiling), `isPreseasonPhase` |
| `roster-ops.ts` | `addPlayerToTeam`, `dropPlayerFromTeam` (dead money + waivers; pass `phase`), `movePlayer`, `adjustFaab`, `forgiveRetiredDeadMoney`, `broadcastTransaction` |
| `lineup.ts` | `getLineup` (`lineup.defaultCarryOver`), `isLocked` (lock type + `lockOffsetMinutes`), `canStart` (taxi starters), `isOnBye`, `weekGamesByTeam`, `optimalLineup`, `autoFillLineup`, `saveLineup` (carries changes into untouched later weeks), `validateLineup` |
| `scoreboard.ts` | `buildTeamWeekScore` (pure: best ball, auto-subs, empty-slot penalty, adjustments — shared by every score view), `teamWeekScore`, `winProbability`, `refreshWeekMatchups` (ties / tiebreak chain, reverse-scoring week, forfeits, illegal-roster zero points), `POSITION_SD`, `remainingFraction` |
| `scoreboard-rules.ts` | Pure matchup rules: `decideWinner`, `tiebreakChain`, `planAutoSubs`, `didNotPlay`, `playingStarters` |
| `standings.ts` | `computeStandings` (tiebreakers, all-play, streaks, power rankings, median game), `playoffSeeds`, `leagueSeeds`; `rankTeams` / `rankLeague` — the one pure ranking (group tiebreaks for 3+ tied teams, chain restarts, season coin flip) that the playoff-odds sim also uses; `coinFlipDraw`; `StandingRow.tiebreak` / `divisionTiebreak` record why a team ranks above the next |
| `schedule.ts` | `roundRobin`, `generateSchedule` |
| `picks.ts` | `ensureDraftPicks` (3 yrs × 2 rounds), `pickLabel`, `pickShortLabel`, `teamPicks` |
| `chat-system.ts` | `ensureDefaultChannels`, `postSystemMessage` |
| `notify.ts` | `notify()`, `NOTIFICATION_DEFAULTS`, `sendPushToUser`, `leagueUserIds`, `teamUserIds` |
| `email.ts` | `sendEmail()`, `emailLayout()` (no SMTP → saved to `.emails/` + EmailLog PREVIEW) |
| `realtime/bus.ts`, `realtime/client.ts`, `realtime/events.ts` | SSE pub/sub |
| `nfl/state.ts`, `nfl/teams.ts` | NFL season/week; team metadata/logos |
| `sync/*` | Sleeper + ESPN sync |
| `jobs/registry.ts` | every background job + schedule; `runJob(name)` |
| `jobs/league-refresh.ts` | `refreshAllLeagues` (current week; daily run also rescoring last week until the stat-correction cutoff, and retired-player dead-money forgiveness) |

## Feature modules (ownership)
| Module | Routes (`src/app/(league)/…`) | Library |
|---|---|---|
| Players & research | `players/**`, `news/**`, `injuries/**` | `lib/players/**`, `lib/sync/news.ts`, `components/players/**` |
| My Team & insights | `team/page`, `team/insights`, `team/contracts`, `team/picks`, `teams/**` | `lib/team/**`, `lib/insights/**`, `components/team/**` |
| Live scoring | `scoring/**`, `schedule/**` | `lib/live/**`, `components/scoring/**` |
| Standings & playoffs | `standings/**`, `playoffs/**` | `lib/sim/**`, `lib/playoffs/**` (incl. `elimination.ts`: `championshipStatus`, the single "is this team out of the bracket?" answer used by waivers, free agency, trades and draft order), `components/standings/**` |
| Trades | `trades/**`, `commissioner/trades/**` | `lib/trades/**`, `lib/value/**`, `components/trades/**` |
| Drafts & rookies | `draft/**`, `rookies/**` | `lib/draft/**`, `lib/rookies/**`, `components/draft/**` |
| Waivers, keepers, season | `transactions/**`, `waivers/**`, `team/keepers/**`, `commissioner/season/**` | `lib/waivers/**`, `lib/keepers/**`, `lib/season/**`, `components/waivers/**` |
| Commissioner & rules | `commissioner/**` (except trades/season), `rules/page` | `lib/commissioner/**`, `components/commissioner/**` |
| Community | `chat/**`, `managers/**`, `settings/**`, `notifications/**`, `rules/suggestions/**`, `history/**`, `league/**` | `lib/chat/**`, `lib/profiles/**`, `lib/stats/**`, `lib/proposals/**`, `components/community/**`, `app/api/chat/**`, `app/api/upload/**` |
| Weekly recaps | `recaps/**` | `lib/recap/**` |
| League home | `page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx` | `components/home/**`, Docker files |

## Dynasty rules model
- **Contracts**: `RosterSpot.salary` (whole $) + `contractYears` remaining (incl. current season). Cap = `settings.salaryCap.cap`.
  Dead money on cuts: `settings.salaryCap.deadMoney` (stored per player in `LeaguePlayerState.deadCap`).
- **Draft picks**: `DraftPick` rows exist for the next `trades.futurePickYears` (3) seasons × `draft.rookie.rounds` (2). They are tradable assets (`TradeAsset.type = "PICK"`). The season rollover creates the new third year.
- **FAB**: `FaabLedger` is the source of truth; `Team.faabBalance` is a cached sum. FAB can be traded.
- **Keepers**: designated in the `KEEPER` phase (`KeeperDesignation`), salary escalates per `settings.keepers.escalation`.
- **Phases**: `League.phase` ∈ PRESEASON → REGULAR → PLAYOFFS → OFFSEASON → KEEPER → (rollover) PRESEASON.
