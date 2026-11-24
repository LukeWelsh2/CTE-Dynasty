# CTE Dynasty: League Settings and Rules Catalog

Research date: 2026-11-24. This is the full list of settings for the CTE Dynasty settings JSON schema. It is built from what the CBS Sports Fantasy commissioner product, MyFantasyLeague (MFL), Fleaflicker and Sleeper let a commissioner set, plus common rules from salary-cap dynasty leagues (Reality Sports Online, league bylaws). It does **not** copy any branding. It takes only structure, setting names in our own words, and value ranges.

---

## 0. How to read this document

### 0.1 Provenance tags

Each setting has a tag that says where the evidence came from:

| Tag | Meaning |
|---|---|
| **[V:CBS]** | Checked on a public cbssports.com page this session. Sources: the managed free-league rules page (which shows CBS *defaults*), the Commissioner FAQ, the create-league comparison and the features chart. |
| **[V:SLP-API]** | Checked as a real key in Sleeper's public league JSON (`api.sleeper.app/v1/league/...`). I pulled about 80 leagues from the 2025 season and took the union of their `settings`, `scoring_settings` and `metadata` keys. Value meanings marked "inferred" are my reading of the data. |
| **[V:SLP-help]** | From the Sleeper help center or blog, read through search-engine excerpts. The help site itself could not be fetched from this container. |
| **[V:MFL]** | From MFL's features page or MFL user forums, through search excerpts. MFL hosts were blocked by the network proxy. |
| **[V:FLEA]** | From Fleaflicker help pages or forums, through search excerpts. Fleaflicker was blocked by the proxy. |
| **[V:other]** | From other public sources: RSO write-ups, league bylaws, NFL.com/ESPN help, FantasyPros, DynastyLeagueFootball. |
| **[M]** | From memory or general platform knowledge, not re-checked this session. Treat it as likely but unconfirmed. |
| **[R]** | A CTE Dynasty recommendation or extension. No platform offers it as named, but it is needed for a salary-cap dynasty league. |

### 0.2 Type vocabulary for the JSON schema

| Type | JSON form | Notes |
|---|---|---|
| `bool` | `true` / `false` | |
| `int` | integer | Give min and max in the schema. |
| `number` | float | Scoring values. Allow negatives. |
| `money` | number | In cap units (see `cap.unit`). Store as an integer of the smallest unit (for example tenths when `cap.decimalPlaces = 1`) to avoid float drift. |
| `percent` | number from 0 to 100 | |
| `enum<...>` | string | Allowed values are listed. |
| `week` | int from 1 to 18 | NFL week. `0` or `null` means none or disabled. |
| `dow` | enum `MON TUE WED THU FRI SAT SUN` | Day of week. |
| `time` | `"HH:mm"` | In `league.timeZone`. |
| `datetime` | ISO-8601 string | |
| `Tier[]` | `[{ "min": int, "max": int\|null, "pts": number }]` | Ranges include both ends. `max: null` means "or more". |
| `ScoreRule` | `number` **or** `{ "pts": number, "per": number, "positions"?: string[] }` | A bare number means points per one unit. `per` lets "1 point per 25 yards" stay an exact increment. |
| `teamId[]`, `playerId[]` | arrays of string IDs | |

### 0.3 Top-level shape of the settings document

```jsonc
{
  "schemaVersion": 1,
  "league":      { /* §1 */ },
  "season":      { /* §2 calendar and key dates */ },
  "roster":      { /* §3 slots, limits, IR, taxi */ },
  "lineup":      { /* §4 lock timing, auto-subs */ },
  "scoring":     { /* §5 global options plus every stat rule */ },
  "waivers":     { /* §6 */ },
  "faab":        { /* §6 */ },
  "trades":      { /* §7 */ },
  "cap":         { /* §8 */ },
  "contracts":   { /* §8 */ },
  "rookieScale": { /* §8 */ },
  "franchiseTag":{ /* §8 */ },
  "releases":    { /* §8 dead money */ },
  "keepers":     { /* §9 */ },
  "draft":       { "general": {}, "startup": {}, "rookie": {}, "supplemental": {} }, /* §10 */
  "playoffs":    { /* §11 */ },
  "schedule":    { /* §12 */ },
  "tiebreakers": { /* §13 */ },
  "commish":     { /* §14 */ },
  "fun":         { /* §15 */ }
}
```

Every setting should also carry **metadata** in the schema (not in the values file). This lets the settings UI and the read-only rules page be generated from the schema:

- `label`, `help` (a one-line tooltip), and `group` (for the UI tab).
- `lockPolicy`: one of `anytime`, `beforeDraft`, `beforeSeason`, `offseasonOnly`, `requiresLeagueVote`. CBS-style products let the commissioner change most rules at any time ([V:CBS] "any rule you set can be changed at any time"). For CTE we recommend locking scoring and cap rules in-season ([R]).
- `visibleToOwners`: bool. Almost everything is public on the rules page.

### 0.4 Sources consulted

- CBS managed-league rules (defaults for roster, scoring, waivers, trades and playoffs): https://www.cbssports.com/fantasy/football/games/free/rules
- CBS Commissioner FAQ (keepers, drafts, transactions, schedules): https://www.cbssports.com/fantasy/football/games/commissioner/frequently-asked-questions
- CBS create-league comparison (Free vs Commissioner; up to 30 teams; "1000+ scoring options"; "Salary Cap, Snake, Offline, Extended and hybrid" drafts; "Unlimited keepers with detailed long-term contracts"; "Multiple games/week, custom playoffs"): https://www.cbssports.com/fantasy/modals/create
- CBS features chart (Player Pool, Auction, League Size/Division, Waiver Wire, Roster Limit, Custom Playoff, Keeper/Dynasty, League History, Override options, Customizable URL, Trade Evaluator, Polls, Message Board and Chat, League Email): https://www.cbssports.com/fantasy/football/games/chart
- CBS Commissioner terms (stat-correction cutoff Thursday 6:00 a.m. ET): https://www.cbssports.com/info/about/tos/fbc
- Sleeper public API (live JSON key inspection): https://api.sleeper.app/v1/league/{id}, https://api.sleeper.app/v1/user/{id}/leagues/nfl/2025
- Sleeper help: taxi squads https://support.sleeper.com/en/articles/3640482-how-do-taxi-squads-work ; FAAB https://support.sleeper.com/en/articles/4678615-how-do-faab-and-waivers-work ; waiver types https://support.sleeper.com/en/articles/1876041-what-types-of-waivers-do-you-support ; playoffs https://support.sleeper.com/en/articles/2528718-custom-playoff-settings ; consolation vs toilet bowl https://support.sleeper.com/en/articles/2203534-consolation-bracket-vs-toilet-bowl ; trading https://support.sleeper.com/en/articles/4702096-trading-details ; auto-subs https://support.sleeper.com/en/articles/9731991-how-does-player-autosubs-work ; keeper round cost https://support.sleeper.com/en/articles/2219811-how-do-i-set-the-round-cost-for-a-keeper
- MFL features: https://home.myfantasyleague.com/features , https://home.myfantasyleague.com/feature-list/ ; MFL blind-bid forum threads at forums.footballguys.com
- Fleaflicker help: https://www.fleaflicker.com/help/commissioner-options , /help/waivers , /help/what-types-of-waivers-does-fleaflicker-offer , /help/ir-and-taxi-squad , /help/trading
- Salary-cap dynasty conventions: RSO introduction https://tiny.write.as/supercommish/introduction-to-realitysportsonline ; DLF "Salary Cap Confidential" series https://dynastyleaguefootball.com/2019/06/07/salary-cap-confidential-cap-penalties/ ; FantasyPros startup auction settings https://www.fantasypros.com/2025/08/startup-auction-league-rules-settings-fantasy-football/
- Rookie-draft order by Max PF (example bylaws): https://draftforthefuture.github.io/League/Draft.html
- Lineup-lock and trade-review option sets on other platforms: https://support.nfl.com/hc/en-us/articles/35869720023060-League-Settings , https://support.espn.com/hc/en-us/articles/115003938712-Lineup-Lock-Times

**Network limits this session:** only `cbssports.com` and `api.sleeper.app` could be fetched directly. MFL, Fleaflicker, the Sleeper help center, Reddit and Footballguys were blocked by the proxy, so those facts come from search excerpts and are tagged as such.

---

## 0.5 Platform capability matrix (summary)

"Yes" means native support. "Rules-only" means leagues enforce it by hand, through commissioner edits.

| Capability | CBS Commissioner | MFL | Fleaflicker | Sleeper |
|---|---|---|---|---|
| League size | up to 30 [V:CBS] | large, 32+ [M] | up to ~32 [M] | up to 32 [M] |
| Divisions | Yes [V:CBS] | Yes, plus conferences [M] | Yes [M] | Yes [M] |
| SuperFlex / custom flex | Yes [M] | Yes, with min-max position ranges [M] | Yes [M] | Yes (`SUPER_FLEX`) [V:SLP-API] |
| IDP | Yes [V:CBS "individual defensive players"] | Yes [M] | Yes [M] | Yes (`idp_*` keys) [V:SLP-API] |
| Taxi squad | Partial / reserve [M] | Yes [V:MFL] | Yes, eligibility by years [V:FLEA] | Yes (slots, years, deadline, vets) [V:SLP-API] |
| IR slots and status eligibility | Yes [M] | Yes [V:MFL] | Yes, minimum status [V:FLEA] | Yes (per-status toggles) [V:SLP-API] |
| Position-specific scoring | Yes, "points by position" [V:CBS] | Yes [M] | Yes [M] | Partial (bonus per position for rec and first downs) [V:SLP-API] |
| Yardage tiers and milestone bonuses | Yes, "yardage ranges" [V:CBS] | Yes, any range [M] | Yes [M] | Fixed bonus keys [V:SLP-API] |
| FAAB / blind bid | Yes [V:CBS] | Yes, conditional bids [V:MFL] | Yes [V:FLEA] | Yes [V:SLP-help] |
| Trade FAAB | ? | Yes [V:MFL] | ? | Yes [V:SLP-help] |
| Future pick trading | Yes [V:CBS] | Yes [V:MFL] | Keeper leagues only [V:FLEA] | Yes (`pick_trading`) [V:SLP-API] |
| Salary cap | Yes (salary-cap draft, contracts) [V:CBS] | Yes, hard or soft, per-team caps [V:MFL] | Auction keeper costs [M] | No (rules-only) [M] |
| Contracts (years) | Yes, "detailed long-term contracts" [V:CBS] | Yes [V:MFL] | No [M] | No [M] |
| Automatic salary escalation | ? | Yes (X% or $Y per season) [V:MFL] | ? | No |
| Dead money / cap penalties | Override tools [M] | Salary Adjustments [V:MFL] | No | No |
| Startup auction | Yes [V:CBS] | Yes, live and slow/email [M] | Yes [M] | Yes [M] |
| Median game | ? | Yes, all-play options [M] | ? | Yes (`league_average_match`) [V:SLP-API] |
| Guillotine | No [M] | Rules-only | No | Yes (`type: 3`) [V:SLP-API] |
| Best ball | ? | Yes [M] | ? | Yes (`best_ball`) [V:SLP-API] |
| Auto-subs | ? | ? | ? | Yes (`max_subs`) [V:SLP-help] |
| Multiple games per week | Yes [V:CBS] | Yes, double-headers [V:MFL] | ? | No (only the median game) |
| Two-week championship | Yes, custom playoffs [V:CBS] | Yes [M] | Yes [M] | Yes [V:SLP-help] |

---

## 1. General / League (`league.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `league.name` | string | — | 1–60 chars | all | |
| `league.shortName` | string | `"CTE"` | 2–8 chars | [R] | For compact headers, mobile tabs and box scores. |
| `league.slug` | string | `"cte-dynasty"` | `[a-z0-9-]{3,40}` | [V:CBS] customizable league URL | |
| `league.season` | int | current NFL season | 2020–2100 | all | |
| `league.leagueType` | enum | `dynasty` | `redraft`, `keeper`, `dynasty`, `guillotine`, `bestBall` | [V:SLP-API] `settings.type` (0 redraft, 1 keeper, 2 dynasty, 3 guillotine; 3 inferred from `last_chopped_leg`), `best_ball` | CTE: `dynasty`. |
| `league.format` | enum | `h2hPoints` | `h2hPoints`, `totalPoints`, `allPlay`, `h2hCategories` | [V:CBS] H2H default; [M] CBS also offers points-only and roto | Football leagues are almost always H2H points. |
| `league.numTeams` | int | 12 | 4–32 | [V:CBS] up to 30; [V:SLP-API] `num_teams` (8–18 seen) | |
| `league.numDivisions` | int | 2 | 0 to `numTeams/2` | [V:CBS] default 3 divisions of 4 | 0 means no divisions. |
| `league.divisions` | `{id,name,teamIds[]}[]` | — | — | [V:CBS] | Division names are free text. |
| `league.conferences` | `{id,name,divisionIds[]}[]` | `[]` | — | [M] MFL | Optional level above divisions. |
| `league.timeZone` | IANA string | `America/New_York` | any IANA zone | [V:CBS] all CBS deadlines are in ET | Every `time` field is read in this zone. |
| `league.visibility` | enum | `private` | `private`, `public`, `publicReadOnly` | [V:CBS] public / private / "winners" leagues | `publicReadOnly` lets outsiders see standings without joining ([R]). |
| `league.inviteMode` | enum | `link` | `link`, `password`, `commissionerDirect` | [V:SLP-API] `commissioner_direct_invite` | |
| `league.coOwnersAllowed` | bool | true | — | [M] CBS and Sleeper co-owners | |
| `league.maxManagersPerTeam` | int | 2 | 1–4 | [R] | |
| `league.playerPool` | enum | `all` | `all`, `afcOnly`, `nfcOnly`, `custom` | [V:CBS] "just AFC players, just NFC, or both" | |
| `league.positionsUsed` | string[] | `["QB","RB","WR","TE"]` | `QB RB WR TE K DST DL LB DB DE DT CB S P HC` | [V:CBS] choose positions; [M] MFL has P and HC | Drives which scoring sections show. |
| `league.statCorrectionCutoff` | `{dow,time}` | `{THU,"06:00"}` | any | [V:CBS] corrections final Thursday 6:00 a.m. ET | Corrections after the cutoff do not change results. |
| `league.renewal.autoContinue` | bool | true | — | [V:SLP-API] `metadata.auto_continue` | Rolls the league into the next season. |
| `league.renewal.carryOver` | object of bools | all true | `rosters`, `rules`, `scoring`, `history`, `faab`, `waiverOrder` | [V:CBS] renewal keeps rosters, rules and scoring | |
| `league.history.enabled` | bool | true | — | [V:CBS] League History area (past winners, standings, power rankings) | |
| `league.constitution` | markdown string | `""` | ≤ 50 KB | [M] custom rules text on CBS and MFL; [R] | Shown on the Rules page above the generated rules. |
| `league.messageBoard.enabled` | bool | true | — | [V:CBS] | |
| `league.chat.enabled` | bool | true | — | [V:CBS] | |
| `league.newsPosts.enabled` | bool | true | — | [V:CBS] commissioner news stories with images and video | |
| `league.polls.enabled` | bool | true | — | [V:CBS] custom polls | |
| `league.email.enabled` | bool | true | — | [V:CBS] league email address and e-reports | |
| `league.dues.amount` | money (real currency) | 0 | ≥ 0 | [M] MFL accounting page | Kept separate from cap money. |
| `league.dues.payouts` | `{place:int\|"weeklyHigh"\|"regSeasonChamp", amount?:number, percent?:number}[]` | `[]` | — | [M]/[R] | |
| `league.dues.trackPayments` | bool | false | — | [M] MFL accounting | |
| `league.trophies.winner` | `{name,bannerText,icon}` | — | — | [V:SLP-API] `metadata.trophy_winner`, `trophy_winner_banner_text` | |
| `league.trophies.loser` | `{name,bannerText,icon}` | — | — | [V:SLP-API] `metadata.trophy_loser` | See §15, last-place rules. |

---

## 2. Season calendar and key dates (`season.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `season.regularSeasonStartWeek` | week | 1 | 1–4 | [V:SLP-API] `start_week` | |
| `season.lastRegularSeasonWeek` | week | 14 | 8–17 | [V:CBS] regular season is the first 14 weeks | |
| `season.playoffStartWeek` | week | derived (= last + 1) | — | [V:SLP-API] `playoff_week_start` (15 most common) | Stored for Sleeper parity. Validate it is consistent. |
| `season.finalWeek` | week | 17 | 15–18 | [V:CBS] title game in Week 17 | Week 18 risks NFL teams resting starters. |
| `season.offseasonTransactions` | bool | true | — | [V:SLP-API] `offseason_adds` | Dynasty leagues need offseason adds, drops and trades. |
| `season.leagueYearRollover` | datetime | first Monday after the Super Bowl, or `03-01` | — | [R] | The moment contract years tick down, salaries escalate, the cap resets and dead money for the year rolls off. |
| `season.keyDates.startupDraftAt` | datetime | — | — | [R] | Year one only. |
| `season.keyDates.rookieDraftAt` | datetime | after the NFL Draft (May) | — | [R] | |
| `season.keyDates.keeperDeadline` | datetime | — | — | [V:CBS] "the date that keepers need to be determined by"; [V:SLP-API] `metadata.keeper_deadline` | |
| `season.keyDates.franchiseTagDeadline` | datetime | — | — | [R]/[V:other] RSO | |
| `season.keyDates.extensionDeadline` | datetime | — | — | [R] | |
| `season.keyDates.rfaDeadline` | datetime | — | — | [R] | |
| `season.keyDates.contractAssignmentDeadline` | datetime | before Week 1 lock | — | [M] MFL leagues set contract years by a deadline | |
| `season.keyDates.capComplianceAt` | datetime | before Week 1 lock | — | [R] | |
| `season.keyDates.rosterCutdownAt` | datetime | before Week 1 lock | — | [R] | Used when `roster.offseasonSize` is set. |
| `season.keyDates.freeAgencyAuction` | `{start,end}` | — | — | [V:other] RSO offseason FA auction | |
| `season.keyDates.tradeDeadline` | datetime | derived from `trades.deadline` | — | [V:CBS] | |

---

## 3. Rosters (`roster.*`)

### 3.1 Size and starting slots

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `roster.size` | int | 25 (dynasty); CBS managed default 14 | 9–60 | [V:CBS] 14-man default; [M] dynasty 22–30 | Active plus bench. IR and taxi are extra. |
| `roster.offseasonSize` | int\|null | null | `size`–80 | [R] | Larger limit until `rosterCutdownAt`. |
| `roster.starters` | map `SlotCode → int` | `{QB:1,RB:2,WR:3,TE:1,FLEX:2,SUPER_FLEX:1}` | 0–5 per slot | [V:CBS] default QB1 RB2 WR3 TE1 K1 DST1; [V:SLP-API] `roster_positions` | |
| `roster.bench` | int | derived = `size − Σstarters` | — | [V:SLP-API] `BN` entries | |
| `roster.customSlots` | `{code,label,eligible[]}[]` | `[]` | — | [R] (MFL allows arbitrary position ranges [M]) | For example `{code:"OP",label:"Offensive Player",eligible:["QB","RB","WR","TE"]}`. |
| `roster.positionMax` | map `Pos → int\|null` | all null | 0–20 | [V:SLP-API] `position_limit_qb/rb/wr/te/def` | Roster-wide caps, for example a maximum of 4 QBs to stop SuperFlex hoarding. |
| `roster.positionMin` | map `Pos → int` | all 0 | 0–5 | [M] MFL | |
| `roster.draftPositionMax` | map `Pos → int\|null` | null | — | [V:CBS] live draft maximum per position (2 QB, 5 RB, 5 WR, 2 TE, 2 K, 2 DST) | Applies only during the draft. |
| `roster.allowEmptyStarterSlots` | bool | true | — | [V:CBS] "may use fewer players... without penalty" | |
| `roster.illegalRosterPolicy` | enum | `blockMovesUntilFixed` | `zeroPointsForWeek`, `blockMovesUntilFixed`, `commishResolves` | [V:CBS] an illegal lineup scores 0; [V:SLP-help] over-limit rosters cannot make changes | |
| `roster.positionEligibility.source` | enum | `providerWithOverride` | `provider`, `providerWithOverride` | [V:CBS] the commissioner decides dual eligibility | |
| `roster.positionEligibility.allowDual` | bool | true | — | [V:CBS] | |
| `roster.idpMode` | enum | `none` | `none`, `consolidated` (DL/LB/DB), `granular` (DE/DT/LB/CB/S) | [M] | |
| `roster.teamDefenseMode` | enum | `none` for CTE (or `dst`) | `none`, `dst`, `defPlusSt` (separate DEF and ST units) | [V:CBS] team DST unit counts as one player; [M] | |

**Slot code catalog** (each slot's eligible positions):

| SlotCode | Eligible | Source |
|---|---|---|
| `QB`, `RB`, `WR`, `TE`, `K` | itself | [V:SLP-API] |
| `DST` (Sleeper `DEF`) | team defense | [V:SLP-API] |
| `FLEX` | RB, WR, TE | [V:SLP-API] |
| `WRRB_FLEX` | RB, WR | [M] Sleeper |
| `REC_FLEX` | WR, TE | [M] Sleeper |
| `SUPER_FLEX` | QB, RB, WR, TE | [V:SLP-API] |
| `OP` (offensive player) | QB, RB, WR, TE, K | [M] MFL/CBS-style |
| `DL`, `LB`, `DB` | consolidated IDP | [M] Sleeper / MFL |
| `DE`, `DT`, `CB`, `S` | granular IDP | [M] MFL / CBS |
| `IDP_FLEX` | DL, LB, DB | [M] Sleeper |
| `P` | punter | [M] MFL / CBS |
| `HC` | head coach | [M] MFL |
| `BN` | any | [V:SLP-API] |
| `IR`, `TAXI` | see §3.2–3.3 | [V:SLP-API] |

### 3.2 Injured reserve (`roster.ir.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `roster.ir.slots` | int | 2 | 0–10 | [V:SLP-API] `reserve_slots` (0–3 seen) | |
| `roster.ir.eligibleStatuses` | enum[] | `["IR","PUP","NFI","OUT","SUSPENDED"]` | `IR`, `PUP`, `NFI`, `OUT`, `DOUBTFUL`, `QUESTIONABLE`, `SUSPENDED`, `COVID`, `NA` (not active), `DNR` | [V:SLP-API] `reserve_allow_out/doubtful/sus/cov/na/dnr`; [V:FLEA] a minimum-status setting such as "Out, PUP, IR" | NFL IR is always eligible. |
| `roster.ir.allowInOffseason` | bool | true | — | [R] | Lets owners stash players who were injured at season's end. |
| `roster.ir.activationPolicy` | enum | `blockMovesUntilActivated` | `none`, `blockMovesUntilActivated`, `autoMoveToBench` | [M] Sleeper blocks moves when an IR player is no longer eligible | |
| `roster.ir.countsTowardRosterSize` | bool | false | — | [M] | |
| `roster.ir.capChargePercent` | percent | 100 | 0–100 | [V:MFL] injured players can optionally count against the cap | |
| `roster.ir.minWeeksOnIr` | int | 0 | 0–8 | [R] | NFL-style anti-churn. |
| `roster.ir.tradeable` | bool | true | — | [M] | |

### 3.3 Taxi squad (`roster.taxi.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `roster.taxi.slots` | int | 3 | 0–10 | [V:SLP-help] 0–10; [V:SLP-API] `taxi_slots` | |
| `roster.taxi.eligibility` | enum | `maxExperience` | `rookiesOnly`, `maxExperience`, `anyPlayer` | [V:FLEA] rookies, rookies plus 1st-year, rookies plus 2nd-year, or any (default) | |
| `roster.taxi.maxExperienceYears` | int | 1 | 0–3 | [V:FLEA]; [V:other] league examples use 1 and 2 | Years of NFL experience a player may have to stay eligible. |
| `roster.taxi.maxYearsOnTaxi` | int | 3 | 1–4 | [V:SLP-API] `taxi_years`; [V:SLP-help] "Taxi Years 3 means a rookie must come off in his 4th year" | |
| `roster.taxi.allowVeterans` | bool | false | — | [V:SLP-API] `taxi_allow_vets` | |
| `roster.taxi.deadlineWeek` | week | 1 | 0 (none) to 18 | [V:SLP-API] `taxi_deadline` (0 and 4 seen); [V:SLP-help] a deadline for finalizing taxi | After the deadline players can only be promoted. |
| `roster.taxi.addSources` | enum[] | `["rookieDraft"]` | `rookieDraft`, `startupDraft`, `freeAgency`, `waivers`, `trade` | [V:SLP-help] FA pickups must go to the active roster first | A player traded for may keep his taxi status if still eligible ([R]). |
| `roster.taxi.allowReturnAfterPromotion` | bool | false | — | [V:SLP-help] common rule "no return once activated" | |
| `roster.taxi.countsTowardRosterSize` | bool | false | — | [V:SLP-help] does not count against the roster limit | |
| `roster.taxi.capChargePercent` | percent | 50 | 0–100 | [R] | Many cap leagues discount taxi salaries. |
| `roster.taxi.playersCanStart` | bool | false | — | [M] | |
| `roster.taxi.tradeable` | bool | true | — | [M] | |
| `roster.taxi.poaching.enabled` | bool | false | — | [V:SLP-help] Sleeper does not support taxi raiding; [V:other] league bylaws ban "taxi sniping" | |
| `roster.taxi.poaching.ownerCanMatch` | bool | true | — | [R] | The owner can promote the player to keep him. |
| `roster.taxi.poaching.compensation` | enum | `none` | `none`, `faab`, `draftPick`, `salaryRaise` | [R] | |
| `roster.taxi.poaching.salaryMultiplier` | number | 2.0 | 1–5 | [R] | The poacher pays the old salary times this multiplier. |

---

## 4. Lineups (`lineup.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `lineup.lockMode` | enum | `perPlayer` | `perPlayer` (each player at his own kickoff), `firstGameOfWeek` (the whole lineup at the week's first kickoff), `firstSundayGame`, `customWeekly` | [V:CBS] per-player locks; [V:other] ESPN and NFL.com offer per-player or first-game | |
| `lineup.lockOffsetMinutes` | int | 0 | 0–60 | [V:CBS] locks 5 minutes before the scheduled start | |
| `lineup.customWeeklyLock` | `{dow,time}` | `{SUN,"13:00"}` | — | [R] | Used only when `lockMode=customWeekly`. |
| `lineup.slotLocksWithOccupant` | bool | true | — | [V:CBS] once starters have played, a reserve cannot be activated into their slot | Once the player in a slot has kicked off, the slot is frozen. |
| `lineup.allowLateSwapFlex` | bool | true | — | [M] | A later-kickoff player can move into FLEX while the FLEX player has not played. |
| `lineup.benchLock` | bool | false | — | [V:SLP-API] `bench_lock` (meaning inferred: bench players also freeze at their kickoff) | |
| `lineup.defaultCarryOver` | enum | `previousWeek` | `previousWeek`, `optimalProjected`, `empty` | [V:CBS] last week's lineup is used if none is set | |
| `lineup.futureWeeksEditable` | bool | true | — | [M] CBS and MFL allow setting future weeks | |
| `lineup.autoSubs.maxPerWeek` | int | 0 | 0–3 | [V:SLP-API] `max_subs`; [V:SLP-help] "how many substitutions are allowed per week" | Automatically benches starters marked OUT. |
| `lineup.autoSubs.requireLaterKickoff` | bool | true | — | [V:SLP-API] `sub_start_time_eligibility`; [V:SLP-help] "Require AutoSub To Not Play Before Starter" | |
| `lineup.autoSubs.lockIfStarterActive` | bool | false | — | [V:SLP-API] `sub_lock_if_starter_active` (meaning inferred) | |
| `lineup.bestBall` | bool | false | — | [V:SLP-API] `best_ball` | The system picks the optimal lineup after the games. |
| `lineup.commishCanEditAfterLock` | bool | true | — | [M] CBS and MFL override tools | Every edit is logged (§14). |
| `lineup.eliminatedTeamsSetLineups` | bool | true | — | [R] | Needed for consolation brackets. |
| `lineup.alerts.emptyOrInactiveStarter` | bool | true | — | [V:CBS] fantasy alerts; [R] | Bye, OUT or empty-slot warnings. |

---

## 5. Scoring (`scoring.*`)

### 5.1 Global scoring options

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `scoring.decimalPlaces` | int | 2 | 0–3 | [V:SLP-API] float values | Shown precision. Store full precision internally. |
| `scoring.yardageMode` | enum | `fractional` | `fractional` (0.04 per yard), `increment` (whole points per N yards, floored), `rounded` | [V:CBS] "1 point for every 25 yards"; "Rounding will NOT be used... 49 yards = 4 points" | |
| `scoring.negativeYardage` | enum | `count` | `count`, `ignore` | [M] | For example −8 rushing yards gives −0.8. |
| `scoring.allowNegativePlayerScore` | bool | true | — | [V:SLP-API] negative tier values such as `yds_allow_550p = −7` | |
| `scoring.allowNegativeTeamScore` | bool | true | — | [R] | |
| `scoring.positionOverrides` | map `Pos → Partial<Rules>` | `{}` | any stat key | [V:CBS] "Set points by position"; [V:SLP-API] `bonus_rec_te`, `bonus_fd_*` | The general mechanism for TE premium, 6-point QB passing TDs, and so on. |
| `scoring.bonusStacking` | enum | `cumulative` | `cumulative` (100 and 200 both pay), `highestOnly` | [M] | |
| `scoring.returnTdCredit` | enum | `both` | `dstOnly`, `playerOnly`, `both` | [V:CBS] a return TD counts for the DST, not for an active WR | |
| `scoring.customStats` | `{key,label,formula}[]` | `[]` | — | [V:CBS] "create your own categories" | Advanced. |

**Rule encoding:** each stat below is a `ScoreRule`. For example `passYd: 0.04`, or `passYd: { pts: 1, per: 25 }` in increment mode. Tiered stats use `Tier[]`.

### 5.2 Passing

The "Sleeper key" column maps to Sleeper's `scoring_settings` key names. Every key in that column was seen in live JSON ([V:SLP-API]), so this table doubles as an import map from Sleeper.

| Key | Sleeper key | Unit | Typical default | Notes / source |
|---|---|---|---|---|
| `passYd` | `pass_yd` | per yard | 0.04 (1 per 25) | [V:CBS] 1 per 25; [V:SLP-API] 0.04 |
| `passTd` | `pass_td` | each | 4 | [V:CBS] 6 in managed leagues; Sleeper sample is mostly 4 |
| `passInt` | `pass_int` | each | −2 | [V:CBS] −2; Sleeper sample is mostly −1 |
| `passIntTd` | `pass_int_td` | each pick-six thrown | 0 | an extra penalty |
| `pass2pt` | `pass_2pt` | each | 2 | [V:CBS] 2 |
| `passAtt` | `pass_att` | each | 0 | |
| `passCmp` | `pass_cmp` | each | 0 | some leagues use 0.1–0.5 |
| `passInc` | `pass_inc` | each | 0 | for example −0.25 |
| `passSacked` | `pass_sack` | each | 0 | for example −0.5 |
| `passSackYd` | — | per yard lost | 0 | [M] MFL |
| `passFd` | `pass_fd` | each first down | 0 | |
| `passCmp40p` | `pass_cmp_40p` | each 40+ yard completion | 0 | long-play bonus |
| `passTd40p` | `pass_td_40p` | each 40+ yard TD | 0 | long-TD bonus |
| `passTd50p` | `pass_td_50p` | each 50+ yard TD | 0 | long-TD bonus |
| `passTdLengthTiers` | — | `Tier[]` on TD length | `[]` | [M] MFL-style ranges |
| `bonusPassYd300` | `bonus_pass_yd_300` | once per game | 0 | milestone |
| `bonusPassYd400` | `bonus_pass_yd_400` | once per game | 0 | milestone |
| `bonusPassCmp25` | `bonus_pass_cmp_25` | once (25+ completions) | 0 | |
| `passYdTiers` | — | `Tier[]` | `[]` | [V:CBS] "yardage ranges" |
| `passCmpPctTiers` | — | `Tier[]` on completion % | `[]` | [V:CBS] points for completion percentage |

### 5.3 Rushing

| Key | Sleeper key | Unit | Typical default | Notes |
|---|---|---|---|---|
| `rushYd` | `rush_yd` | per yard | 0.1 (1 per 10) | [V:CBS] 1 per 10 |
| `rushTd` | `rush_td` | each | 6 | [V:CBS] 6 |
| `rushAtt` | `rush_att` | each | 0 | |
| `rush2pt` | `rush_2pt` | each | 2 | |
| `rushFd` | `rush_fd` | each | 0 | first-down leagues use 0.5–1 (1 seen [V:SLP-API]) |
| `rush40p` | `rush_40p` | each 40+ yard run | 0 | |
| `rushTd40p` | `rush_td_40p` | each | 0 | |
| `rushTd50p` | `rush_td_50p` | each | 0 | |
| `bonusRushYd100` | `bonus_rush_yd_100` | once | 0 | |
| `bonusRushYd200` | `bonus_rush_yd_200` | once | 0 | |
| `bonusRushAtt20` | `bonus_rush_att_20` | once | 0 | |
| `bonusRushRecYd100` | `bonus_rush_rec_yd_100` | once (combined yards) | 0 | |
| `bonusRushRecYd200` | `bonus_rush_rec_yd_200` | once | 0 | |
| `rushYdTiers` | — | `Tier[]` | `[]` | |

### 5.4 Receiving

| Key | Sleeper key | Unit | Typical default | Notes |
|---|---|---|---|---|
| `rec` | `rec` | each reception | 1 (PPR); 0.5 half; 0 standard | |
| `recYd` | `rec_yd` | per yard | 0.1 | [V:CBS] 1 per 10 |
| `recTd` | `rec_td` | each | 6 | |
| `rec2pt` | `rec_2pt` | each | 2 | |
| `recFd` | `rec_fd` | each | 0 | |
| `recTgt` | — | each target | 0 | [M] MFL |
| `rec0_4`, `rec5_9`, `rec10_19`, `rec20_29`, `rec30_39`, `rec40p` | `rec_0_4`, `rec_5_9`, `rec_10_19`, `rec_20_29`, `rec_30_39`, `rec_40p` | each catch in that length band | 0 | "Tiered PPR" |
| `recTd40p`, `recTd50p` | `rec_td_40p`, `rec_td_50p` | each | 0 | long-TD bonus |
| `bonusRecYd100`, `bonusRecYd200` | `bonus_rec_yd_100`, `bonus_rec_yd_200` | once | 0 | |
| `bonusRecTe` | `bonus_rec_te` | per TE reception | 0.5 for a TE-premium league | **TE premium** ([V:SLP-API]; 1.0 seen) |
| `bonusRecRb` | `bonus_rec_rb` | per RB reception | 0 | |
| `bonusRecWr` | `bonus_rec_wr` | per WR reception | 0 | |
| `bonusFdQb`, `bonusFdRb`, `bonusFdWr`, `bonusFdTe` | `bonus_fd_qb`, `bonus_fd_rb`, `bonus_fd_wr`, `bonus_fd_te` | per first down by position | 0 | position-specific first-down bonus |
| `recYdTiers` | — | `Tier[]` | `[]` | |

### 5.5 Ball security and miscellaneous offense

| Key | Sleeper key | Unit | Typical default | Notes |
|---|---|---|---|---|
| `fum` | `fum` | each fumble (lost or not) | 0 | |
| `fumLost` | `fum_lost` | each | −2 | [V:CBS] −2, including fumbles on special teams |
| `fumRecTd` | `fum_rec_td` | offensive fumble-recovery TD | 6 | [V:CBS] 6 |
| `offFumRec` | — | own-team fumble recovered | 0 | [M] |

The 2-point conversion rules are in each section above (`pass2pt`, `rush2pt`, `rec2pt`). [V:CBS] scores a 2-point conversion at 2 points.

### 5.6 Individual returns and special teams (non-DST)

| Key | Sleeper key | Unit | Typical default | Notes |
|---|---|---|---|---|
| `krYd` | `kr_yd` | per yard | 0 | for example 0.04 |
| `prYd` | `pr_yd` | per yard | 0 | for example 0.1 |
| `krTd` | `kr_td` | each | 6 if returns are scored | |
| `prTd` | `pr_td` | each | 6 | |
| `stTd` | `st_td` | any special-teams TD | 6 | |
| `stFf` | `st_ff` | forced fumble on special teams | 0 | |
| `stFumRec` | `st_fum_rec` | each | 0 | |
| `stTklSolo` | `st_tkl_solo` | each | 0 | |
| `fgRetYd` | `fg_ret_yd` | missed-FG return yards | 0 | |
| `blkKickRetYd` | `blk_kick_ret_yd` | per yard | 0 | |
| `returnYdCombinedTiers` | — | `Tier[]` | `[]` | [M] |

### 5.7 Kicking

| Key | Sleeper key | Unit | Typical default | Notes |
|---|---|---|---|---|
| `kickingMode` | — | enum `distanceTiers`, `perYard`, `flat` | `distanceTiers` | [R] |
| `xpm` | `xpm` | each | 1 | [V:CBS] 1 |
| `xpmiss` | `xpmiss` | each | −1 | |
| `fgm` | `fgm` | flat per FG | 0 (3 in `flat` mode) | |
| `fgm0_19` | `fgm_0_19` | each | 3 | [V:CBS] 0–49 = 3 |
| `fgm20_29` | `fgm_20_29` | each | 3 | |
| `fgm30_39` | `fgm_30_39` | each | 3 | |
| `fgm40_49` | `fgm_40_49` | each | 4 | |
| `fgm50_59` | `fgm_50_59` | each | 5 | [V:CBS] 50+ = 5 |
| `fgm50p` | `fgm_50p` | each | 5 | older Sleeper key |
| `fgm60p` | `fgm_60p` | each | 6 | |
| `fgmYds` | `fgm_yds` | per FG yard | 0 (0.1 in `perYard`) | |
| `fgmYdsOver30` | `fgm_yds_over_30` | per yard beyond 30 | 0 | |
| `fgmiss` | `fgmiss` | each miss | −1 | |
| `fgmiss0_19` … `fgmiss60p` | `fgmiss_0_19`, `fgmiss_20_29`, `fgmiss_30_39`, `fgmiss_40_49`, `fgmiss_50_59`, `fgmiss_50p`, `fgmiss_60p` | each | −1 for short misses, 0 for 50+ | |
| `fgDistanceTiers` | — | `Tier[]` | — | [V:CBS] general ranges |

### 5.8 Team defense / special teams (DST)

| Key | Sleeper key | Unit | Typical default | Notes |
|---|---|---|---|---|
| `dstTd` | `def_td` | each defensive TD | 6 | [V:CBS] 6 |
| `dstStTd` | `def_st_td` | each special-teams TD | 6 | [V:CBS] kick and punt return TDs count for the DST |
| `dstSack` | `sack` | each | 1 | [V:CBS] 1 |
| `dstSackYd` | `sack_yd` | per yard | 0 | |
| `dstInt` | `int` | each | 2 | [V:CBS] 2 |
| `dstFumRec` | `fum_rec` | each | 2 | [V:CBS] 2 |
| `dstFf` | `ff` | each | 1 | |
| `dstSafety` | `safe` | each | 2 | [V:CBS] 2 |
| `dstBlkKick` | `blk_kick` | each | 2 | |
| `dst2ptReturn` | `def_2pt` | each | 2 | [V:CBS] 2-point return = 2 |
| `dstXpSafety` | — | safety on a PAT or 2-point try | 1 | [V:CBS] 1 |
| `dstPassDef` | `def_pass_def` | each | 0 | |
| `dstTkl`, `dstTklSolo`, `dstTklAst`, `dstTklLoss` | `tkl`, `tkl_solo`, `tkl_ast`, `tkl_loss` | each | 0 | |
| `dstQbHit` | `qb_hit` | each | 0 | |
| `dst3AndOut` | `def_3_and_out` | each | 0 | |
| `dst4thDownStop` | `def_4_and_stop` | each | 0 | |
| `dstForcedPunt` | `def_forced_punts` | each | 0 | |
| `dstKrYd`, `dstPrYd` | `def_kr_yd`, `def_pr_yd` | per yard | 0 | |
| `dstKrTd`, `dstPrTd` | `def_kr_td`, `def_pr_td` | each | 0 (covered by `dstStTd`) | |
| `dstStFf`, `dstStFumRec`, `dstStTklSolo` | `def_st_ff`, `def_st_fum_rec`, `def_st_tkl_solo` | each | 1, 1, 0 | |
| `dstIntRetYd`, `dstFumRetYd` | `int_ret_yd`, `fum_ret_yd` | per yard | 0 | |
| `bonusDstIntTd50p`, `bonusDstFumTd50p` | `bonus_def_int_td_50p`, `bonus_def_fum_td_50p` | each | 0 | long-return TD bonus |
| `dstPtsAllowedPerPt` | `pts_allow` | per point allowed | 0 | linear alternative to tiers |
| `dstPtsAllowedTiers` | `pts_allow_0`, `pts_allow_1_6`, `pts_allow_7_13`, `pts_allow_14_20`, `pts_allow_21_27`, `pts_allow_28_34`, `pts_allow_35p` | `Tier[]` | Sleeper sample: 10 / 7 / 4 / 1 / 0 / −1 / −4 | [V:CBS] 0 = 12, 1–6 = 8, 7–13 = 6, 14–20 = 4, 21–27 = 2, 28+ = 0 |
| `dstYdsAllowedPerYd` | `yds_allow` | per yard allowed | 0 | |
| `dstYdsAllowedTiers` | `yds_allow_0_100`, `yds_allow_100_199`, `yds_allow_200_299`, `yds_allow_300_349`, `yds_allow_350_399`, `yds_allow_400_449`, `yds_allow_450_499`, `yds_allow_500_549`, `yds_allow_550p` | `Tier[]` | Sleeper sample: 5 / 3 / 2 / 0 / −1 / −3 / −5 / −6 / −7 | [V:CBS] <50 = 12, 50–99 = 10, 100–149 = 8, 150–199 = 6, 200–249 = 4, 250–299 = 2, 300+ = 0 |
| `dstPointsAllowedBasis` | — | enum `defenseAndSpecialTeams`, `allPointsAllowed` | `defenseAndSpecialTeams` | [V:CBS] excludes points scored against the offense, such as pick-sixes and safeties |
| `dstYardsAllowedBasis` | — | enum `netRushPlusPass`, `totalIncludingReturns` | `netRushPlusPass` | [V:CBS] rushing plus passing yards |

### 5.9 Individual defensive players (IDP)

The Sleeper keys below marked [V] appeared in the live JSON. Keys marked [M] follow Sleeper's naming pattern but were not seen in this sample. Default values are a balanced IDP set from memory ([M]/[R]).

| Key | Sleeper key | Unit | Typical default |
|---|---|---|---|
| `idpTkl` | `idp_tkl` [V] | combined tackle | 0 (use solo and assist instead) |
| `idpTklSolo` | `idp_tkl_solo` [V] | each | 1 |
| `idpTklAst` | `idp_tkl_ast` [V] | each | 0.5 |
| `idpTklLoss` | `idp_tkl_loss` [M] | each | 1 |
| `idpSack` | `idp_sack` [V] | each | 3 |
| `idpSackYd` | `idp_sack_yd` [V] | per yard | 0 |
| `idpQbHit` | `idp_qb_hit` [M] | each | 0.5 |
| `idpInt` | `idp_int` [V] | each | 4 |
| `idpIntRetYd` | `idp_int_ret_yd` [M] | per yard | 0 |
| `idpFf` | `idp_ff` [V] | each | 3 |
| `idpFumRec` | `idp_fum_rec` [V] | each | 2 |
| `idpFumRetYd` | `idp_fum_ret_yd` [M] | per yard | 0 |
| `idpPassDef` | `idp_pass_def` [V] | each | 1 |
| `idpSafety` | `idp_safe` [V] | each | 2 |
| `idpBlkKick` | `idp_blk` [V] | each | 2 |
| `idpDefTd` | `idp_def_td` [V] | each | 6 |
| `bonusIdpTkl10p` | `bonus_tkl_10p` [V] | once (10+ tackles) | 0 |
| `bonusIdpSack2p` | `bonus_sack_2p` [V] | once (2+ sacks) | 0 |
| `bonusIdpPassDef3p` | `idp_pass_def_3p` [V] | once (3+ passes defended) | 0 |
| position overrides | — | for example `scoring.positionOverrides.DB.idpTklSolo = 1.5` | — |

### 5.10 Optional positions (punter, head coach)

| Key | Unit | Typical default | Source |
|---|---|---|---|
| `puntYd` | per yard | 0.04 | [M] MFL and CBS offer punters |
| `punts` | each | 0 | [M] |
| `puntInside20` | each | 1 | [M] |
| `puntTouchback` | each | −0.5 | [M] |
| `puntBlocked` | each | −2 | [M] |
| `puntNetAvgTiers` | `Tier[]` | `[]` | [M] |
| `hcWin` / `hcLoss` / `hcTie` | each | 3 / 0 / 1 | [M] MFL head coach |
| `hcMarginTiers` | `Tier[]` on point margin | `[]` | [M] |

### 5.11 Milestone and long-play engine (generic form of the bonuses above)

```jsonc
"scoring": {
  "bonuses": [
    { "stat": "passYd", "threshold": 300, "pts": 3, "mode": "once", "positions": ["QB"] },
    { "stat": "rushYd", "threshold": 100, "pts": 3, "mode": "once" },
    { "stat": "recYd",  "threshold": 100, "pts": 3, "mode": "once" }
  ],
  "longPlayBonuses": [
    { "play": "rushTd", "minYards": 40, "pts": 2 },
    { "play": "recTd",  "minYards": 40, "pts": 2 },
    { "play": "passTd", "minYards": 40, "pts": 1 }
  ]
}
```

`mode` is `once` (when the threshold is crossed) or `eachIncrement` (every N past the threshold). The Sleeper fixed keys (`bonus_*`, `*_40p`, `*_50p`) map onto these entries when importing. Source: [V:CBS] "bonuses and yardage ranges"; [V:SLP-API] bonus keys.

### 5.12 Common scoring presets (for a "start from preset" picker)

The values come from the tables above. Mark each preset as a starting point; every value can be edited.

| Preset | rec | passTd | passInt | TE prem | First downs | DST/K |
|---|---|---|---|---|---|---|
| `standard` | 0 | 4 | −2 | 0 | 0 | yes |
| `halfPpr` | 0.5 | 4 | −2 | 0 | 0 | yes |
| `ppr` | 1 | 4 | −2 | 0 | 0 | yes |
| `superflexTep` (dynasty common) | 1 | 4 | −2 | +0.5 | 0 | no K, no DST |
| `ppfd` (points per first down) | 0 | 4 | −2 | 0 | rush, rec and pass FD = 1 / 1 / 0.25 | optional |
| `cbsManagedLike` | 0 | 6 | −2 | 0 | 0 | yes, tiers as in §5.8 [V:CBS] |

---

## 6. Waivers, free agency and FAAB (`waivers.*`, `faab.*`)

### 6.1 Waiver mechanics

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `waivers.type` | enum | `faab` | `none` (all first-come-first-served), `rolling`, `reverseStandings`, `faab` | [V:SLP-API] `waiver_type` (0, 1, 2 seen; inferred mapping 0 rolling, 1 reverse standings, 2 FAAB); [V:SLP-help] rolling is the default; [V:FLEA] priority or blind bid; [V:CBS] standard or FAB | |
| `waivers.initialOrder` | enum | `reverseFinalStandings` (dynasty) | `reverseDraftOrder`, `reverseFinalStandings`, `reverseMaxPF`, `random`, `manual` | [V:CBS] after the draft, the reverse of round 1 order | |
| `waivers.priorityReset` | enum | `never` | `never` (pure rolling), `weekly` (re-sort by reverse standings each week), `onlyAfterClaim` | [V:CBS] reset weekly after Monday standings, rolling within the week | |
| `waivers.priorityTiebreakers` | tiebreaker[] | `["worstRecord","lowestPointsFor","highestPointsAgainst"]` | see §13 | [V:CBS] exactly this order | |
| `waivers.clearDays` | int | 2 | 0–7 | [V:SLP-API] `waiver_clear_days` (0–2 seen) | How long a dropped player stays on waivers. |
| `waivers.droppedPlayerRule` | enum | `untilNextRunAfterClearDays` | `untilNextRun`, `untilSecondRun`, `clearDays` | [V:CBS] dropped in FA: until the 2nd run; dropped in a run: until the next run | |
| `waivers.lockAtKickoff` | bool | true | — | [V:CBS] free agents lock and go on waivers 5 minutes before their game, until Wednesday | Sleeper calls this "After Games Waiver Clear" [V:SLP-help]. |
| `waivers.afterGamesClearDays` | int | 1 | 0–3 | [V:SLP-help] Sleeper recommends 1 or 2 days | |
| `waivers.byePlayersLockAt` | enum | `lastGameOfWeek` | `lastGameOfWeek`, `firstGameOfWeek`, `never` | [V:CBS] bye-week players lock 5 minutes before the week's last game | |
| `waivers.runSchedule` | `{dow,time}[]` | `[{WED,"03:00"}]` | any | [V:SLP-API] `waiver_day_of_week`; [V:CBS] nightly 1–6 a.m. ET from Wednesday to Sunday morning | |
| `waivers.daily.enabled` | bool | false | — | [V:SLP-API] `daily_waivers` | Runs every day. |
| `waivers.daily.days` | dow[] | all | — | [V:SLP-API] `daily_waivers_days` (a bitmask) | |
| `waivers.daily.hour` | int | 0 | 0–23 | [V:SLP-API] `daily_waivers_hour` | |
| `waivers.continuousFreeAgency` | bool | true | — | [V:SLP-help] continuous waivers; [V:CBS] unlocked free agents add instantly | Players who clear waivers become first-come-first-served. |
| `waivers.newPlayersStartOnWaivers` | bool | true | — | [V:CBS] players new to the pool start on waivers | Rookies added after the NFL Draft, for example. |
| `waivers.preseasonDailyRuns` | bool | true | — | [V:CBS] nightly runs from the draft through the night before opening day | |
| `waivers.playoffMode` | enum | `faabOnly` | `sameAsRegular`, `faabOnly`, `rollingFrozen` | [V:SLP-help] reverse standings is not available in the playoffs; [V:FLEA] order is never reset in the playoffs | |
| `waivers.offseason.mode` | enum | `faab` | `closed`, `faab`, `fcfs` | [V:SLP-API] `offseason_adds`; [V:SLP-help] offseason waivers | |
| `waivers.disableAdds` | bool | false | — | [V:SLP-API] `disable_adds` | A commissioner freeze. |
| `waivers.maxPendingClaims` | int | 40 | 1–100 | [V:FLEA] limit of 40 | |
| `waivers.maxClaimsWonPerRun` | int\|null | null | 1–10 | [R] | |
| `waivers.maxAcquisitions.perWeek` | int\|null | null | 1–20 | [M] Yahoo and ESPN acquisition limits | |
| `waivers.maxAcquisitions.perSeason` | int\|null | null | 1–200 | [M] | |
| `waivers.eliminatedTeamsCanAdd` | bool | true (CTE); CBS default false | — | [V:CBS] no add/drops for non-playoff or eliminated teams | Dynasty leagues often allow this. Recommend true for CTE so teams can build ([R]). |
| `waivers.undroppablePlayers` | playerId[] | `[]` | — | [V:CBS] the commissioner keeps an undroppable list | |
| `waivers.addDropFee` | money (real) | 0 | ≥ 0 | [M] | Ties into `league.dues`. |
| `waivers.antiAbuse.dropCooldownHours` | int | 0 | 0–168 | [V:CBS] team-dropping and waiver-abuse policies | Blocks churning add, drop, add. |

### 6.2 FAAB / blind bidding

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `faab.budget` | money | 100 | 0–10000 | [V:SLP-help] default $100; [V:SLP-API] 100, 120, 200 and 1000 seen | |
| `faab.minBid` | money | 0 | 0–10 | [V:SLP-help] default $0 | Set to `cap.minSalary` if bids become salary. |
| `faab.bidIncrement` | money | 1 | 0.1–5 | [V:MFL] commissioner sets minimum and increment | |
| `faab.tiebreaker` | enum | `waiverPriority` | `waiverPriority`, `earliestBid`, `reverseStandings`, `lowestPointsFor`, `random` | [V:SLP-help] priority breaks ties; [V:MFL] worst-to-first or earliest bid | |
| `faab.conditionalBids` | bool | true | — | [V:MFL] contingent or conditional blind bids processed in rounds | For example "only if I lose bid A, place bid B". |
| `faab.claimOrderUsedWhen` | enum | `budgetExhausted` | `always`, `budgetExhausted` | [V:FLEA] order matters only once the budget is spent | |
| `faab.seasonReset` | enum | `eachLeagueYear` | `never`, `eachLeagueYear`, `manual` | [V:SLP-help] Sleeper never resets automatically | |
| `faab.carryoverPercent` | percent | 0 | 0–100 | [R] | Share of unused FAAB carried into the next year. |
| `faab.tradeable` | bool | true | — | [V:SLP-help] FAAB is tradeable; [V:MFL] blind-bid money in trades | |
| `faab.tradeMaxPerSeason` | money\|null | null | — | [R] | |
| `faab.suggestionsShown` | bool | false | — | [V:SLP-API] `faab_suggestions` | Suggested bids. |
| `faab.revealBidsAfterRun` | enum | `allBids` | `winningOnly`, `allBids`, `none` | [M]/[R] | Show every bid (winners and losers) on the transactions page. |
| `faab.zeroBidAllowed` | bool | true | — | [V:SLP-help] | |
| `faab.bidBecomesSalary` | bool | true (cap league) | — | [M] common in MFL salary leagues; [R] | The winning bid sets the player's cap salary (at least `cap.minSalary`). |
| `faab.budgetSource` | enum | `separate` | `separate`, `capSpace` | [R] | With `capSpace`, a team can bid only its remaining cap room. |
| `faab.weeklyAllowance` | money | 0 | ≥ 0 | [R] | Fun or anti-tank: a set amount added each week. |

---

## 7. Trades (`trades.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `trades.enabled` | bool | true | — | [V:SLP-API] `disable_trades` | |
| `trades.deadline.week` | week\|null | 11 | 1–17 or null | [V:SLP-API] `trade_deadline` (11 most common; 99 seen, inferred to mean no deadline); [V:CBS] Thursday of Week 11, 11:59:59 p.m. ET | |
| `trades.deadline.time` | `{dow,time}` | `{THU,"23:59"}` | — | [V:CBS] | |
| `trades.offseasonWindowOpens` | enum\|datetime | `afterFinalWeek` | `afterFinalWeek`, `afterRollover`, datetime | [R] | Dynasty leagues trade all offseason. |
| `trades.duringPlayoffs` | bool | false | — | [M] | |
| `trades.review.mode` | enum | `leagueVote` | `none`, `commissioner`, `leagueVote`, `leagueVoteThenCommissioner` | [V:other] NFL.com offers vote, commissioner veto or none; [V:CBS] enough disputes send the trade to the commissioner | |
| `trades.review.periodHours` | int | 48 | 0–72 | [V:SLP-API] `trade_review_days` (2 most common); [V:SLP-help] up to 3 days; [V:CBS] at least 24 hours | |
| `trades.review.vetoVotesNeeded` | int | 4 (of 12) | 1 to `numTeams − 2` | [V:CBS] 4 disputes; [V:SLP-API] `veto_votes_needed` (5–9 seen) | |
| `trades.review.voteEligible` | enum | `nonInvolvedTeams` | `nonInvolvedTeams`, `allTeams` | [R] | |
| `trades.review.showVoters` | bool | false | — | [V:SLP-API] `veto_show_votes` | |
| `trades.review.autoPoll` | bool | false | — | [V:SLP-API] `veto_auto_poll`; [V:SLP-help] pinned polls in chat | |
| `trades.review.processAt` | enum | `endOfPeriodNextRun` | `immediatelyAfterPeriod`, `endOfPeriodNextRun` | [V:SLP-help] processed at midnight PT; [V:CBS] processed 12–6 a.m. ET | |
| `trades.acceptLeadHours` | int | 0 | 0–72 | [V:CBS] must be accepted 43 hours before the first involved kickoff to count that week | |
| `trades.lockedPlayersPolicy` | enum | `processAfterUnlock` | `processAfterUnlock`, `block` | [V:CBS] trades with players who have locked stay pending until next week | |
| `trades.offerExpiryHours` | int | 72 | 1–336 | [M] | |
| `trades.maxTeamsPerTrade` | int | 3 | 2–4 | [M] Sleeper supports multi-team trades | |
| `trades.allowUnbalanced` | bool | true | — | [V:CBS] 3-for-1 trades allowed | |
| `trades.postTradeRosterPolicy` | enum | `mustFixBeforeLock` | `mustFixBeforeLock`, `requireDropsInOffer`, `blockIfIllegal` | [V:CBS] an illegal roster is allowed but must be fixed before the deadline | |
| `trades.assets.draftPicks` | bool | true | — | [V:SLP-API] `pick_trading`; [V:CBS] future pick trading; [V:FLEA] keeper leagues only | |
| `trades.assets.draftPickYearsOut` | int | 3 | 1–5 | [M] Sleeper about 3 seasons; MFL configurable | |
| `trades.assets.faab` | bool | true | — | [V:SLP-help]; [V:MFL] | |
| `trades.assets.capSpace` | bool | false | — | [R] | "Cash considerations": trade future cap room. |
| `trades.assets.salaryRetentionMaxPercent` | percent | 0 | 0–50 | [R] | The sender keeps paying X% as dead money. |
| `trades.assets.taxiPlayers` | bool | true | — | [M] | |
| `trades.assets.irPlayers` | bool | true | — | [M] | |
| `trades.cap.mustBeCompliantAfter` | bool | true | — | [M] MFL hard-cap enforcement | A trade fails if either side ends over the cap (hard cap). |
| `trades.cap.salaryMatching` | enum | `none` | `none`, `withinPercent`, `withinAmount` | [R] (NBA-style) | |
| `trades.cap.salaryMatchingTolerance` | number | 0 | — | [R] | |
| `trades.pickTradingRequiresPrepaidDues` | bool | false | — | [R] a common dynasty rule | Prevents trading future picks and then leaving the league. |
| `trades.reacquireCooldownDays` | int | 0 | 0–60 | [R] niche | |
| `trades.tradeBlock.enabled` | bool | true | — | [M] CBS trading block | |
| `trades.evaluator.shown` | bool | true | — | [V:CBS] Trade Evaluator | |
| `trades.commishOwnTradesReviewedBy` | enum | `coCommissioner` | `none`, `coCommissioner`, `leagueVote` | [R] | Transparency for the commissioner's own deals. |

---

## 8. Salary cap and contracts

### 8.1 Cap (`cap.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `cap.enabled` | bool | true | — | [V:CBS] salary-cap drafting and contracts; [V:MFL] | |
| `cap.unit` | enum | `"$"` | `"$"`, `"$K"`, `"$M"` | [R] | Display only. |
| `cap.decimalPlaces` | int | 0 | 0–2 | [R] | For example $0.5M minimum deals need 1. |
| `cap.amount` | money | 200 | 50–100000 | [V:MFL] a league-wide cap; [V:other] Fantrax examples $300 | |
| `cap.perTeamOverrides` | map teamId → money | `{}` | — | [V:MFL] each franchise can start with a different cap | |
| `cap.type` | enum | `hard` | `hard`, `soft` | [V:MFL] hard or soft | |
| `cap.soft.maxOverage` | money\|null | null | — | [R] | |
| `cap.soft.luxuryTaxRate` | number | 1.0 | 0–3 | [R] | Tax per $1 over the cap, charged as FAAB, next year's cap or real money. |
| `cap.soft.taxPaidAs` | enum | `nextYearCap` | `nextYearCap`, `faab`, `dues`, `draftPick` | [R] | |
| `cap.soft.taxDistributedToUnderCapTeams` | bool | false | — | [R] | |
| `cap.floor` | money\|null | null | 0 to `amount` | [R] (NFL-style) | |
| `cap.floorPenalty` | enum | `chargeDifferenceAsDeadMoney` | `none`, `chargeDifferenceAsDeadMoney`, `forfeitPick` | [R] | |
| `cap.growth.mode` | enum | `none` | `none`, `percent`, `flat` | [R] | Cap growth at the league-year rollover. |
| `cap.growth.value` | number | 0 | — | [R] | |
| `cap.minSalary` | money | 1 | > 0 | [M]; [V:other] Fantrax league $0.4M | |
| `cap.maxSalary` | money\|null | null | — | [R] | Optional maximum for one player. |
| `cap.irChargePercent` | percent | 100 | 0–100 | [V:MFL] IR can optionally count | Mirrors `roster.ir.capChargePercent`. |
| `cap.taxiChargePercent` | percent | 50 | 0–100 | [R] | |
| `cap.emptyRosterSpotCharge` | money | 0 | 0 to `minSalary` | [V:other] Fantrax league charges an empty spot like a minimum player | Stops teams hoarding cap by running short rosters. |
| `cap.enforcement.inSeason` | enum | `blockOverCapMoves` | `blockOverCapMoves`, `allowUntilCompliance`, `warnOnly` | [M]/[R] | |
| `cap.enforcement.offseason` | enum | `allowUntilCompliance` | same | [R] | Lets teams sit over the cap until `capComplianceAt`. |
| `cap.enforcement.overCapAtDeadlinePenalty` | enum | `commishResolves` | `commishResolves`, `autoReleaseLowestValue`, `forfeitPick`, `freezeTransactions` | [R] | |
| `cap.rollover.mode` | enum | `none` | `none`, `percentOfUnused`, `fullUnused` | [R] (NFL-style) | |
| `cap.rollover.percent` | percent | 0 | 0–100 | [R] | |
| `cap.rollover.maxAmount` | money\|null | null | — | [R] | |
| `cap.adjustments` | ledger `{teamId, season, amount, reason, createdBy}[]` | `[]` | — | [V:MFL] Salary Adjustments report | Dead money, trades of cap space and penalties all land here. |
| `cap.projectionYears` | int | 3 | 1–5 | [R] | How many future years the cap sheet shows. |

### 8.2 Contracts (`contracts.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `contracts.enabled` | bool | true | — | [V:MFL] contract tracking in Salary Cap Setup; [V:CBS] "detailed long-term contracts" | |
| `contracts.minYears` | int | 1 | 1–3 | [V:other] | |
| `contracts.maxYears` | int | 4 | 1–7 | [V:other] FantasyPros 2–3 standard; RSO multi-year | |
| `contracts.decrementAt` | enum | `leagueYearRollover` | `leagueYearRollover`, `seasonEnd` | [V:other] MFL league rules: one contract year expires for every player at season's end | |
| `contracts.yearsSetAt` | enum | `atAcquisitionOrDeadline` | `atAcquisition`, `byDeadline`, `atAcquisitionOrDeadline` | [M] MFL leagues assign years by a deadline | Startup and FA contracts get their length by `contractAssignmentDeadline`. |
| `contracts.defaultYearsIfUnset` | int | 1 | 1 to `maxYears` | [R] | |
| `contracts.lengthLimits` | map years → max count | `{}` | — | [R] | For example `{ "4": 3, "3": 5 }` means at most three 4-year deals. |
| `contracts.totalYearsPool` | int\|null | null | — | [V:other] "contract-year pool" idea | |
| `contracts.lengthSalaryModifier` | map years → percent | `{}` | — | [R] | For example 4-year deals cost +10%. |
| `contracts.guaranteePercent` | percent | 50 | 0–100 | [V:other] DLF: guarantee % is the variable between cap-league types | Feeds the dead-money formula when `releases.deadMoney.mode = guaranteeBased`. |
| `contracts.statusTypes` | enum[] | `["rookie","veteran","freeAgent","franchiseTag","extension","rfaTender","minimum"]` | — | [R] (MFL has a free-text contract-status field [M]) | Shown as a tag on roster rows. |
| `contracts.freeAgent.defaultYears` | int | 1 | 1–`maxYears` | [R] | Applies to in-season pickups. |
| `contracts.freeAgent.maxYearsInSeason` | int | 1 | — | [R] | Stops cheap multi-year deals for midseason breakouts. |
| `contracts.freeAgent.proratedSalary` | bool | false | — | [R] niche | |
| `contracts.waiverClaimInheritsContract` | bool | true | — | [M] | |
| `contracts.tradeInheritsContract` | bool | true | — | [M] | |
| `contracts.escalation.mode` | enum | `percent` | `none`, `percent`, `flat` | [V:MFL] automatic raise by X% or $Y from one season to the next | |
| `contracts.escalation.value` | number | 10 | 0–50 (percent) or ≥ 0 (flat) | [M] 10% is common | |
| `contracts.escalation.rounding` | enum | `up` | `up`, `nearest`, `down` | [R] | Rounds to `cap.decimalPlaces`. |
| `contracts.escalation.appliesTo` | enum | `allExceptRookie` | `all`, `allExceptRookie`, `veteransOnly`, `keepersOnly` | [R] | |
| `contracts.escalation.compounding` | bool | true | — | [R] | |
| `contracts.expiring.to` | enum | `freeAgentAuction` | `freeAgentAuction`, `waivers`, `rfa`, `freeAgentPool` | [V:other] RSO offseason FA auction | |
| `contracts.extensions.enabled` | bool | true | — | [M] RSO extensions | |
| `contracts.extensions.window` | enum | `finalYearOffseason` | `finalYearOffseason`, `anyOffseason`, `anyTime` | [R] | |
| `contracts.extensions.maxYearsAdded` | int | 3 | 1–5 | [R] | |
| `contracts.extensions.costFormula` | enum | `percentRaisePerYear` | `percentRaisePerYear`, `positionalAverageTopN`, `fixedTable` | [R] | |
| `contracts.extensions.costValue` | number | 20 | — | [R] | For example +20% per year added. |
| `contracts.extensions.perTeamPerSeason` | int\|null | 2 | — | [R] | |
| `contracts.extensions.rookieOnly` | bool | false | — | [R] | |
| `contracts.rfa.enabled` | bool | false | — | [R] | Restricted free agency. |
| `contracts.rfa.eligible` | enum | `rookieContractExpiring` | `rookieContractExpiring`, `anyExpiring` | [R] | |
| `contracts.rfa.matchWindowHours` | int | 48 | — | [R] | The owner can match the winning FA-auction bid. |
| `contracts.rfa.compensation` | enum | `none` | `none`, `pickByAmount` | [R] | |
| `contracts.holdouts.enabled` | bool | false | — | [R] niche | |

### 8.3 Rookie scale (`rookieScale.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `rookieScale.enabled` | bool | true | — | [V:other] DLF: "used in nearly every salary cap league with a rookie draft" | |
| `rookieScale.contractYears` | int | 3 | 2–5 | [V:other] "most leagues award 3–5 years"; RSO 3 or 4 | |
| `rookieScale.yearsByRound` | map round → years | `{}` | — | [R] | For example round 1 = 4 years, rounds 2+ = 3 years. |
| `rookieScale.method` | enum | `byOverallPick` | `byOverallPick`, `byRound`, `percentOfCap`, `flat` | [R] | |
| `rookieScale.table` | `{pick?:string, round?:int, salary:money}[]` | see the example below | — | [R] | |
| `rookieScale.escalates` | bool | false | — | [R] | Rookie deals usually stay flat. |
| `rookieScale.optionYear.enabled` | bool | true | — | [V:other] RSO option year for first-round picks | |
| `rookieScale.optionYear.roundsEligible` | int[] | `[1]` | — | [V:other] RSO | |
| `rookieScale.optionYear.costFormula` | enum | `avgTopNAtPosition` | `avgTopNAtPosition`, `percentRaise`, `fixed` | [V:other] RSO: average of the top 10 contracts at the position | |
| `rookieScale.optionYear.topN` | int | 10 | 3–20 | [V:other] | |
| `rookieScale.optionYear.deadline` | datetime | before the final rookie year | — | [V:other] | |
| `rookieScale.undraftedRookieSalary` | money | = `cap.minSalary` | — | [R] | |
| `rookieScale.pickCapHold` | bool | false | — | [R] | Owned picks hold their scale amount before the draft. |

Example `rookieScale.table` for a $200 cap, 12 teams ([R]):

| Pick range | Salary | Pick range | Salary |
|---|---|---|---|
| 1.01–1.03 | $10 | 2.01–2.06 | $4 |
| 1.04–1.06 | $8 | 2.07–2.12 | $3 |
| 1.07–1.09 | $6 | 3.01–3.12 | $2 |
| 1.10–1.12 | $5 | 4.01+ | $1 (minimum) |

### 8.4 Franchise tag (`franchiseTag.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `franchiseTag.enabled` | bool | true | — | [V:other] RSO | |
| `franchiseTag.perTeamPerSeason` | int | 1 | 0–3 | [V:other] RSO: one tag per manager | |
| `franchiseTag.eligible` | enum | `expiringOnly` | `expiringOnly`, `anyPlayer` | [V:other] RSO: an expiring contract | |
| `franchiseTag.costFormula` | enum | `maxOfAvgTopNAndRaise` | `avgTopNAtPosition`, `salaryPlusPercent`, `maxOfAvgTopNAndRaise`, `fixed` | [V:other] RSO: average of the top-5 salaries at the position | |
| `franchiseTag.topN` | int | 5 | 3–12 | [V:other] RSO | |
| `franchiseTag.minRaisePercent` | percent | 20 | 0–100 | [R] | |
| `franchiseTag.years` | int | 1 | 1 | [V:other] | |
| `franchiseTag.consecutiveTagMultiplier` | number | 1.2 | 1–2 | [R] NFL-style | A second straight tag costs 120%. |
| `franchiseTag.maxConsecutive` | int | 2 | 1–3 | [R] | |
| `franchiseTag.type` | enum | `exclusive` | `exclusive`, `nonExclusiveWithMatch` | [R] | |
| `franchiseTag.transitionTag.enabled` | bool | false | — | [R] | Cheaper (top 10) with matching rights only. |
| `franchiseTag.deadline` | datetime | — | — | [R] | Mirrors `season.keyDates.franchiseTagDeadline`. |

### 8.5 Releases and dead money (`releases.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `releases.deadMoney.enabled` | bool | true | — | [V:other] RSO dead cap; [V:MFL] salary adjustments | |
| `releases.deadMoney.mode` | enum | `percentByYear` | `none`, `percentByYear`, `percentPerYearRemaining`, `guaranteeBased` | [V:other] | |
| `releases.deadMoney.currentYearPercent` | percent | 100 | 0–100 | [V:other] RSO: 100% of the current year | |
| `releases.deadMoney.futureYearsPercent` | percent | 50 | 0–100 | [V:other] RSO: 50% of each remaining year | |
| `releases.deadMoney.perYearRemainingPercent` | percent | 20 | 0–100 | [V:other] league bylaws: 20% times years remaining | Used when mode is `percentPerYearRemaining`. |
| `releases.deadMoney.waivedIfClaimed` | bool | true | — | [V:other] RSO: dead cap only if the player clears waivers | The claiming team takes the contract. |
| `releases.retirementForgives` | bool | true | — | [V:other] remaining years are forgiven on retirement | |
| `releases.preseasonCut.percent` | percent\|null | null | 0–100 | [R] | A reduced penalty before Week 1 (for example 50% of the current year). |
| `releases.minimumSalaryCutFree` | bool | true | — | [R] | |
| `releases.inSeasonOneYearFaCutFree` | bool | true | — | [R] | Lets teams stream midseason pickups. |
| `releases.releasedPlayerTo` | enum | `waivers` | `waivers`, `freeAgent` | [V:CBS] dropped players go to waivers | |
| `releases.deadMoneyTradeable` | bool | false | — | [R] | |
| `releases.amnesty.perTeamTotal` | int | 0 | 0–2 | [R] niche | A one-time penalty-free release. |
| `releases.amnesty.window` | enum | `offseason` | `offseason`, `anytime` | [R] | |

### 8.6 Cap holds (`capHolds.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `capHolds.expiringContracts.enabled` | bool | false | — | [R] (NBA-style) | Players with expiring deals hold cap until tag or RFA decisions. |
| `capHolds.expiringContracts.percent` | percent | 100 | 0–200 | [R] | |
| `capHolds.expiringContracts.until` | enum | `franchiseTagDeadline` | `franchiseTagDeadline`, `rfaDeadline`, `freeAgencyStart` | [R] | |
| `capHolds.draftPicks.enabled` | bool | false | — | [R] | Same as `rookieScale.pickCapHold`. |
| `capHolds.pendingFaabBids` | bool | true | — | [R] | Open bids reserve cap room so a team cannot win more than it can pay. |

---

## 9. Keepers (`keepers.*`)

In a dynasty league every rostered player carries over (`keepers.mode = keepAll`). The keeper block still matters for three things: converting from a keeper league, "re-draft lite" years, and a contract-less variant.

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `keepers.mode` | enum | `keepAll` | `none`, `limited`, `keepAll` | [V:CBS] keeper and dynasty support | |
| `keepers.max` | int | 3 | 1 to `roster.size` | [V:SLP-API] `max_keepers`; [V:CBS] "how many players will be kept" | |
| `keepers.min` | int | 0 | 0 to `max` | [M] MFL; [V:FLEA] no minimum enforced | |
| `keepers.deadline` | datetime | — | — | [V:CBS]; [V:SLP-API] `metadata.keeper_deadline`; [V:FLEA] none imposed | |
| `keepers.selectionBy` | enum | `owners` | `owners`, `commissioner` | [V:CBS] "how the owners... will select keepers" | |
| `keepers.cost.mode` | enum | `draftRound` | `none`, `draftRound`, `auctionPrice`, `salary`, `adpRound` | [V:SLP-help] keeper round cost; [V:CBS] "how that applies to the draft" | |
| `keepers.cost.roundsEarlierPerYear` | int | 1 | 0–3 | [M] | Cost moves up one round each year kept. |
| `keepers.cost.priceEscalation` | `{mode:"percent"\|"flat", value:number}` | `{percent,10}` | — | [V:MFL] X% or $Y each season | |
| `keepers.cost.undraftedRound` | enum\|int | `lastRound` | `lastRound`, round number | [M] | |
| `keepers.cost.conflictRule` | enum | `nextEarlierRound` | `nextEarlierRound`, `nextLaterRound` | [M] | Two keepers costing the same round. |
| `keepers.maxYearsKept` | int\|null | null | 1–10 | [V:FLEA] enforced by hand only | |
| `keepers.positionMax` | map Pos → int | `{}` | — | [R] | |
| `keepers.forfeitPickInCostRound` | bool | true | — | [V:CBS] keepers apply to the draft; [V:FLEA] unused picks represent keepers | |
| `keepers.tradeCarriesCost` | bool | true | — | [M] | |

---

## 10. Drafts (`draft.*`)

### 10.1 General draft settings (`draft.general.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `draft.general.type` | enum | `linear` (rookie) / `auction` (startup) | `snake`, `linear`, `auction`, `offline`, `auto` | [V:CBS] Live, Live Salary Cap, Automated and Extended drafts, or offline with results entered | |
| `draft.general.thirdRoundReversal` | bool | false | — | [M] | Snake drafts only. |
| `draft.general.mode` | enum | `slow` | `live`, `slow` | [V:CBS] "Extended" drafts | |
| `draft.general.pickTimerSeconds` | int | 120 (live); 28800 (slow, 8 hours) | 15–172800 | [V:SLP-API] `pick_timer` 120 | |
| `draft.general.pauseWindow` | `{start:time,end:time}`\|null | `{"23:00","08:00"}` | — | [M] slow-draft overnight pause | The clock stops during these hours. |
| `draft.general.onTimeout` | enum | `autopick` | `autopick`, `skipAndAllowLater`, `wait` | [M] MFL allows skip-and-make-up | |
| `draft.general.autopickSource` | enum | `queueThenRankings` | `queueThenRankings`, `rankingsOnly`, `adp` | [V:CBS] auto-draft uses each owner's Rank List | |
| `draft.general.orderMode` | enum | see rookie and startup | `manual`, `random`, `reverseStandings`, … | [V:CBS] "enter your own draft order and customize it" | |
| `draft.general.tradingDuringDraft` | bool | true | — | [M] | |
| `draft.general.chatEnabled` | bool | true | — | [M] | |
| `draft.general.commishTools` | — | — | pause, resume, undo the last pick, pick for a team, reorder, extend the clock | [M] | See §14. |

### 10.2 Startup auction (`draft.startup.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `draft.startup.format` | enum | `liveAuction` | `liveAuction`, `slowAuction`, `blindAuction`, `snakeThenAssignContracts` | [V:CBS] live salary-cap draft; [V:other] DLF blind-bid startup | |
| `draft.startup.budget` | money | = `cap.amount` | — | [R] | |
| `draft.startup.minBid` | money | 1 | > 0 | [M] | Equals `cap.minSalary`. |
| `draft.startup.bidIncrement` | money | 1 | > 0 | [M] | |
| `draft.startup.nominationOrder` | enum | `snakeByDraftSlot` | `linearByDraftSlot`, `snakeByDraftSlot`, `random`, `mostBudgetFirst`, `commissioner` | [M] | |
| `draft.startup.nominationTimerSeconds` | int | 30 | 10–600 | [M] | Live only. |
| `draft.startup.bidTimerSeconds` | int | 30 | 5–120 | [M] | Clock when a player is nominated. |
| `draft.startup.bidTimerResetSeconds` | int | 10 | 3–60 | [M] | Clock resets after each new high bid ("going once"). |
| `draft.startup.maxBidRule` | enum | `reserveMinPerOpenSlot` | `none`, `reserveMinPerOpenSlot` | [M] | `maxBid = remaining − minBid × (openSlots − 1)`. |
| `draft.startup.rosterSlotsToFill` | int | = `roster.size` | — | [R] | Taxi is usually filled later. |
| `draft.startup.positionMax` | map | `roster.draftPositionMax` | — | [V:CBS] | |
| `draft.startup.nominatorOpeningBid` | enum | `anyAmount` | `minBid`, `anyAmount` | [M] | |
| `draft.startup.proxyBidding` | bool | false | — | [M] | Absent owners can set maximums ahead of time. |
| `draft.startup.autoNominateOnTimeout` | bool | true | — | [M] | |
| `draft.startup.slow.bidClockHours` | int | 24 | 4–72 | [M] MFL email auction | The clock resets on each bid. |
| `draft.startup.slow.maxOpenNominationsPerTeam` | int | 2 | 1–10 | [M] | |
| `draft.startup.slow.nominationsPerDayPerTeam` | int | 2 | 1–10 | [M] | |
| `draft.startup.slow.quietHours` | `{start,end}` | `{"00:00","08:00"}` | — | [M] | |
| `draft.startup.contracts.method` | enum | `ownerAssignsAfter` | `ownerAssignsAfter`, `bidIncludesYears`, `autoByPrice` | [V:other] RSO: bidders offer multi-year deals | |
| `draft.startup.contracts.distribution` | map years → count | `{"1":n,"2":n,"3":n,"4":n}` | — | [R] | For example 25 players gives 7 one-year, 7 two-year, 6 three-year and 5 four-year deals. |
| `draft.startup.contracts.deadline` | datetime | 7 days after the auction | — | [R] | |
| `draft.startup.includesRookies` | bool | true | — | [R] | In year one, either rookies are in the auction or a separate rookie draft follows. |

### 10.3 Rookie draft (`draft.rookie.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `draft.rookie.rounds` | int | 4 | 1–7 | [V:SLP-API] `draft_rounds` 3–4; [V:other] RSO 2–5 rounds | |
| `draft.rookie.format` | enum | `linear` | `linear`, `snake` | [M] | |
| `draft.rookie.orderMethod` | enum | `reverseMaxPF` | `reverseStandings`, `reversePointsFor`, `reverseMaxPF`, `lottery`, `toiletBowl`, `hybrid`, `manual` | [V:other] picks 1–6 by Max PF in league bylaws; [M] | Max PF ordering discourages tanking. |
| `draft.rookie.playoffTeamsOrder` | enum | `reversePlayoffFinish` | `reversePlayoffFinish`, `reverseStandings` | [V:other] picks 7–12 by reverse playoff finish | Champion picks last. |
| `draft.rookie.consolationWinnerPick` | enum\|null | null | `firstNonPlayoffPick`, `firstOverall` | [M] common "toilet bowl winner gets 1.01" | |
| `draft.rookie.lottery.enabled` | bool | false | — | [M] | |
| `draft.rookie.lottery.eligible` | enum | `nonPlayoffTeams` | `nonPlayoffTeams`, `bottomN` | [M] | |
| `draft.rookie.lottery.bottomN` | int | 6 | — | [M] | |
| `draft.rookie.lottery.odds` | percent[] | `[25,20,17,15,13,10]` | sums to 100 | [M]/[R] | Weighted toward the worst team. |
| `draft.rookie.lottery.picksDrawn` | int | 3 | 1–6 | [M] | |
| `draft.rookie.lottery.maxDropSpots` | int | 2 | — | [M] | |
| `draft.rookie.lottery.drawAt` | datetime | — | — | [R] | |
| `draft.rookie.lottery.liveReveal` | bool | true | — | [R] fun | An animated reveal page. |
| `draft.rookie.eligiblePlayers` | enum | `rookiesOnly` | `rookiesOnly`, `rookiesAndFreeAgents` | [M] | |
| `draft.rookie.pickTimerSeconds` | int | 28800 | 60–172800 | [M] | |
| `draft.rookie.startAt` | datetime | after the NFL Draft | — | [R] | |
| `draft.rookie.contracts` | — | uses `rookieScale` | — | [V:other] RSO assigns rookie contracts automatically | |
| `draft.rookie.unusedPickPolicy` | enum | `forfeit` | `forfeit`, `makeUpLater` | [M] | |

### 10.4 Supplemental and dispersal draft (`draft.supplemental.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `draft.supplemental.enabled` | bool | false | — | [R] | For expansion or orphaned teams. |
| `draft.supplemental.pool` | enum | `releasedRosters` | `releasedRosters`, `allFreeAgents` | [R] | |
| `draft.supplemental.order` | enum | `reverseStandings` | — | [R] | |
| `draft.supplemental.contractsKept` | bool | true | — | [R] | |

---

## 11. Playoffs (`playoffs.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `playoffs.teams` | int | 6 | 0 to `numTeams` | [V:CBS] 6; [V:SLP-API] `playoff_teams` 6–8 | 0 disables the playoffs. |
| `playoffs.byes` | int | 2 | 0 to `teams − 2` | [V:CBS] seeds 1 and 2 get byes | |
| `playoffs.startWeek` | week | 15 | — | [V:CBS] Weeks 15–17 | Same as `season.playoffStartWeek`. |
| `playoffs.weeksPerRound` | int | 1 | 1–2 | [V:SLP-API] `playoff_round_type`; [V:SLP-help] two-week rounds | |
| `playoffs.championshipWeeks` | int | 1 | 1–2 | [V:SLP-help] two-week championship (Weeks 16 and 17 combined) | |
| `playoffs.seeding.method` | enum | `record` | `record`, `divisionWinnersFirst`, `pointsFor`, `custom` | [V:CBS] division leaders take seeds 1–3, wildcards 4–6 | |
| `playoffs.seeding.divisionWinnersQualify` | bool | true | — | [V:CBS] | |
| `playoffs.seeding.divisionWinnersTopSeeds` | bool | false | — | [V:CBS] true by default | Many leagues prefer division winners without guaranteed top seeds ([R]). |
| `playoffs.seeding.wildcards` | int | derived | — | [V:CBS] 3 wildcards | |
| `playoffs.seeding.reseedEachRound` | bool | false | — | [V:SLP-API] `playoff_seed_type`; [V:SLP-help] "highest seed always plays lowest" | |
| `playoffs.seeding.manualOverride` | bool | true | — | [V:SLP-help] custom seeding and playoff eligibility | |
| `playoffs.matchupTiebreakers` | tiebreaker[] | `["benchPoints","higherSeed"]` | §13 | [V:CBS] combined pass+rush+rec yards of the active lineup, then DST yards allowed, then the higher seed | No ties in the playoffs. |
| `playoffs.consolation.type` | enum | `toiletBowl` | `none`, `consolation` (the winner advances), `toiletBowl` (the loser advances) | [V:SLP-help] | |
| `playoffs.consolation.teams` | int | `numTeams − teams` | 0–8 | [V:SLP-help] up to 8 | |
| `playoffs.consolation.stakes` | enum | `none` | `none`, `rookiePick`, `punishment`, `faabBonus` | [R] | Links to §10.3 and §15. |
| `playoffs.placementGames` | enum[] | `["third"]` | `third`, `fifth`, `seventh`, `allPlaces` | [M] | |
| `playoffs.finalFormat` | enum | `h2h` | `h2h`, `pointsRace` (finalists by total points), `multiTeamFinal` | [M] | |
| `playoffs.eliminatedTeamsTransactions` | bool | true | — | [V:CBS] false by default | |
| `playoffs.medianGameInPlayoffs` | bool | false | — | [R] | |
| `playoffs.waiverMode` | → `waivers.playoffMode` | — | — | [V:SLP-help] | |

---

## 12. Schedule (`schedule.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `schedule.generator` | enum | `divisionWeighted` | `roundRobin`, `divisionWeighted`, `random`, `custom` | [V:CBS] play division rivals twice and others once over 14 weeks | |
| `schedule.divisionGamesPerOpponent` | int | 2 | 1–3 | [V:CBS] | |
| `schedule.gamesPerWeek` | int | 1 | 1–3 | [V:CBS] multiple matchups per team each week | |
| `schedule.doubleHeaderWeeks` | week[] | `[]` | — | [V:MFL] double-header weeks | |
| `schedule.medianGame.enabled` | bool | false | — | [V:SLP-API] `league_average_match`; [V:SLP-help] an extra game each week against the league median | |
| `schedule.medianGame.weeks` | enum\|week[] | `allRegularSeason` | — | [R] | |
| `schedule.allPlay.tracked` | bool | true | — | [M] MFL all-play | Shown in standings. Can also be a tiebreaker. |
| `schedule.rivalries` | `{teamA, teamB, name?}[]` | `[]` | — | [R] | Fixed rivals. |
| `schedule.rivalryWeeks` | week[] | `[]` | — | [R] | Every team plays its rival in these weeks. |
| `schedule.avoidRepeatWithinWeeks` | int | 3 | 0–6 | [R] | |
| `schedule.oddTeamCountPolicy` | enum | `medianOpponent` | `bye`, `medianOpponent` | [R] | |
| `schedule.manualEdits` | bool | true | — | [V:CBS] custom schedules | |

---

## 13. Tiebreakers (`tiebreakers.*`)

**Tiebreaker tokens** (the shared vocabulary): `winPct`, `headToHeadRecord`, `headToHeadPoints`, `divisionRecord`, `conferenceRecord`, `pointsFor`, `pointsAgainstHigh`, `pointsAgainstLow`, `maxPotentialPoints`, `lowestMaxPotentialPoints`, `benchPoints`, `allPlayRecord`, `medianRecord`, `recordLastNWeeks`, `strengthOfSchedule`, `highestSingleWeek`, `activeLineupTotalYards` ([V:CBS]), `dstYardsAllowed` ([V:CBS]), `higherSeed`, `topStarterScore`, `worstRecord`, `lowestPointsFor`, `highestPointsAgainst`, `coinFlip`, `commissioner`.

| Key | Type | Typical default | Source | Notes |
|---|---|---|---|---|
| `tiebreakers.regularSeasonMatchup` | enum | `allowTie` | [V:CBS] regular-season ties are allowed | Alternatives: `benchPoints`, `topStarterScore`. |
| `tiebreakers.playoffMatchup` | token[] | `["benchPoints","higherSeed"]` | [V:CBS] `activeLineupTotalYards`, `dstYardsAllowed`, `higherSeed` | |
| `tiebreakers.standings` | token[] | `["winPct","headToHeadRecord","pointsFor","divisionRecord","pointsAgainstHigh","coinFlip"]` | [V:CBS] seeding uses YTD PF, then YTD PA, then combined yards | |
| `tiebreakers.division` | token[] | `["winPct","headToHeadRecord","divisionRecord","pointsFor","coinFlip"]` | [M] | |
| `tiebreakers.multiTeamHeadToHead` | enum | `skipIfNotAllPlayedEqually` | [R] | Three-way ties. |
| `tiebreakers.waiverPriority` | token[] | `["worstRecord","lowestPointsFor","highestPointsAgainst"]` | [V:CBS] | |
| `tiebreakers.draftOrder` | token[] | `["lowestMaxPotentialPoints","lowestPointsFor","coinFlip"]` | [V:other] | |
| `tiebreakers.faab` | → `faab.tiebreaker` | — | [V:SLP-help] / [V:MFL] | |

---

## 14. Commissioner powers (`commish.*`)

### 14.1 Settings

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `commish.commissionerTeamId` | teamId | — | — | all | |
| `commish.coCommissioners` | teamId[] | `[]` | 0–3 | [M] CBS, MFL and Sleeper co-commissioners | |
| `commish.actionLog.visibleToLeague` | bool | true | — | [R] | An audit trail of every override (the biggest UX trust win). |
| `commish.notifyLeagueOnSettingChange` | bool | true | — | [R] | |
| `commish.settingChangesRequireVote` | enum[] | `["scoring","cap","contracts"]` | any group | [R] | A league vote (passed with `voteThreshold`) is needed to change these mid-season. |
| `commish.voteThresholdPercent` | percent | 67 | 51–100 | [R] | |
| `commish.ownTeamActionsRequireCoCommish` | bool | true | — | [R] | |
| `commish.canVetoTrades` | bool | true | — | [V:SLP-help] veto, force through, reverse | |
| `commish.lockedSettingsAfter` | map group → event | `{roster:"draftStart",scoring:"week1Lock"}` | — | [V:other] ESPN locks settings after a time; [R] | |

### 14.2 Commissioner actions (UI tools, not stored settings; each one writes to the action log)

| Action | CBS | MFL | Fleaflicker | Sleeper | Source |
|---|---|---|---|---|---|
| Edit any roster (add or drop for a team) | Yes | Yes | Yes | Yes | [M]; [V:FLEA] Edit Rosters |
| Edit lineups, including after lock or retroactively | Yes | Yes | Yes | Partial | [V:CBS] override options; [M] |
| Adjust team points or matchup results | Yes | Yes | ? | No | [V:CBS] override options; [M] |
| Approve, veto, force or reverse trades | Yes | Yes | Yes | Yes | [V:SLP-help]; [V:CBS] commissioner evaluation |
| Process or undo waivers and FAAB; edit the waiver order and FAAB balances | Yes | Yes | Yes (reset budget) | Yes (mobile) | [V:FLEA]; [V:SLP-help] |
| Set or randomize the draft order; pause, undo or make picks; enter offline results | Yes | Yes | Yes | Yes | [V:CBS] |
| Edit salaries and contracts | Yes | Yes | — | — | [V:CBS] contracts; [V:MFL] Edit Player Salaries/Contracts |
| Apply salary adjustments (dead money, penalties) | Partial | Yes | — | — | [V:MFL] |
| Edit the schedule and divisions | Yes | Yes | Yes | Partial | [V:CBS] |
| Manual playoff seeding and eligibility | Yes | Yes | ? | Yes | [V:SLP-help] |
| Set undroppable players | Yes | ? | ? | ? | [V:CBS] |
| Lock or unlock a team; replace an owner; manage orphan teams | Yes | Yes | Yes | Yes | [M] |
| Mark a whole roster as keepers | ? | Yes | Yes | Yes | [V:FLEA] "These are the keepers" |
| Post league news and announcements; email the league; polls | Yes | Yes | ? | Chat polls | [V:CBS] |
| Renew the league and roll over the season | Yes | Yes | Yes | Yes | [V:CBS] |
| Run the rookie lottery (draw and reveal) | — | — | — | — | [R] |
| Grant FAAB or cap bonus or penalty | ? | Yes (adjustments) | ? | Yes (edit FAAB) | [V:SLP-help] |

---

## 15. Niche and fun rules (`fun.*`)

| Key | Type | Typical default | Allowed values | Source | Notes |
|---|---|---|---|---|---|
| `fun.guillotine.enabled` | bool | false | — | [V:SLP-API] `type: 3`, `last_chopped_leg` | The lowest scorer each week is eliminated. |
| `fun.guillotine.eliminatedPerWeek` | int | 1 | 1–2 | [M] | |
| `fun.guillotine.releasedRosterTo` | enum | `waiversFaab` | — | [M] | |
| `fun.guillotine.disableElimination` | bool | false | — | [V:SLP-API] `disable_elimination` (meaning inferred) | |
| `fun.lastPlace.determinedBy` | enum | `toiletBowlLoser` | `regularSeasonRecord`, `pointsFor`, `toiletBowlLoser` | [V:SLP-help] toilet bowl | |
| `fun.lastPlace.trophyName` | string | `"The Taco"` | — | [V:SLP-API] `metadata.trophy_loser` | |
| `fun.lastPlace.punishment` | markdown | `""` | — | [R] | For example a tattoo, a 24-hour sign, or the SAT. |
| `fun.lastPlace.punishmentDeadline` | datetime | — | — | [R] | |
| `fun.lastPlace.proofUploadRequired` | bool | true | — | [R] | Photo or video shown in the league hall of shame. |
| `fun.lastPlace.draftPenalty` | enum | `none` | `none`, `loseFaab`, `forfeitPickSwap` | [R] | |
| `fun.weeklyHighScore.prize` | enum | `none` | `none`, `duesPayout`, `faabBonus`, `capBonus` | [M] | |
| `fun.weeklyHighScore.amount` | number | 0 | — | [M] | |
| `fun.medianGame` | → `schedule.medianGame` | — | — | [V:SLP-API] | |
| `fun.benchPointsTiebreak` | → `tiebreakers.*` | — | — | [R] | |
| `fun.survivorPool.enabled` | bool | false | — | [M] MFL survivor pool | A side game in which the lowest weekly scorer among survivors is out. |
| `fun.pickem.enabled` | bool | false | — | [M] CBS and MFL pick'em | |
| `fun.awards.weekly` | enum[] | `["topScore","biggestBlowout","closestGame","benchBlunder","waiverHero"]` | — | [R] | Generated automatically on the matchup recap. |
| `fun.powerRankings.auto` | bool | true | — | [V:CBS] power rankings in League History | |
| `fun.hallOfFame.enabled` | bool | true | — | [V:CBS] league history; [R] | Champions, records, the trophy room. |
| `fun.rivalryTrophies` | `{name, teamA, teamB}[]` | `[]` | — | [R] | |
| `fun.bounty.enabled` | bool | false | — | [R] | For example FAAB to whoever beats the No. 1 seed. |
| `fun.emptyStarterFine` | money (real) | 0 | — | [R] | |
| `fun.vampire.enabled` | bool | false | — | [M] community format | |
| `fun.taxiPoaching` | → `roster.taxi.poaching` | — | — | [R] | |
| `fun.chaosWeek` | `{week, rule}` | null | `doubleTE`, `kickersDouble`, `benchScores` | [R] | |

---

## 16. Cross-field validation rules (for the schema validator)

1. `season.regularSeasonStartWeek ≤ season.lastRegularSeasonWeek < season.finalWeek ≤ 18`.
2. Playoff week count: `playoffs.startWeek = lastRegularSeasonWeek + 1`. The playoff weeks needed are `ceil(log2(playoffs.teams)) × weeksPerRound`, plus `championshipWeeks − 1` when the final runs two weeks. That number must be ≤ `finalWeek − lastRegularSeasonWeek`.
3. `playoffs.byes < playoffs.teams`, and `playoffs.teams − playoffs.byes` must be even after the byes. Six teams with two byes works.
4. `playoffs.teams + playoffs.consolation.teams ≤ league.numTeams`.
5. `numDivisions` divides `numTeams` evenly, or uneven divisions must be explicitly allowed.
6. `Σ roster.starters ≤ roster.size`, and every starter slot has at least one eligible position in `league.positionsUsed`.
7. `roster.positionMax[pos] ≥` the minimum number of starters that need `pos` (for example 2 RB slots means `positionMax.RB ≥ 2`).
8. `trades.review.vetoVotesNeeded ≤ numTeams − 2`.
9. `faab.minBid ≤ faab.budget`. If `faab.bidBecomesSalary`, then `faab.minBid ≥ cap.minSalary`.
10. `cap.floor ≤ cap.amount`. `cap.minSalary × roster.size ≤ cap.amount`.
11. `contracts.minYears ≤ contracts.maxYears`. `rookieScale.contractYears ≤ contracts.maxYears` unless the option year is enabled.
12. The rookie scale, summed over each team's expected picks, should stay well under the cap. Warn above 25% ([R]).
13. `draft.startup.maxBidRule = reserveMinPerOpenSlot` requires `draft.startup.budget ≥ minBid × rosterSlotsToFill`.
14. `draft.rookie.lottery.odds` sums to 100 and has length = `bottomN` or the number of non-playoff teams.
15. `trades.deadline.week < playoffs.startWeek` (warn only).
16. `roster.taxi.slots > 0` requires `league.leagueType ∈ {dynasty, keeper}`.
17. Every Tier[] list has no overlapping ranges and covers the domain (warn about gaps).

---

## 17. Suggested CTE Dynasty starting values (a JSON skeleton)

These are [R] values: a sensible starting point for a 12-team SuperFlex, TE-premium, salary-cap dynasty league. Every value can be changed in the settings UI.

```jsonc
{
  "schemaVersion": 1,
  "league": { "name": "CTE Dynasty", "shortName": "CTE", "slug": "cte-dynasty", "leagueType": "dynasty",
              "format": "h2hPoints", "numTeams": 12, "numDivisions": 2, "timeZone": "America/New_York",
              "visibility": "private", "playerPool": "all", "positionsUsed": ["QB","RB","WR","TE"],
              "statCorrectionCutoff": { "dow": "THU", "time": "06:00" } },
  "season": { "regularSeasonStartWeek": 1, "lastRegularSeasonWeek": 14, "finalWeek": 17,
              "offseasonTransactions": true, "leagueYearRollover": "03-01" },
  "roster": { "size": 25, "starters": { "QB": 1, "RB": 2, "WR": 3, "TE": 1, "FLEX": 2, "SUPER_FLEX": 1 },
              "positionMax": { "QB": 5 }, "allowEmptyStarterSlots": true, "illegalRosterPolicy": "blockMovesUntilFixed",
              "teamDefenseMode": "none", "idpMode": "none",
              "ir":   { "slots": 2, "eligibleStatuses": ["IR","PUP","NFI","OUT","SUSPENDED"], "capChargePercent": 100 },
              "taxi": { "slots": 3, "eligibility": "maxExperience", "maxExperienceYears": 1, "maxYearsOnTaxi": 3,
                        "deadlineWeek": 1, "addSources": ["rookieDraft","startupDraft"], "allowReturnAfterPromotion": false,
                        "capChargePercent": 50, "poaching": { "enabled": false } } },
  "lineup": { "lockMode": "perPlayer", "lockOffsetMinutes": 0, "defaultCarryOver": "previousWeek",
              "autoSubs": { "maxPerWeek": 0 }, "bestBall": false },
  "scoring": { "decimalPlaces": 2, "yardageMode": "fractional", "bonusStacking": "cumulative",
               "passYd": 0.04, "passTd": 4, "passInt": -2, "pass2pt": 2,
               "rushYd": 0.1, "rushTd": 6, "rush2pt": 2,
               "rec": 1, "recYd": 0.1, "recTd": 6, "rec2pt": 2, "bonusRecTe": 0.5,
               "fumLost": -2, "fumRecTd": 6,
               "positionOverrides": {}, "bonuses": [], "longPlayBonuses": [] },
  "waivers": { "type": "faab", "initialOrder": "reverseFinalStandings", "clearDays": 2, "lockAtKickoff": true,
               "runSchedule": [{ "dow": "WED", "time": "03:00" }], "continuousFreeAgency": true,
               "playoffMode": "faabOnly", "offseason": { "mode": "faab" }, "eliminatedTeamsCanAdd": true },
  "faab":    { "budget": 100, "minBid": 1, "bidIncrement": 1, "tiebreaker": "waiverPriority", "conditionalBids": true,
               "seasonReset": "eachLeagueYear", "tradeable": true, "revealBidsAfterRun": "allBids",
               "bidBecomesSalary": true, "budgetSource": "separate" },
  "trades":  { "enabled": true, "deadline": { "week": 11, "time": { "dow": "THU", "time": "23:59" } },
               "review": { "mode": "leagueVote", "periodHours": 48, "vetoVotesNeeded": 4, "showVoters": false },
               "assets": { "draftPicks": true, "draftPickYearsOut": 3, "faab": true, "capSpace": false },
               "cap": { "mustBeCompliantAfter": true, "salaryMatching": "none" },
               "pickTradingRequiresPrepaidDues": true },
  "cap":       { "enabled": true, "unit": "$", "decimalPlaces": 0, "amount": 200, "type": "hard", "floor": null,
                 "minSalary": 1, "taxiChargePercent": 50, "emptyRosterSpotCharge": 0,
                 "enforcement": { "inSeason": "blockOverCapMoves", "offseason": "allowUntilCompliance" } },
  "contracts": { "enabled": true, "minYears": 1, "maxYears": 4, "decrementAt": "leagueYearRollover",
                 "escalation": { "mode": "percent", "value": 10, "rounding": "up", "appliesTo": "allExceptRookie" },
                 "freeAgent": { "defaultYears": 1, "maxYearsInSeason": 1 },
                 "expiring": { "to": "freeAgentAuction" },
                 "extensions": { "enabled": true, "window": "finalYearOffseason", "maxYearsAdded": 3,
                                 "costFormula": "percentRaisePerYear", "costValue": 20 } },
  "rookieScale": { "enabled": true, "contractYears": 3, "method": "byOverallPick",
                   "optionYear": { "enabled": true, "roundsEligible": [1], "costFormula": "avgTopNAtPosition", "topN": 10 } },
  "franchiseTag": { "enabled": true, "perTeamPerSeason": 1, "eligible": "expiringOnly",
                    "costFormula": "maxOfAvgTopNAndRaise", "topN": 5, "minRaisePercent": 20 },
  "releases": { "deadMoney": { "enabled": true, "mode": "percentByYear", "currentYearPercent": 100,
                               "futureYearsPercent": 50, "waivedIfClaimed": true },
                "retirementForgives": true, "minimumSalaryCutFree": true, "inSeasonOneYearFaCutFree": true },
  "keepers":  { "mode": "keepAll" },
  "draft": { "startup": { "format": "slowAuction", "minBid": 1, "bidIncrement": 1, "nominationOrder": "snakeByDraftSlot",
                          "maxBidRule": "reserveMinPerOpenSlot", "slow": { "bidClockHours": 24, "maxOpenNominationsPerTeam": 2 },
                          "contracts": { "method": "ownerAssignsAfter" } },
             "rookie":  { "rounds": 4, "format": "linear", "orderMethod": "reverseMaxPF",
                          "playoffTeamsOrder": "reversePlayoffFinish", "pickTimerSeconds": 28800,
                          "lottery": { "enabled": false } } },
  "playoffs": { "teams": 6, "byes": 2, "startWeek": 15, "weeksPerRound": 1, "championshipWeeks": 1,
                "seeding": { "method": "record", "divisionWinnersQualify": true, "reseedEachRound": true },
                "matchupTiebreakers": ["benchPoints","higherSeed"],
                "consolation": { "type": "toiletBowl", "stakes": "punishment" }, "placementGames": ["third"] },
  "schedule": { "generator": "divisionWeighted", "gamesPerWeek": 1, "medianGame": { "enabled": false }, "rivalryWeeks": [] },
  "tiebreakers": { "regularSeasonMatchup": "allowTie",
                   "standings": ["winPct","headToHeadRecord","pointsFor","divisionRecord","pointsAgainstHigh","coinFlip"],
                   "waiverPriority": ["worstRecord","lowestPointsFor","highestPointsAgainst"],
                   "draftOrder": ["lowestMaxPotentialPoints","lowestPointsFor","coinFlip"] },
  "commish": { "coCommissioners": [], "actionLog": { "visibleToLeague": true }, "notifyLeagueOnSettingChange": true,
               "settingChangesRequireVote": ["scoring","cap","contracts"], "voteThresholdPercent": 67 },
  "fun": { "lastPlace": { "determinedBy": "toiletBowlLoser", "trophyName": "The Taco" },
           "awards": { "weekly": ["topScore","biggestBlowout","closestGame","benchBlunder"] },
           "powerRankings": { "auto": true }, "hallOfFame": { "enabled": true } }
}
```

---

## 18. How the rules UI should present this (CBS-style layout with UX upgrades)

**CBS pattern, from memory [M]:** commissioner settings sit under a commissioner menu, split into tabbed sub-pages: League / Draft & Rosters / Scoring / Transactions (add/drop, waivers, FAB, trades) / Keepers / Schedule & Playoffs. ([V:CBS] the setup article says the auction option is set "under the 'draft & rosters' tab in the league setup".) Owners get a read-only **Rules** page that lists the same groups as dense two-column tables (label and value), with the scoring table broken out by position group. CBS's managed-league rules page follows the same order: Teams/Roster Requirements, then Scoring (Offense, Defense, Points Allowed, Yards Allowed, Wins & Losses, Stat Corrections), Schedule & Playoffs, Lineup Changes, Add/Drop & Waivers (conditions table, rank, schedule), and Trades (approval, multi-player, deadline) [V:CBS].

**Recommended CTE structure [R]:**

- **One schema, two renderings.** The commissioner sees an editable form. Owners see the generated read-only Rules page in the same section order (§1 to §15 above), plus a "Constitution" markdown block at the top.
- **Settings tabs** (left rail on desktop, horizontal scroll chips on mobile): League · Calendar · Rosters · Lineups · Scoring · Waivers & FAAB · Trades · Cap & Contracts · Draft · Playoffs & Schedule · Tiebreakers · Commissioner · Fun.
- **Diff vs preset:** each field shows a dot when it differs from the chosen preset, and "Reset to preset" works per section.
- **Lock badges:** show "Locked until offseason" or "Requires league vote" from `lockPolicy` and `commish.settingChangesRequireVote`.
- **Impact preview:** a scoring change shows last season's top 24 players re-scored. A cap change shows each team's resulting cap room.
- **Change log:** every save writes `{who, when, path, old, new, reason}` and posts to the league feed when `notifyLeagueOnSettingChange` is on.
- **Scoring editor:** an accordion by group (Passing / Rushing / Receiving / Misc / Returns / Kicking / DST / IDP / Bonuses). Each row reads `stat · points · per N · position overrides`. Tier editors use inline add-range rows with a gap and overlap warning.
- **Mobile:** single column. Tables collapse to label-value cards. Sticky Save and Cancel bar. A 16px gutter.
