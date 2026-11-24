# CTE Dynasty 🏈

A private fantasy football website for the **CTE Dynasty** league: a dynasty, salary-cap league with every NFL player available. The page layout follows CBS Sports Fantasy league pages, with a few UX upgrades: a sticky live scoreboard, ⌘K search, a mobile tab bar, dark mode and one-tap lineup moves.

## Features

| Area | What you get |
|---|---|
| **Login & profiles** | Email/password accounts, invite-code signup that claims a team, password reset by email. Each manager edits their own profile (bio, avatar, favorite team, socials, team branding). |
| **League home** | Your matchup with live win probability, lineup alerts, the week's scoreboard, standings, upcoming schedule and key dates, transactions, news on your players, a chat preview and the latest recap. |
| **Scoreboard everywhere** | A live score ticker under the nav on every page, one click from each matchup and the full schedule. |
| **Players** | All ~8,000 NFL players from Sleeper, with filters, stat timeframes, projections, add/drop, FAB claims and a watch list. |
| **Player profiles** | Bio, injury and practice status, depth chart, contract and owner, game log with scoring breakdown, season stats, projections, news, injury history and league transaction history. |
| **News & injuries** | ESPN news and injury reports synced every 10 minutes. Injury alerts go to the managers who roster the player. |
| **My Team** | Tap-to-move lineup editor, Optimize button, game-time locks, IR/taxi moves, cap and roster counts, contracts (extensions, franchise tag, rookie options) and draft picks. |
| **Manager insights** | Start/sit suggestions with the change in win probability, injury and bye replacements, matchup difficulty, waiver targets, lineup efficiency history and a bye planner. |
| **Live scoring** | Stats update about every 20 seconds during games. Matchup pages update instantly, with live projections and a win-probability chart. |
| **Touchdown phone alerts** | Web Push to iPhone (16.4+, once added to the Home Screen), Android and desktop. Each manager picks who triggers alerts: their starters, their roster, their matchup, or the whole league. |
| **Standings & playoffs** | Configurable tiebreakers, all-play records, power rankings and a live playoff bracket. Playoff and championship odds come from a 10,000-run simulation, refreshed daily. |
| **Trades** | Trades can include players, rookie picks (3 seasons × 2 rounds per team) and FAB dollars. Counter-offers, multi-team trades, commissioner or league-vote review, a trade block and a full trade history. |
| **Trade calculator** | Dynasty values that account for production, age, salary vs. contract value, injuries, record (contender vs. rebuilder) and draft-pick value. |
| **Waivers & FAB** | Blind FAB bidding or rolling priority, processed on a configurable schedule, with a complete FAB ledger. |
| **Drafts** | Live salary auction room (nominations, bids, timers, max-bid rule, proxy bids) and live rookie draft room (pick clock, queue, big board, autopick). Also: lottery, draft results and rookie rankings updated through the offseason. |
| **Keepers & contracts** | End-of-season keeper designation with salary increases, dead money on cuts, and a season rollover that keeps each team at three years of picks. |
| **Commissioner** | Every rule is editable, including per-position scoring (e.g. TE premium), bonuses, defense and kicking tiers, roster slots, cap, contracts, waivers, trades, drafts, playoffs and custom rules. Also: settings history with revert, member invites, roster/score edits, schedule tools, jobs and email log. |
| **Community** | Live league chat with channels, DMs, @mentions and reactions. Also a rule-suggestion board with voting, in-depth manager stats (head-to-head, luck, lineup efficiency) and league history/records. |
| **Weekly recap emails** | An automatic Tuesday email: awards, matchup of the week, best and worst lineup decisions, standings movement, playoff-odds movers and next week's preview. |

## Tech stack
Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS · Prisma · PostgreSQL. Live updates use Server-Sent Events, phone alerts use Web Push (VAPID), and email goes over SMTP (nodemailer). Background jobs run inside the server process (croner). NFL data comes from the free public **Sleeper** and **ESPN** endpoints, so no API keys are needed.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the pieces fit together.

## Quick start (local)

```bash
# 1. Postgres 14+ running locally, then:
cp .env.example .env              # set DATABASE_URL and AUTH_SECRET
npm install
npx prisma db push                # create tables
npm run sync:all                  # pull every NFL player, schedule, stats, projections, news (~30s)
npm run db:seed                   # demo CTE Dynasty league (12 teams, rosters, contracts, picks)
npm run dev                       # http://localhost:3000
```

Demo login: `commish@ctedynasty.local` / `ctedynasty` (commissioner). The other demo managers use `<name>@ctedynasty.local` with the same password.

### Start your real league
1. Sign in as the commissioner and go to **Commish → Members & Invites**.
2. Rename the teams and send each manager an invite link (`/signup?code=…`). Signing up with a code claims that team.
3. Change the demo commissioner's email and password, or invite yourself and promote that account.
4. Set every rule under **Commish → League Settings** and **Scoring Rules**.
5. Run the startup **Salary Auction** and the **Rookie Draft** from **Draft → Draft Center**.

## Phone notifications (touchdown alerts)
1. Run `npm run vapid`, paste `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` into `.env`, then restart.
2. Each manager opens **Notifications & phone alerts** and taps **Enable alerts**.
   * **iPhone:** in Safari, tap Share → **Add to Home Screen**, open CTE Dynasty from the home screen, then enable alerts (iOS 16.4+).
   * **Android / desktop:** enable alerts straight from the browser.
3. Optional SMS fallback: set the `TWILIO_*` variables.

Web Push needs HTTPS in production.

## Weekly recap emails
Set the `SMTP_*` variables (Resend, Postmark, SendGrid, a Gmail app password, etc.) and `EMAIL_FROM`. Day and time are configurable under **Commish → League Settings → Notifications**. Without SMTP, emails are saved as previews you can read in **Commish → System → Email log**.

## Deploy
The app is one long-running Node process (live scoring and jobs run inside it), so use a host that keeps a server running:

```bash
docker compose up -d --build      # app + Postgres (see docker-compose.yml)
docker compose exec app npm run sync:all
```

This works on any VPS, Railway, Render or Fly.io with a managed Postgres. Set `APP_URL` to your public HTTPS URL. Serverless hosting (e.g. Vercel) is not recommended because the live scoring poller and job scheduler need a persistent process.

## Background jobs
| Job | When | What it does |
|---|---|---|
| live-scoring | every 20s (does nothing when no games are on) | Pulls in-game stats, updates matchups, sends TD alerts |
| sync-news | every 10 min | ESPN news and injury reports |
| sync-games | hourly | NFL schedule, game state, betting lines |
| sync-projections | every 6h | Weekly projections |
| sync-players | daily | Player teams, injuries, depth charts |
| playoff-odds | daily | Playoff odds simulation and bracket updates |
| process-waivers | hourly check | Runs FAB/waivers on the configured day and time |
| trade-review | every 5 min | Finishes trades once review ends, expires stale offers |
| draft-clock | every 2s during live drafts | Pick timers, auction lot closing, autopick |
| weekly-recap | hourly check | Builds and emails the recap on the configured day |
| lineup-warnings, keeper-deadlines, rookie-rankings, cleanup | various | Reminders and housekeeping |

Run any job once with `npm run job -- <name>`. Set `JOBS_ENABLED=false` to disable the scheduler.

## Development
* `npm run typecheck` · `npm test` · `node scripts/dev-check.mjs /players /team --shots ./shots` (loads pages as a logged-in user and reports errors)
* Conventions are in [`CLAUDE.md`](CLAUDE.md).
