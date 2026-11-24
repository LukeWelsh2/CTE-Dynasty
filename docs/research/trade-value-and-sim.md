# CTE Dynasty: Trade Value, Win Probability and Manager-Quality Methods

Research date: 2026-11-24. This file gives the math for three features:

1. **Dynasty trade values.** This covers players, rookie picks, salary-cap contracts, injuries, team context and 2-for-1 trades.
2. **Matchup win probability**, both before kickoff and live during games, plus **playoff odds** from a Monte Carlo simulation.
3. **Manager decision-quality metrics** for the weekly recap: lineup efficiency, bench points, start/sit, waiver impact and luck.

Every formula has a default constant that we can put in code. Nothing here copies another product's branding. We only describe how public tools work and then define our own models.

---

## 0. How to read this document

### 0.1 Provenance tags

| Tag | Meaning |
|---|---|
| **[V]** | Checked this session against a named public source (URL in §10). Where a site was blocked by the network proxy, the check came from search-engine excerpts of that page. The note says so. |
| **[V-exact]** | Rebuilt exactly from a source's published data. Example: the DynastyProcess value formula matches all 843 rows of their public `values.csv` with zero error. |
| **[D]** | Computed this session from public nflverse data with scripts I wrote (method in §0.2). Anyone can reproduce it from the same files. |
| **[M]** | From memory or general domain knowledge. Not re-checked this session. Treat it as likely but unconfirmed. |
| **[R]** | A CTE Dynasty recommendation or design choice. No source sets it. We chose it, usually informed by [D] or [V] numbers. |

### 0.2 Data and conventions behind the [D] numbers

- **Sources** (GitHub release assets of `nflverse/nflverse-data`, plus `nflverse/nfldata` `games.csv`):
  - `stats_player_week_{2015..2025}.csv`
  - `stats_team_week_{2015..2025}.csv`
  - `play_by_play_{2022..2025}.csv.gz`
  - `players.csv` (birth dates)
  - `draft_picks.csv`
- **Window:** regular season, weeks 1–17 only, so seasons before and after 2021 are comparable.
- **Scoring for [D]:**
  - **PPR:** pass yd 0.04, pass TD 4, INT −2, rush/rec yd 0.1, rush/rec TD 6, reception 1, fumble lost −2, 2-pt 2. This is the nflverse `fantasy_points_ppr` column.
  - **Half-PPR:** PPR minus 0.5 × receptions.
  - **K:** FG 0–39 = 3, 40–49 = 4, 50+ = 5, PAT = 1, missed FG or PAT = −1.
  - **DST:**
    - Sack 1, INT 2, opponent fumble recovered 2, safety 2, defensive or special-teams TD 6, blocked FG or punt 2.
    - Points allowed (opponent final score): 0 → +10, 1–6 → +7, 7–13 → +4, 14–20 → +1, 21–27 → 0, 28–34 → −1, 35+ → −4.
- **"Naive projection"** (used wherever [D] needs a projection to measure error against). It is a shrunk trailing average:
  - `proj = (4 × prior-season PPG + season-to-date points) / (4 + games so far)`.
  - If there is no prior season, the player needs at least 3 games, and we use the plain season-to-date PPG.
  - Errors are measured from week 3 on.
  - Expert projections should be somewhat more accurate, so treat [D] error SDs as an **upper bound** and recalibrate on our own logged projections (§4.7).
- **"Starter-caliber"** means weekly projection ≥ QB 14, RB 9, WR 9, TE 6.5, K 7, DST all. These are roughly 12-team starter levels.
- **Ages** are integer age on Sept 1 of the season.

### 0.3 Network limits this session

- `keeptradecut.com`, `www.javelinfantasyfootball.com`, CRAN and most other non-GitHub hosts were refused by the egress proxy.
- KeepTradeCut (KTC), FantasyCalc, DLF and the other articles were read only through search-engine excerpts.
- GitHub raw files and release assets could be fetched. That is how the DynastyProcess and nflverse items were checked exactly.

---

## 1. Quick reference: default constants

```jsonc
{
  "marketValue": {
    "curve": "exponential",            // value = A * exp(-k * rank)            [V-exact DynastyProcess]
    "A": 10500, "k": 0.0235,           // k range 0.015 (depth-friendly) .. 0.035 (stud-heavy)  [V] slider exists, range [R]
    "formatSource": { "superflex": "ecr_2qb", "oneQb": "ecr_1qb" }
  },
  "futurePicks": {
    "discountNextDraft": 0.90,         // [V-exact] DP: next-draft tier = 0.90 x value of same-tier current slots
    "discountPerExtraYear": 0.80,      // [V-exact] DP: two drafts out = next-year x 0.80  (=> 0.72)
    "discountThreeYears": 0.65,        // [R] extrapolated (0.72 x 0.90)
    "unknownSlotAveraging": "geometric" // [V-exact] DP averages in rank space (= geometric mean of values); "arithmetic" for model EV [R]
  },
  "ageCurve": "see §3.3 table",         // [D]+[R]
  "attritionHazard": "see §3.3 table",  // [R] informed by [D]
  "availability": { "QB": 0.82, "RB": 0.78, "WR": 0.82, "TE": 0.76 }, // [D] next-season games-played share for established starters (approx, see §3.3)
  "timeWeights": {                      // [R] per contract year y = 0..4
    "contender": [1.00, 0.55, 0.30, 0.15, 0.08],
    "balanced":  [1.00, 0.85, 0.72, 0.61, 0.52],
    "rebuilder": [0.40, 0.90, 1.00, 0.90, 0.80]
  },
  "cap": { "dollarsAboveMinimum": "nTeams * (cap - rosterSize * minSalary)", "escalation": 0.10, "deadMoneyCurrent": 1.00, "deadMoneyFuture": 0.50 },
  "consolidation": { "method": "powerSum", "alpha": 1.20, "rosterSpotValue": 150, "rosterSpotStep": 0.25 }, // [R]
  "fairnessBands": { "fair": 0.05, "slight": 0.12, "clear": 0.25 },                                      // [R] share of larger side
  "weeklySD": {                          // [D] sd = max(floor, a + b * proj), PPR
    "QB":  { "a": 7.15, "b": 0.05, "floor": 6.0 },
    "RB":  { "a": 4.58, "b": 0.25, "floor": 3.5 },
    "WR":  { "a": 3.83, "b": 0.31, "floor": 3.0 },
    "TE":  { "a": 2.93, "b": 0.37, "floor": 2.5 },
    "K":   { "a": 4.08, "b": 0.06, "floor": 3.5 },
    "DST": { "a": 5.22, "b": 0.06, "floor": 4.5 }
  },
  "winProb": { "model": "normal", "projectionShrink": 0.75, "pythagoreanK": 4.4 },     // [D] calibration
  "live": { "remainingMeanCurve": "linear", "remainingVarCurve": "linear", "paceBeta": { "RB": 0.14 } }, // [D]
  "playoffSim": { "nSims": 10000, "teamStrengthTau": 7.0, "commonWeeklyShockSD": 9.5 },  // [D]+[R]
  "lineupEfficiencyPrior": { "mean": 0.775, "sd": 0.05 }                                 // [V] ffsimulator default
}
```

---

## 2. How the reference systems work

### 2.1 KeepTradeCut (KTC): crowd-sourced

**Inputs**
- **[V]** Users answer "Keep, Trade, Cut" prompts. The trade calculator page says it draws on "28,247,864 data points (and counting)". Values update "quickly, automatically, every 10 minutes". (Source: KTC player-values and trade-calculator pages, via search excerpts.)
- **[V]** KTC also offers **"Tradesourced"** values derived from completed trades, and a blended **"Crowd+Trade"** source. A dropdown switches between the three.
- **[M]** The value scale tops out at 9999 for the most valuable asset. This is widely seen in KTC exports but was not confirmed this session.

**Formats**
- **[V]** Superflex is a toggle, and the calculator's default is "Superflex / .5 PPR".
- **[V]** TE Premium has four levels, applied "algorithmically" on top of the base 12-team 0.5-PPR values:
  - **Off**
  - **TE+:** start 1 TE with a mild or moderate bonus (+0.5 or +0.75 PPR, or about 1.5–2× WR PPR).
  - **TE++:** start 2 TEs, *or* a bonus of more than +1 PPR or more than 2× WR PPR.
  - **TE+++:** start 2 TEs *and* extra TE bonuses.
  - KTC tells voters to answer as if in a default 0.5-PPR 12-team league with no TE premium.

**Value Adjustment (the 2-for-1 handling)**
- **[V] (FAQ):** "We add value to the side of the trade that's giving up more when you look at roster spots, players' 'stud' factor, etc." The adjustment "is reverse engineered from the player the lesser side needs to have added to even the trade", so it changes as players are added. Listed factors: the difference in player values, how much of a "stud" the players are, and the number of lesser-value players in the trade. The trade-calculator page says the adjustment "was built from real dynasty trades".
- **[V] (Javelin Fantasy Football, 2022 reverse-engineering, via excerpts):**
  - Each player gets a hidden **raw adjustment** from a 3-input non-linear formula. The inputs are reported as the player's value, the top value in the trade and the top value overall.
  - The raw adjustment ranges from about **10% to 42.4%** of a player's value. A value of about 8200 gives a raw adjustment of about 2900.
  - A trade is "equal" when the **sums of raw adjustments** on each side match.
  - The algorithm takes the raw-sum gap and **solves for the value of a hypothetical player whose raw adjustment equals the gap**. In their example, a 400 gap is closed by a player worth about 2700.
  - The displayed Value Adjustment then comes from the difference in sums of values.
  - The exact constants were in images I could not read. Plugging those two data points into a guessed power-law form gave implausibly large adjustments, so **we do not reproduce KTC's formula**. §3.9 defines our own.
- **Takeaway for CTE:** a convex "stud premium" plus a roster-spot term is industry standard. It must be monotone (adding an asset never lowers a side's raw total). Junk throw-ins should add almost nothing.

### 2.2 FantasyCalc: revealed preference from real trades

**[V] (FAQ and secondary sources, via excerpts)**
- Values are fitted by an **optimization algorithm** over a very large set of completed trades. One blog says about 6 million trades from platforms such as Sleeper. One-for-one deals are the baseline.
- **Recent trades are weighted more.**
- The algorithm runs **separately for 1QB and Superflex**. It adjusts for TE premium, PPR and team count.
- The FAQ says values follow an **exponential curve**, so the calculator adds **no extra stud bonus**.
- It does add a **"waiver adjustment"**: a small value for the bench spot freed by an uneven trade, which "increases with each additional bench spot lost".
- A third-party analysis (thirdc substack) says FantasyCalc **values future picks much lower than KTC** and values current-year picks highly.

**Takeaway for CTE:** if the value curve is already exponential in rank, the consolidation premium can be small. Our default α = 1.2 in §3.9 is mild for that reason.

### 2.3 DynastyProcess (DP): rank to exponential value (open source)

**Player formula [V-exact]**
- From `dynastyprocess/data` → `files/values.csv`, scraped 2026-11-20. The result matches all 843 rows (players and picks), in both formats, with zero error:

```
value_1qb = round( 10500 * exp(-0.0235 * ecr_1qb) )
value_2qb = round( 10500 * exp(-0.0235 * ecr_2qb) )
```

- `ecr_*` is the FantasyPros dynasty **overall** expert consensus rank: 1QB, or 2QB for superflex. Fractional ranks are allowed.
- **[V]** The DP calculator exposes this as a **"Valuation Factor"** slider over `0.0235`. A larger value means more stud-heavy, a smaller one more depth-friendly. The build runs weekly via `.github/workflows/weekly-playervalues.yml`, which calls the private `R/values/build_pickecr.R`, `build_playerecr.R` and `build_values.R`.
- What the curve implies (1QB examples from the same file):

| Rank | Value |
|---|---|
| 1 | 10184 |
| 12 | 7277 |
| 24 | 5686 |
| 48 | 3596 |
| 96 | 1134 |
| 144 | 349 |

- **The value halves every 29.5 rank spots** (ln 2 / 0.0235).
- Superflex example: the QB1 has 2QB value 10232 but only 7058 in 1QB. The 2QB value for QBs ranked 2 to 5 is about 8000–8750.

**Pick formula [V-exact]**
- Each pick gets an ECR on the same overall scale. `values-picks.csv` derives it from rookie rankings mapped into startup ranks, for example 1.01 = 21.5, 1.06 = 61.4, 1.12 = 109.0, 2.12 = 190.1, 3.12 = 254.0 in 1QB. That ECR then goes through the same exponential.
- **Future-pick rule (fitted exactly from the file):**
  - Next-draft **Early / Mid / Late** tier ECR = mean ECR of current slots 1–4 / 5–8 / 9–12 in that round, **+ 4.4834**.
  - Next-draft **generic** round pick = mean of the E/M/L ECRs.
  - **Two drafts out** = next-draft generic **+ 9.4955**.
  - Since exp(−0.0235 × 4.4834) = **0.900** and exp(−0.0235 × 9.4955) = **0.800**, DP's design is: next-draft = **90%** of a known-slot equivalent, and the year after = **80%** of that (**72%** overall).
  - Averaging happens in **rank space**, which equals a **geometric mean** of values. So a generic future 1st (2052) is worth about the 1.07 slot, only about **73%** of the arithmetic mean of the twelve 1st-round slot values (2813). This is a built-in risk discount.

DP pick values (scrape 2026-11-20). In the file, slot-specific rows are labeled with the most recent class; generic rows are the future drafts.

| Round | Format | .01 | .02 | .03 | .04 | .05 | .06 | .07 | .08 | .09 | .10 | .11 | .12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1QB | 6337 | 5597 | 4545 | 3703 | 3027 | 2483 | 2044 | 1688 | 1398 | 1162 | 968 | 810 |
| 1 | SF | 8123 | 6556 | 5309 | 4316 | 3520 | 2881 | 2366 | 1949 | 1612 | 1337 | 1113 | 930 |
| 2 | 1QB | 679 | 572 | 483 | 409 | 347 | 296 | 253 | 217 | 186 | 161 | 139 | 120 |
| 2 | SF | 779 | 655 | 553 | 468 | 397 | 338 | 289 | 248 | 213 | 184 | 159 | 138 |
| 3 | 1QB | 105 | 91 | 80 | 70 | 62 | 54 | 48 | 43 | 38 | 34 | 30 | 27 |
| 3 | SF | 120 | 105 | 92 | 81 | 71 | 63 | 56 | 49 | 44 | 40 | 36 | 32 |
| 4 | 1QB | 24 | 22 | 20 | 18 | 16 | 15 | 13 | 12 | 11 | 10 | 10 | 9 |

| Future pick | 1QB | SF | | Future pick | 1QB | SF |
|---|---|---|---|---|---|---|
| Next Early 1st | 4448 | 5319 | | Next Early 2nd | 473 | 542 |
| Next Mid 1st | 2031 | 2354 | | Next Mid 2nd | 246 | 282 |
| Next Late 1st | 956 | 1100 | | Next Late 2nd | 135 | 154 |
| Next 1st (generic) | 2052 | 2397 | | Next 2nd (generic) | 250 | 287 |
| Two-out 1st | 1641 | 1917 | | Two-out 2nd | 200 | 229 |
| Next 3rd / Two-out 3rd | 47 / 37 | 54 / 43 | | Next 4th / Two-out 4th | 13 / 10 | 16 / 13 |

**Pick decay inside round 1 [D from the table]:** value falls about **17% per slot** (k ≈ 0.187 per slot in 1QB, 0.197 in SF). So 1.12 is worth about 13% of 1.01. That is far steeper than the realized production gap in §3.6.

**[V]** `ffscrapr::dp_values()` reads `values-players.csv` keyed by FantasyPros ID. DP's ecosystem (`ffsimulator`) also gives the simulation method in §6.

### 2.4 Dynasty League Football (DLF) trade analyzer

- **[V] (FAQ, via excerpts):** values blend **DLF rankings, ADP and recent real-world trades**. The trades come from their Trade Finder, built on MyFantasyLeague trades. Values update **nightly**. A DLF article warns the analyzer is "somewhat ADP-dependent".
- The FAQ has a "How are pick values determined?" heading, but its text was not in the excerpts. The DLF FAQ also says a team's own situation changes pick value: rebuilders value picks more.

### 2.5 Other tools (context)

- **[V]** RotoWire's calculator has contender and rebuilder modes, which change *suggestions* (immediate contributors versus young players and picks).
- **[V]** RotoBaller applies multipliers to picks, up for rebuilders and down for contenders. It values picks up to 5 years out, lower each year.
- **[V]** Dynasty Nerds values picks up to 3 years out, with early, mid and late tiers.
- **[V]** DraftSharks' chart shows a small gap between this year's and next year's random 1st (30 vs 28).
- **[V]** A 4for4 rule of thumb: a 2nd this year is worth about a 1st next year.

### 2.6 What CTE takes from these

1. Use an **exponential rank-to-value curve** as the neutral market currency (DP formula, configurable k).
2. In a salary-cap league the real currency is **surplus dollars**: production value minus cost. No public calculator does this, so §3.5 defines it.
3. Prefer the **team-context evaluator** for trades inside the league: re-optimize both lineups and re-run the season simulation. Use the market-points calculator with a mild consolidation term as the neutral view.
4. Discount future picks **×0.90 per year, then ×0.80** (DP), and by projected slot from our own simulation.

---

## 3. CTE Dynasty asset value model

### 3.0 Architecture [R]

| Layer | Unit | Used for |
|---|---|---|
| **Market points (MP)** | 0–10,500, exponential in consensus rank | A neutral "no-cap" value. Player cards, rankings, the quick trade calculator. |
| **Production value (PV)** | Expected fantasy points over replacement (VORP) per season, by year | The input to dollars and the team-context evaluator. |
| **Contract surplus (SV)** | Present-value cap dollars = Σ weight × (PV in $ − salary), with cut option | The main currency for trades and cap decisions in CTE. |
| **Team-context Δ** | Δ weekly starting-lineup points (ROS and future years), Δ playoff and title odds | Trade evaluator verdicts for the two real rosters. |

Keep MP and SV side by side in the UI. A 30-year-old WR on an expiring $45 deal can have high MP but negative SV.

### 3.1 Market points from rank

```
MP(asset) = 10500 * exp(-k * rank)        // k = 0.0235 default; rank = consensus overall dynasty rank in league format
```

- **Format:** superflex uses 2QB ranks, 1QB uses 1QB ranks [V-exact].
- **TE premium [R]:** rescale TE ranks before applying the curve. Recompute each TE's rank as if his projections were scaled by the league's TE bonus. Simpler fallback: multiply TE MP by 1.15 (TE+), 1.30 (TE++) or 1.45 (TE+++). These multipliers are [R]; KTC's actual multipliers are not public.
- **The k slider [R]:** UI label "Stud ↔ Depth". The range 0.015–0.035 is our choice; DP's slider exists [V] but its range was not confirmed.
- **Own-model blend [R]:** if CTE has its own multi-year VORP model, use `rank_blend = rank by (0.5 × z(MP rank) + 0.5 × z(model PV))`. Show the source on hover.

### 3.2 Projections, replacement level and VORP

**Season projection** for player i in future season y (y = 0 is the current or next season):

```
P_i,y = PPG_i,0 * G_exp(pos) * A(pos, age_i + y) / A(pos, age_i)          // age curve, §3.3
E[VORP_i,y] = S_i,y * max(0, P_i,y - Repl_pos,y)                          // S = survival / attrition, §3.3
```

- `G_exp`: expected games = 17 × availability (§3.3 table).
- `PPG_i,0`: current per-game projection (expert or our model), for when the player is active.

**Replacement level algorithm [R]**
1. Sort all players by projected season points.
2. Fill every team's starting lineup greedily, the most restrictive slots first: QB, RB, WR, TE, then FLEX, then SUPER_FLEX. This decides how many of each position start league-wide.
3. **Lineup replacement** = projected points of the best player at that position *not* used as a starter. Use this for VORP.
4. **Waiver replacement** = the best player at the position not on any roster. Use this for the roster-spot value in §3.9 and for cut decisions.

**Replacement levels [D]:** realized season PPR totals at the cutoff ranks (hindsight; projected replacement levels are lower because projections regress).

| Season | 12-team SF: QB24 | RB36 | WR48 | TE18 | Total league VORP | 12-team 1QB with K/DST: QB13 | TE16 | K13 | DST13 | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| 2021 | 180 | 128 | 132 | 124 | 8923 | 242 | 129 | 122 | 109 | 8160 |
| 2022 | 161 | 126 | 136 | 116 | 8894 | 236 | 126 | 124 | 98 | 7896 |
| 2023 | 150 | 129 | 138 | 120 | 9518 | 250 | 125 | 131 | 116 | 7930 |
| 2024 | 161 | 125 | 141 | 114 | 9670 | 257 | 118 | 126 | 104 | 8412 |
| 2025 | 172 | 128 | 122 | 126 | 9244 | 235 | 128 | 132 | 103 | 8518 |
| **Mean** | **165** | **127** | **134** | **120** | **≈9250** | **244** | **125** | **127** | **106** | **≈8180** |

**Where SF VORP comes from [D]**, averaged over the five seasons:

| Position | Share of total VORP |
|---|---|
| QB | ≈24% |
| RB | ≈31% |
| WR | ≈37% |
| TE | ≈9% |

In 1QB, the QB share falls to about 10%.

**Positional scarcity** comes out of the replacement baselines automatically. With CTE's default lineup (QB1, RB2, WR3, TE1, FLEX2, SF1), QB replacement sits near QB24–26. That is why the 2QB ranks in §3.1 push QBs up.

### 3.3 Age curves, attrition and availability

**Method [D]:** the delta method on consecutive seasons, 2015–2025.
- Both seasons need at least 8 games.
- Selection is **symmetric** (the two-season average PPG must be ≥ QB 12 / RB 8 / WR 8 / TE 6). This avoids the regression-to-the-mean bias of selecting on year t only.
- Each age pools ages a−1 to a+1, weighted by min(games).
- The cumulative index is normalized so the peak = 1.00.
- Because both seasons need 8+ games, the curve is **conditional on staying active**. Attrition is handled separately below.

**Production index, peak = 1.00 [D]:**

| Age | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| QB | — | 0.91 | 0.98 | 1.00 | 1.00 | 0.96 | 0.94 | 0.93 | 0.92 | 0.93 | 0.91 | 0.91 | 0.85 | 0.80 | 0.74 | 0.73 | 0.70 |
| RB | 0.74 | 0.86 | 0.94 | 1.00 | 1.00 | 0.96 | 0.90 | 0.80 | 0.68 | 0.59 | 0.49 | 0.45 | — | — | — | — | — |
| WR | 0.76 | 0.86 | 0.92 | 0.99 | 1.00 | 1.00 | 0.95 | 0.91 | 0.83 | 0.77 | 0.64 | 0.55 | 0.44 | 0.41 | — | — | — |
| TE | 0.57 | 0.70 | 0.83 | 0.94 | 0.98 | 1.00 | 0.99 | 0.96 | 0.91 | 0.85 | 0.82 | 0.79 | 0.74 | 0.64 | 0.55 | — | — |

**Year-over-year ratios behind the table [D]** (pooled ±1 year; sample pairs in parentheses):
- **RB:** 23→24 1.06 (172), 25→26 0.97 (145), 26→27 0.93 (120), 27→28 0.90 (87), 28→29 0.84 (63), 29→30 0.87 (39).
- **WR:** 25→26 1.00 (204), 27→28 0.95 (155), 29→30 0.92 (92), 30→31 0.84 (68), 32→33 0.81 (27).
- **TE:** 22→23 1.18 (53), 25→26 1.02 (89), 28→29 0.95 (68), 33→34 0.87 (19).
- **QB:** about 1.00 from 24 to 31, then 32→33 0.93 and 34→35 0.93.
- QB samples are small (19–68 pairs), so read QB to about ±0.05.

**Age at elite seasons [D]** (top-12 QB/TE, top-24 RB/WR by total PPR, 2015–2025):

| Position | Median age | Mean age | Notes |
|---|---|---|---|
| QB | 27 | 28.5 | Long tail to 40+ |
| RB | 25 | 25.0 | 78% at ages 22–27; only 27 of 264 seasons at 29+ |
| WR | 25 | 25.6 | Steady from 22 to 28 |
| TE | 27 | 27.1 | Flat from 23 to 31 |

**Outside checks [V]:**
- ESPN: RBs who debuted since 2000 lost **25.2%** of PPR PPG from age 28 to 29. QB rushing drops between 26 and 27.
- 4for4 (2025): WR peak at **26–28**, decline starting at 29, but still near career baseline through about 31.
- Fox Sports (2013): QB efficiency peaks at 27 and fantasy at 29; TE curves resemble WR.
- Our RB 28→29 step is ×0.84, conditional on staying active. That is milder than ESPN's −25% PPG; the samples and methods differ (all RBs since 2000 versus our symmetric selection of fantasy-relevant RBs). Adding the attrition hazard below, our *unconditional* expected-value drop from 28 to 29 is about −31%.

**Recommended CTE production index A(pos, age) [R]** (smoothed, monotone after the peak; extrapolate below 21 or above the last column at −8% per year):

| Age | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| QB | .85 | .91 | .97 | 1.00 | 1.00 | .97 | .95 | .94 | .93 | .93 | .92 | .90 | .86 | .81 | .76 | .72 | .68 | .63 | .58 | .53 |
| RB | .78 | .88 | .95 | 1.00 | 1.00 | .96 | .90 | .80 | .69 | .59 | .50 | .42 | .35 | .29 | — | — | — | — | — | — |
| WR | .78 | .87 | .93 | .98 | 1.00 | 1.00 | .96 | .91 | .84 | .77 | .66 | .56 | .46 | .40 | .34 | — | — | — | — | — |
| TE | .60 | .71 | .83 | .93 | .98 | 1.00 | .99 | .96 | .91 | .86 | .82 | .78 | .72 | .64 | .56 | .48 | — | — | — | — |

**Attrition (yearly probability a fantasy-relevant player stops being one, beyond the age decline) [R]**, informed by [D]:
- **[D] Share of fantasy-relevant players still top-N next year** (QB24/RB36/WR48/TE18), by age:
  - RB: 63% at 22, 48–52% at 23–24, 43–47% at 25–27, 36% at 28, 17% at 29.
  - WR: 64% at 22, 41–55% at 23–29, 41% at 31, 25% at 33.
  - These include regression and role churn, so they overstate true attrition. We use a hazard instead.

| Position | Hazard by age band |
|---|---|
| QB | ≤32: 3%, 33–36: 8%, 37+: 15% |
| RB | ≤25: 5%, 26–27: 10%, 28–29: 18%, 30+: 30% |
| WR | ≤27: 4%, 28–30: 8%, 31+: 15% |
| TE | ≤28: 4%, 29–31: 8%, 32+: 15% |

`S_i,y = Π_{t=0}^{y-1} (1 − h(pos, age_i + t))`

**Availability (expected share of team games played next season) [D]:**
- Established starters (≥10 games and starter-level PPG in season t) played a stat-line share in season t+1 of:
  - QB 0.79 mean (median 0.94)
  - RB 0.75 (median 0.88)
  - WR 0.80 (median 0.88)
  - TE 0.72 (median 0.82)
- The 2021+ seasons are understated by about 4% because week 18 is excluded.
- Share playing ≤8 games next year: QB 16%, RB 16%, WR 13%, TE 19%.
- **Defaults [R]:** QB 0.82, RB 0.78, WR 0.82, TE 0.76. Multiply by 17 to get `G_exp`.

### 3.4 Time weights and team context (contender vs rebuilder)

**Present value of a stream of yearly values** X_y:

```
PV = Σ_{y=0}^{H-1} w_profile[y] * X_y            // H = 5 default
```

| Profile [R] | y0 | y1 | y2 | y3 | y4 | Meaning |
|---|---|---|---|---|---|---|
| Contender | 1.00 | 0.55 | 0.30 | 0.15 | 0.08 | Title odds now dominate |
| Balanced (δ = 0.85) | 1.00 | 0.85 | 0.72 | 0.61 | 0.52 | Market-neutral; δ ≈ DP's 0.90 then 0.80 pick discounting |
| Rebuilder | 0.40 | 0.90 | 1.00 | 0.90 | 0.80 | The current season has little value to them |

**In-season scaling [R]:**
```
w0_eff = w0 * (weeks remaining incl. playoffs for that team / total weeks)
```
After the trade deadline, y0 drops out for trades (there are none), but it still applies to cap and cut decisions.

**Auto-detected team status [R]**, from the playoff simulation (§6) and roster age:
- **Contender:** P(playoffs) ≥ 60% or P(title) ≥ 1.5 / nTeams (12.5% in a 12-team league).
- **Rebuilder:** P(playoffs) ≤ 25% *and* the share of MP held by players aged ≥ 27 is below the league median.
- **Balanced:** everyone else.
- The owner can override this in "My Team → Strategy".

The evaluator shows the verdict under **both teams' profiles**. A trade can be "+$6 for A (contender) and +$4 for B (rebuilder)", which is a win-win. These modes exist in public tools only as suggestion filters or pick multipliers [V]. Weighting by profile is our design.

**Phase-2 option [R]:** for contenders, value the current-season part by **Δ championship probability** from §6. Re-simulate the season with and without the trade (common random numbers, 10k sims). Convert with `$ per 1% title odds = (league dues or prize pool share) / 100`, or just show "+3.1% title odds" without converting.

### 3.5 Salary-cap adjustment: surplus value

**Step 1: dollars per VORP point [R]** (standard auction-calculator logic [V]: FantasyPros and others turn VORP shares into dollars)

```
D_avail   = nTeams * (cap - rosterSize * minSalary)          // dollars above minimum the league can spend
$/VORP    = D_avail / Σ_{all players} E[VORP_i,0]           // league-wide projected VORP for the coming season
V$_i,y    = minSalary + $/VORP * E[VORP_i,y]               // production value in cap dollars
```

- CTE defaults (catalog: 12 teams, $200 cap, 25 roster, $1 minimum): `D_avail = 12 × (200 − 25) = $2,100`.
- Using hindsight VORP (about 9,250 in SF, §3.2) gives about **$0.227 per VORP point**. Projected league VORP is smaller (about 6,000–7,000 [R], because projections regress), which gives about **$0.30–0.35**. Always recompute from the league's live projections.
- If `cap.growth` is on, scale `D_avail` per year by the cap growth.

**Step 2: salary schedule [R]** (catalog defaults: 10% compounding escalation, rookie deals flat):
```
Salary_i,y = Salary_i,0 * (1 + e)^y   for y < yearsRemaining; 0 after
```
Apply `cap.taxiChargePercent` and `cap.irChargePercent` when relevant.

**Step 3: surplus with the cut option.** This is a dynamic program solved backward. The catalog's dead-money defaults are 100% of the current year and 50% of each future year:

```
// keep value from year y onward, given the player is still under contract
Keep(y) = w[y] * (V$_y - Salary_y) + Best(y+1)
// cut at the start of year y: lose production, pay dead money now and later
Cut(y)  = - Σ_{t>=y} w[t] * dead_t(y)      where dead_y(y) = 1.00*Salary_y, dead_t(y) = 0.50*Salary_t for t>y
Best(y) = max(Keep(y), Cut(y))              Best(yearsRemaining) = ControlValue (below)
SV      = Best(0)
```

**Control value after the contract [R]**
- An expiring player can be franchise-tagged, given RFA, or extended. The catalog defaults are: tag = average of the top-5 salaries at the position, raised at least 20%; extension = +20% per added year.
- `ControlValue = w[T] * max(0, V$_T − TagCost_T) * P(tag available)`. Default P = 0.5, since one tag per team is shared across candidates.
- If neither option is on, ControlValue = 0. Rookies on the catalog's RFA/option-year rules use the option cost instead of TagCost.

**Worked example [R]** (illustrative numbers):
- **Player:** WR, age 26, projection 250 PPR points next season, WR replacement 135.
- **Contract:** $30 now, 3 years left, 10% escalation.
- **Rates:** `$/VORP` = 2100 / 6500 = $0.323. Hazard 4% per year.
- **Age index:** 26 → 1.00, 27 → 0.96, 28 → 0.91.

| y | P | VORP if active | S | E[VORP] | V$ = $1 + 0.323 × E[VORP] | Salary | V$ − Salary | Balanced w | Contender w | Rebuilder w |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 250.0 | 115.0 | 1.00 | 115.0 | 38.2 | 30.0 | +8.2 | 1.00 | 1.00 | 0.40 |
| 1 | 240.0 | 105.0 | 0.96 | 100.8 | 33.6 | 33.0 | +0.6 | 0.85 | 0.55 | 0.90 |
| 2 | 227.5 | 92.5 | 0.92 | 85.2 | 28.5 | 36.3 | −7.8 | 0.72 | 0.30 | 1.00 |

- **Surplus by profile:**
  - Balanced: 8.2 + 0.5 − 5.6 = **+$3.1**
  - Contender: 8.2 + 0.3 − 2.3 = **+$6.2**
  - Rebuilder: 3.3 + 0.5 − 7.8 = **−$4.0**
- **Cut check for year 2:** keep = −7.8 versus cut = −0.5 × 36.3 = −18.2, so keeping wins and the cut option does not bind.
- MP might call this player a top-40 asset. In CTE, the contract erases most of that value for a rebuilder. That is the core reason for the SV currency.

**Display [R]:**
- Cap sheet column "Surplus (PV $)" with a sparkline of V$ versus salary by year.
- Trade evaluator totals: "Surplus Δ", "Cap space Δ this year" and "Dead-money risk" (worst-case `Cut(0)`).

### 3.6 Rookie draft picks

**(a) Market curve:** use the DP tables in §2.3 [V-exact], scaled into our MP via the same exponential. Superflex leagues use the SF row.

**(b) Realized production by rookie slot [D]**
- **Classes:** 2015–2023 NFL drafts (9 classes). Outcomes are each player's first 3 NFL seasons in PPR.
- **Slot proxy:** each class's QB/RB/WR/TE ordered by NFL draft pick. NFL draft capital is the main driver of rookie ADP [M], but real rookie ADP differs.
- **Hit:** at least one top-12 QB/TE or top-24 RB/WR season. This is NBC's definition.
- **Elite:** at least one top-6 QB/TE or top-12 RB/WR season.
- **vorp3:** the sum of season VORP over 3 years, using the 12-team replacement levels in §3.2.

*Superflex proxy (QBs included), 27 picks per first-round tier:*

| Tier | n | Hit | ≥2 hits | Elite | Mean vorp3 | Median best finish | vorp3 ÷ top tier |
|---|---|---|---|---|---|---|---|
| 1.01–1.03 | 27 | 56% | 33% | 37% | 156 | 13 | 1.00 |
| 1.04–1.06 | 27 | 52% | 41% | 41% | 163 | 23 | 1.04 |
| 1.07–1.09 | 27 | 56% | 30% | 37% | 124 | 17 | 0.80 |
| 1.10–1.12 | 27 | 48% | 33% | 30% | 99 | 22 | 0.64 |
| 2.01–2.06 | 54 | 37% | 15% | 13% | 51 | 32 | 0.33 |
| 2.07–2.12 | 54 | 24% | 15% | 15% | 48 | 36 | 0.30 |
| Round 3 | 108 | 20% | 8% | 10% | 36 | 47 | 0.23 |
| Round 4 | 108 | 10% | 2% | 6% | 15 | 61 | 0.10 |

*1QB proxy (RB/WR/TE only):*

| Tier | Hit | ≥2 hits | Elite | Mean vorp3 | vorp3 ÷ top tier |
|---|---|---|---|---|---|
| 1.01–1.03 | 74% | 52% | 56% | 192 | 1.00 |
| 1.04–1.06 | 48% | 26% | 30% | 123 | 0.64 |
| 1.07–1.09 | 56% | 33% | 26% | 95 | 0.49 |
| 1.10–1.12 | 41% | 15% | 15% | 56 | 0.29 |
| 2.01–2.06 | 30% | 15% | 15% | 51 | 0.27 |
| 2.07–2.12 | 30% | 15% | 17% | 48 | 0.25 |
| Round 3 | 13% | 4% | 6% | 23 | 0.12 |
| Round 4 | 8% | 4% | 5% | 16 | 0.08 |

*Round-1 hit rates by position [D]:*

| Proxy | RB | WR | TE | QB |
|---|---|---|---|---|
| SF | 84% (n 19) | 47% (n 47) | 64% (n 11) | 39% (n 31) |
| 1QB | 85% (n 27) | 41% (n 63) | 56% (n 18) | — |

**Exponential fit to the 5-slot-smoothed vorp3 [D]:**
- `value(slot) ∝ exp(−0.058 × (slot − 1))` in SF (−0.055 in 1QB).
- So 1.12 ≈ 0.53–0.55 × 1.01, 2.12 ≈ 0.26–0.28, and 3.12 ≈ 0.13–0.15.
- Realized 3-year production decays about **3 times more slowly** than the market curve (DP 0.19 per slot). The market pays a large premium for top slots. Plausible reasons [R]: value lasting beyond year 3, the consolidation premium for studs, and hype.

**Mean season VORP by year since draft, SF proxy [D]** (year 4 uses classes 2015–2022, year 5 uses 2015–2021):

| Tier | Y1 | Y2 | Y3 | Y4 | Y5 |
|---|---|---|---|---|---|
| 1.01–1.03 | 45.8 | 57.7 | 52.5 | 45.1 | 57.6 |
| 1.04–1.06 | 32.1 | 52.4 | 78.0 | 53.5 | 54.9 |
| 1.07–1.09 | 18.5 | 49.5 | 56.3 | 38.3 | 26.3 |
| 1.10–1.12 | 29.0 | 37.2 | 33.2 | 45.6 | 39.7 |
| 2.01–2.06 | 10.1 | 19.8 | 21.2 | 34.3 | 19.5 |
| 2.07–2.12 | 10.3 | 20.8 | 16.5 | 18.0 | 18.5 |
| Round 3 | 6.7 | 15.7 | 14.0 | 10.6 | 8.4 |
| Round 4 | 2.0 | 6.7 | 6.4 | 7.7 | 5.3 |

Production rises from year 1 to years 2–3. That matters for contenders: a rookie gives less now.

**Outside checks [V]:**
- NBC: 47.6% of first-round rookie picks hit (same hit definition), trending to 58%. 40 first-round and 27 second-round hits in 2010–2016; only 24 of 336 third-round-or-later picks hit.
- The Dynasty Guru (2018): hit rates of 45.8% / 30.6% / 9.3% for rounds 1, 2, and 3+. With a stricter test (2+ starter seasons): 31.7% / 18.3% / 4.2%.
- DLF GAAP memo: the 2021 class went 7 of 12 and the 2022 class 5 of 12.
- PFF (older): year-1 hits of 86% at 1.01, 57% at 1.02–1.03, and 19% for 1.04–1.12.

Our [D] rates sit in the same range.

**(c) Recommended CTE pick values [R]**
- **Market points:** the DP curve, by format.
- **Cap-league surplus:** the empirical model:
  ```
  E[V$_y | tier] = minSalary + $/VORP * VORP_tier,y       (table above, y = 1..contractYears)
  PickSV(tier)   = Σ_y w[y_offset+y] * (E[V$_y | tier] − scaleSalary_tier) + w[T] * ControlValue_tier
  ```
  `y_offset` = 0 for this year's draft, 1 for next year's, and so on.
- **Rookie-scale finding [D]+[R]:** using the catalog's example rookie scale ($10 for 1.01–1.03, $8, $6, $5, $4, $3, $2, $1, flat for 3 years), hindsight $0.227 per VORP point and V$ = $1 + $0.227 × VORP per year, the 3-year surplus (before control value) is:
  - 1.01–1.03: +$8.4
  - 1.04–1.06: +$15.9
  - 1.07–1.09: +$13.2
  - 1.10–1.12: +$10.6
  - 2.01–2.06: +$2.6
  - 2.07–2.12: +$4.8
  - Round 3: +$5.3
  - Round 4: +$3.4

  In SF, the top-3 tier charges the most for production similar to 1.04–1.06. Most of the top tier's extra value is **elite upside and control years**. **Tell the commissioner** the example scale is steep at the top. A flatter scale ($8 / $7 / $6 / $5 …) keeps surplus monotone. These are small samples (27 per tier) with proxy slots, so present this as guidance, not fact.

**(d) Future picks [R]**, built on the DP discount [V-exact]:

```
PickValue(team, round, yearsOut) = D(yearsOut) * Mean_s~P(slot | team) [ V_slot(round, s) ]
D(0) = 1.00 (slot known or season finished), D(1) = 0.90, D(2) = 0.72, D(3) = 0.65
```

- **Slot probabilities:** P(slot) for the coming draft comes from the playoff simulation (§6.9), applying `draft.orderRule` (reverse standings, playoff finish, max-PF or lottery). For drafts two or more years out, use the uniform 1/nTeams. A team's roster strength can shift it toward a tier: for example a rebuilder's two-years-out 1st weighted 40/35/25 toward early, mid, late [R].
- **Mean:** `Mean` = **geometric** for MP (matches the DP market) and **arithmetic** for SV (expected value).
- **Labels:** in the UI, a pick shows its projected tier ("Proj. 1.03–1.05, 62% early") and an owner tag ("via TEAM").

### 3.7 Injury discounts

**Short-term or in-season [R]:**
```
X_0 ← X_0 * (1 − weeksOut / weeksRemaining)
```
For questionable or doubtful players, apply to the current week only: `p_play` is 0.85 for Questionable, 0.25 for Doubtful, 0 for Out [M].

**Season-ending or long-term:** a multiplier on next season's projection, plus an extra hazard.

| Injury | Year +1 factor | Year +2 factor | Extra hazard (does not return / career-altering) | Source |
|---|---|---|---|---|
| ACL, RB | **0.80** | **0.985** | 10% [R] | [V] 4for4: about −20% PPG in year 1 back, −1.4% in year 2. FantasyLabs: "just under 30%" drop. Another study (Porras via AOL): about −10%, and **29% of RBs did not return** to NFL action. We chose 10% for currently fantasy-relevant RBs. |
| ACL, WR/TE | 0.88 | 0.98 | 5% | [M]. [V] receiving work is reported as less affected than rushing. |
| ACL, QB | 0.95 | 1.00 | 3% | [M] |
| Achilles, RB/WR/TE | 0.70 | 0.90 | 15% | [M] |
| Achilles, QB | 0.85 | 0.95 | 5% | [M] |
| Major lower-leg fracture or ankle (TightRope etc.) | 0.92 | 1.00 | 3% | [M] |
| Recurrent soft tissue (2+ hamstring injuries in 12 months) | availability −0.05 | — | — | [R] |
| Concussion (2+ in 24 months) | availability −0.05 | — | +3% | [R] |

- **Timing [V]:** average return to play for RB ACL tears without posterolateral corner or LCL involvement is about **330 days**. Early-season injuries mean a full-season absence plus a slow start in Week 1.
- **Implementation [R]:** an injury record holds `{type, date, side, expectedReturnWeek}`. The model applies the multipliers by days since injury rather than by season boundary: use the year-+1 factor for 0–12 months after the injury and the year-+2 factor for 12–24 months.

### 3.8 Format adjustments

**Superflex or 2QB:** QB replacement moves from about QB13 to about QB24–26 (§3.2 table).
- [D] QB replacement is about 165 points in SF versus about 244 in 1QB, which raises QB VORP by about 80 points per season.
- [V-exact] DP's 2QB values raise QBs ranked 1 to 5 from about 3,900–7,100 (1QB) to about 8,000–10,200.

**TE premium:** recompute TE projections with the league's bonus, then recompute VORP. The market shortcut is in §3.1.

**PPR level:** the half-PPR residual SDs are smaller for receivers (§4.1). Value shifts toward high-reception players by about +0.5 × receptions per game. This is handled by projecting with league scoring.

**Deeper benches or taxi:** waiver replacement drops and the roster-spot value rises. Recompute `rosterSpotValue` = MP of the best waiver player (§3.9) every week.

### 3.9 Consolidation: 2-for-1 and roster spots

**Neutral market calculator (MP) [R]:** a power sum plus a roster-spot credit.

```
Adj(side) = ( Σ_{assets a in side} MP_a^α )^(1/α)  +  RS(extraSpots(side))
extraSpots(side) = max(0, nAssets(other side) − nAssets(side))     // spots this side frees up
RS(n) = Σ_{j=1..n} R * (1 + step*(j−1))                            // R = 150, step = 0.25 (FantasyCalc-style "grows per spot")
α = 1.20 default; 1.00 = no stud premium (pure sum); 1.35 = strong (KTC-like feel)
```

- **Properties:**
  - Monotone: adding an asset never lowers Adj.
  - The marginal value of a small throw-in is close to 0. Under α = 1.2, adding a 500 to two 4500s adds about +240.
  - The largest asset dominates.
  - Order-independent, cheap to compute, and easy to explain ("studs count extra").
- **Auto-tuning R [R]:** set `R` = max(150, MP of the best unrostered player at the receiving side's most-needed position).
- **Verdict:** `Δ = Adj(A) − Adj(B)`; `pct = |Δ| / max(Adj(A), Adj(B))`.

**Worked examples** (α = 1.2, R = 150) [R]:

| Side A gets | Side B gets | Plain sums | Adj A | Adj B | Δ (A − B) | Verdict |
|---|---|---|---|---|---|---|
| 8000 | 4500 + 4500 | 8000 vs 9000 | 8150 | 8018 | +132 | Fair |
| 8000 | 6000 + 2000 | 8000 vs 8000 | 8150 | 7311 | +839 | Slight edge A (10%) |
| 8000 | 4500 + 4500 + 500 | 8000 vs 9500 | 8338 | 8257 | +81 | Fair (the throw-in barely matters) |
| 8000 | 3000 × 3 | 8000 vs 9000 | 8338 | 7494 | +843 | Slight edge A |
| 6000 + 3000 | 9000 | 9000 vs 9000 | 8108 | 9150 | −1042 | Slight edge B (11%) |
| 5000 | 4000 + 1200 | 5000 vs 5200 | 5150 | 4772 | +378 | Slight edge A (7%) |

**Sensitivity of "8000 vs 4500 + 4500" to α:**

| α | Δ (A − B) |
|---|---|
| 1.00 | −850 |
| 1.15 | −72 |
| 1.20 | +132 |
| 1.30 | +480 |

**Cap-league and team-context evaluator (recommended for real in-league trades) [R].** Skip α entirely. Re-optimize each roster's **weekly starting lineup** with and without the trade, using projections, byes and injuries. Then sum:

```
ΔTeamValue(team) = Σ_y w[y] * [ Σ_weeks ( OptLineupPts_with − OptLineupPts_without ) * $/pt ]   // production that actually starts
                 + ΔSurplus contract terms (salary, dead money, control)                         // §3.5
                 + ΔRosterSpot (waiver replacement for the spots freed or used)
```

- A 2-for-1 helps the side receiving two players only if the second player starts, or is the main injury fill-in. This is exactly the consolidation effect, measured rather than assumed.
- `$/pt` is the same `$/VORP` from §3.5.

### 3.10 Trade evaluator output [R]

**Header:** a verdict chip (Fair / Slight edge / Clear edge / Lopsided). The bands are |Δ| as a share of the larger side: ≤5%, 5–12%, 12–25%, >25%.

**Panels**, left team against right team:
1. **Market (MP):** plain sum, consolidation adjustment (with an info tooltip), adjusted total.
2. **Cap and contracts (SV):** surplus by year (stacked bars for y0 to y4), cap space Δ this year and next, dead-money exposure, years of control.
3. **Team context:**
   - Δ projected starting points per week, ROS and next year.
   - Δ P(playoffs) and Δ P(title) from 2,000 quick sims, or 10k on demand.
   - Each team's profile (Contender, Balanced or Rebuilder) and the verdict under each.
4. **Age and risk:** value-weighted age before and after, injury flags, and the share of value in RBs aged 27+.

**Commissioner review flag:** pct > 35% on MP *and* SV both favour the same side. This is the "possible collusion review" queue. It flags only and never blocks.

**Retro grade:** stored at trade time (MP, SV and team-context numbers) and recomputed weekly for "Trade Retrospective" in the recap (§7.6).

### 3.11 Updating and storage [R]

- **Nightly job:**
  - Pull consensus ranks.
  - Recompute MP, projections, VORP, $/VORP and SV for every rostered player and pick.
  - Store a daily snapshot `asset_value(asset_id, date, mp_1qb, mp_sf, pv_y0..y4, v$_y0..y4, sv_balanced, sv_contender, sv_rebuilder)` for value-history charts.
- **Versioning:** store `model_version` and the constants with every snapshot, so a trade grade can be explained later.

---

## 4. Weekly scoring distributions (inputs for win probability and simulation)

### 4.1 Per-position weekly scoring SD

**[D]** Starter-caliber player-weeks, weeks 3–17, 2016–2025, PPR, measured against the naive projection.

| Pos | n | Mean proj | Mean actual | SD actual | **SD error (PPR)** | SD error (half-PPR) | CV (SD error ÷ proj) | Skew | p10 error | Median error | p90 error | % weeks ≤ 0 pts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| QB | 3,356 | 18.1 | 17.4 | 8.1 | **7.9** | 7.9 | 0.44 | 0.22 | −10.7 | −1.0 | +9.6 | 0.8% |
| RB | 5,182 | 13.8 | 13.3 | 8.6 | **8.0** | 7.6 | 0.58 | 0.80 | −9.4 | −1.8 | +10.5 | 0.6% |
| WR | 7,807 | 13.6 | 12.9 | 8.5 | **8.1** | 7.2 | 0.60 | 0.80 | −9.9 | −1.8 | +10.1 | 2.5% |
| TE | 3,594 | 10.1 | 9.8 | 7.1 | **6.8** | 5.9 | 0.67 | 0.92 | −7.7 | −1.3 | +8.7 | 4.0% |
| K | 3,393 | 8.6 | 7.9 | 4.6 | **4.7** | — | 0.55 | 0.47 | −6.4 | −1.0 | +5.5 | 3.5% |
| DST | 4,784 | 6.4 | 6.4 | 5.7 | **5.7** | — | 0.90 | 0.74 | −6.6 | −0.8 | +7.6 | 12.4% |

**Within-player season SD [D]** (player-seasons with ≥10 games and PPG above the starter threshold; this is the noise floor without projection error):

| Pos | Mean SD | CV |
|---|---|---|
| QB | 7.4 | 0.41 |
| RB | 7.6 | 0.57 |
| WR | 7.8 | 0.59 |
| TE | 6.5 | 0.66 |
| K | 4.5 | 0.54 |
| DST | 5.4 | 0.90 |

**Outside check [V]:** a 4for4 weekly-consistency study gives CVs of about QB 41%, K 49%, WR 61%, RB 63%, TE 70% and D/ST 71%. These match except DST. Our DST scoring includes negative points-allowed tiers, which widens it.

**Recommended defaults (weekly SD in PPR) [R]:**

| Pos | Weekly SD |
|---|---|
| QB | 7.9 |
| RB | 8.0 |
| WR | 8.1 |
| TE | 6.8 |
| K | 4.7 |
| DST | 5.7 |

In half-PPR, use RB 7.6, WR 7.2 and TE 5.9.

### 4.2 SD as a function of projection [D]

**Weighted linear fit** over 2-point projection buckets, using buckets with ≥200 player-weeks:

| Pos | sd(proj) = a + b·proj | Bucket evidence (proj → SD) |
|---|---|---|
| QB | 7.15 + 0.05·p | 9 → 8.1, 15 → 7.8, 19 → 7.9, 23 → 8.8 (roughly flat) |
| RB | 4.58 + 0.25·p | 3 → 5.0, 7 → 6.8, 11 → 7.2, 15 → 7.9, 19 → 9.9 |
| WR | 3.83 + 0.31·p | 3 → 4.5, 7 → 6.1, 11 → 7.5, 15 → 8.3, 19 → 9.8, 21 → 9.3 |
| TE | 2.93 + 0.37·p | 3 → 3.9, 7 → 5.8, 11 → 6.8, 15 → 7.8 |
| K | 4.08 + 0.06·p | 5 → 4.4, 9 → 4.5, 11 → 5.1 |
| DST | 5.22 + 0.06·p | 3 → 5.5, 7 → 5.6, 9 → 5.7 |

**Floors [R]:** QB 6.0, RB 3.5, WR 3.0, TE 2.5, K 3.5, DST 4.5.

**Projection bias [D]:** naive projections run hot for high projections (WR at 17+: −1.7 to −2.1; QB at 20+: −1.4 to −1.7) and cold for low ones. That is regression to the mean. Our own projection pipeline should shrink toward the positional mean. For win probability, handle it with the shrink factor λ in §4.6.

### 4.3 Distribution shape and sampler

- **[D]** Player-week errors are **right-skewed** (skew 0.2–0.9). The median sits 1–2 points below the mean: "most weeks slightly disappoint, a few weeks explode".
- **[V]** A Footballguys article notes that player fantasy-point distributions look more like **gamma** than normal.
- **Player-level sampler [R]:** a shifted gamma matched to mean μ = proj and SD σ = sd(proj), with shift L to allow negatives:

```
L = {QB: -4, RB: -2, WR: -1, TE: -1, K: -3, DST: -8}      // [R] about the observed minima region
shape k = ((μ − L) / σ)^2,  scale θ = σ^2 / (μ − L);  X = L + Gamma(k, θ)
```

  Unshifted gamma shapes at the average starter for reference [D]: QB 5.3, RB 3.0, WR 2.8, TE 2.2, K 3.4, DST 1.3.
- **Alternative:** bootstrap residuals. ffsimulator's approach [V] resamples historical weekly scores for players at the same positional rank. Store empirical residual quantiles per position and projection bucket (deciles), then sample `proj + residual × (sd(proj) / sd_bucket)`.
- **Team level:** the sum of 9–10 starters is close to normal (CLT). Use the **normal** model for team totals and win probability. Keep gamma or bootstrap for player range bars ("p10–p90") on matchup pages.

### 4.4 Correlations between players in the same NFL game

**[D]** Pearson correlation of projection errors. Players are ranked by projection within their team that week.

| Pair | r | Pair | r |
|---|---|---|---|
| QB1 ~ WR1 (same team) | **+0.34** | QB1 ~ opposing DST | **−0.38** |
| QB1 ~ WR2 | +0.30 | K ~ opposing DST | −0.29 |
| QB1 ~ TE1 | +0.28 | DST ~ opposing DST | −0.25 |
| QB1 ~ RB1 | +0.09 | RB1 ~ opposing DST | −0.22 |
| QB1 ~ K (same team) | +0.09 | QB1 ~ opposing QB1 | +0.19 |
| K ~ own DST | +0.24 | QB1 ~ opposing WR1 | +0.10 |
| RB1 ~ own DST | +0.06 | WR1 ~ opposing WR1 | +0.07 |
| QB1 ~ own DST | −0.06 | WR1 ~ WR2 (same team) | +0.01 |
| RB1 ~ RB2 (same team) | −0.03 | WR1 ~ TE1, RB1 ~ WR1 | ≈0.00 |

**Team variance [R]:**
```
Var(T) = Σ_i σ_i² + 2 Σ_{i<j} ρ_ij σ_i σ_j        // ρ_ij from the table when i, j share an NFL game; else 0
Cov(T_A, T_B) = Σ_{i∈A, j∈B} ρ_ij σ_i σ_j          // e.g. my QB vs your DST that faces him (ρ = −0.38)
σ_margin² = Var(T_A) + Var(T_B) − 2 Cov(T_A, T_B)
```

In a sampler, use a Gaussian copula with these ρ and the gamma marginals from §4.3.

### 4.5 Team-level numbers

**[D] Method:** a pseudo-league.
- 12 teams per season, snake-drafted by season-average projection.
- Roster: 2 QB, 5 RB, 6 WR, 2 TE, 1 K, 1 DST.
- Each week the lineup starts the highest-projected eligible players.
- 2016–2025, about 1,970 team-weeks per format.

| Metric | Standard lineup (QB, 2RB, 3WR, TE, FLEX, K, DST) | CTE superflex lineup (QB, 2RB, 3WR, TE, 2 FLEX, SF) |
|---|---|---|
| Mean projected / actual team score | 126.2 / 120.7 | 133.3 / 129.4 |
| SD of weekly actual score | 24.5 | 27.4 |
| SD of (actual − projected) | 23.3 | 24.7 |
| … after removing the league-wide weekly shock | 21.9 | 22.9 |
| League-wide weekly common shock (SD of the mean error across teams) | 9.4 | 9.8 |
| Matchup margin error SD | 32.4 | 34.1 |
| Implied correlation between opponents' errors | +0.03 | +0.05 |

The **common weekly shock** (some weeks everyone scores high) cancels in head-to-head games. It matters for median games, all-play and points-for tiebreakers (§6.2).

### 4.6 Pre-game win probability

**Model [R]** (normal on the margin, with shrink and calibration):

```
μ_A = Σ starters' projections (0 for byes/inactives);  σ_A, σ_B, Cov from §4.4
WP_A = Φ( λ * (μ_A − μ_B) / σ_margin )            λ = projection shrink, default 0.75
Ties: P(tie) ≈ 0 with decimal scoring; if the league scores integers, P(tie) ≈ φ(z)/σ_margin.
```

**Calibration [D].** With naive projections and σ_margin from the residuals (32–34), the model is **overconfident**:

| Predicted | Observed |
|---|---|
| 0.85 | 0.78 |
| 0.75 | 0.65–0.70 |
| 0.15 | 0.21–0.23 |

Maximum-likelihood fits:

| Fit | Standard | Superflex |
|---|---|---|
| Normal: effective margin SD | 46.5 | 45.5 |
| Pythagorean exponent k in P = a^k / (a^k + b^k) | 4.3 | 4.6 |
| Logistic scale s in P = 1 / (1 + e^(−Δ/s)) | 28.75 | 27.75 |

- Log loss: 0.657–0.659 (standard) and 0.632–0.635 (SF), against 0.693 for a coin flip.
- The best normal fit implies **λ ≈ 32.4 / 46.5 = 0.70** (standard) to **0.75** (SF). Projection differences are too wide by about 25–30% because naive projections do not regress.
- Example, 125 vs 115 projected: normal σ = 34 → 61.6%, σ = 46 → 58.6%, Pythagorean k = 3.5 → 57.2%, k = 4.4 → 59.1%.

**Footnote [V]:** a Footballguys forum thread on CBS's live win-percentage display quotes the pre-game form `a^3.5 / (a^3.5 + b^3.5)` as matching CBS's starting number. That is a user's reconstruction, not CBS documentation. Our data says k = 3.5 is slightly too flat for naive projections; with better projections it may be about right.

**Recommendation [R]:**
- Ship the **normal model with λ = 0.75** and player-level σ from §4.2.
- Log every pre-lock projection and outcome.
- Refit λ by maximum likelihood after each season (minimum 300 matchups; until then, pool with this prior).
- Show WP to whole percents. Clamp the display to 1%–99% until the result is final.

### 4.7 Calibration logging [R]

- **Table:** `projection_log(week, player_id, slot, proj, sd, locked_at, actual)`.
- **Season-end job:**
  - Refit `a`, `b` and the floors per position.
  - Refit λ.
  - Refit the correlations if the sample is ≥ 2,000 pairs.
  - Write `model_params(version, season, ...)`.

---

## 5. Live win probability

### 5.1 Model [R]

For each starter i, take:
- `S_i` = points so far.
- `f_i` = share of the NFL game remaining: game clock remaining / 3600. Use 1 before kickoff and 0 when final.
- `p_i` = pre-game projection.
- `σ_i` = pre-game SD.

```
μ_i,rem = p_i * r(f_i) + paceAdj_i                    r(f) = expected share of points still to come
σ²_i,rem = σ_i² * v(f_i)                              v(f) = share of variance still to come
paceAdj_i = β_pos * (S_i − p_i * (1 − r(f_i))) * min(1, f_i / (1 − f_i))   // only RB has β ≠ 0

Team: S_A = Σ S_i;  μ_A,rem = Σ μ_i,rem;  V_A = Σ σ²_i,rem + 2 Σ ρ_ij σ_i,rem σ_j,rem  (same-game pairs, both still live)
WP_A(t) = Φ( ( (S_A − S_B) + λ * (μ_A,rem − μ_B,rem) ) / sqrt(V_A + V_B − 2 Cov_AB,rem) )
// λ (§4.6) shrinks only the still-projected part; points already scored are certain.
// Projected final shown to users = S_A + μ_A,rem (unshrunk).
```

### 5.2 Expected share of points by game clock: r(f) [D]

Play-by-play 2022–2025, starter-caliber player-games, approximate PPR from plays (no 2-pt or return TDs). The table shows the share of final points already scored when that much game clock has elapsed:

| Elapsed (min) | Clock share | QB | RB | WR | TE | K |
|---|---|---|---|---|---|---|
| 7.5 | 0.125 | 0.103 | 0.128 | 0.114 | 0.111 | 0.081 |
| 15 (end Q1) | 0.25 | 0.226 | 0.251 | 0.236 | 0.220 | 0.197 |
| 22.5 | 0.375 | 0.337 | 0.372 | 0.345 | 0.337 | 0.319 |
| 30 (half) | 0.50 | 0.519 | 0.520 | 0.519 | 0.509 | 0.533 |
| 37.5 | 0.625 | 0.624 | 0.637 | 0.623 | 0.615 | 0.616 |
| 45 (end Q3) | 0.75 | 0.751 | 0.767 | 0.750 | 0.739 | 0.738 |
| 52.5 | 0.875 | 0.860 | 0.877 | 0.856 | 0.851 | 0.841 |
| 57 | 0.95 | 0.933 | 0.946 | 0.931 | 0.920 | 0.912 |

**Share of fantasy points by quarter [D]:**

| Pos | Q1 | Q2 | Q3 | Q4 | OT |
|---|---|---|---|---|---|
| QB | 22.6% | 29.4% | 23.2% | 24.2% | 0.7% |
| RB | 25.1% | 26.9% | 24.6% | 22.6% | 0.7% |
| WR | 23.6% | 28.3% | 23.1% | 24.2% | 0.8% |
| TE | 22.0% | 28.9% | 23.0% | 25.2% | 0.8% |
| K | 19.7% | 33.6% | 20.6% | 25.4% | 0.8% |

**Final 2:00 of each half** (13.3% of the clock):

| Pos | Share of points |
|---|---|
| K | 19.4% |
| QB | 13.3% |
| TE | 14.5% |
| WR | 13.3% |
| RB | 9.3% |

**Recommendation [R]:**
- Use **linear r(f) = f** by default. The worst miss is about 4 points of share (QB and K mid-Q2).
- Optional refinement: a piecewise-linear r through each position's quarter shares. For skill positions use Q1 .23, Q2 .29, Q3 .23, Q4 .25. For K use .20, .34, .21, .25.
- **Halftime is not a pause in r:** 52% of points are done at 30:00.

### 5.3 Remaining variance v(f) [D]

The ratio Var(points still to come) ÷ Var(full-game points), by elapsed time:

| Elapsed (min) | Clock share | QB | RB | WR | TE | K | f (linear) |
|---|---|---|---|---|---|---|---|
| 0 | 0 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| 15 | 0.25 | 0.82 | 0.75 | 0.77 | 0.77 | 0.82 | 0.75 |
| 30 | 0.50 | 0.53 | 0.42 | 0.48 | 0.48 | 0.51 | 0.50 |
| 45 | 0.75 | 0.30 | 0.20 | 0.25 | 0.25 | 0.30 | 0.25 |
| 52.5 | 0.875 | 0.18 | 0.11 | 0.16 | 0.15 | 0.18 | 0.125 |
| 57 | 0.95 | 0.09 | 0.05 | 0.07 | 0.09 | 0.11 | 0.05 |

**Recommendation [R]:**
- `v(f) = f`, which is Brownian-style scaling. The standard deviation of points still to come then shrinks with √f. The NFL win-probability model on Pro-Football-Reference uses the same √time scaling for the score margin [V].
- Optional per-position exponents `v = f^γ`: RB γ ≈ 1.2, QB and K γ ≈ 0.95, WR and TE 1.0.

### 5.4 Does in-game pace predict the rest of the game? [D]

Correlation between first-half error (points − 0.52 × proj) and second-half error (points − 0.48 × proj):

| Pos | Correlation | Slope |
|---|---|---|
| QB | −0.05 | — |
| WR | 0.00 | — |
| TE | +0.04 | — |
| K | +0.03 | — |
| RB | **+0.14** | 0.139 |

- The RB signal reflects workload and game script.
- **Recommendation:** set β_RB = 0.14 and β = 0 for all other positions. Do not "extrapolate pace". A WR with 15 points at halftime is expected to add only his usual second-half share.

### 5.5 Edge cases [R]

| Situation | Rule |
|---|---|
| Player inactive or ruled out before kickoff | p_i = 0, σ_i = 0. Show a red "OUT – 0 proj" chip. If the league allows late swaps, keep a "swap available until HH:MM" flag. |
| Player leaves injured (status "Out" or "Doubtful to return" from the live feed) | μ_rem = 0 and σ_rem = 0 from that moment. "Questionable to return": multiply μ_rem by 0.5 and σ_rem² by 0.5. |
| Overtime | f = (OT clock remaining / 600) × 0.03. OT holds about 0.7–0.8% of points [D], so remaining is almost 0. |
| Game delayed or postponed | f = 1 and the "not started" state. If moved to another week, follow league rules (0 points or carry-over). |
| DST | Points-allowed tiers are a step function. Rule: `μ_rem = p × f` until f < 0.25. Then model the opponent's final score as N(current + implied team total × f, (10·√f)²); the implied total comes from the betting line, or 21.5 by default [R]. Integrate the PA-tier table over that distribution, add `stat-event points × f`, and cap σ_rem at the remaining tier spread. |
| K | Linear r is fine. Add 0.3 × f to the second-quarter weight for the 2-minute drill when using the piecewise r. |
| Stat corrections (Tuesday or Thursday) | Recompute final results. If a result flips, record the change in the transaction log and the recap ("Stat correction flipped matchup X"). |
| Bench players | Excluded from WP. Shown as "bench points" for tiebreakers when `tiebreakers.regularSeasonMatchup = benchPoints`. |
| Ties possible | WP_A = P(A > B) + 0.5 × P(tie). Show "Tie ≈ x%" only if the league scores integers. |

### 5.6 Output and UI [R]

On the matchup page, add a horizontal WP bar under the scoreboard. Each side shows:
- Score
- Projected final (`S + μ_rem`)
- `p10–p90` range
- "Players left: n (yet to play / in progress)"

Also add a **WP timeline chart** across the game window (Thu / Sun 1 pm / 4 pm / SNF / MNF). Recompute every scoring play or every 60 s. Label the biggest swings ("+18% – RB X 45-yd TD").

**League scoreboard:** a mini WP bar for each matchup. Sort "closest games" first on mobile.

**Storage:** `live_wp(matchup_id, ts, wp_home, proj_home, proj_away)`. Downsample to one point per minute after the game.

---

## 6. Playoff odds: Monte Carlo simulation

### 6.1 Inputs

- Current standings: W, L, T, PF, PA, division, head-to-head record matrix, all-play and median records.
- Remaining schedule (regular season and any median game).
- Playoff settings: team count, byes, divisions, reseeding, consolation bracket.
- Tiebreaker tokens from the settings catalog (§13 of `rules-catalog.md`). Defaults are:
  - Standings: `winPct, headToHeadRecord, pointsFor, divisionRecord, pointsAgainstHigh, coinFlip`
  - Playoff matchups: `benchPoints, higherSeed`
- Per team and week, from current rosters, ROS projections, byes and known injuries:
  - Mean `μ_t,w` from the optimal projected lineup.
  - SD `σ_t,w` from §4.4.

### 6.2 Score model [R] (from [D])

```
score_t,w = μ_t,w + u_t + c_w + ε_t,w
u_t  ~ N(0, τ²)          per team per simulation: persistent "our projections of this team are wrong" (strength uncertainty)
c_w  ~ N(0, 9.5²)        per week per simulation, shared by all teams: league-wide high/low weeks [D: 9.4–9.8]
ε_t,w ~ N(0, σ_t,w² − 9.5²)   team-specific weekly noise (σ_t,w ≈ 23–25 incl. common part [D])
```

**τ (persistent team-strength error) [D]:**
- Per-player persistent ROS projection error (points per game, conditional on playing), as of weeks 4 / 8 / 12:
  - QB 3.0 / 2.5 / 2.7
  - RB 3.7 / 2.9 / 2.5
  - WR 3.0 / 3.1 / 2.1
  - TE 2.3 / 2.3 / 2.3
  - K 1.4 / 1.0 / 0.4
  - DST 1.9 / 1.8 / 1.2
- Summed over a 10-starter superflex lineup (independent): about **9 points per week** at weeks 4–8 and about **7.5** at week 12.
- Lineup management (benching busts) lowers the effective value.
- **Defaults [R]:** τ = 8 at weeks ≤ 6, 7 at weeks 7–11, 6 at weeks ≥ 12, and 0 for weeks already played.

**Injury hazard [R]:** in each simulated week, each starter has a 5% chance of a multi-week injury (§3.3 availability). The team mean then drops to the best bench replacement for 1–4 weeks (uniform). This fattens the tails realistically. Make it optional (`sim.injuryHazard = 0.05`).

### 6.3 Algorithm

```ts
function simulateSeason(state: LeagueState, cfg: SimConfig, seed: number): SimSummary {
  const rng = pcg32(seed);                       // reproducible; store seed with the result
  const tally = initTally(state.teams);          // counts per team: playoffs, bye, seed[k], title, finish[k], draftSlot[k]
  for (let s = 0; s < cfg.nSims; s++) {
    const st = cloneStandings(state.standings);
    const u = state.teams.map(() => rng.normal(0, cfg.tau));
    for (const week of state.remainingRegularWeeks) {
      const c = rng.normal(0, cfg.commonShockSD);
      const scores = new Map<TeamId, number>();
      for (const t of state.teams)
        scores.set(t, state.mu[t][week] + u[t] + c + rng.normal(0, Math.sqrt(Math.max(1, state.sd[t][week] ** 2 - cfg.commonShockSD ** 2))));
      for (const g of state.schedule[week]) applyResult(st, g.home, g.away, scores);    // W/L/T, PF, PA, H2H, division
      if (cfg.medianGame) applyMedianGame(st, scores);                                   // +1 W to top half, +1 L to bottom half
      updateAllPlay(st, scores);
    }
    const seeds = seedTeams(st, cfg.playoffs, cfg.tiebreakers, rng);   // divisions, wildcards, tiebreak chain
    const bracketResult = simulateBracket(seeds, state, u, cfg, rng);  // byes, reseeding, 2-week finals, matchup tiebreakers
    const draftOrder = draftOrderFrom(st, bracketResult, cfg.draftOrderRule, rng);      // §6.9
    record(tally, st, seeds, bracketResult, draftOrder);
  }
  return summarize(tally, cfg.nSims);           // probabilities with ±1.96*sqrt(p(1-p)/N)
}
```

### 6.4 Tiebreakers and seeding

Apply the token chain in order to each **tied group**, re-starting the chain whenever a group splits (NFL-style) [R].

| Token | Simulation implementation |
|---|---|
| `winPct` | (W + 0.5 T) / G |
| `headToHeadRecord` | Win percentage in games among the tied teams only. With `multiTeamHeadToHead = skipIfNotAllPlayedEqually`, skip the step unless every pair played the same number of times. |
| `headToHeadPoints` | PF in games among the tied teams |
| `pointsFor` / `pointsAgainstHigh` / `pointsAgainstLow` | Simulated season totals. These are continuous, so ties almost never survive. |
| `divisionRecord` | W% in division games |
| `allPlayRecord`, `medianRecord` | Tracked each simulated week |
| `maxPotentialPoints` | Needs an optimal-lineup score each simulated week. Approximate it as score + E[bench gain] (≈ +8 to +15 [D], §7.2), or skip it in simulations and note that. |
| `benchPoints` (playoff matchups) | Simulate a bench score ~ N(μ_bench, 15²) only when needed |
| `coinFlip` | rng |

**Seeding procedure [R]:**
1. Division winners (if `playoffs.divisionWinnersAutoBid`) take the top seeds, or are guaranteed a spot only (setting).
2. Remaining spots go to wildcards by the standings chain.
3. Byes go to the top `playoffs.byes` seeds.
4. Optional reseeding each round.

### 6.5 Playoff bracket simulation

- Use the same score model. The u_t persists from the regular season.
- Two-week finals sum both weeks.
- Week-17 rest risk: optionally lower μ by 3% for teams with many players on clinched NFL teams [R].
- Consolation and toilet bowls are simulated only if they decide draft order.

### 6.6 Outputs (Standings → "Playoff Odds" tab) [R]

**Columns per team:**
- Record
- PF
- Projected final W–L (mean; also p10–p90)
- **Playoffs %**
- **Bye %**
- Division %
- Seed distribution (mini stacked bar 1…N)
- **Title %**
- Δ since last week (green or red)
- **Leverage this week** = P(playoffs | win) − P(playoffs | loss), from conditioning the same sims on this week's result
- Projected draft slot (mode) and the slot distribution sparkline

**Precision:** 10,000 simulations give a standard error of at most 0.5 points (at 50%). Display whole percents, plus "<1%" or ">99%" when not mathematically decided.

**"What-if" mode:** the user fixes outcomes of remaining games (click winners), then re-runs 2,000 simulations in a Web Worker.

### 6.7 Clinch and elimination codes [R]

The checks are deterministic and ignore points.

- **Clinched playoff (x):** T's minimum possible wins (lose out) > the k-th highest maximum possible wins among the other teams, where k = number of playoff spots. With "≥" and a tiebreaker T cannot lose for certain (e.g. H2H already won), also count it as clinched.
- **Eliminated (e):** T's maximum wins (win out) < the k-th highest *minimum* wins among the others, or is equal with a tiebreaker T certainly loses.
- **Division (y) and bye (z):** the same logic within the relevant group.
- Head-to-head games among rivals make the simple bounds conservative. That is acceptable: we may show "99.9%" rather than "x" for a while. When fewer than 20 games remain, run an exact search over all W/L outcomes (2^games), treating PF-based tiebreakers as unknown.

### 6.8 Performance

- 12 teams × 5 remaining weeks × 10k simulations is 600k team-score draws plus sorting. That is under 150 ms in a Node worker [R estimate].
- Run nightly and after each game slot (Thu / Sun / Mon) via a job.
- Cache by `(leagueId, week, standingsHash, projectionsVersion)`.
- **Common random numbers:** reuse the seed for before/after comparisons (trade Δ odds, what-ifs) so differences are not noise.

### 6.9 Draft-slot distribution (feeds §3.6 future-pick values) [R]

- From each simulation, apply `draft.orderRule`: reverse standings for non-playoff teams, then playoff finish (champion last); or `maxPotentialPoints` / lottery if configured.
- Accumulate P(team holds slot s).
- Combine with pick ownership: a pick's value uses its *original* team's slot distribution.

---

## 7. Manager decision-quality metrics (weekly recap)

### 7.1 Optimal (hindsight) lineup: exact algorithm [R]

- Model the lineup as an assignment problem: slots on one side, rostered players on the other.
- Weight = actual points if the player is eligible for the slot, −∞ otherwise.
- Solve with the **Hungarian algorithm**. Size is at most 12 slots × 40 players, so it is trivial.
- Greedy "most restrictive slot first" is *not* always optimal with FLEX plus SUPER_FLEX multi-eligibility, so use Hungarian.
- **Scope:** only players on the roster at the week's first lock. Players added mid-week count only for games after they were added (`acquiredAt < game kickoff`). IR and taxi players are excluded unless `taxi.playersCanStart`.
- **Projection-optimal lineup:** the same solver using pre-lock projections. Store it at each lock time.

### 7.2 Lineup efficiency and points left on the bench

```
LineupEfficiency (LE) = ActualStarterPts / OptimalPts                 (if OptimalPts ≤ 0 → LE = 1)
PointsLeftOnBench (PLB) = OptimalPts − ActualStarterPts
```

**Baselines:**
- **[V]** The ffsimulator simulation package assumes a *human* manager's LE ~ N(0.775, 0.05), "usually between 0.67 and 0.87".
- **[D]** A manager who **always starts the highest projection**, on a 17-man pseudo-roster:

| Lineup | Mean LE | Median | p10 | p90 | Mean PLB | p90 PLB |
|---|---|---|---|---|---|---|
| Standard (with K/DST) | 0.897 | 0.910 | 0.775 | 1.000 | 14.5 | 31.7 |
| Superflex (10 starters) | 0.947 | 0.973 | 0.849 | 1.000 | 8.0 | 23.3 |

- Bigger CTE benches (25 + taxi) lower LE mechanically. **Rank managers by league percentile** and show "vs projection-follower" rather than raw thresholds.

### 7.3 Decision delta (did the manager beat the projections?) [R]

```
DecisionDelta_w = ActualStarterPts − ActualPts(ProjectionOptimalLineup)
```

- Positive means the manager's start/sit calls beat simply following projections.
- Season total plus a weekly bar. This separates **skill in lineup calls** from **roster quality** (PF) and **luck** (§7.7).

### 7.4 Start/sit hits [R]

**Decision set:** for each starting slot, the started player versus the **best benched alternative eligible for that slot** (by actual points). Only alternatives that were not yet locked when the starter locked count.

**Scoring:**
- **Hit:** starter ≥ alternative.
- **Miss:** alternative > starter.
- **Big miss:** alternative − starter ≥ 10 points.
- **Close call:** |proj_starter − proj_alt| < 3 points.
- **Record:** "Start/Sit 9–1 this week (close calls 3–1)" and "Season 98–34 (74%)".
- **Net start/sit points:** Σ (starter − alternative) over close calls.
- **Expected hit rate** for a projection-follower ≈ the share of close calls that projections get right. Compute it league-wide each week and show it as the baseline.
- **Biggest decision of the week:** the single decision with the largest |starter − alternative| among close calls. Use it for the recap headline.

### 7.5 Waiver and free-agent pickup impact [R]

For each add (waiver or FA) at week w₀, over weeks w₀..now:

```
StartedPts       = Σ points while in the starting lineup
MarginalPts      = Σ_weeks ( OptLineupActualPts_with_player − OptLineupActualPts_without_player )   // hindsight value to that roster
ManagerCaptured  = Σ_weeks ( StartedPts_w − pts of the player he displaced from the lineup that week )
FAAB efficiency  = MarginalPts / max(1, FAAB $ spent)         (show per-$ and total)
PickupHit        = started ≥ 3 times OR MarginalPts ≥ 15
```

- **Weekly recap:** "Waiver Wire MVP" (highest MarginalPts this week among adds within the last 4 weeks) and "Best FAAB value" (highest MarginalPts per $ this season).
- **Drops:** "Points dropped" = points scored by released players that week for any new team, plus "Regret" if they would have started.
- **Cap leagues:** include the salary taken on and the dead money from the corresponding drop.

### 7.6 Trade retrospective [R]

- **At trade time:** store MP, SV and the team-context Δ (§3.10).
- **Weekly:**
  - `StarterPtsSinceTrade(team)` = Σ actual starter points of acquired players − Σ points those traded away would have scored *in that team's optimal lineup* (counterfactual lineup recompute).
  - `ValueΔSinceTrade` = (current MP or SV of assets received − assets sent) − the Δ at trade time.
- **Recap block:** "Trade Watch: Team A leads the Week 5 trade by +38 starter pts and +$4 SV."

### 7.7 Luck metrics

**All-play** [V for the definition: dqydj, csun.io, ElHabr]:
```
AllPlayWins_w(t) = #{teams u ≠ t : score_u,w < score_t,w} + 0.5 * #{ties}
AllPlayPct(t)    = Σ_w AllPlayWins_w / ((N − 1) * weeks)
ExpectedWins(t)  = Σ_w AllPlayWins_w / (N − 1)                  // xW: wins vs a random opponent
LuckIndex(t)     = ActualWins(t) − ExpectedWins(t)              // sums to 0 across the league (H2H only)
```

- **Typical size [V]:** in a 14-game season, the 2.5th–97.5th percentiles of (actual W% − all-play W%) are about **±22%**, roughly **±3 wins** (dqydj). Analytically, SD(luck) = sqrt(Σ_w p_w(1 − p_w)) ≈ 1.6 wins over 14 weeks [R].
- **Display:** "Luck: +2.1 wins (2nd luckiest)" with a diverging bar.

**Further luck and context metrics [R]:**

| Metric | Formula | Notes |
|---|---|---|
| Projection-based expected wins | Σ pre-game WP (§4.6) | Separates "drew a good roster week" from schedule luck |
| Points-against luck | mean(opponent score) − league mean score | Opponent got hot vs you; in points per week |
| Median-game record | wins vs league median each week | Show even when the median game is not used for standings |
| Close-game record | record in games decided by < 5 pts, vs expected 50% (or Σ WP at kickoff) | "1–4 in coin flips" |
| Injury luck | Σ projected points of starters lost to in-game injuries (§5.5) | Reported per team |
| Ref/stat-correction swings | count of results flipped by stat corrections | Rare; recap footnote |
| Strength of schedule (remaining) | mean opponent projected μ for remaining weeks, vs league mean | Shown in the playoff-odds tab |

### 7.8 Composite "Manager Score" and recap layout [R]

**Weekly Manager Score, 0–100**, as league percentiles:
- 35% Lineup Efficiency
- 25% Decision Delta
- 20% waiver marginal points (rolling 4 weeks)
- 20% trade Δ (rolling season)

Luck is **excluded** and shown separately, so the score rewards decisions, not outcomes.

**Weekly recap sections** (League Home → "Week N Recap"):
1. Headline: game of the week (closest final, or the biggest WP comeback with its WP chart).
2. Scores table: each matchup's final, pre-game WP, the winner's win chance at its lowest ("won from 14%").
3. **Manager Report Card:**
   - Rows: teams.
   - Columns: Score, PF, Optimal, LE%, PLB, Start/Sit (hits–misses, close calls), Decision Δ, Waiver Δ, Luck (this week, as all-play wins out of N−1), Manager Score.
   - Sortable and colour-scaled. On mobile, collapse to team cards with three key chips (LE, PLB, Luck).
4. Awards (auto-generated):
   - "Best Manager" (top Manager Score)
   - "Bench Warmer" (most PLB)
   - "Unluckiest" (lost with the 2nd-highest score, or most all-play wins in a loss)
   - "Luckiest" (won with a bottom-3 score)
   - "Waiver Wire MVP"
   - "Biggest Decision"
   - "Best Trade Watch"
   - "Projection Buster" (biggest player over-projection)
5. Standings movement and playoff-odds Δ (§6.6).
6. Season-to-date luck table: W, xW, Luck, PF rank, all-play record.

### 7.9 Season awards [R]

- Most efficient manager (highest mean LE)
- Most points left on the bench
- Best start/sit record (minimum 50 decisions)
- Waiver king (MarginalPts)
- Best FAAB value (MarginalPts per $)
- Luckiest and unluckiest (LuckIndex)
- Best and worst trade (retro Δ)
- "Cap Wizard" (highest SV per $ committed)

---

## 8. Where these show up in the CBS-like information architecture [R]

The page layout is covered by sibling research. This maps methods to pages:

| Page (CBS-style IA) | Methods used |
|---|---|
| **League Home** | Recap card (§7.8), scoreboard with mini WP bars (§5.6), playoff-odds movers (§6.6) |
| **Live Scoring / Matchup** | Live WP bar and timeline (§5), player p10–p90 ranges (§4.3), "players left" |
| **Standings → Playoff Odds** | §6.6 columns, clinch codes (§6.7), what-if mode, projected draft slots |
| **Team → Roster / Cap Sheet** | MP, SV and contract sparkline per player (§3.5), age-curve tooltip (§3.3), injury flags (§3.7) |
| **Trades → Trade Evaluator** | §3.10 panels. CBS's features chart lists a "Trade Evaluator" (see `rules-catalog.md`); ours adds cap and team context |
| **Players → Player Card** | Value history (MP and SV), projected VORP by year, age multiplier, injury discount explanation |
| **Draft → Pick Values** | Pick table (§3.6), slot distribution per owned pick, rookie-scale surplus |

**[V]** A Footballguys forum thread confirms CBS shows a live-updating win percentage on each fantasy matchup (user report).

---

## 9. Open items and things to verify later

1. **KTC Value Adjustment constants.** The source article's formulas were images, and the host was blocked. Our power-sum (§3.9) is our own and is not meant to match KTC.
2. **FantasyCalc waiver-adjustment size and pick discount.** Their FAQ was read only via excerpts. Their API host was not attempted, because the network policy blocks most non-GitHub hosts.
3. **Rookie slot proxy.** Real rookie ADP history (DLF or Sleeper ADP archives) would replace the NFL-pick ordering in §3.6. Expect the top tier's hit rate to rise and the round-2 rates to fall when real ADP is used.
4. **Expert-projection error.** Recompute §4 with stored expert projections once CTE logs them (§4.7). Expect error SDs 5–15% lower than the naive numbers [M].
5. **Hazard and availability tables (§3.3)** are partly [R]. Fit a proper survival model (Kaplan–Meier by position and age) when time allows.
6. **Injury multipliers marked [M]** in §3.7 (Achilles, WR/QB ACL) need a dedicated study.

---

## 10. Sources

**Data and code (fetched directly)**
- DynastyProcess data repo: `files/values.csv`, `files/values-picks.csv`, `files/values-players.csv`, `.github/workflows/weekly-playervalues.yml` — https://github.com/dynastyprocess/data (raw: https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv)
- ffsimulator: README and "Custom Simulations" vignette (lineup efficiency 0.775 / 0.05; bootstrap by positional rank; circle-method schedules) — https://github.com/ffverse/ffsimulator , https://raw.githubusercontent.com/ffverse/ffsimulator/main/vignettes/custom.Rmd
- nflverse data releases: `stats_player`, `stats_team`, `pbp`, `players`, `draft_picks` — https://github.com/nflverse/nflverse-data/releases ; games and scores — https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv

**Trade-value systems (via search excerpts; hosts blocked for direct fetch)**
- KTC FAQ — https://keeptradecut.com/frequently-asked-questions
- KTC trade calculator — https://keeptradecut.com/trade-calculator
- KTC player values — https://keeptradecut.com/about/player-values
- KTC TE premium — https://keeptradecut.com/about/tight-end-premium
- Javelin, "How the KeepTradeCut Value Adjustment Works (in Detail)" — https://www.javelinfantasyfootball.com/2022/09/30/how-the-ktc-adjustment/
- FantasyCalc FAQ — https://fantasycalc.com/frequently-asked-questions
- OfficePoolStop, trade calculators overview (6M trades; DP constants) — https://www.officepoolstop.com/blog/the-importance-of-trade-calculators-in-dynasty-and-where-they-let-you-down
- "Are you overpaying for picks" (FantasyCalc vs KTC picks) — https://thirdc.substack.com/p/are-you-overpaying-for-picks
- DLF Dynasty Trade Analyzer FAQ — https://dynastyleaguefootball.com/dynasty-trade-analyzer-faqs
- DLF, "The Difference Between Dynasty ADP and Trade Value" — https://dynastyleaguefootball.com/2021/08/26/the-difference-between-dynasty-adp-and-trade-value/
- RotoWire dynasty trade calculator (contender and rebuilder modes) — https://www.rotowire.com/fantasy/football/dynasty-trade-calculator
- FantasyPros, best dynasty trade tools — https://www.fantasypros.com/2026/08/best-dynasty-fantasy-football-trade-tools/
- DraftSharks dynasty trade value chart — https://draftsharks.com/trade-value-chart/dynasty/ppr

**Rookie picks**
- NBC Sports, "Dynasty Rookie Pick Hit Rates" — https://www.nbcsports.com/fantasy/football/news/article-numbers-dynasty-rookie-pick-hit-rates
- The Dynasty Guru, "How Often Do Rookie Draft Picks Hit?" — https://thedynastyguru.com/2018/03/06/often-rookie-draft-picks-hit/
- DLF GAAP memo — https://dynastyleaguefootball.com/2024/01/04/dynasty-gaap-memo-first-round-rookie-pick-batting-average-and-hit-rates/
- PFF rookie draft history — https://www.pff.com/news/fantasy-dynasty-rookie-draft-history-lesson

**Aging and injuries**
- ESPN, players' peak and decline — https://global.espn.com/fantasy/football/story/_/id/37933720/2023-fantasy-football-players-peak-decline-quarterback-running-back-wide-receiver
- 4for4, production curves by age — https://4for4.com/2025/preseason/production-curves-positional-breakouts-prime-years-and-falloffs-age
- Fox Sports, production by age — https://www.foxsports.com/stories/other/fantasy-football-production-by-age
- 4for4, Breece Hall injury profile (RB ACL −20% / −1.4%) — https://www.4for4.com/2023/preseason/breece-hall-injury-profile-and-2023-fantasy-football-outlook
- FantasyLabs, RB ACL recovery — https://www.fantasylabs.com/?p=2806
- AOL / Yahoo, "Is injury prone really a thing" (Porras) — https://www.aol.com/fantasy-football-injury-prone-really-144807411.html

**Variance and win probability**
- 4for4, weekly consistency (CV by position) — https://www.4for4.com/2016/preseason/leveraging-weekly-player-consistency-daily-fantasy-football
- Footballguys, expectation and variance (gamma shape) — https://www.footballguys.com/article/DFS_expectationvariance
- Footballguys forum, "Win probability function" (CBS live WP; a^3.5 form) — https://forums.footballguys.com/threads/win-probability-function.807352
- Pro-Football-Reference win probability model (√time scaling) — https://www.pro-football-reference.com/about/win_prob.htm

**Luck and manager metrics**
- DQYDJ, fantasy scheduling luck — https://dqydj.com/fantasy-football-scheduling-luck/
- csun.io, expected wins — https://www.csun.io/2024/02/09/expected-wins-fantasy.html
- Tony ElHabr, measuring manager performance — https://tonyelhabr.rbind.io/posts/fantasy-football-performance/index.html

**Salary cap and auction**
- FantasyPros, salary-cap value method — https://support.fantasypros.com/hc/en-us/articles/360053100033-How-are-your-fantasy-football-salary-cap-values-calculated-Salary-Cap-Calculator
- The Fantasy Footballers, creating auction values — https://www.thefantasyfootballers.com/articles/fantasy-football-creating-your-own-player-values-for-auction-salary-cap-drafts/
- Capr (surplus value concept) — https://capr.app/
- Dynasty Fantasy League rulebook (cut penalties) — https://www.dynastyfantasyleague.com/rulebook/
- League Tycoon, contract rules — https://leaguetycoon.com/rules/contract-league-rules/
- CTE settings catalog (cap, contract, rookie-scale and tiebreaker defaults used above) — `docs/research/rules-catalog.md`
