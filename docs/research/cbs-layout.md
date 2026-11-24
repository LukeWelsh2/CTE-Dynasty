# CBS Fantasy Football League Interface: Layout and IA Research

Research for **CTE Dynasty**, an original dynasty salary-cap league site. The goal is to borrow
**structure** (information architecture, page sections, table columns, workflows, feature lists)
from CBS Sports' league pages and improve the UX. It is **not** to copy CBS logos, names,
trademarks, colors as brand identity, illustrations or copy.

Compiled 2026-11-24.

---

## 0. How to read this document

### Evidence tags

| Tag | Meaning |
|-----|---------|
| **[V]** | **Verified** from a source fetched during this research: a public cbssports.com page, a CBS rules or FAQ page, a CBS-rendered app mockup, or third-party scraper code / captured CBS payloads on GitHub that show real CBS league URLs, DOM classes, column headers and JSON fields. The source is named inline or in section 26. |
| **[I]** | **Inferred** from verified artifacts, such as URL paths, network traces, field names or CSS class names, without seeing the rendered page. |
| **[M]** | **From memory** (general knowledge of CBS league pages, roughly 2014–2025). Likely right in spirit, but labels and exact placement may differ. Check against a real logged-in league before you treat it as fact. |

### Method and limits

- CBS league pages live on `https://<league-slug>.football.cbssports.com/` and **need a login**
  (login is reCAPTCHA-protected), so I could not render any of them directly.
- This container could reach `www.cbssports.com`, `raw.githubusercontent.com` and the GitHub code
  search API. These hosts were **blocked**: the CBS help center (`help.football.cbssports.com`,
  `help.cbssports.com`, `cbsi.my.site.com`), the CBS CDNs (`sports.cbsimg.net`,
  `sportsfly.cbsistatic.com`), the Wayback Machine, Reddit, YouTube, the App Store / Google Play,
  FantasyPros and the Footballguys forums. I only have help-center text where a web-search
  summary quoted it.
- The strongest **[V]** evidence came from:
  1. **Open-source scrapers and extensions** that hit real CBS league URLs and parse real DOM, plus
     **captured CBS JSON payloads**. One request trace dates from 2026-10-20 and one fixture set
     from 2026-09-10, so both reflect the current CBS site.
  2. **The CBS fantasy app promo page** (`cbssports.com/features/fantasy-app-download`). Its phone
     mockups are live HTML: roster screen, matchup screen and draft board, with real labels.
  3. **Public cbssports.com fantasy pages**: stats tables, player pages, roster trends, the
     Commissioner FAQ, free-league rules and the "create a league" comparison.
- Screenshots are saved in `docs/research/shots/` as **internal reference only**. They contain CBS
  branding. Never ship them or derive assets from them.
  - `cbs-app-promo-mockups-desktop.png`: full promo page, rendered at deviceScaleFactor 1.
  - `cbs-app-mockup-draftboard-roster-crop.png`: 2x crop of the draft-board and roster phone
    mockups.
  - Public stats and player pages rendered **unstyled** because their CSS CDN is blocked, so those
    screenshots were discarded.

---

## 1. Executive summary

- **Platform shape [V/I].** Each league gets its own subdomain. One horizontal top nav has hover
  dropdowns (`#fantNavContainer > .fantNavBar > .fantNavFastFacts > ul > li.fantNavItem.fant-drop.drop.main-nav`).
  Second-level pages use a tab strip (`.fantasyHeaderNav`, e.g. *League Details | Owners*). Content
  sits in boxed modules (`div.box-Rg.box-white`) holding dense data tables
  (`table.data[.data3].pinHeader.borderTop`) with zebra rows (`tr.row1 / tr.row2`), header rows
  (`tr.label`), group title rows (`tr.title`, `tr.subtitle`) and "my team" highlighting
  (`tr.bgFan`).
- **Core page set and real routes [V].**
  - `/` league home
  - `/teams/{id}` team roster and lineup
  - `/teams/all` all rosters
  - `/teams/roster-grid`
  - `/teams/scout-team`
  - `/teams/roster-optimization`
  - `/players/playerpage/{id}` and `/players/playerpage/snippet/{id}` (player card)
  - `/players/rankings/...`
  - `/stats/stats-main/...` (player search and stats)
  - `/scoring/live/{period}/{matchup}`
  - `/standings/overall`, `/standings/power-rankings`, `/standings/owner`
  - `/transactions/{season}/all/all_but_lineup`, `/transactions/add-drop`, `/transactions/trade`
  - `/draft/results/{year}:{id}:{name}[/nomination]`, `/draft/live/room2`
  - `/history`, `/history/year-by-year/`
  - `/rules`
  - `/options`, `/options/lineup-page`
  - `/setup/commish-tools/...`
  - `/print/csv/...` (CSV exports)
- **CBS supports salary-cap dynasty natively [V].** Rosters show **Salary** and **Contract**
  columns. Transactions record **"Signed for $X"**, **"Dead Cap"** charges and **future draft-pick
  trades** ("2026 Round 3 (Orig) - Draft Pick Traded from Team"). Free-agent **auctions** run as a
  separate "draft" with a per-pick bid history. Keepers and contracts are first-class. CTE Dynasty
  should match this feature depth and present it far better.
- **The modern CBS app style [V, mockup]** uses white cards, rounded corners and pill tabs. It
  color-codes positions (slot badges and draft-board cells), colors the opponent text green or red
  by matchup difficulty, shows a red **Q** injury tag inline, puts **PROJ** and **OPRK** columns on
  the roster, and gives the matchup screen a **win %** and **PMR**. The bottom tab bar reads
  *Roster | Matchup | Research | Advice | League*.
- **Known CBS pain points** (user reports; [V] via search summaries): the desktop team switcher is
  clunky in leagues of more than 8 teams. Posts in the league feed get buried. Paid upsells look
  like normal links. Commish tools have historically been called "dreadful." The draft room makes
  it hard to track the picks before yours. Section 24 answers each of these.

---

## 2. Route inventory: CBS (verified) mapped to a CTE Dynasty proposal

| Area | CBS path (evidence) | What it is | Proposed CTE route |
|------|--------------------|------------|-------------------|
| League home | `/` [V trace] | Feed, modules, scoreboard | `/` |
| My team | `/teams` → `/teams/{id}` [V] | Roster and lineup for a team; `{id}` is numeric | `/team/:teamId` |
| All rosters | `/teams/all` [V] | Every team's roster table on one page | `/rosters` |
| Roster grid | `/teams/roster-grid` [V] | Matrix of all rosters (teams as columns) | `/rosters/grid` |
| Scout team | `/teams/scout-team` [V] | Scouting view of another team | `/team/:id/scout` |
| Lineup optimizer | `/teams/roster-optimization`, `/teams/roster-optimization/recommendations-free-agents` [V] | Optimal-lineup suggestion plus FA recommendations | `/team/:id/optimize` |
| Roster report | `/teams/roster-report/{team}/{period}/?action=set-lineup` [V] | AJAX partial for lineup editing | (API) |
| Lineup views | `/teams/lineup-view/{view}/{subview}/set-lineup?team=&point=&period=` with view ∈ `sch`, `odds`, `redzone`, `projections-restofseason`, `projections-{week}` [V] | Swappable column sets on the lineup page | `?view=` param |
| Position eligibility | `/teams/eligibility/` [V, baseball] | Eligibility report | `/team/:id/eligibility` |
| Player page | `/players/playerpage/{id}/` [V] | Full player profile | `/players/:playerId` |
| Player card | `/players/playerpage/snippet/{id}?loc=snippet&selected_tab=overview` [V] | Popup card with tabs | Side drawer `?player=` |
| Player projections | `/component/playerpage/player-projections/{id}/{period}` [V] | AJAX module | (API) |
| Player rankings | `/players/rankings`, `/players/rankings/top200/season/ppr` [V] | League-aware rankings | `/players/rankings` |
| Player search / stats | `/stats/stats-main/{scope}:{pos}/{period}:{p\|f}/{report}/{stats\|projections}?print_rows=9999` [V]; `?default_add=` (add flow), `?selectedplayer=` [V] | The main player table | `/players?pos=&status=&period=&view=` |
| CSV export | `/print/csv/stats/view/...`, `/print/csv/standings/overall` [V] | Download any table | `Export` button |
| Live scoring | `/scoring/live`, `/scoring/live/{period}/{matchup}` [V] | GameTracker matchup view | `/scoring/:week/:matchupId` |
| Scoring (baseball) | `/scoring/standard` [V] | Scoring summary view | `/scoring/:week` |
| Standings | `/standings/overall[/{season}]` [V] | Overall plus division tables | `/standings` |
| Power rankings | `/standings/power-rankings` [V] | Record + Points + Breakdown | `/standings/power` |
| Owner standings | `/standings/owner` [V] | Standings by owner (likely all-time) [I] | `/history/managers` |
| Schedule | Schedule page with "WEEK N (Edit)" headers [V] | League schedule | `/schedule` |
| Transactions log | `/transactions/{season}/all/all_but_lineup?pageIndex-tableContainer-0=-999` and `/transactions/all/all_but_lineup/{season}` [V] | Filterable log; `-999` means "show all" | `/transactions` |
| Add/Drop | `/transactions/add-drop` [V] | Add/drop workflow | `/transactions/add` |
| Trade | `/transactions/trade/` [V] | Trade center | `/trades` |
| Draft results | `/draft/results`, `/draft/results/2019:Pre-season`, `/draft/results/2024:Pre-season:MLFF%20AUCTION3/`, `/draft/results/2025:2:Free%20Agency/nomination` [V] | Results for any past draft or auction, via a draft-history dropdown | `/draft/:draftId` |
| Live draft room | `/draft/live/room2` (newer), `/draft/live/room` [V] | Real-time draft room | `/draft/:draftId/room` |
| League rules | `/rules` [V] | League details and rules | `/league/rules` |
| History | `/history`, `/history/year-by-year/` [V] | League history | `/history` |
| Options | `/options`, `/options/lineup-page` [V] | User preferences, incl. lineup page prefs | `/settings` |
| Commish tools | `/setup/commish-tools/schedule-edit` [V, hockey] | Commissioner tools subtree | `/commish/...` |
| Team logo builder | `/team-logo?logo_type=logo:text&captype=helmet&capcolor=blk&logo=saint.gif&minilogo=...&letters=LSDS&text_color=red&button_type=flat&button_color=tan1&size=72x72` [V] | Generated helmet/cap logos with letters | `/team/:id/edit` (own builder) |
| Owner logo | `/ownerlogo?size=36x36&id=...` [V] | Owner avatar | avatars |
| League JSON API | `/api/league/{details,rules,scoring/rules,rosters,teams,schedules,standings/overall,feed,stats,fantasy-points/weekly-scoring,transaction-list/log,transaction-list/add-drops,transactions/waiver-order,transactions/lineup,lineup,opm/pick-list}` [V] | Backing API (same-origin proxy and `api.cbssports.com/fantasy/`) | `/api/...` |

---

## 3. Global header (site chrome above the league)

### 3.1 CBS public site header, current [V: fetched HTML and screenshot]

- A thin near-black bar, about 64px tall.
  - **Left:** a 3x3 "grid" menu icon, then featured sport links: *NFL, NCAA FB, NBA, NCAA BB, UFC,
    Golf*.
  - **Center:** wordmark logo.
  - **Right:** *Watch, Fantasy, Betting*, then an account (user) icon.
- **The mega-menu** is grouped *Sports | Watch | Fantasy | Betting*. The Fantasy group lists:
  - Explore Fantasy, Fantasy News, Play Now, **My Teams**
  - Football, Baseball, Basketball, Hockey
  - UFC Pick'Em, Football Pick'Em, College Pick'Em, bracket games
  - Get the Fantasy App, Must-Draft Players
- **The public fantasy football sub-nav** reads *Home, Rankings, Projections, Roster Trends, Stats,
  Depth Charts, Player News, Get the Fantasy App, Player Search, Injury Report, Fantasy Football
  Today, Fantasy Hub, Fantasy Games*.
- The footer has columns *More / Company / Regulation / Contact Us / Social Media / Account*.
  *Account* contains *Manage My Account, Newsletters, My Teams, Forgot Password*.

### 3.2 On league subdomains

- **[M]** The same global CBS bar sits above the league chrome, often with a "My Teams" switcher
  that lists every CBS fantasy team the user owns, across sports. Ad slots are common:
  - **[V]** A userstyle hides `#leaderboard-wrap`, `#adSkinLeft/Right`, `#footerBottomBanner`,
    `#fantasyLeagueMessageRow` and a Taboola strip "that cause the page to be jumpy". In other
    words, **layout shift from ads** is a known complaint.

### CTE takeaway

Use a single slim app header: CTE wordmark, league switcher (only if we ever host more than one
league), global search (Cmd+K), notifications bell and avatar menu. Show no ads and nothing that
causes layout shift.

---

## 4. League header (identity block)

**[V]**
- League identity is an uploaded **league image** (`fantasy-media.cbssports.com/football/{slug}/{hash}.jpg`)
  plus team logos at 36x36 (owner logo) and 100x100 (team logo).
- Team logos are either uploaded images or **generated by the CBS logo builder** (cap or helmet
  type, cap color, icon, mini-logo, 1–4 letters, text color and position, button type and color,
  size 72x72).
- The viewer's team id is embedded in the page (`var myTeamId = 16;`), together with a team object
  (`id, name, short_name, abbr, long_abbr, logo, division, is_vacant`).

**[M]**
- **Layout:**
  - **Left:** league logo (square) with the **league name** large beside it. Some pages add a
    smaller line with season and commissioner.
  - **Right ("Fast Facts"):** your team logo, team name, **record** and **rank**, e.g.
    "5-3, 2nd in East". The nav container class `fantNavFastFacts` **[V]** suggests the nav and
    these facts share one bar.
- **Message bar:** a full-width strip under the header for commissioner announcements and system
  notices, e.g. renewal. **[V]** The FAQ says to renew "go to your league home page and click in
  the message bar at the top of the page."
- **Team switcher:** **[V]** a `<select id="teamPageSelect">` on team pages whose values are
  `/teams/{N}`. **[V, user complaint]** "The 'Select a Team' option from your main team page
  sucks" in leagues of more than 8 teams.

### CTE takeaway

- Build a compact header with league crest and name, season and week, and phase (Offseason, Draft,
  Regular Season, Playoffs).
- Add a **"My team" chip** showing logo, record, rank, **cap space** and **roster count / limit**.
- Make the team switcher a searchable popover with logos, not a native `<select>`.

---

## 5. Main league navigation bar and dropdowns

**[V]** These parts are verified:
- The nav is one horizontal bar of **hover dropdowns** (`li.fantNavItem.fant-drop.drop.main-nav`).
  On the home page the **League** tab is marked `selected`.
- The League dropdown contains **"League Details"**. That page has a sub-tab strip
  (`.fantasyHeaderNav > ul > li`) whose second tab is the **Owners** page.
- A FantasyPros extension reads the active sub-tab label (`.fantasyHeaderNav .active a` or
  `.optsel`) and expects values such as **"Overview"** and **"Projections"** on player and stat
  pages.

**[M + I]** The menu below is reconstructed from memory and checked against the verified routes:

| Top item | Dropdown items | Evidence |
|----------|---------------|----------|
| **League** (selected on home) | Home · Standings · Power Rankings · Schedule · Transactions · League Details (Rules/Settings) · Owners · Message Board · Polls · League History · Records/Trophy Room · Photos/Stories ("Add Story/Images/Video") · Invite/Email League ("League Email Address") | League Details and Owners [V]; history, rules, standings and transactions routes [V]; message board, polls and stories as features [V]; exact labels [M] |
| **My Team** | Roster/Lineup (`/teams/{id}`) · Set Lineup · Add/Drop · Trade · Trade Block [M] · Waiver Claims/Pending [M] · Scout Team · Roster Grid · All Rosters · Lineup Optimizer · Team Settings (name, abbreviation, logo builder) · Team Schedule [M] | Routes [V]; "My Team, Trade page" phrase [V, rules] |
| **Players** | Player Search/Free Agents (`/stats/stats-main?default_add=`) · Stats · Rankings · Projections · Roster Trends (Most Added/Dropped/Viewed) · Injury Report · Player News · Depth Charts | Routes [V]; public sub-nav labels [V] |
| **Scoring** | Live Scoring/GameTracker · Matchups by week · Box scores · Fantasy points by player · Matchup Recaps [M] | Live routes [V]; "Game recaps after every matchup" [V] |
| **Standings** (sometimes under League) | Overall · Divisions · Power Rankings · Breakdown [M] · Owner standings · Playoff picture/bracket [M] | Routes [V] |
| **Transactions** (sometimes under League) | Log (filter: All / All but Lineup / Add-Drops / Trades / Lineup) · Add/Drop · Trade · Waiver Order · Pending | Routes and filter tokens [V] |
| **Draft** | Draft Central [V phrase] · Draft Room (button on draft day) [V] · Draft Results/History · Draft Order · Rank List/Draft Prep · Mock Draft [M] · Draft Recap [V, "personalized Draft Recaps"] | [V/M] |
| **Research** | CBS editorial: news, rankings, projections, start/sit, injuries, depth charts, video | Public site [V]; placement inside league nav [M] |
| **Commish** (commissioners only) | Commish Tools home (League Setup · Roster Management · Draft Management · ...) | Help text [V] (see section 20) |
| **Help** | Help center, live-scoring diagnostics (`/help/lps`) | [V] pages exist |

### CTE proposed top nav (desktop)

**Home · My Team · Matchup · Players · League ▾ · Trades · Draft ▾ · Commish (role-gated)**

League ▾ contains Standings, Schedule, Transactions, Rosters, Cap Table, Rules, History, Board and
Polls.

### Mobile

Use a bottom tab bar, as the CBS app does **[V]**: **Home · Team · Matchup · Players · League**.
League opens a sheet with everything else.

---

## 6. League score ticker and scoreboard strip

**[V]**
- The home page loads every team's 100x100 logo, which points to a scoreboard or standings module
  with logos **[I]**.
- The app matchup header shows, per side:
  - rank, live points and projected points ("1 20.25 116.1 VS 35.38 124.7")
  - record and seed ("12-4 (4)")
  - **PMR** (player minutes remaining, "491 PMR 468")
  - **win probability** ("41% WIN 59%")
  - a matchup label ("VS Championship")

**[M]** In season, CBS league pages show a horizontal **matchup ticker** along the top of the home
or scoring pages. Each tile holds the two team abbreviations or logos and live scores, and links to
`/scoring/live/{week}/{matchup}`. Horizontal arrows scroll it, and the user's own matchup comes
first or is highlighted.

### CTE spec: a sticky scoreboard strip

- It appears on every in-season page, under the nav, about 56px tall, and collapses to 40px on
  scroll.
- **Each tile shows:** both team crests and abbreviations, live score, projected score, a
  win-probability bar, PMR or "players left" pips, and a status (Pre / Live / Final).
  - Tap opens the matchup.
  - The user's matchup is pinned first.
  - Scores update in real time (SSE or websockets) with a subtle flash when they change.
- **Offseason:** the same strip becomes a "league pulse" showing cap-space leaders, open trade
  offers, auction countdown and the rookie draft clock.

---

## 7. League Home page modules

### 7.1 Verified from the 2026 network trace of a real league home page [V]

1. **League feed:** `/api/league/feed?content_type=all`.
   - Items carry `type` (`add_drop`, `commissioner_message_tool`, and others), `subject`, `body`
     (HTML), `author_name`, `author_logo`, `author_team`, `to` ("Everyone" or private), `pinned`,
     `is_private`, `reply_ids`, `views`, `created`, `modified` and `years`.
   - Example subjects: "Add/Drop for TEAM"; "Manual Draft Order Set" (a commissioner message).
2. **Roster Trends, Most Added:** `/component/homepage/roster-trends/added`.
3. **"Who Do I Start" (WDIS) question widget:** `/data/common/fantasy/wdis/get-question/`.
4. **Fantasy video player:** autoplay, muted, NFL-fantasy playlist.
5. **Editorial headlines with thumbnails:** fantasy-journalist images at 160x134.
6. **Team logos for all teams:** a standings or scoreboard snippet **[I]**.
7. **"saag-fantasy/league" module:** purpose unknown, possibly odds or advice.

### 7.2 Verified marketing features list [V: CBS "Fantasy Football Features" chart]

Customizable Homepage · Custom Polls · Detailed Transaction Reports · Trade Evaluator · Message
Board & Chat · League Email Address · Add Story/Images/Video · Detailed League History Area ·
Roster Trends · Flexible/Sortable Stats · Enhanced Lineup Views · Fantasy Alerts & E-Reports ·
Override Options · Customizable League URL.

### 7.3 Typical desktop composition [M]

- **Two or three columns.**
  - **Main column:** league news feed and message board posts (commissioner posts can be pinned),
    transactions inline, auto-generated recaps.
  - **Right rail:** my matchup card, standings snapshot, poll, roster trends, WDIS, video, and
    a **"Draft Room" button on draft day [V]**.
- **Commissioner-customizable** module order and visibility ("Customizable Homepage" [V]).

### CTE Home spec

- **Top:** a "This week" hero with my matchup, lineup alerts (empty slot, bye week, injured
  starter, illegal lineup), deadlines (waivers process, trade deadline, contract deadlines) and
  action buttons.
- **Main column:** a filterable **feed** with tabs *All · Chat · Transactions · Trades · Commish ·
  Recaps*. Pinned commissioner notice at top. Reactions and threaded replies. "Load newer" instead
  of burying posts.
- **Right rail:**
  - standings mini-table (top 6 plus my row)
  - **cap table mini** (cap space by team)
  - active poll
  - trade block
  - top performers this week
  - injuries on my roster
  - upcoming key dates

---

## 8. My Team page (roster and lineup)

### 8.1 Structure

**[V]**
- The roster table is `table.data.data3.pinHeader.borderTop`, which gives it a pinned or sticky
  header.
- Row types:
  - `tr.title`: team name header
  - `tr.label`: column headers
  - `tr.playerRow`: one per player
- **Section dividers are themselves `playerRow`s holding a single cell:** **"Reserves"**,
  **"Injured"**, **"Practice"**. So the groups run Starters, Reserves (bench), Injured (IR) and
  Practice (taxi or practice squad).
- Roster status codes are `A` (active or starter) and `RS` (reserve), plus IR slots ("Injured
  Players") and max counts per status in `league/rules → roster.statuses`.
- Lineup slots (`roster_pos`) include QB, RB, WR, TE, K, DST and flex slots such as **RB-WR-TE**,
  **WR-TE** and **RB-WR**. The full CBS vocabulary is QB, TQB, RB, WR, TE, RB-WR, WR-TE, RB-WR-TE,
  FLEX, K, TK, DST, D, ST, DB, LB, DL, DL-LB-DB.
  - The app shows flex as **"RWT"**.
  - Team-level fields include `lineup_status` (e.g. `"illegal"`), `warning`, `projected_points`
    and `point` (the period).

**[M]**
- Above the table sit the team header (logo, name, owner(s), record, rank, points for/against),
  a **period selector** ("Week 7 ▾") and a view switcher.
- Below the table: a "Save Lineup" or "Submit" action in older versions. Newer versions save
  instantly.
- A transactions or trade summary may also appear.

### 8.2 Columns

**[V]**
- Salary-cap league, `/teams/all` default view. The exact header row as scraped:

  `Pos | Player | Opp | Game Time | Bye | O/U | PosRnk | Ovp | Rost | Start | Salary | Contract | 2025 | 3yr Avg | Proj`

  - **Player** renders as "Name POS • TEAM" plus icons (news note, injury).
  - **O/U** is the game over/under.
  - **PosRnk** is position rank.
  - **Ovp** / **OPRK** is opponent rank versus the position.
  - **Rost** / **Start** are league-wide % rostered and % started.
  - **2025** is last season's fantasy points.
  - **3yr Avg** is the three-year average.
  - **Proj** is the projection.
- An older salary league showed Salary in roughly the 13th column of the team page.
- Dead-cap rows appear on the roster as "{Player} Dead Cap", with Pos shown as "DC".

**[V]** The per-player fields available in the CBS JSON:
- `jersey, age, bye_week, opponent ("@CAR"), opponent_team, home_game, gametime (unix), oprk`
- `percentowned, percentstarted, projected_points, avg_points, ytd_points`
- `injury ("Knee - ACL"), return ("Questionable for Week 1 at Car..."), pro_status, headline` (latest news)
- `icons, is_keeper, is_locked, on_waivers, on_waivers_until`
- `eligible ("RB,RB-WR-TE"), eligible_for_il, no_longer_eligible_for_il, roster_pos, roster_status, owned_by_team_id, game_odds, photo`

**[V, app mockup]** The mobile roster row shows:
- an outlined position-colored **slot badge** (QB, RB, WR, TE, RWT, K)
- the player photo
- the short name, e.g. "J. Allen"
- a filled position chip, then the NFL team, then a red **Q** if questionable
- the opponent line ("@ HOU Sun 1:00 PM"), with the opponent abbreviation **green** for an easy
  matchup and **red** for a hard one
- **PROJ** (e.g. 22.3) and **OPRK** on the right

The section header reads **"Active Players  PROJ: 145.2"**. The team header shows team name, owner
summary ("John Doe & 1 more") and record ("0-0"). Below it are action tiles **Player · Trades ·
Waivers · News · More**, then a **"Week 1"** selector and an **"Overview"** view pill.

### 8.3 Lineup views (column sets)

**[V]** Views load via AJAX into `#lineup_views`:
- **Overview** (default)
- **Schedule** (`sch`)
- **Odds** (`odds`)
- **Red Zone** (`redzone`)
- **Projections (Rest of Season)**
- **Projections (Week N)**

Preferences live at `/options/lineup-page`.

**[M]** Further views likely include Season stats, Last week, Fantasy points by week, and News.

### 8.4 Lineup editing UX

**[V]**
- Each row's position cell is `.playerPosition`, with a **"changePos" link** for moving a player.
- Saves go to `PUT /api/league/transactions/lineup`, and the roster partial refreshes from
  `/teams/roster-report/{team}/{period}/?action=set-lineup`.
- A **Lineup Optimizer** lives at `/teams/roster-optimization`, with FA recommendations.
- A slot locks **5 minutes before the player's game** (CBS rules: "change the status... up to 5
  minutes before a player's NFL team is scheduled to start").
- An illegal lineup scores zero.
- The previous week's lineup carries over if none is set.

**[M]** The flow:
1. Click the slot or "Move" control on a player.
2. Valid destination slots highlight, or a small menu lists them (Bench, IR, the slot names).
3. Click the target to swap.
4. Locked players appear greyed with a lock icon.
5. The app also allows reordering (the marketing mentions "drag-and-drop").
6. Users have complained that the desktop lineup page still relies on dropdown menus, and that the
   app is easier.

### 8.5 Related team pages

- **[V]** Scout Team, Roster Grid (all rosters as columns), All Rosters (`/teams/all`), Position
  Eligibility.
- **[M]** Team Schedule and Team Transactions.

### CTE My Team spec (dynasty and cap)

- **Header strip:**
  - cap meters: Cap used / Cap room / Dead cap / Next season committed
  - roster counts: Active / Bench / IR / Taxi, each against its limit
  - lineup legality badge
  - "Optimize" button
- **Grouped table:** **Starters → Bench → IR → Taxi → Dead Cap**. Each group has a sticky label row
  with a count against its limit.
- **Columns (default "Lineup" view):**
  - Slot, Player (with pos chip, NFL team and status tag), Opp + kickoff
  - Proj, OPRK, Bye, % Start
  - **Salary**, **Years left**, **Contract status** (Rookie, Franchise, Expiring)
  - Last 3 avg, Action (⋯)
- **Saved views:** Lineup · Contracts (Salary, years, cap hit by season, cut cost) · Stats (season)
  · Projections (ROS) · Schedule/Matchups · News.
- **Editing:**
  - Tap a slot, then tap a target (two-tap swap) with valid targets highlighted.
  - Drag-and-drop on desktop.
  - Keyboard: arrows, then Enter.
  - Saves instantly with optimistic UI and Undo.
  - Each player shows a lock countdown.

---

## 9. Players search page (free agents, stats, add/drop entry)

### 9.1 URL grammar

**[V]** `/stats/stats-main/{scope}:{positions}/{period}:{p|f}/{report-name}/{stats|projections}?print_rows=9999`

**Scope**
- `all` for every player
- `team:all` and `teamtotals` for team-level reports

**Positions**
- Colon-joined, e.g. `all:FLEX`, `all:DST`
- Baseball example: `all:C:1B:2B:3B:SS:OF:U`

**Period**
- `ytd`, `14d`, `restofseason`, `y`, or a week number `N`
- each followed by `:p` or `:f`

**Report**
- `standard` or a **commissioner- or user-saved custom report name**, e.g. "TRUFFLEoffense",
  "PosElig", "Hot Pitchers", "salary info", "accrued"
- **[V]** "Complete access to player stats with custom saved reports" is a Commissioner feature.

**Query params**
- `?default_add=` opens the table in add mode. A FantasyPros extension distinguishes "TopAv" (top
  available) from "WA" (waiver add) by this param.
- `?selectedplayer=`
- `print_rows=9999` shows all rows (pagination is the default).

**CSV**
- `/print/csv/stats/view/...`

### 9.2 Filters

**[V, public stats page]**
- **Position tabs:** QB · RB · WR · TE · **RB-WR-TE** (flex) · K · DST. All appears on roster
  trends.
- **Timeframe:** Week N Proj · Week N+1 Proj · Rest of Season Proj · Last Week · {Season} (YTD) ·
  prior seasons.
- **Scoring:** PPR / Non-PPR.

**[M, league version]**
- **Availability:** All Players · Available (FA + Waivers) · Free Agents · On Waivers · Owned ·
  My Team · a specific team.
- **NFL team filter**, **name search**, **"Show: Stats / Projections"**.
- **Rookies** toggle and **injured** toggle in some reports.

### 9.3 Columns

**[V, league table header as scraped]**

`Action | {League-abbr / Avail} | Player | Opp | OpRk/OVP | Bye | Rost | Start | Avg | Total`
followed by stat groups.

- The second column carries the **owner team abbreviation** or FA / W status.
- In this league report the column order is:
  `Opp, OpRk, PaCmp, PaAtt, PaYd, PaTD, PaInt, RuAtt, RuYd, RuTD, RuFD, Tar, Rec, ReYd, ReTD, ReFD, FL, Avg, FPts`
- Rows use `tr.row1/row2`. **The user's own players are highlighted with `tr.bgFan`.**

**[V, public stats page] Column groups and definitions:**

| Position | Groups and columns |
|----------|-------------------|
| QB | **Passing:** gp, att, cmp, yds, yds/g, td, int, rate · **Rushing:** att, yds, avg, td · **Misc:** fl · fpts, fppg |
| RB | **Rushing:** gp, att, yds, avg, td · **Receiving:** tgt, rec, yds, yds/g, avg, td · **Misc:** fl · fpts, fppg |
| WR | **Receiving:** gp, tgt, rec, yds, yds/g, avg, td · **Rushing:** att, yds, avg, td · fl · fpts, fppg |
| TE | **Receiving:** gp, tgt, rec, yds, yds/g, avg, td · fl · fpts, fppg |
| K | gp, fgm, fga, lng, 1-19, 1-19a, 20-29, 20-29a, 30-39, 30-39a, 40-49, 40-49a, 50+, 50+a, xpm, xpa, fpts, fppg |
| DST | **Defense/Special Teams:** int, sfty, sck, tk, frec, fum, dtd · **Yards Allowed:** pts, ppg, pass, rush, total, avg · fpts, fppg |

Every column header has a tooltip with the full name, e.g. "rate = Passer Rating". Every column
sorts (`?sortcol=passing_td&sortdir=descending`).

### 9.4 Actions and tags

**[V]**
- The add/drop UI marks a **`.to-playerRow`** (player being added) and a **`.from-playerRow`**
  (player being dropped). The clickable action sits in **`.editCell a`**.
- Undroppable players do not appear on the "Transactions, Add/Drop page" (free-league rule).
- Waiver claims carry `priority` and `bid_amount` (FAB). Their state reads e.g. "won".
- **Injury and news icons:** a `.playerIconsWrapper` holds the news-note icon
  (`icon-news-note-recent`, title = latest headline, link `subtab="Update"`).
- Injury designations come through `injury` and `return` text ("Questionable for Week 12 vs.
  Tennessee").
- The app shows a single-letter tag (**Q**). Statuses include Q, D, O, IR, PUP, NFI and SUSP, and
  `pro_status` can be "PUP".

**[M]** The Action column shows a green **+** (add or claim), a red **–** (drop, on your own
players) and a **trade** (⇄) icon on other teams' players. A waiver clock icon marks players on
waivers, with the date they clear.

### CTE Players spec

- A filter bar, sticky:
  - position segmented control: ALL QB RB WR TE FLEX K DST, plus Rookies
  - status: Available / FA / Waivers / Rostered / My team / Team ▾
  - timeframe: Season, Last 4, Last week, Week N proj, ROS proj, Prior season
  - scoring view
  - search
- **Column presets:** Overview · Season stats · Advanced (targets, snap %, RZ) · Projections ·
  **Contract** (salary, years, owner, cap hit) · Dynasty (age, experience, draft capital).
  Include a column chooser and saved custom reports (match CBS's "custom saved reports").
- **Row:** a primary action button sized for touch (Add / Claim $ / Trade / Drop). The player name
  opens the **player drawer**. Show a status tag and a news dot with a "new" indicator.
- **Bulk compare:** checkbox up to 4 players, then "Compare".
- **Export CSV** on every table.

---

## 10. Player card (popup) and full player profile

### 10.1 Player card popup

- **[V]** It loads via `/players/playerpage/snippet/{id}?loc=snippet&selected_tab=overview&play_video=0`.
  It is a tabbed modal whose default tab is **Overview**, and it can embed video.
- **[M]** Tabs: **Overview · News · Game Log · Stats · Projections**, sometimes Splits or Profile.
- **[M]** Header: photo, name, #, position, team, bio line, injury status, ownership ("Owned by
  TEAM" or "Free Agent" or "Waivers until..."), and action buttons (Add, Drop, Trade, Watch).

### 10.2 Full player page

**League version**
- **[V]** `/players/playerpage/{id}/` plus `/component/playerpage/player-projections/{id}/{period}`.
- **[V]** The 2014 redesign press release notes "player pages with a trading card look and feel."

**Public version, current [V: fetched]**
- **Header:** team abbreviation, jersey "#4", position "QB", name, and three headline stats
  (e.g. YDS 3049 · TD 25 · YDS/G 277.2).
- **Tabs:** **Player Home · Fantasy · Game Log · Splits · Career**.
- **Player Bio** fields:
  - **HT/WT** (6-2, 230 lbs)
  - **Birthplace**
  - **Age**
  - **School**
  - **Experience** (years)
- **Next Game card:** date and time, network, opponent with record, venue, Game Preview link.
- **Fantasy tab sections:**
  - **Recent Games:** date, key stats (yds, td, int, rate), FPTS; "Full Game Log" link.
  - **Schedule:** Opponent (@/vs), Game (date, or result like "W 37-20" or "L 33-30 / OT"),
    **Opp RK**, **Opp FPTS**; BYE row; "Full Schedule" link.
  - **Fantasy Stats:** Year rows plus **3y Avg**, grouped passing / rushing / fantasy (yds, td,
    int, yds, td, fpts, fpts/g); "Full Career Stats".
  - **Fantasy Performance by Week:** chart.
  - **Rostered %** (e.g. 100%), **Start %** (95%), **Pos Rank** (#7 QB Rank).
  - **Fantasy News:** a RotoWire-sourced feed with headline, source, date, blurb and analysis
    expandable via "See More / See Less".

### CTE player drawer and profile spec

- **One component, two sizes:** a right-side **drawer** (desktop) or full-height sheet (mobile)
  opened from anywhere, plus a full page at `/players/:id` with the same tabs.
- **Tabs:** Overview · News · Game Log · Stats · Splits · **Contract & History** (salary, years,
  acquisition path such as drafted, auction or trade, transaction timeline, dead-cap exposure) ·
  Profile (bio).
- **Header actions:** Add/Claim · Drop · Propose trade · Watch · Compare. Always show the owner and
  cap context: "Owned by X · $23 · 2 yrs left".

---

## 11. Live scoring matchup page

### 11.1 DOM and data

**[V, scraper DOM from `/scoring/live/1/1`]**
- `.matchupDetailsContainer`, with a `.scoringTableHeader`.
- Team headers: `.teamLogo.homeTeamLogo` / `awayTeamLogo` (the viewer's team adds
  `.selectedTeamLogo`), `.homeTeamName` / `.awayTeamName`, `.homeOwners` / `.awayOwners`, and
  `.homeTeam.scoreCont` / `.awayTeam.scoreCont`.
- Regions: `.playerItemsMatchupContainer` holds `.homeStartersRegion`, `.homeBenchRegion`,
  `.awayStartersRegion` and `.awayBenchRegion`. A literal **"BENCH"** label sits between starters
  and bench.
- Player rows: `.playerLayoutContainer`, holding `.playerName a`, `.playerPos` ("POS | TEAM"),
  `.playerScoreRegion .playerScore` (live points) and `.projScore` (projected).
- A **"WEEK N"** label appears on the page.

**[V, app mockup]**
- **Header:** rank, live points and **projected** points for each side; record and seed; **PMR**;
  **win probability %**; team names; matchup label (e.g. "Championship").
- **Player row:** slot, short name, a **live stat line in CBS abbreviations** (e.g. "72 PAYD, PATD
  (28) 4 RUYD", "4 RUATT, 24 RUYD, RECPT, 20 REYD"), live points (7.28) and projected (22.4).
- **Below each player:** a **game-situation line**: NFL score, quarter, clock, down and distance,
  field position ("7 1st 1:52 • 2nd & 3, ARI 26 7").
- Players **yet to play** show opponent and kickoff ("@ SF Sun 8:20 PM"), a dash for points, and
  their projection.

**[V]**
- The 2014 release describes a "faster, sleeker **GameTracker**." Live scoring uses "no refresh"
  push.
- The Help Center has a "Live Scoring Tests" diagnostics page.
- Stats become **final Thursday 6:00 AM ET**, after stat corrections.

### 11.2 Layout

**[M]** A side-by-side two-column table (away left, home right), aligned row by row by **slot**,
with each slot label in a center column. Totals sit at the top and bottom. Bench is collapsed below.

A left or right rail lists **all league matchups** for the week, so you can switch games. Clicking
a player opens the stat breakdown (each stat category with points). Points update with a highlight.

### CTE Matchup spec

- **Header:** both crests, live score, projected final, **win-probability bar**, **players left**
  (and minutes remaining), and "Yet to play / Playing / Done" counts.
- **Body:** slot-aligned mirrored rows. The center column holds the slot label. Each side shows
  photo, name, pos chip, status pill (Pre / Q2 7:12 / Final), live points, projection and a
  sparkline.
  - Expanding a row reveals the scoring breakdown: stat → points.
  - A game-state chip for "in red zone" or "on field."
  - Bench sits below, collapsed, with an "optimal lineup would have scored X" note after games.
- **Week switcher** and **matchup switcher**, as a horizontal list of league games.
- **Mobile:** a vertical stack of rows with both players in each row (CBS app style), plus a sticky
  score header.

---

## 12. Standings

### 12.1 Overall and division standings

**[V]** Tables are `table.data.borderTop`, one per division:
- A **`tr.subtitle`** row names the division, e.g. "East Division".
- A `tr.label` row holds the column headers.
- `/standings/overall/{season}` shows past seasons.

**[V]** Columns as parsed by a 2026 scraper:

`Team | W | L | T | Pct | GB | Strk | (col 7: an integer count; likely weekly high-score count) | PF | (col 9) | PA`

**[M]** Columns 7 and 9 are probably "High pts weeks" and "PF Avg" or "Home/Away". Confirm in a
live league. CBS standings also commonly show Division record and Points Back.

### 12.2 Power Rankings

**[V]** `/standings/power-rankings` has the columns:

`Rank | Team | Record (pts) | Points (pts) | Breakdown (pts) | Power Score`

A composite of three components:
- win-loss record
- points scored
- **Breakdown**: the record you would have if you played every team every week (all-play)

### 12.3 Other standings

- **[V]** **Owner standings** at `/standings/owner`.
- **[M]** A **Breakdown** report (all-play record by week) and a **Playoff** picture or bracket.

### 12.4 Tiebreakers and playoffs

**[V, free-league rules]**
- Playoff head-to-head ties are broken by:
  1. combined passing, rushing and receiving yards of the active lineup
  2. defensive yards allowed
  3. the higher seed
- Standard seeding: 3 division winners plus 3 wildcards; seeds 1–2 get byes. Commissioner leagues
  customize this ("Custom Playoff Schedules" [V]).

### CTE Standings spec

- **Tabs:** Overall · Divisions · Power · All-Play · Playoff Picture · **Cap Standings** (cap room,
  dead cap, committed future dollars) · All-Time (by manager).
- **Columns:** Rank, Team, W-L-T, Pct, GB, Div record, PF, PA, Diff, Streak, Last 5, All-Play,
  Playoff odds (%), clinch or elimination markers (x / y / z / e).
- Show the active tiebreaker under the table. Hovering a tie shows why A ranks above B.

---

## 13. Schedule page

**[V]**
- The schedule renders week by week with a header **"WEEK 1 (Edit)"**. The commissioner gets an
  inline Edit link, and the editor lives at `/setup/commish-tools/schedule-edit`.
- Each row reads `Away Team`, `away score - home score`, `Home Team`, plus a **"Box"** link to the
  box score.
- CBS supports **multiple games per week per team** and custom playoffs.

**[M]** Filters for a single team's schedule, or by week. Playoff weeks are labeled (Quarterfinal,
Semifinal, Championship, consolation).

### CTE Schedule spec

- **Views:** By week (cards) · By team (season grid) · Playoff bracket (visual).
- Future weeks show projected scores. Rivalry and history badges show the head-to-head record.

---

## 14. Transactions log, add/drop and waivers

### 14.1 Log

**[V]** `/transactions/{season}/all/all_but_lineup`:
- The filter token `all_but_lineup` hides lineup moves.
- Pagination param `pageIndex-tableContainer-0=-999` shows all rows.
- **Columns** (td index): 0 (date/time) | 1 Team (link `/teams/{N}`) | 2 Players/Action | 3
  **Effective** (week).
- Row ids encode a unix timestamp. Trade legs share a timestamp prefix.
- One `<tr>` holds one team's leg. A cell can hold several `<br>`-separated actions (a waiver
  claim's add plus drop).
- Empty state: **"No Transactions for This Period."**

**[V]** Action vocabulary in the Players cell:
- **"Added"**, **"Dropped"**
- **"Signed for $X"** (FAB or salary signing)
- **"Traded from {Team}"**
- Pick legs:
  - **"{Year} Round {n} [(Original Owner)] - Draft Pick Traded from {Team}"** for future picks
  - **"Round {n}, (Overall Pick {x}) - Draft Pick Traded from {Team}"** for current-season picks
- **"{Player} Dead Cap Added / Dropped"** (salary-cap charge)
- Lineup-only entries: **"Activated"**, **"Benched"**, **"Moved to {slot}"**
- Each player renders as `a.playerLink` + `span.playerPositionAndTeam` ("WR • IND") +
  `span.playerIconsWrapper`.

**[M]** The type filter dropdown offers All · All but Lineup · Add/Drops · Trades · Lineup Changes
· Commissioner; there is also a team filter and a season selector. The 2014 release notes
"retooled transaction pages, featuring faster add/drop."

### 14.2 Add/Drop workflow

**[V]**
- Lives at `/transactions/add-drop`. It also opens from the player table (`?default_add=`).
- Paired add (`to-playerRow`) and drop (`from-playerRow`) selection, then a confirm step.
- Waiver claims carry `priority` (claim order) and `bid_amount` (FAB).
- Waiver order is available via the API.
- **Rules:**
  - Waivers process nightly (1–6 AM ET).
  - Players lock 5 minutes before kickoff.
  - Dropped players go on waivers.
  - The commissioner can add or drop for any team, even past transaction limits.

### CTE Transactions spec

- **Log** filters: type · team · week · player. Each row is an **event card**:
  - a trade shows both sides plus picks plus cap impact
  - a waiver shows the winning bid, losing bids (optional reveal) and priority
- **Claim flow:** pick player → pick drop (or "none" if room) → **FAB bid** with remaining budget
  shown → **contract terms preview** (salary = bid, years per league rule) → confirm.
  - A **pending claims** list allows drag-reorder of priority.
- Every transaction has a permalink and a comment thread.

---

## 15. Trade page (propose-trade flow)

**[V]**
- The Trade page lives at `/transactions/trade/`. Rules text refers to the **"My Team, Trade
  page"** for monitoring offers.
- Trades can be **unbalanced multi-player** deals (e.g. 3-for-1). An illegal roster after a trade
  is allowed, but must be fixed before the lineup deadline.
- **Voting and review (free leagues):** a 24h+ voting period. Four "dispute" votes send the trade
  to the commissioner. Trades process overnight (12–6 AM ET).
- Commissioner leagues set their own rules ("decide how your league deals with trades").
- A **Trade Evaluator** exists ("Trade Evaluator" feature [V]).
- **Future draft picks are tradable** ("future draft pick trading" [V]).
- Commissioners can **make and process trades for any team** (Commish Tools → Roster Management →
  Trades [V]).

**[M]** The flow:
1. Choose a trade partner (team dropdown).
2. A two-column roster view appears: your players on the left, theirs on the right, each with
   checkboxes, plus draft picks.
3. Optionally choose players to drop to make room.
4. Add a message and an expiration.
5. "Propose Trade."
6. The recipient gets an inbox notice and can Accept, Reject or Counter.
7. A pending trade appears on both teams' Trade pages with a Cancel option.
8. League members can view pending trades and vote to veto or dispute.

The Trade Evaluator shows a projected-points delta.

### CTE Trade Center spec (salary-cap dynasty)

- **Builder:** two (or more) team columns. Assets are players, **future picks by year and round
  with original owner**, and **FAB dollars** (if allowed).
- **Live validation:** cap room after the trade for each team (this season and next), roster limit
  after the trade, contract implications, and the trade deadline.
- **Evaluator panel:** projected points ROS, dynasty value delta, age curve and cap delta.
- **States:** Draft → Proposed → Countered → Accepted → Review (veto window countdown) → Processed
  / Vetoed / Expired. Each has a timeline and a comment thread.
- **Trade block:** owners list available players and needs. Show league-wide "open offers" counts.

---

## 16. Draft: Draft Central, results, live room and auction room

### 16.1 Draft types and setup

**[V]**
- "Salary Cap, Snake, Offline, Extended and hybrid options." Also Live Drafts, **Live Salary Cap
  Drafts**, Automated Drafts and Extended Drafts.
- Offline results can be entered live or after the draft.
- Custom draft orders.
- **Draft Central** page; a **"Draft Room" button** on the League home page on draft day.
- **Draft Queue:** a priority list for your next pick. On timeout the room auto-picks the top
  queued player, then falls back to the **Rank List**. Rank lists can be one overall list or six
  positional lists.
- **90-second pick timer** in free leagues.
- Commissioners can set the draft order manually (feed item "Manual Draft Order Set").

### 16.2 Draft results

**[V]** `/draft/results/{year}:{draftId}:{draftName}` with a **draft-history dropdown**. A league
can hold several draft events per season, e.g. "Pre-season", "Free Agency", "Reset Auction",
"Auction v2".

**[V] Auction results by team:** the table has a team-name row (single cell), then these columns:

`POS | Player | Salary | ELIG | Total FPTS | Active FPTS`

**[V] Auction results by nomination** (`/nomination` view):

`Nomination # | Team | Player (POS • TEAM) | Salary`

- The salary link (`a.salaryBid`) carries the **entire bid history** inline:
  `data-bids="Team:-:Amount;-;Team:-:Amount;..."`.

**[M]** Snake results views: By Round · By Team · Grid (board). Each shows pick number, round.pick,
team and player.

### 16.3 Live draft room (snake)

**[V]**
- The newer room is at `/draft/live/room2`, with a **"DRAFT RESULTS"** panel listing picks as
  `pick# | team | "Last, First, POS, TEAM"`.
- **App draft board [V mockup]:**
  - team header avatars across the top (e.g. "Da Bears", "Sunday Kings", "Gridiron Guru")
  - a snake grid of cards labeled **"round.pick (overall)"** (e.g. "2.10 (20)"), then player short
    name, position and **"Bye: N"**
  - cards **color-filled by position** (RB teal-green, WR blue, TE purple, QB magenta, DST orange)
  - the current slot shows a **"1:30 On the Clock"** countdown
- **Complaint [V]:** "difficult to track picks preceding mine."

**[M]** Desktop layout:
- **Top bar:** round and pick ("Round 3 · Pick 5 · #29 overall"), countdown, "On the clock: TEAM",
  "Your next pick in N", sound toggle, settings, Exit.
- **Center:** Available Players table, filterable by position tabs, search, hide-drafted toggle and
  NFL team. Columns: Rank / ADP / Player / Bye / Proj / last-season pts / Draft and +Queue buttons.
- **Right:** tabs **Queue** (drag to reorder) · **My Roster** (slots filled) · **Results** (latest
  picks) · **Chat**.
- A toggle swaps the **Draft Board** grid in for the table.

### 16.4 Auction (salary-cap) room

**[V]** Live Salary Cap Drafts exist, with nomination order and bidding. Bid history is retained.

**[M]** Layout:
- **The block:** nominated player card, **current high bid** and bidder, countdown that resets on
  each bid, bid buttons (+$1, +$5, custom) and **"Max you can bid: $X"**.
- **Nomination panel:** when it's your turn, choose a player and an opening bid.
- **Budgets table:** Team · $ Left · Spots Left · **Max Bid** · roster preview.
- **Results feed:** player, winning team, price.

### CTE Draft spec

**Rookie draft (snake, with traded picks)**
- Board cells show the **current owner and "via ORIG"** for traded picks.
- "Trade pick" is available from the board.
- **Pick tracker strip:** the last 5 picks plus the next 5, always visible. This fixes the
  "hard to track prior picks" complaint.

**Free-agent auction (CTE's equivalent of CBS "Free Agency" draft events)**
- **Budgets:** $ left, max bid, spots left, and **next-season cap impact** for each team.
- **Contract years** chosen at win time, if the league uses that rule.
- Full **bid history** per lot, plus an exportable results table matching CBS's "nomination" and
  "by team" views.

**Pre-draft**
- Rank list, queue, mock draft, ADP/value sheets and **keeper/contract deadline** checklists.

---

## 17. Message board, league feed and chat

**[V]**
- Message Board & Chat, posting **stories with images and video**, and a **league email address**.
- Notifications for message-board posts.
- Feed items (API) have:
  - `subject`, `body`, `author_name` / `author_team` / `author_logo`
  - `to` ("Everyone" or a target), `is_private`, `pinned`, `reply_ids` (threaded replies)
  - `views`, `created`, `modified`
  - `type`: `add_drop`, `commissioner_message_tool`, and others
- System events (add/drops) and commissioner messages appear in the **same feed** as owner posts.
- **Complaint [V]:** "You post something and it's just buried shortly thereafter."
- The page also embeds a **chat** config (the viewer's team object sits beside it) **[V]**.

**[M]**
- **Message board list columns:** Subject · Author · Replies · Views · Last Post.
- **Composer:** subject, body (rich text), recipient (Everyone or specific owners), attach image.
- Commissioners can pin posts and delete or move them.

### CTE spec

- Separate **Chat** (realtime, threaded, reactions, @mentions, GIFs) from **Board** (long-form
  posts, pinned rules, weekly recaps).
- System events go in their own filterable lane, so they never bury owner posts.
- Unread counts appear on the nav. Weekly AI or auto-generated recaps are optional.

---

## 18. Polls (and WDIS)

**[V]**
- **Custom Polls** is a Commissioner feature. The home page loads a **"Who Do I Start"** question
  widget (`/data/common/fantasy/wdis/get-question/`).

**[M]**
- **Poll module on home:** question, radio options, Vote button, then a results bar chart with
  percentages and a vote count.
- **The commissioner creates polls:** question, options, open and close dates, anonymous or
  public.
- **A Polls page lists active and past polls.**

### CTE spec

- **Polls:**
  - single or multi choice, anonymous toggle, close time
  - quorum and "binding vote" flags for rule changes
  - results visible after voting
- **Start/Sit asks:** an owner posts "A or B?" and leaguemates vote.

---

## 19. League section: details, owners, history and records

**[V]**
- The **League Details** page (from the League dropdown) has these blocks:
  - **LEAGUE IDENTITY**: rule | setting
  - **ROSTER LIMITS**: Position | Min | Max | Total
  - **SCORING SYSTEM**: category | name | points, 3 columns
  - **DRAFT SETTINGS**: rule | setting
  - other league settings: rule | setting
- **Owners** tab: Team | Owner name | ... | Email.
- **Rules** page at `/rules`.
- **League History** at `/history` and `/history/year-by-year/`. "Robust league history that keeps
  track of your highlights" and "Detailed League History Area."
- **Owner standings** at `/standings/owner`.
- **Co-managers** are supported (Commish Tools → League Setup → Teams and Managers).

**[M]** Trophy room or champions list, league records (highest score, biggest blowout, longest
streak), season archives.

### CTE spec

- **Rules:** a readable rulebook (Markdown) plus auto-generated settings tables, with
  "last changed by and when."
- **History:** Champions · Season-by-season · Records · Head-to-head · Manager profiles · **Contract
  & trade history** · Draft history.

---

## 20. Commissioner home (Commish Tools)

### 20.1 Layout

**[V via help-article excerpts]** The Commish Tools page is organized in **columns of
categories**:

- **League Setup** (left column)
  - **General** subsection: *Teams and Managers* (Manage Teams page; add co-managers)
  - **Manager Permissions** subsection: *Team Manager Permissions*
- **Roster Management**
  - *Add/Drop*: add or drop for any team; can submit a waiver or FAB claim instead; can exceed
    transaction limits
  - *Trades*: make or process trades for any team
- **Draft Management** (middle column)
  - *Draft Set Up*
  - *Online Live Draft*
- Schedule editing at `/setup/commish-tools/schedule-edit` **[V]**
- **Commissioner Message Tool** posts to the feed, e.g. "Manual Draft Order Set" **[V]**
- **Older path names [V, forum]:**
  - *Commish Tools / League Settings / Set Transaction Policies*
  - *Commish Tools / Tools / In-season Rosters* with a **"Start Waivers"** button
- **Mobile [V]:** League icon → gear icon → Commish Tools.

**[M]** Other likely links:

| Category | Likely links |
|----------|--------------|
| League Setup | League name, URL, logo; Divisions; Roster positions and limits; Scoring system; Schedule and playoffs; Transaction rules (waivers, FAB, trade review); Keepers and contracts; Invite owners; Renew league |
| Roster Management | Lineup changes for any team; Keeper selection; Edit salaries and contracts; Waiver order and FAB budgets; Undo transactions |
| Scoring | Stat corrections and overrides ("Override Options" [V]); Edit matchup results |
| Communication | Message tool; Email league; Polls; Message-board moderation |
| Draft Management | Draft order; Enter offline results; Reset draft |

### CTE Commissioner home spec

- **Dashboard first:**
  - **Action queue**: trades awaiting review, illegal lineups, cap violations, contract deadlines,
    unpaid dues, pending waivers
  - **Season phase controls**: Offseason → Keeper/Contract deadline → Auction → Rookie draft →
    Regular season → Playoffs
  - **Audit log** of every commissioner action
- **Tool groups:** League Settings · Teams & Managers · Rosters & Contracts · Cap & Finances ·
  Transactions & Trades · Draft & Auction · Schedule & Scoring · Communication · Data
  (import/export).
- Every commissioner override logs who, what and when, and **notifies affected owners**.

---

## 21. Mobile IA (CBS app, for reference)

**[V, app mockup]**
- **Bottom tabs:** **Roster · Matchup · Research · Advice · League**.
- **Team screen action tiles:** **Player · Trades · Waivers · News · More**.
- **Pills:** "Week 1" selector, "Overview" view pill.
- **Draft board:** a full-screen sheet with ✕ close.

**[V, 2014 release]** "Jump between teams in two taps," live mobile drafting, "do everything on
mobile that they can do on their computers."

**[V, user report]** The mobile app is considered easier than the desktop lineup page.

### CTE mobile-first

- The bottom bar is **Home · Team · Matchup · Players · League**.
- Commish lives inside League.
- A floating context action: **"Set lineup"** in season, **"Bid"** during the auction, **"Pick"**
  during the draft.

---

## 22. Visual style (density, color, type, tables)

### 22.1 CBS public site design tokens, current

**[V from CSS fetched from cbssports.com]**

| Role | Value |
|------|-------|
| Brand primary blue | `#004ace` (default `--custom-color-primary`) |
| Hover / darker blue | `#0036b5` |
| Bright blue | `#0064ff`, `#4383fa` |
| Blue tint (selected or hover rows) | `#f5f8ff` |
| Near-black (header bar, text) | `#101010`, `#181818`, `#212121` |
| Text grays | `#333`, `#484848`, `#5f5f5f`, `#767676`, `#8f8f8f` |
| Borders and dividers | `#dcdcdc`, `#c8c8c8`, `#e8e8e8` |
| Surfaces | `#fff`, `#f2f2f2` |
| Red (live, alerts, loss) | `#eb2a2a`, `#e10500`, `#f94343` |

- Team and league theming uses `--team-color-primary/secondary` and `--league-color-*` variables,
  so pages can tint to an NFL team's colors.
- **Typography:** "TT Norms" (geometric sans), with a narrow variant. The marketing hero uses a
  condensed, heavy all-caps display face.
- **Older league pages** (about 2015) loaded Proxima Nova and Jubilat **[V, saved CBS HTML]**.

### 22.2 League page density and tables

**[V]** Class names: `data`, `data3`, `pinHeader` (sticky header), `borderTop`, `row1/row2` zebra,
`label` (header row), `title`, `subtitle`, `bgFan` (my-team highlight), `box-Rg box-white`
(boxed module).

**[M]**
- Very dense desktop tables: roughly 11–12px body text, 22–26px rows, uppercase small header
  labels on a light-gray band.
- Thin 1px gray rules and alternating white and very-light-gray rows.
- Blue links for player and team names.
- Positive numbers in green, negative or alerts in red.
- Modules are white boxes with a bold uppercase title bar.
- A wide fixed-width centered layout (roughly 1000–1200px) with a right rail for ads or modules.

### 22.3 App style, modern

**[V mockup]**
- White cards with large radii (about 16–24px) and soft gray dividers.
- Bold dark names, tiny gray uppercase labels ("PROJ").
- **Position color-coding** on outlined slot badges, filled chips and draft-board cells.
- **Green or red opponent text** for matchup quality; red single-letter injury tags.
- Pill segmented controls, a horizontally scrolling action-tile row and a bottom tab bar.

### CTE style direction

Original, with no CBS colors used as identity.
- **Pick our own brand palette**, e.g. a deep slate or ink base with a single accent that is
  **not** CBS blue. Define tokens (`--bg`, `--surface`, `--border`, `--text`, `--muted`,
  `--accent`, `--pos-qb` ... `--pos-dst`, `--good`, `--bad`, `--warn`), with full **light and
  dark** themes.
- **Position colors are a common industry convention** and fine to use, but choose our own hues.
  Always pair color with the text label for accessibility.
- **Density modes:** "Comfortable" (default on mobile) and "Compact" (tables at 13px with 32px
  rows on desktop). Use tabular numerals (`font-variant-numeric: tabular-nums`). Right-align
  numbers and pin the first two columns on horizontal scroll.
- **Type:** a free, legible UI sans with good tabular figures (e.g. Inter or IBM Plex Sans), plus
  an optional condensed display face for headings.

---

## 23. CBS salary-cap and dynasty features to match (and beat)

**[V unless marked]**

**Contracts and keepers**
- **Keepers:** unlimited, "with detailed long-term contracts." Options cover how many keepers, how
  keepers are selected, the keeper deadline, and draft impact. "We also include salary and contract
  information."

**Roster, cap and picks**
- **Roster columns:** Salary and Contract (years).
- **Stats reports:** "salary info" at team scope.
- **Dead cap:** "{Player} Dead Cap" pseudo-players on rosters (Pos = "DC") and transaction entries
  "Dead Cap Added / Dropped." The amount is not shown on the transaction page; it lives on the
  roster.
- **Future draft-pick trading** with an original-owner annotation.

**Acquisition**
- **FAB** ("Free Agent Budget"), waivers, or a custom process. Signings are logged as
  "Signed for $X."
- **Free-agent auctions** are separate draft events, e.g. "{Year}:2:Free Agency", with nomination
  order and full bid history.

**League-wide**
- **History retention** across seasons; all league data carries over on renewal.
- **Up to 30 teams**, multiple games per week, custom playoffs, AFC-only / NFC-only player pools.
- **Pricing context:** Commissioner costs $179.99 per league per season ($149.99 early),
  with a 14-day free trial.

**Commissioner gap [I]:** there is no single cap dashboard. CTE can win here with a **League Cap
Table** at `/league/cap`:
- teams × seasons (2026, 2027, 2028...)
- committed salary, dead cap, cap room, roster count, contracts expiring
- drill-down into each team's ledger

---

## 24. UX improvements CTE Dynasty should make (beyond CBS)

1. **Sticky live scoreboard strip** on every in-season page. It shows win %, projected final and
   players left, updates in real time, and puts my matchup first (section 6).
2. **Command palette (Cmd/Ctrl+K)**: jump to any player, team, page or action ("Propose trade to
   ...", "Add Puka Nacua", "Set lineup"). Fuzzy search with recent items.
3. **Mobile-first lineup editing**: two-tap swap, drag-and-drop, valid-slot highlighting, lock
   countdowns, instant save with Undo, and an "Optimize lineup" preview diff. This replaces CBS's
   dropdown-driven desktop lineup page.
4. **Dark mode plus density toggle** (Comfortable / Compact), remembered per user.
5. **Always-visible cap context**: a header chip with cap room, dead cap and roster count against
   the limit. Every add, claim, trade or bid shows a **before/after cap preview** and blocks
   illegal moves with a clear reason.
6. **League Cap Table and contract ledger**: multi-season committed dollars, expiring contracts,
   dead cap, and cut-cost calculator per player.
7. **Unified player drawer** (instead of modal popups and separate pages) with deep-linkable URL
   state (`?player=123&tab=news`). Back and forward work and the drawer is shareable.
8. **Trade Center 2.0**: multi-team, picks with original owner, FAB, live roster and cap
   validation for this year and next, evaluator panel, counter-offers, trade block, veto timeline,
   and per-trade discussion.
9. **Searchable team switcher with logos** (fixes CBS's clunky "Select a Team" `<select>` in
   leagues of more than 8 teams) and a "jump between teams in two taps" pattern on desktop too.
10. **Feed that never buries posts**: separate lanes for Chat, Board, Transactions and Commish.
    Pinned items, unread markers, reactions and threads.
11. **Draft and auction room upgrades**: an always-visible "last 5 / next 5 picks" tracker,
    traded-pick ownership on the board, nomination and bid hotkeys, max-bid and next-season cap
    impact, a reconnect-safe clock, and full bid-history export.
12. **Saved table views and column chooser** on Players, Rosters and Stats (match CBS's custom
    saved reports, but self-serve), plus **CSV export** everywhere.
13. **Accessible status design**: injury tags as text pills (Q / D / O / IR / PUP / SUSP) with
    tooltips for the return estimate. Never color alone; WCAG AA contrast in both themes.
14. **Real-time notifications center** (in-app plus push or email): trade offers, waiver results,
    outbid alerts, lineup warnings (bye, injured or empty starter), contract deadlines, and
    commissioner actions affecting you.
15. **No layout shift, no ads, no disguised upsells**: reserve space for async modules and use
    skeleton loaders. Responsive tables pin the first column and scroll horizontally instead of
    breaking.
16. **Keyboard shortcuts** across the app: `g h` home, `g t` team, `g m` matchup, `/` search, `?`
    help overlay. Full keyboard access in the draft room.
17. **Commissioner action queue and audit log**: one place for everything that needs the
    commissioner, and a transparent public log of every override (fixes "dreadful commish tools").
18. **Season-phase-aware home**: home and nav adapt to Offseason / Contracts deadline / Auction /
    Rookie draft / Season / Playoffs, surfacing the one or two actions that matter now.
19. **Deep-linkable everything**: week, matchup, filters and table views live in the URL, so
    "look at this" links in chat land on the exact state.
20. **Explainable standings**: tiebreaker explanations, all-play, playoff odds and clinch markers.
    The power-ranking formula is shown openly (Record + Points + All-Play).
21. **Compare tool**: 2–4 players side by side (stats, schedule, contract, age curve), reachable
    from any table via checkboxes.
22. **Offline-tolerant PWA**: installable, caches the roster and rules, and queues lineup changes
    with a conflict warning if a lock passes.
23. **Rules-as-data**: settings drive both the UI validation and the human-readable rulebook, with
    a change history.

---

## 25. Brand guardrails (what NOT to copy)

- Copy **no** CBS / CBS Sports names, eye logo, wordmarks, "Commissioner" service mark,
  "GameTracker", "Fantasy Football Today" or other product names, imagery, illustration style or
  marketing copy.
- Do **not** use CBS's primary blue (`#004ace` family) or the black-bar plus blue-hero combination
  as our identity.
- Our own original terms are fine. Generic fantasy terms are fine too: "Live Scoring", "Matchup",
  "Power Rankings", "Trade Block", "Rank List", "Queue". Avoid CBS-specific coinages such as
  "PMR"; use "Players left" or "Minutes left".
- Screenshots in `docs/research/shots/` are for internal research only. Do not commit them to a
  public build, and do not trace from them.

---

## 26. Sources

### Public cbssports.com pages (fetched with curl)

- Fantasy football stats tables: `https://www.cbssports.com/fantasy/football/stats/` and
  per-position `/stats/{POS}/2026/ytd/stats/ppr/`. Gives filters, column groups and definitions.
- Roster trends: `https://www.cbssports.com/fantasy/football/trends/`
- Player pages: `https://www.cbssports.com/nfl/players/1824864/dak-prescott/` (bio) and `.../fantasy/`
  (fantasy tab).
- Fantasy app promo with live-HTML phone mockups: `https://www.cbssports.com/features/fantasy-app-download`
- Features chart: `https://www.cbssports.com/fantasy/football/games/chart`
- Commissioner FAQ: `https://www.cbssports.com/fantasy/football/games/commissioner/frequently-asked-questions`
- Create-a-league comparison: `https://www.cbssports.com/fantasy/modals/create`
- Football games landing: `https://www.cbssports.com/fantasy/games/football/`
- Free league rules (draft room, queue, waivers, trades, tiebreakers): `https://www.cbssports.com/fantasy/football/games/free/rules`
- 2014 league redesign press release: `https://www.cbssports.com/info/ir/press/2014/ff`
- Live Scoring Help Center: `https://www.cbssports.com/help/lps`
- Site CSS tokens: `https://www.cbssports.com/_next/static/css/esi/layout.css`, `page.css`

### GitHub code showing real CBS league URLs, DOM and payloads (via raw.githubusercontent.com)

- `jeffmacuga/ffl-cc`: `discovery_output/cbs_request_trace.jsonl` (2026 league home, team,
  lineup, player page and optimizer request trace), `api_league_feed_*.json`, `rosters_test.json`
- `rmaxsm/TRUFFLEdash` (salary-cap dynasty league on CBS):
  - `scrape/rosters.py`, `data/rosters.csv` (roster columns incl. Salary and Contract)
  - `scrape/transactions.py` (transaction log vocabulary, picks, dead cap)
  - `scrape/auctions.py` (FA auction results and bid history)
  - `scrape/weekly.py` (stats-main columns)
  - `legacy/dre/weeklyScripts/standings.py`
- `ben2b15/Fantasy-Dashboard`: `backend/src/adapters/cbs.ts` and `scripts/cbs-explore*.mjs`
  (live scoring DOM)
- `benbipes/krfc`: `scripts/update_weekly.py` (standings and power-ranking columns)
- `AMess33/scrape`: `League Settings/complete/CBSLeagueSettings.ts` (nav DOM, League Details
  blocks, Owners tab)
- `joshbaltzell/ff-slot-machine`: `extension/test/fixtures/cbs/README.md` and
  `transactions.json` (API routes, roster keys, positions, waiver-claim fields)
- `trevmon28/fantasy-draft-assistant`: `draft_watcher.py` (`/draft/live/room2`, DRAFT RESULTS
  panel)
- `alexdino2/major-league-fantasy-football`: `scripts/scrape-draft-results.js` (auction results
  columns)
- `runnersaw/ComplicatedLeague`: `data/commands.txt` (team, transactions and draft-results paths)
- `uberfastman/fantasy-football-metrics-weekly-report`: `ffmwr/dao/platforms/cbs.py` (API
  endpoints)
- FantasyPros CBS content script (archived in `Bihui-Jin/suppmaterial-impact-of-extensions-on-browser-performance`):
  `enhance_cbs_nfl.js` (`#teamPageSelect`, `#lineup_views`, `.fantasyHeaderNav`, `.editCell`,
  `.to-/from-playerRow`, `/players/rankings`)
- `uso-archive/data`: `data/usercss/148769.user.css` (ad containers on league pages)
- `TeamHG-Memex/page-compare`: `data/cbssports-1.html` (2015 CBS HTML; font families)
- `fagan2888/fantasy_football_scraping`: `login_pull.ipynb` (schedule page text "WEEK N (Edit)",
  "Box")

### Web-search summaries (CBS help-center excerpts and user reports; pages not directly fetchable here)

- CBS help: "As Commissioner, how can I make adds and drops for other teams?", "...make trades for
  other teams?", "How do co-managers work?", "How do I set up an Online Live Draft?" (help.football.cbssports.com
  / cbsi.my.site.com/fchc). Gives the Commish Tools column names.
- The Huddle forums: "Waivers using CBS Sportsline" (older Commish Tools paths, "Start Waivers").
- Footballguys forum "CBS Sportsline revamp" (complaints: feed burying, team selector, dropdowns,
  upsell links, commish tools).
- App Store / Google Play listings (GameTracker, live scoring, "draft room terrible; difficult to
  track picks preceding mine").
- FantasyPros CBS league-management review (pricing, features).
