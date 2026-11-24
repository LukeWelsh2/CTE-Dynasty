# CTE Dynasty design system v3

**White · blue · light grey · black.** A light, precise, tech-forward league site in the CBS-style colour family
(original CTE Dynasty branding — never copy CBS / ESPN logos, names or assets). The goal of v3 is **organisation of
information**: lots of stats, but each page is as easy to digest as a good sports app — summary first, the right
visual for each kind of data, words only when they are needed.

Everything is built from the kit (`@/components/ui/core` server-safe, `@/components/ui/client` client-only) and
the tokens in `tailwind.config.ts` (names) + `src/app/globals.css` (values per theme). **If a pattern below exists,
use it verbatim instead of hand-rolling classes.** Reference implementations: League Home (`src/app/(league)/page.tsx`,
`src/components/home/**`), Matchup (`src/components/scoring/matchup-view.tsx`), Standings
(`src/app/(league)/standings/page.tsx`, `src/components/standings/**`).

---

## 0. The rules on one screen

1. **One job per page, summary first.** Title → (summary strip of 2–4 numbers) → primary content → secondary
   content (truncated) → details behind a tap.
2. **Progressive disclosure, never removal.** Nothing the app shows may become unreachable: collapse it, move it
   behind a tap / ⓘ / "Show more" / a tab — and make the way back obvious.
3. **Words only when necessary.** Titles of 1–4 words, sentence case, bold. One grey subline at most. Explanations go
   behind an ⓘ (`InfoButton`, `Panel info`) or into a collapsed "About" row (`Collapsible`).
4. **Show, don't tell.** Same kind of data → same visual everywhere (§5 pattern catalogue).
5. **Lists before tables.** Phones show ≤ 4 columns; the rest behind a row tap, a column switcher or a sticky-column
   scroller.
6. **Hierarchy through type, weight and space** — not boxes, borders and colour.
7. **Colour has a job.** Near-black content, grey secondary, light-grey page, white cards, ONE blue for everything
   interactive or selected. Red = live / loss / injury / over cap. Green = win / positive. Amber = warning. Gold =
   trophies only. Team colours = small identity accents.
8. **Whitespace is a feature.** 8-pt rhythm, 16px card padding, 16–24px between blocks, ≤ 5–7 blocks above the fold.
9. **Phone first, both themes.** 360–430px is the primary product; dark mode follows the same system.

---

## 1. Brand & colour

### 1.1 Tokens (Tailwind name → CSS variable, light / dark)

| Token | Use | Light | Dark |
|---|---|---|---|
| `bg-surface` | page background | `#f4f5f7` light grey | `#0b0b0c` near-black |
| `bg-panel` | cards, lists, tables, bars | `#ffffff` | `#161719` charcoal |
| `bg-raised` | menus, popovers, sheets, dialogs | `#ffffff` | `#1f2023` |
| `bg-sunken` | fills **inside** cards: tracks, inputs' disabled state, hover, chips, expanded rows | `#f2f3f5` | `#1e1f22` |
| `bg-chrome` | top bar, desktop nav, score strip, tab bar | `#ffffff` | `#111214` |
| `border-line` | hairlines (`/70` inside cards) | `#e3e5e9` | `#2c2e33` |
| `text-ink` | content, numbers | `#101114` | `#f2f3f5` |
| `text-muted` | secondary text, micro-labels (≥ 5.4:1) | `#5c616b` | `#9ba1aa` |
| `text-faint` | icons, chevrons, "—" only (3:1, **never for words**) | `#8a9099` | `#6b7079` |
| `live` / `loss` | LIVE, losses, injuries, over cap, negative | `#d01f2b` | `#f2555a` |
| `win` | wins, positive deltas, clinched | `#167c3a` | `#2fbf63` |
| `--c-accent` | the blue as a CSS variable (`rgb(var(--c-accent))`) for inline styles / SVG | `#0b5cd5` | `#5b9bf7` |

**Blue scale `brand-*`** (the one interactive colour): `brand-600 #0b5cd5` is THE blue in light mode (links, primary
buttons, active tab underline, selected segment text, focus ring, chart highlight, "mine"); in dark mode use
`dark:text-brand-400` for blue text (`#5b9bf7`, 6:1 on charcoal). Primary buttons are `bg-brand-600` in both themes
(white text 6:1). Tints: `bg-brand-600/[0.06–0.08]` light, `dark:bg-brand-400/15`.

**Gold `gold-*`** survives only for championship / trophy moments (champion, title game, trophy icon). Gold text:
`text-gold-700 dark:text-gold-400`. The `gold` Button variant is retired and renders as primary blue.

**Semantic tints** for any hue: `bg-<hue>-500/10 dark:bg-<hue>-400/15` + `text-<hue>-700 dark:text-<hue>-300`.
`text-win` / `text-loss` / `text-live` are theme-aware and safe as small text.

**Team colours are data, not decoration**: logo tiles (`TeamLogo`), a dot, a thin bar segment (`WinProbBar`,
`CompareBar` fills). Never a large fill, never a card background. Anything drawn in a team colour keeps the
hairline (`.wp-seg`) so near-white / near-black colours stay visible.

**Never** raw `bg-white`, `bg-gray-*`, `text-gray-*`, `bg-black/…` (dark mode breaks; `bg-black/50` only as a scrim),
gradients, glows (`shadow-glow-*` are now flat 1px rings), glass (`backdrop-blur` is disabled), dark hero panels.

### 1.2 Contrast (WCAG AA, checked)
`text-ink`, `text-muted`, `text-win`, `text-loss`, `text-live`, `text-brand-600`, `dark:text-brand-400`,
`text-gold-700 / dark:text-gold-400` clear 4.5:1 on `surface`, `panel` and `sunken` in their theme. White on
`bg-brand-600`, `bg-live`, `bg-green-700` ≥ 4.5:1. Fails — don't use for text: `text-faint`, `text-gold-500/600`,
`text-amber-500/600`, `text-green-500/600`, `text-brand-500` on white.

### 1.3 "Mine" (my team / my row / my matchup)
A faint blue wash + 3px blue leading edge, and the team name in blue:
- table rows: `<tr className="row-mine">` · cards / tiles: `.mine`
- list rows: `ListRow mine` / `RankBar mine` / `MatchupRow mine` (built in)
- names: `text-brand-600 dark:text-brand-400` (`TeamIdentity mine`)

---

## 2. Type

**Inter only** (self-hosted variable font with optical sizes). `font-display` is now Inter too; legacy
`font-display … uppercase font-extrabold` headings are rendered sentence-case, bold, tight-tracked by a compatibility
rule in `globals.css` until each page migrates. Don't write new `font-display` / `uppercase` headings. Tabular numbers
are on globally; scores and money never wrap (`.numeral`).

| Role | Recipe | Kit |
|---|---|---|
| Page title | 26px → 30px, bold, `tracking-[-0.02em]` | `PageHeader title` |
| Home week title | 28 → 32px bold | `HomeHeader` |
| Section / card title | **17px bold**, sentence case, `tracking-[-0.01em]` | `Panel title`, `SectionHeader`, `ListGroup title` |
| Row title | 15px semibold (14px from `sm`) | `ListRow`, `RankBar`, `MatchupRow` |
| Body | 15px (14px from `sm`), `text-ink` | — |
| Subline / caption | 13px `text-muted` — ONE line, truncates | `subtitle` / `sub` props |
| Micro-label | **12px semibold uppercase `tracking-[0.04em]` `text-muted`** — stat captions, column heads, groups | `.eyebrow`, `Stat label` |
| Key number (summary) | 20 → 24px semibold tabular | `SummaryStrip` |
| Stat number | 17 / 22 / 28px semibold tabular | `Stat size="sm|md|lg"` |
| Score | 40 → 48/52px semibold tabular | `LiveNumber className="text-[40px] … sm:text-[48px]"`, `ScoreNumber size="xl"` |
| Row number | 15px semibold tabular | `ListRow value`, `RankBar` |
| Badge | 11px semibold uppercase | `Badge` |

Nothing meaningful under 12px (11px only inside badges / position tags / the ticker's status line). Line length ≤ 70ch
(`max-w-[70ch]` on any paragraph).

---

## 3. Space, shape, elevation

- **8-pt rhythm**: 8 / 16 / 24 / 32. Card padding **16px** (`Panel` body `px-4 pb-4 pt-3`, `p-4` untitled; rows
  `px-4`). Between cards `gap-4` (phones) / `gap-6` (lg). Inside cards `gap-3`/`gap-4`. Page gutter is the shell's
  `px-3 sm:px-4`.
- **Rows**: list rows ≥ 52px (`min-h-[52px]`), expandable rows 56px, summary rows (`Collapsible`) 48px. Primary
  buttons ≥ 40px on phones (`size="md"`), 44px in sheets / alerts (`size="lg"`).
- **Radius**: `rounded-card` 12 (cards) · `rounded-control` 8 (buttons, inputs) · `rounded-lg` 10 · `rounded-xl` 14
  (menus) · `rounded-2xl` 16 (dialogs, floating bars) · `rounded-sheet` 18 (sheet top) · `rounded-full` (chips, pills,
  avatars, icon buttons). Segmented controls are 10px tracks with 8px thumbs.
- **Elevation**: cards are white with a 1px hairline ring (`.card` = `rounded-card bg-panel shadow-card`); no drop
  shadows on cards. Menus / sheets / dialogs float (`shadow-raised`, `shadow-pop`). Sticky bars: `.bar-top`
  (hairline below) / `.bar-bottom` (hairline above).
- **Hierarchy without boxes**: inside a card separate sections with a hairline (`border-t border-line/70`) and a
  micro-label (`<h3 className="eyebrow px-4 pb-1 pt-3">Injuries</h3>`), not with nested cards or tinted panels.
- z-index: sticky page bars `z-20`, tab bar / floating action bars `z-40`, menus `z-50`, sheets `z-[100]`, drawer
  `z-[110]`, search `z-[120]`.
- Breakpoints: phone < 640 (`sm`), tab bar hidden from `md` (768), desktop rail from `lg` (1024), wide from `xl`.
- Shell facts: `--tabbar-h` (spacing `tabbar`) is the phone tab-bar height incl. safe area, `0px` from `md`; `<main>`
  reserves room for it; fixed bottom bars sit at `bottom-[calc(var(--tabbar-h)+0.5rem)]`; the top bar and score strip
  are not sticky, so page-level sticky bars use `top-0`. Toasts appear at the top on phones.

---

## 4. The presentation system

### 4.1 Page anatomy (top → bottom)

| Layer | What | Kit |
|---|---|---|
| 1. Title | micro-label kicker (season / week) + 1–4 word title + ≤ 1 grey line | `PageHeader` (`kicker`, `title`, `subtitle`) |
| 2. Section tabs (optional) | sibling pages | `TabLinks` (underline, blue indicator) |
| 3. Summary strip | the 2–4 numbers that answer the page's main question | `SummaryStrip items` (+ optional `header` row) |
| 4. Controls | view switch / filters for the primary content | `SegmentedLinks` / `SegmentedControl`, `Chip` row in `ScrollRow` |
| 5. Primary content | the one thing the page is for (list, matchup, lineup) | `ListGroup`/`ListRow`, `RankBar`, `MatchupRow`, `.tbl` (md+) |
| 6. Secondary content | related modules, each truncated to its top 3–5 rows | `Panel` + `ShowMore` / `MoreLink "All"` / `SeeAll` |
| 7. Details | breakdowns, explanations, rules, footnotes | row expanders, `Collapsible`, `InfoButton` sheet, a detail page |

Phone above-the-fold budget (390×844 minus chrome ≈ 650px): **≤ 5–7 distinct blocks**. Desktop: main column + right
rail (`lg:grid-cols-3`, main `lg:col-span-2`) or `xl:grid-cols-[minmax(0,1fr)_320px]`; on phones the rail interleaves
by importance (`display: contents` + `order-*`, see Home).

### 4.2 Disclosure rules

1. **Truncate secondary lists to 3–5 rows** with a "Show N more" row (`ShowMore`, client) or a header link to the full
   page (`MoreLink` "All", or `SeeAll` footer). Never cut a list without one of these.
2. **Row tap for detail**: a list row may expand in place (StandingsList pattern: `aria-expanded` button, the details
   in `bg-sunken` below as a `StatGrid`) or link to a detail page (`ListRow href`).
3. **Explanations → ⓘ**: "how this works", rules, data sources, legends, footnotes, timezone notes → `Panel info={…}`
   / `SectionHeader info={…}` / `<InfoButton title>…</InfoButton>` (opens a bottom sheet on phones, dialog on desktop).
4. **Reference material → collapsed rows**: tiebreakers, playoff format, bonus rules → a card of `Collapsible` rows
   ("About these standings"), each with a short `meta` on the right ("5 steps", "Wk 15–17").
5. **Bench-type content → behind a tap**, with its totals still visible in the summary (Matchup: bench rows collapsed,
   "Bench pts" / "Left on bench" CompareBars always visible).
6. **Duplicated navigation is removed, not hidden**: if the shell already shows it (the score strip shows every
   matchup), the page doesn't repeat it.
7. An affordance must be visible: chevron (`ChevronDown` rotating, `ChevronRight` for links), "Show N more", ⓘ, or a
   blue link. Hidden-on-hover controls don't exist on phones.

### 4.3 Writing rules

- Titles: 1–4 words, sentence case, no punctuation: "Week 12 matchup", "My players", "Rule votes", "About these
  standings". Not "MY MATCHUP", not "Latest Transactions In The League".
- Sublines: one line of context, ≤ ~40 characters: "Top 6 make the playoffs", "#general", "5 injured · 1 starting".
- **Labels over sentences**: "Proj 153.7" not "Projected to score 153.7 points"; "11 · 11" not "11 yet to play vs 11
  yet to play"; "Kickoff Thu 8:00 PM ET" not "Week 12 kicks off Thursday at 8:00 PM Eastern".
- Status as chips/dots, not prose: LIVE red dot, "Final", "Proj", W/L pills, injury tags.
- Empty states: a short title + at most one line ("No transactions yet."), the rest behind ⓘ or omitted.
- Numbers: scores 2 decimals (league setting), projections 1 decimal, money `fmtMoney` ("-$5"), odds `fmtProb` /
  `pctLabel` ("<1%", ">99%"), records `7-4` / `7-4-1`, ranks `ordinal` ("4th"), deltas "▲ 23" / `Delta`.
- Middle dot ` · ` separates facts in a subline; never two sublines.
- Kill repetition: don't restate the title in the subline, the week in every card, or a number already in the summary.

---

## 5. Pattern catalogue (data → component)

| Kind of data | Component | Example in the app |
|---|---|---|
| The page's key numbers | `SummaryStrip items={[{label, value, sub?, tone?, href?, title?}]} header?` | Home "My team" (Record · Rank · Cap · FAB); Standings (Rank · Record · Odds · Seed) |
| Label-above-number | `Stat label value sub? tone? size="sm\|md\|lg" align?` | Standings row expander |
| A breakdown (several numbers) | `StatGrid items cols={2\|3\|4} size?` | expanded standings row; recap awards |
| Key / value lines | `StatRow label value sub? tone? strong?` (stack them, `divide-y`) | cap breakdowns, settings summaries |
| Head-to-head comparison | `CompareBar label left right leftText? rightText? decimals? lowerIsBetter? leftColor? rightColor?` (+ `CompareHeader left right`) | Matchup: Yet to play, Playing, Done, Bench pts, Left on bench |
| Two-sided probability | `WinProbBar left leftColor rightColor size` (scoring: `WinProbRow`) | every matchup |
| One headline percentage | `Ring value size? stroke? color? label` | playoff odds / title odds on a detail page |
| Share of a whole | `Meter value max tone? size? caption? valueText?` | cap used vs cap, roster spots, FAB spent |
| Ranking | `RankList` + `RankBar rank leading title sub value max display? valueSub? mine? href?` | Home power rankings |
| A list of things | `ListGroup title right footer` + `ListRow leading title subtitle value valueSub trailing chevron mine href` | players, injuries, transactions |
| A matchup | `MatchupRow away home status homeWinProb href mine myTeamId decimals logo label note` | Home scoreboard |
| Change over time (in a row) | `Sparkline data width? height? area? baseline? className="text-brand-600"` | weekly scores beside a team |
| Change over time (detail) | `TrendChart data x series kind="line\|bar" height yFormat xFormat referenceY ariaLabel` (client) | odds history, weekly scores |
| Signed change | `Delta value decimals? suffix? invert?` | odds ▲, points vs projection |
| Result / streak | `ResultPill result="W\|L\|T\|W3"` | last-5 form |
| Live / final / upcoming | `GameStatus status`, `LiveDot` | headers, rows |
| Injury / position | `InjuryTag status`, `PosBadge pos` (neutral grey; IR red) | player rows |
| Scores | `ScoreNumber` (static) / `LiveNumber` (client, tweens + flashes) | matchup header |
| Section title outside a card | `SectionHeader title sub? info? action?` | groups of cards |
| Explanation | `InfoButton title>…` or `Panel info infoTitle` | Standings, Upcoming, Win probability |
| Collapsed reference | `Collapsible summary meta? defaultOpen?` | "About these standings" |
| Truncated list | `ShowMore initial={3} as="ul" moreLabel?` (client) / `SeeAll href` | Home modules |
| View switch (2–5 options) | `SegmentedLinks options active full?` (URL) / `SegmentedControl options value onChange full?` (client) | Standings Overall / Divisions / All-Play; Overview / Points / Form |
| Sibling pages | `TabLinks tabs active` | Standings · Power · Playoffs |
| Filters | `Chip` in `ScrollRow className="-mx-3 gap-2 px-3"` | player position filters |

### 5.1 Code recipes

```tsx
// Summary strip (page's main numbers)
<SummaryStrip items={[
  { label: "Rank", value: "4th", sub: "of 12" },
  { label: "Record", value: "7-4", sub: "PF 1480" },
  { label: "Odds", value: "85%", sub: <span className="text-win">▲ 23 wk</span>, title: "Playoff odds · up 23 points since last week" },
  { label: "Seed", value: "#4", sub: "in" },
]} />

// A card with a title, an ⓘ and a header link; list body bleeds to the edges
<Panel title="Standings" subtitle="Top 6 make the playoffs" info={<p>…how it works…</p>} noPad actions={<MoreLink href="/standings">All</MoreLink>}>
  <ul className="divide-y divide-line/70 border-t border-line/70">
    <ListRow href={`/teams/${t.id}`} leading={<TeamLogo team={t} size={28} />} title={t.name} subtitle="7-4 · PF 1480" value="85%" valueSub="odds" mine={mine} />
  </ul>
</Panel>

// Truncated secondary list
<ShowMore as="ul" initial={3} className="divide-y divide-line/70">{rows.map((r) => <ListRow key={r.id} … />)}</ShowMore>

// Head-to-head
<div className="divide-y divide-line/70">
  <CompareBar label="Yet to play" left={11} right={9} decimals={0} leftColor={myColor} rightColor={oppColor} />
  <CompareBar label="Left on bench" left={12.4} right={3.1} decimals={2} lowerIsBetter />
</div>

// Share of a whole
<Meter value={294} max={300} tone={over ? "bad" : "brand"} caption="Cap used" valueText="$294 / $300" />

// Ranking
<RankList>{teams.map((t, i) => <RankBar key={t.id} rank={i + 1} leading={<TeamLogo team={t} size={28} />} title={t.name} sub="7-4" value={t.score} max={top} mine={t.id === myId} href={`/teams/${t.id}`} />)}</RankList>

// Reference material behind taps
<Panel title="About these standings" noPad>
  <div className="divide-y divide-line/70 border-t border-line/70 px-4">
    <Collapsible summary="Tiebreakers" meta="5 steps">…</Collapsible>
  </div>
</Panel>

// Detail chart
<TrendChart ariaLabel="Weekly points" data={weeks} x="week" series={[{ key: "pts", label: "Points" }, { key: "avg", label: "League avg", dashed: true }]} xFormat={(w) => `W${w}`} />
```

### 5.2 Tables on phones

A table that is the page's main content becomes a list on phones (`md:hidden` list + `hidden md:block` table):
≤ 4 visible columns (rank · name + subline · 1–2 key numbers), plus **one** of: a row expander showing the other
columns as a `StatGrid` (Standings), a column switcher (`SegmentedControl` choosing which 2 numbers show), or a link to
a detail page. Secondary wide tables may scroll sideways: `card scroll-thin overflow-x-auto` wrapper, `.tbl`,
`.tbl-sticky` on the first column's `<th>` and every `<td>`, `row-mine` for my row (never a `bg-*` on sticky cells).

`.tbl` (desktop-dense): 12px uppercase grey header on white with a hairline, hairline rows, 12 → 16px outer inset,
`.num` right-aligned tabular cells, `.group-row` grey band, `.tbl-compact`.

---

## 6. Kit API index

### Server-safe — `@/components/ui/core`

| Component | Props |
|---|---|
| `Button` / `ButtonLink` / `buttonClass(variant, size, cls)` | `variant` primary · secondary · tinted · ghost · plain · danger · success · (gold = primary); `size` xs · sm · md (40→36) · lg (44) |
| `IconButton` | `label` (required), `variant` ghost · secondary · tinted, `size` sm · md, `href?` |
| `MoreLink` | `href`, children ("All", "Box score") |
| `Panel` | `title?`, `subtitle?`, `info?`, `infoTitle?`, `actions?`, `noPad?`, `className?`, `bodyClassName?`, `id?` |
| `PageHeader` | `title`, `kicker?`, `subtitle?`, `actions?` |
| `SectionHeader` | `title`, `sub?`, `info?`, `infoTitle?`, `action?`, `as?` h2 · h3, `id?` |
| `SectionLabel` | micro-label heading: children, `right?`, `as?` |
| `SummaryStrip` | `items: { label, value, sub?, tone?, href?, title? }[]` (2–4), `header?` |
| `Stat` | `label`, `value`, `sub?`, `tone?` good · bad · live · brand · muted, `size?` sm · md · lg, `align?` |
| `StatGrid` | `items: { label, value, sub?, tone?, key? }[]`, `cols?` 2 · 3 · 4, `size?` |
| `StatRow` | `label`, `value`, `sub?`, `tone?`, `strong?` |
| `CompareBar` / `CompareHeader` | see §5; `left`/`right` numbers, `leftText`/`rightText` display overrides |
| `Ring` | `value` 0–1, `size?` 64, `stroke?` 6, `color?`, `label?`, `children?` (centre) |
| `RankBar` / `RankList` | `rank?`, `leading?`, `title`, `sub?`, `value`, `max`, `display?`, `valueSub?`, `mine?`, `href?`, `titleText?` |
| `Sparkline` | `data`, `width?` 72, `height?` 24, `area?`, `baseline?`, `label?`, `strokeWidth?` |
| `Delta` | `value`, `decimals?` 1, `suffix?`, `invert?` |
| `ResultPill` | `result` ("W", "L", "T", "W3"), `title?` |
| `Collapsible` | `summary`, `meta?`, `defaultOpen?`, `bodyClassName?` |
| `MatchupRow` | `away`, `home` (`{ team, score, projected, record? }`), `status`, `homeWinProb?`, `href?`, `mine?`, `myTeamId?`, `decimals?`, `winnerTeamId?`, `label?`, `note?`, `logo?(team)` |
| `SeeAll` | `href`, children — 48px blue footer link of a card list |
| `InfoButton` | `title`, children (sheet content), `label?`, `size?` |
| `ListGroup` / `ListRow` | group: `title?`, `right?`, `footer?`; row: `href?`, `leading?`, `title`, `subtitle?`, `value?`, `valueSub?`, `valueTone?`, `trailing?`, `chevron?`, `mine?`, `titleText?`, `as?` |
| `Meter` | `value`, `max`, `tone?` brand · good · warn · bad · gold · neutral, `size?`, `label?`, `caption?`, `valueText?` |
| `WinProbBar` | `left` 0–1, `leftColor?`, `rightColor?`, `size?` xs · sm · md, `label?` |
| `ScoreNumber` | `value`, `decimals?`, `size?` sm · md · lg · xl, `dim?` |
| `Badge` | `tone` neutral · brand · gold · green · red · amber · purple · live |
| `GameStatus`, `LiveDot`, `InjuryTag`, `PosBadge` | status chips |
| `Chip` / `chipClass` | `href?`, `active?` (blue fill), `count?`, `icon?`, `size?`, `scroll?` |
| `SegmentedLinks` | `options: { key, label, href }[]`, `active`, `full?`, `ariaLabel?`, `scroll?` |
| `TabLinks` | `tabs`, `active`, `variant?` underline · segmented |
| `TeamLogo`, `TeamIdentity`, `PlayerHeadshot`, `PlayerLink`, `NflLogo`, `Avatar` | identity |
| `StickyActionBar`, `Skeleton`, `EmptyState`, `Alert`, `Field`, `Divider`, `SheetGrabber`, `menuItemClass`, `menuLabelClass` | unchanged APIs |

### Client — `@/components/ui/client`

| Component | Props |
|---|---|
| `ShowMore` | children (rows), `initial?` 5, `moreLabel?`, `lessLabel?`, `as?` div · ul · ol, `className?`, `buttonClassName?` |
| `TrendChart` | `data`, `x`, `series: { key, label, color?, dashed? }[]`, `kind?` line · bar, `height?` 180, `yFormat?`, `xFormat?`, `yDomain?`, `referenceY?`, `referenceLabel?`, `ariaLabel` |
| `SegmentedControl` | `options: { value, label, title?, disabled? }[]`, `value`, `onChange`, `full?`, `ariaLabel?` |
| `ClientTabs` | `tabs: { key, label, content }[]`, `initial?`, `variant?`, `full?` |
| `Modal` | `open`, `onClose`, `title?`, `footer?`, `size?` (bottom sheet on phones) |
| `Dropdown`, `Toggle`, `LiveNumber`, `SubmitButton`, `ActionButton`, `ThemeToggle`, `InfoButton` | unchanged APIs |

---

## 7. Do / don't (from this app)

| Don't (before) | Do (v3) |
|---|---|
| Home opened with a navy hero holding the league name, a commissioner paragraph, a team card, announcements and 7 pills | Title "Week 12" + one status chip, one row of to-do/shortcut chips, then the 4-number summary strip; notes moved to a compact "From the commissioner" card |
| "My Matchup" showed 0.00 – 0.00 before kickoff with the projection in small print | Before kickoff the big numbers ARE the projections (micro-label "Proj"); after kickoff the score, "Live proj" below |
| Players-left chips for both teams (12+ pills) always visible | `CompareBar` "Yet to play / Playing / Done"; the names behind "Players left" (`Collapsible`) |
| Standings snapshot with 5 table columns + three footnote paragraphs | Ranked rows: rank · logo · name + "7-4 W1 · PF 1480" · odds; footnotes in the ⓘ sheet |
| Scoreboard tiles in a 2-col grid with a win-prob bar each | `MatchupRow` list (team lines + status column), mine first, 3 shown + "Show all 6 matchups" |
| News rows with headline + 2-line summary + player links + time | Headline (2-line clamp) + "Player · 18h ago"; summary one tap away; 3 shown |
| Matchup page repeated the week's matchups in a second strip under the score strip | Removed — the score strip and "← Week 12" already do it |
| Matchup bench always expanded (14 rows) | Bench collapsed; its totals ("Bench pts", "Left on bench") in the summary |
| Standings: 15-column table scrolled sideways on phones; legend + tiebreak prose in the sidebar | Phone list (rank · team · 2 numbers) with Overview / Points / Form switcher and tap-to-expand stats; "About these standings" collapsed rows |
| All-caps condensed headings ("MY MATCHUP", "LATEST TRANSACTIONS") | Sentence case 17px bold ("Week 12 matchup", "Transactions") |
| Gold "mine" highlights, gold tab underlines, gold CTA buttons | Blue edge + blue name for mine; blue underline; primary blue button |
| Rainbow position badges | Neutral `PosBadge` (IR red) |

---

## 8. Reference screens

### 8.1 Home (`/`)
- **Main question:** "How is my week going, and what do I need to do?"
- **Summary:** `HomeHeader` (eyebrow "League · season · phase", title "Week 12", status chip: Kickoff / N live / Final),
  to-do chips with counts (trade offers, votes, claims, rule votes) + shortcuts; `LineupAlert` (only loud when a starter
  needs action); `MyTeamStrip` = SummaryStrip Record · Rank · Cap · FAB with the team as its header row.
- **Primary:** `MyMatchupCard` — two sides (logo, name, record · owner, big score or projection), win probability bar
  with both %, CompareBars (Yet to play / Playing / Done), "Players left" collapsible, "Next · Wk 13 vs …" footer.
- **Secondary (truncated):** Standings snapshot (top teams + mine, playoff line, odds; ⓘ legend), From the
  commissioner (message 3-line clamp + pinned announcements, 1 line each), Week scoreboard (`MatchupRow`, 3 + show
  all), Upcoming (next opponents; key dates 3 + more; timezone in ⓘ), My players (injuries 3 + more, news headlines 3 +
  more), League chat (last 3), Transactions (3 + more), Rule votes (support bar), Weekly recap (headline + awards grid;
  intro in ⓘ), Power rankings (`RankBar`).
- **Behind a tap:** players yet to play, news summaries, recap intro, standings legend/seeding rules, full lists.
- Phone order: header → lineup → my team → matchup → standings → notes → scoreboard → upcoming → my players → chat →
  transactions → rule votes → recap → power. Desktop: main column + rail.

### 8.2 Matchup (`/scoring/[id]`)
- **Main question:** "Am I winning, and who is still to play?"
- **Summary card:** eyebrow "Week 12 · round", status; the two sides (logo, name, record · rank · manager), big scores
  (projections before kickoff), "Live proj"; multi-week game line; `WinProbRow`; CompareBars Live proj · Yet to play ·
  Playing · Done · Bench pts · Left on bench (shown when meaningful for the status).
- **Sticky score bar:** abbrevs + scores (projections before kickoff) + LIVE dot / Final / Proj.
- **Primary:** Starters, slot-by-slot (left · slot · right): name, game status, points (big) over projection; tap the
  slot for the scoring breakdown. Reading guide in the ⓘ.
- **Secondary:** Bench (collapsed; totals in summary), Reserve (collapsed), Win probability chart (compact empty
  state; explanation in ⓘ), Big plays.
- Removed duplicate: the in-page week matchup strip (the score strip + "← Week 12" link cover it).

### 8.3 Standings (`/standings`)
- **Main question:** "Where do I stand, and will I make the playoffs?"
- **Summary:** SummaryStrip Rank · Record (PF / GB) · Odds (playoff odds + ▲ change) · Seed.
- **Controls:** `SegmentLinks` Overall · Divisions · All-Play (+ Season when there is history); All-play explanation
  in an ⓘ next to it.
- **Primary:** phones — `StandingsList` (rank · logo · team + "#seed · marker · manager" · 2 numbers chosen by
  Overview / Points / Form; bye and playoff lines; tap a row → every other column as a StatGrid + tie note + team
  link). md+ — the full `OverallTable` (sticky team column, `row-mine`, quiet cut lines, last-5 pills).
- **Secondary:** Playoff picture (byes, opening round, in the hunt; odds meaning in ⓘ); "About these standings"
  collapsed rows: Playoff odds (when / how), Legend, Tiebreakers, Playoff format, Bonus results.
- Shared with `/playoffs` + `/standings/power`: `StandingsTabs`, `SegmentLinks` (now the kit's segmented control),
  `ClinchBadge` (quiet green/grey letter chips), `LastFive` (W/L pills), `OddsCell`, `TeamCell`, `PlayoffPicture`.

---

## 9. Migrating an area page (checklist for the next pass)

Work top to bottom; check 360 / 390 / 430 (light + dark) and 1400.

1. Write down the page's main question, its 2–4 summary numbers, what is primary / secondary / behind a tap (like §8).
2. `PageHeader` with a short title; delete paragraphs under it (→ ⓘ).
3. Add a `SummaryStrip` if the page has a "how am I doing" question (Team: record · points · cap space · roster).
4. Replace hand-rolled cards with `Panel` (sentence-case title, `info`, `MoreLink "All"`), lists with
   `ListRow` / `RankBar` / `MatchupRow`, stat boxes with `Stat` / `StatGrid`, progress bars with `Meter`, two-sided
   numbers with `CompareBar`.
5. Truncate secondary lists (`ShowMore initial={3}` / `MoreLink`), collapse reference text (`Collapsible`).
6. Phone tables → list + expander / column switcher (§5.2).

| Find | Replace with |
|---|---|
| `font-display … uppercase … tracking-wide` heading | plain `text-[17px] font-bold` (card) / `PageHeader` (page) |
| `text-[11px] font-bold uppercase tracking-…` caption | `.eyebrow` (12px micro-label) |
| `rounded-lg border border-line bg-panel shadow-panel` | `.card` / `Panel` |
| `bg-brand-900` / navy headers, `hero-surface`, dark gradients | white card + 17px bold title |
| gold underline / gold "mine" / `variant="gold"` | blue (`after:bg-brand-600`), `row-mine` / `.mine`, `variant="primary"` |
| `text-brand-700 dark:text-brand-300` on names (not links) | `text-ink`; links `text-brand-600 dark:text-brand-400` |
| stat boxes `rounded border p-2 text-center` | `Stat` / `StatGrid` / `SummaryStrip` |
| a paragraph explaining a module | `Panel info={…}` |
| footnotes under a table | ⓘ or a `Collapsible` "About" row |
| > 5 rows of a secondary list | `ShowMore initial={3..5}` |
| wide table as main content on phones | list + expander (`StandingsList` pattern) |
| `text-green-600` / `text-red-600` numbers | `text-win` / `text-loss` / `Delta` |
| `bg-white`, `bg-gray-*`, `text-gray-*` | `bg-panel` / `bg-sunken`, `text-ink` / `text-muted` |
| text under 12px outside badges | 12px+ |

Done means: no horizontal scroll at 360, every number tabular, nothing important under 12px, primary actions ≥ 40px,
dark mode checked, nothing hidden behind the tab bar, and every piece of information still reachable.

---

## 10. Traps

- **`tailwind.config.ts` stays CommonJS** (`module.exports`). An `export default` config is cached by Node 22's
  `require(esm)` and a running dev server silently keeps the old tokens.
- Tailwind's `order-*` utilities stop at `order-12`; use `order-[13]` beyond (Home interleaves 13 modules).
- In a flex row (`TabLinks`, chips) a label like `Power<span> Rankings</span>` loses its space: wrap the whole label in
  one `<span>`.
- `line-clamp-*` needs `display: -webkit-box`; adding `block` after it cancels the clamp.
- `ShowMore` is a client component; its children are rendered server-side and passed in — fine, but keep keys on rows.
- `InfoButton` is self-contained (no imports from `./core` / `./client`) so server components can render it without a
  cycle; keep it that way.
- Don't name a component class after a Tailwind utility (`.eyebrow`, not `.overline`).
- `overflow-x-auto` wrappers are `position: relative` globally (zero specificity) so `sr-only` labels can't widen the
  page on phones.
- `.tbl thead .tbl-sticky` sets `z-index: 2`; in a table that also has sticky headers use `!z-20` on that `<th>`.
- Row tints (hover, `.row-mine`) are background *images* so sticky cells stay opaque — never put a `bg-*/NN` on a
  sticky cell.
- Team colours need the `.wp-seg` hairline; use `contrastPair(a, b)` (`@/components/home/bits`) when two team colours
  meet.
- Two sides of a matchup share a score baseline: stretch the sides (`items-stretch`) and pin the score with `mt-auto`.
