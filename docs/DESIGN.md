# CTE Dynasty — Design language ("tech-forward refresh")

An **evolution** of the CBS-style league site, not a redesign: same information architecture, page layouts,
navigation and navy + championship-gold brand, same data density. What changes is the finish — solid layered
surfaces, crisp type, big tabular numerals and calm motion, in the spirit of Apple Sports / Stocks and the
newest fantasy apps (never copy their assets, names or logos).

Every page is built from the UI kit (`@/components/ui/core` server-safe, `@/components/ui/client` client-only)
plus the classes in `src/app/globals.css`. **If a recipe below exists, use it verbatim instead of hand-rolling
classes.** Tokens live in `tailwind.config.ts` (names) and `globals.css` (values per theme).

## 1. Principles

1. **Calm surfaces, loud numbers.** Neutral, layered surfaces; scores, win %, cap space and records are the
   heroes — big semibold tabular figures (`ScoreNumber`, `.numeral`).
2. **Solid, never glass.** Every surface is opaque. Depth comes from soft multi-layer shadows and hairlines,
   not borders, blur or translucency. `backdrop-blur-*` is switched off in the Tailwind config; don't use
   `bg-panel/95`-style see-through bars either.
3. **One job per color.** Navy = action & navigation, gold = "mine" / championship / one urgent call to action,
   red = live, green / red = win / loss. Everything else is neutral.
4. **Phone first.** 44px primary targets, thumb-reachable bars above the tab bar, safe areas, single column under
   `sm`, nothing hidden behind the tab bar, no sideways page scroll at 360px.
5. **Motion with meaning.** Live things pulse, scores tween and flash, sheets slide; 150–300ms ease-out; all of it
   disappears under `prefers-reduced-motion`.

## 2. Tokens

### 2.1 Color (Tailwind name → CSS variable, light / dark)

| Token | Use | Light | Dark |
|---|---|---|---|
| `bg-surface` | page background (level 0) | `#f2f4f8` cool grey | `#05070c` near-black |
| `bg-panel` | cards, tables, bars (level 1) | `#ffffff` | `#11151e` |
| `bg-raised` | menus, popovers, sheets, modals, floating bars (levels 2–3) | `#ffffff` | `#1a1f2b` (higher = lighter, like iOS) |
| `bg-sunken` | **fills inside cards**: table header, input fill, hover, chips, segmented track | `#f4f6fa` | `#1b212d` |
| `bg-chrome` | navy top bar + desktop nav | `#091633` | `#080d1b` |
| `border-line` | hairlines & separators (`/70` inside cards) | `#e2e7ef` | `#282f3e` |
| `text-ink` | primary text | `#0b1220` | `#edf1f7` |
| `text-muted` | secondary text (≥ 4.5:1 on panel) | `#5b687e` | `#919cb0` |
| `text-faint` | tertiary, non-essential: chevrons, disabled, "—" (≥ 3:1, **not** for words people must read) | `#7a8599` | `#6b7689` |
| `live` | live red: dots, LIVE pills, "playing" counts | `#d61f45` | `#f43f5e` (white-text fills use `#e11d48`, see below) |
| `win` / `loss` | results, positive / negative numbers | `#15803d` / `#d42020` | `#22c55e` / `#f05252` |
| `brand-50…950` | navy scale (hex unchanged). Actions `brand-600/700`; links `text-brand-600 dark:text-brand-300`; tints `bg-brand-500/10 dark:bg-brand-400/15` | | |
| `gold-50…900` | championship gold. Fills `gold-400/500`; **gold text: `text-gold-700 dark:text-gold-400`** (`gold-700` = `#8f6700`; 500/600 fail contrast on white) | | |

`live`, `win`, `loss` are theme-aware and take opacity (`bg-live/10`, `text-win`). Tints for any hue:
`bg-<hue>-500/10 dark:bg-<hue>-400/15` + `text-<hue>-700 dark:text-<hue>-300`.

**Contrast (WCAG AA, checked):** `text-ink`, `text-muted`, `text-win`, `text-loss`, `text-live`, `text-gold-700` /
`dark:text-gold-400` and `text-brand-600` / `dark:text-brand-300` all clear 4.5:1 on `surface`, `panel` and `sunken`
in their theme, so they are safe for 11–13px text. White text on `bg-live` is always ≥ 4.5:1 (dark mode swaps the
fill to the deeper red automatically for `bg-live text-white`). **Fails — don't use for text:** `text-faint` (icons /
"—" only), `text-gold-500/600`, `text-amber-500/600`, `text-green-500/600`, `text-emerald-500`, `text-sky-500` on light
surfaces — use the `-700` shade with a `dark:` `-300/400` partner. Placeholders are `text-muted` (inside `.input`).
Never use raw `bg-white`, `bg-gray-*`, `text-gray-*`, `bg-black/…` for surfaces or text (dark mode breaks);
`bg-black/50` is only for the modal scrim.

**"Mine"** (my team, my matchup, my row): `.row-mine` on table rows; on cards/tiles `.mine` (gold wash + 3px gold
inset accent on the leading edge); on names `text-brand-700 dark:text-brand-300` (`TeamIdentity mine`).

### 2.2 Surfaces & elevation (all opaque)

| Level | Recipe | Used for |
|---|---|---|
| 0 page | `bg-surface` (already on `<body>`) | page |
| 1 card | `.card` = `rounded-card bg-panel shadow-card` (shadow carries the hairline ring — no `border`) | panels, tiles, list groups |
| 1 hero | `.hero-surface` (navy gradient + gold glow, white text, `rounded-2xl`) | home hero, matchup hero, auth |
| 2 raised | `.raised` = `rounded-xl bg-raised shadow-raised` | menus, popovers, the floating action bar |
| 3 overlay | `bg-raised shadow-pop` + `rounded-t-sheet` (phone sheet) / `rounded-2xl` (dialog) over `.scrim` | `Modal`, search, drawer |
| chrome | `bg-chrome text-white` (top bar, desktop nav) · `.bar-top` (sticky header bars) · `.bar-bottom` (tab bar, bottom bars) | sticky / fixed chrome |

`.bar-top` = solid `bg-panel` + hairline on the bottom edge + soft shadow below (put `sticky top-0 z-20` on it).
`.bar-bottom` = solid `bg-panel` + hairline on the top edge + soft shadow above.
Legacy `rounded-lg border border-line bg-panel shadow-panel` still renders fine; new code uses `.card`.

### 2.3 Radius

`rounded-sm` 4 · `rounded` 6 (tags) · `rounded-md` 8 (small controls) · `rounded-control` 10 (buttons, inputs) ·
`rounded-lg` 12 (tiles, list items, alerts) · `rounded-card` 16 (cards / panels) · `rounded-xl` 16 (menus) ·
`rounded-2xl` 20 (hero, floating bars, dialogs) · `rounded-sheet` 22 (sheet top corners) · `rounded-full`
(chips, segmented controls, pills, avatars, icon buttons). Team logos are squircles (`TeamLogo`).

### 2.4 Shadow

| Class | Recipe | Use |
|---|---|---|
| `shadow-card` | hairline ring + 2 soft layers | cards (`.card`) |
| `shadow-raised` | ring + medium float | menus, popovers, segmented thumb, floating bar |
| `shadow-pop` | ring + deep float | sheets, dialogs, search |
| `shadow-btn` | inner top highlight + 1px drop | filled buttons |
| `shadow-bar-top` / `shadow-bar-bottom` | hairline + soft shadow away from the edge | sticky top / bottom bars |
| `shadow-glow-live` / `shadow-glow-gold` | colored halo | LIVE pill, gold CTA |
| `shadow-panel` | legacy soft shadow (no ring) | old `border` cards |

Dark mode swaps drop shadows for a white hairline + top highlight automatically (CSS variables).

### 2.5 Spacing rhythm (4px grid)

Page gutter `px-3 sm:px-4` (AppShell). Card padding `p-3 sm:p-4` (`Panel`'s body does this); card header
`px-3 py-2.5 sm:px-4`; `.tbl`'s outer cells inset 12px → 16px from `sm`, so a `noPad` table lines up with its header.
Content that bleeds to a padded Panel's edges uses `-mx-3 sm:-mx-4` (or `noPad`).
Between cards `gap-4` / `space-y-4`; inside cards `gap-3`; inside rows `gap-2`–`gap-3`.
Dense desktop table rows 32–36px; phone list rows ≥ 52px (`ListRow`); primary buttons 40–44px on phones.

### 2.6 Type

Fonts are self-hosted (`public/fonts`, SIL OFL): **Inter Variable** with optical sizing (UI text and numerals —
large sizes get the Display cut automatically) and **Barlow Condensed** 600/700/800 (sporty display, used only for
titles and scoreboard labels). Fallbacks are Apple-first (`-apple-system`, `SF Pro Text`).

| Role | Recipe |
|---|---|
| Hero title | `font-display text-[34px] sm:text-[44px] font-extrabold uppercase leading-[0.95] tracking-[0.01em]` |
| Page title | `PageHeader` (Barlow 800, 30 → 36px, uppercase) |
| Section / card title | `Panel title` (Barlow 700, 17px, uppercase, tracking .04em) |
| Kicker / eyebrow | `.eyebrow` (Inter 11px / 700 / uppercase / tracking .12em, muted); gold kicker `.eyebrow text-gold-700 dark:text-gold-400` |
| Row title | `text-[15px] font-semibold` on phones, `sm:text-sm` dense desktop |
| Body | `text-sm text-ink`; secondary `text-muted` |
| Caption / meta | `text-xs text-muted` (12px). **Nothing meaningful under 11px**; 10px only inside badges / position tags |
| Numerals | `ScoreNumber` / `.numeral` — sizes `sm` 15 · `md` 22 · `lg` 32→40 · `xl` 44→56 |
| Sheet / menu / dialog title | Inter `text-[17px] font-semibold` (sentence case) — `Modal` does this |
| Form label | `.label` (13px, medium, muted, sentence case) |

Tabular numbers are on globally; headings use `text-wrap: balance`; scores and money never wrap (`.numeral` /
`whitespace-nowrap`).

### 2.7 Motion

| Token | Use |
|---|---|
| `duration-150 ease-out` | press, hover, color |
| `duration-200 ease-out-expo` | toggles, segmented thumb, menus |
| `duration-300 ease-out-expo` | sheets, drawer |
| `duration-700 ease-out-expo` | win-prob bar width, number tween |
| `ease-out-expo` = `cubic-bezier(.22,1,.36,1)` · `ease-spring` = `cubic-bezier(.34,1.56,.64,1)` | |

Animations: `animate-flash` (score change wash), `animate-score-pop`, `animate-rise` (bars appearing),
`animate-fade-in`, `animate-sheet`, `animate-drawer`, `animate-menu`, `.skeleton` shimmer, `.live-dot` ping.
All are neutralised by the global `prefers-reduced-motion` rule; add new motion with `motion-safe:` only.

## 3. Materials (no glass)

The user asked for **no glass**: no `backdrop-blur`, no frosted or translucent bars, sheets or menus. The
`backdropBlur` utilities are disabled in `tailwind.config.ts` so a stray class does nothing.

| Need | Recipe |
|---|---|
| Sticky header bar inside a page (score bar, section nav) | `sticky top-0 z-20 bar-top -mx-3 px-3 sm:mx-0 sm:rounded-lg` |
| Fixed / sticky bottom bar | `StickyActionBar` (floating `.raised` card above the tab bar) — or `.bar-bottom` for a full-width bar |
| Menu / popover | `.raised` (+ `animate-menu`) — `Dropdown` already does it |
| Sheet / dialog | `Modal` (`bg-raised shadow-pop`, `.scrim` behind) |
| Hero | `.hero-surface` (the only gradient surface besides primary buttons and win-prob bars) |

## 4. Component cookbook

Imports: `import { … } from "@/components/ui/core"` (server-safe) and `"@/components/ui/client"` (client).

### Page header
```tsx
<PageHeader kicker="2026 season · Week 12" title="Standings" subtitle="Top 6 make the playoffs"
  actions={<ButtonLink href="/playoffs" variant="secondary" size="sm">Bracket</ButtonLink>} />
```
Section nav under it: `<TabLinks tabs={[{ key, label, href }]} active="power" />` (underline, gold indicator,
scrolls with snap on phones). 2–5 view/filter options: `<SegmentedLinks options={[{ key, label, href }]} active=… />`
(URL state) or client `<SegmentedControl options={[{ value, label }]} value onChange />`; `full` stretches it.

### Section panel (card with a title)
```tsx
<Panel title="Standings" subtitle="Top 6 make the playoffs" actions={<MoreLink href="/standings">Full standings</MoreLink>}>…</Panel>
<Panel title="Roster" noPad><div className="overflow-x-auto scroll-thin"><table className="tbl">…</table></div></Panel>
```
Card without a title: `<div className="card p-3 sm:p-4">`. Group heading inside a card or above a list:
`<SectionLabel right={…}>Key dates</SectionLabel>`. Hairline divider: `<Divider />`.

### Data table (desktop-dense)
```tsx
<div className="overflow-x-auto scroll-thin"><table className="tbl">
  <thead><tr><th className="tbl-sticky">Player</th><th className="num">Pts</th></tr></thead>
  <tbody><tr className={cn(mine && "row-mine")}><td className="tbl-sticky">…</td><td className="num">12.4</td></tr></tbody>
</table></div>
```
`.tbl`: 11px uppercase header on `bg-sunken`, hairline rows, 12px (phones) / 16px (sm+) outer inset, hover tint,
`.num` right-aligned tabular cells, `.group-row` navy band, `.tbl-compact`. `.tbl-sticky` = opaque sticky first
column with a hairline (only inside an `overflow-x-auto` wrapper; give the `<th>` and every `<td>` of that column the
class). Row tints (hover, `.row-mine`) are painted as background *images*, so the sticky column stays opaque — never
put a `bg-*/NN` utility on a sticky cell.

### Card list on phones (when the table is the page's main content)
```tsx
<div className="md:hidden"><ListGroup title="Starters">
  <ListRow href={`/players/${p.id}`} leading={<PlayerHeadshot player={p} size={36} />}
    title={p.fullName} subtitle={`${p.position} · ${p.team}`} trailing={<ScoreNumber value={pts} size="sm" />} chevron />
</ListGroup></div>
<div className="hidden md:block">{/* the .tbl */}</div>
```
Rows are ≥ 52px; titles truncate (string titles get a `title` attribute; pass `titleText` otherwise); keep the
key number in `trailing` so nothing scrolls sideways.

### Stat tile & meter
```tsx
<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
  <StatTile label="Cap space" value={fmtMoney(room)} sub="of $300" tone={room < 0 ? "bad" : undefined} />
</div>
<Meter value={used} max={cap} tone={used > cap ? "bad" : "brand"} label="Cap used" />
```
`StatTile` values are large tabular numerals; pass words as `value={<span className="text-xl">Open</span>}`.
`Meter` is the thin rounded progress bar for cap / FAB / roster usage (`size="sm" | "md"`).

### Buttons & actions
| Intent | Recipe |
|---|---|
| Primary (Save, Propose, Claim, Accept, Set lineup) | `<Button>` / `<SubmitButton>` / `<ButtonLink>` — navy gradient + `shadow-btn`. Phones `size="md"` (40px) or `lg` (44px); `w-full sm:w-auto` in sheets / forms |
| Secondary | `variant="secondary"` (solid panel button with hairline) |
| Tinted (prominent secondary: "Add to watch list", "Counter") | `variant="tinted"` |
| Ghost / toolbar | `variant="ghost"`; text-only link button `variant="plain"` |
| Destructive | `variant="danger"`; confirmations via `ActionButton confirm="…"` |
| Gold (max one per screen: "Fix lineup", "Draft now") | `variant="gold"` |
| Icon-only | `<IconButton label="Close"><X size={18} /></IconButton>` (labelled, 40px, round) |
| "View all" in headers | `<MoreLink href="…">Full standings</MoreLink>` |

All buttons have a press state (`active:scale-[0.97]`) and a focus ring. Never two primary buttons side by side.

### Sticky action bar (Save / Bid / Propose) above the tab bar
```tsx
{dirty && (
  <StickyActionBar label="Lineup changes">
    <span className="mr-auto text-sm font-semibold">3 unsaved changes</span>
    <Button variant="ghost" onClick={reset}>Reset</Button>
    <Button onClick={save}>Save lineup</Button>
  </StickyActionBar>
)}
```
Phones: fixed, solid `.raised` card, `rounded-2xl`, floating 8px above the tab bar
(`bottom: calc(var(--tabbar-h) + .5rem)`), safe-area aware; it renders its own spacer so the end of the page is
never hidden. md+: sticky to the bottom of its container (`desktop="static"` keeps it in flow, `"hidden"` hides it).
Hand-rolled bottom bars: `fixed inset-x-0 bottom-[calc(var(--tabbar-h)+0.5rem)] md:bottom-4` — never
`bottom-14` / `bottom-[60px]` (ignores the home indicator).

### Sheet / modal
```tsx
<Modal open={open} onClose={close} title="Claim player"
  footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button>Claim</Button></>}>…</Modal>
```
Phones: bottom sheet with a grabber, `rounded-t-sheet`, body scrolls inside, footer pinned above the home
indicator, buttons ≥ 44px. ≥ sm: centered `rounded-2xl` dialog. Primary action last (right-most) in `footer`.
Custom sheets: put `<SheetGrabber />` at the top and copy Modal's container classes.

### Menus
`<Dropdown trigger={…} align="right">` with rows `className={menuItemClass}` (`<Link className={menuItemClass}>`,
`<button className={menuItemClass}>`). Optional header: `<div className={menuLabelClass}>Signed in as …</div>`.
Menus are `.raised`, rows inset-rounded, 40px tall on phones, and stay on screen.

### Chips & filters
```tsx
<ScrollRow className="-mx-3 gap-2 px-3">  {/* horizontal on phones, snaps, fades the edge */}
  <Chip href="?pos=ALL" active={pos === "ALL"} scroll={false}>All</Chip>
  <Chip href="?pos=QB" active={pos === "QB"} count={12} scroll={false}>QB</Chip>
</ScrollRow>
```
Client chips: `<button className={chipClass(active)} aria-pressed={active}>`. Static tags: `.chip`.

### Switches & inputs
`<Toggle name="x" label="Email me" />` (iOS switch, brand-colored when on). Fields:
`<Field label="Team name" hint="…"><input className="input" /></Field>`. `.input` is a filled field
(`bg-sunken`, hairline) that turns white with a 4px brand focus ring; works for `<select>` (chevron added) and
`<textarea>`. Phones force 16px text in fields (no iOS zoom).

### Tabs inside a client component
`<ClientTabs tabs={[{ key, label, content }]} variant="segmented" />` (or the default underline).

### Empty state · skeleton · alerts
`<EmptyState icon={<Inbox size={22} />} title="No pending claims">Place a claim from…</EmptyState>`.
Loading: `<Skeleton className="h-4 w-32" />` (shimmer; `circle` for avatars) — never flat grey blocks.
`<Alert tone="warn" icon>` (tones `info | warn | error | success`; `icon` adds the tone icon).

### Live indicator & game status
`<LiveDot />` (pulsing red dot; `className="bg-white"` on red fills). `<GameStatus status={m.status} />` renders
the LIVE (pulsing pill) / Final / Upcoming badge consistently.

### Score numerals
```tsx
<ScoreNumber value={side.score} decimals={2} size="xl" dim={!leading} />            {/* static */}
<LiveNumber value={side.score} decimals={2} className="numeral text-[44px] font-semibold" />  {/* tweens + flashes (client) */}
```

### Win-probability bar
`<WinProbBar left={myWinProb} leftColor={myColor} rightColor={oppColor} size="md" label="…" />` — two rounded
segments with a gap; the favourite's segment glows in its color (`.wp-seg` / `.wp-lead` in globals.css: a tight 6px
halo in light mode, a brighter bloom in dark; pass `glow={false}` in dense lists). `size="xs"` for scoreboard tiles. Pair it with
the two percentages in `.numeral text-xs font-semibold` at either end.

### Team / player identity rows
```tsx
<TeamIdentity team={team} size={28} sub={`${record} · ${owner}`} href={`/teams/${team.id}`} mine={team.id === myTeamId} />
<PlayerLink player={p} showHeadshot size={32} />
```
Names truncate with a `title` attribute; logos are squircles; headshots are circles with a hairline ring.

### Badges
`<Badge tone="green|red|amber|brand|gold|purple|neutral|live">` — tinted pills, 11px uppercase.
`<PosBadge pos="WR" />`, `<InjuryTag status="Questionable" />` (unchanged API).

### Horizontal rows (tabs, pills, ticker)
`ScrollRow` (`@/components/ui/scroll-row`): snaps, fades the edge with more content, scrolls the active child
(`aria-current` / `aria-selected` / `data-active`) into view.

## 5. Shell facts other pages rely on

- `--tabbar-h` = tab bar height incl. safe area on phones, `0px` from `md`. Tailwind spacing `tabbar`
  (`bottom-tabbar`, `pb-tabbar`) maps to it.
- The top bar and score ticker are **not** sticky; page-level sticky bars use `top-0`.
- `<main>` reserves room for the tab bar; fixed bottom bars sit at `bottom-[calc(var(--tabbar-h)+0.5rem)]`.
- Toasts appear at the top on phones (clear of bottom bars).
- z-index: page sticky bars `z-20`, floating action bars / tab bar `z-40`, menus `z-50`, sheets `z-[100]`,
  drawer `z-[110]`, search `z-[120]`.
- Breakpoints: phone < 640 (`sm`), tablet 640–767, tab bar hidden from `md` (768), desktop rail from `lg`.

## 6. Kit API index (props)

Server-safe (`@/components/ui/core`):

| Component | Props |
|---|---|
| `Button` / `ButtonLink` / `buttonClass(variant, size, cls)` | `variant` primary · secondary · tinted · ghost · plain · danger · success · gold; `size` xs · sm (36→32) · md (40→36) · lg (44) |
| `IconButton` | `label` (required), `variant` ghost · secondary · tinted · onDark, `size` sm · md, `href?` |
| `MoreLink` | `href`, children |
| `Panel` | `title?`, `subtitle?`, `actions?`, `noPad?`, `className?`, `bodyClassName?`, `id?` |
| `PageHeader` | `title`, `kicker?`, `subtitle?`, `actions?` |
| `SectionLabel` | children, `right?`, `as?` |
| `Badge` | `tone` neutral · brand · gold · green · red · amber · purple · live, `title?` |
| `GameStatus` | `status` LIVE · FINAL · other, `label?` |
| `LiveDot` | `className?` (size `h-1.5 w-1.5`, `bg-white` on red) |
| `Chip` / `chipClass(active, size, cls)` | `href?`, `active?`, `count?`, `icon?`, `size` sm · md, `scroll?`, `title?` |
| `SegmentedLinks` | `options: { key, label, href, title? }[]`, `active`, `full?`, `ariaLabel?`, `scroll?` |
| `TabLinks` | `tabs: { key, label, href }[]`, `active`, `variant` underline · segmented |
| `ScoreNumber` | `value`, `decimals` (2), `size` sm · md · lg · xl, `dim?`, `placeholder` ("—") |
| `WinProbBar` | `left` (0–1), `leftColor?`, `rightColor?`, `size` xs · sm · md, `glow` (true), `label?` |
| `Meter` | `value`, `max`, `tone` brand · good · warn · bad · gold, `size` sm · md, `label?` |
| `StatTile` | `label`, `value`, `sub?`, `tone?` good · bad |
| `ListGroup` / `ListRow` | group: `title?`, `right?`, `footer?`; row: `href?`, `leading?`, `title`, `subtitle?`, `trailing?`, `chevron?`, `titleText?` |
| `TeamIdentity` | `team`, `size` (28), `sub?`, `href?`, `mine?`, `reverse?` |
| `StickyActionBar` | children, `label?`, `desktop` sticky · static · hidden, `innerClassName?` |
| `Skeleton` | `className`, `circle?` |
| `SheetGrabber` | — (absolute; parent `relative`) |
| `menuItemClass` / `menuLabelClass` | class strings for `Dropdown` rows / caption |
| `EmptyState`, `Alert`, `Field`, `Avatar`, `TeamLogo`, `NflLogo`, `PlayerHeadshot`, `PlayerLink`, `PosBadge`, `InjuryTag`, `Divider` | unchanged APIs |

Client (`@/components/ui/client`):

| Component | Props |
|---|---|
| `Modal` | `open`, `onClose`, `title?`, `footer?`, `size` sm · md · lg · xl |
| `Dropdown` | `trigger`, `align` left · right, `className?` (rows: `menuItemClass`) |
| `ClientTabs` | `tabs: { key, label, content }[]`, `initial?`, `variant` underline · segmented, `full?` |
| `SegmentedControl` | `options: { value, label, title?, disabled? }[]`, `value`, `onChange`, `full?`, `ariaLabel?` |
| `Toggle` | `name?`, `defaultChecked?` / `checked?`, `onChange?`, `label?` |
| `LiveNumber` | `value`, `decimals` (2), `format?`, `flash` (true), `className?` |
| `SubmitButton`, `ActionButton`, `ThemeToggle` | unchanged APIs |

## 7. Traps (learned the hard way)

- **`tailwind.config.ts` stays CommonJS** (`module.exports`). An `export default` config is cached by Node 22's
  `require(esm)` and the running dev server silently keeps the old tokens (new classes don't exist, `@apply` of them
  500s the whole site).
- Don't name a component class after a Tailwind utility (the kicker class was renamed `.eyebrow` because Tailwind's
  `overline` text-decoration utility drew a line over every kicker).
- `overflow-x-auto` wrappers are made `position: relative` globally (zero specificity) so `sr-only` labels inside wide
  tables can't widen the page on phones. If you need an absolutely positioned child to escape a scroller, give the
  scroller `static`.
- `backdrop-blur-*` does nothing (disabled); translucent `bg-*/95` bars are off-brand — use `.bar-top` / `.bar-bottom`.
  As a safety net `bg-panel/80|90|95`, `bg-raised/90|95` and `bg-surface/80|90|95` render **opaque** (globals.css), so
  don't reach for them expecting see-through; for a tint use `bg-sunken` or `bg-<hue>-500/10`.
- `Panel` pads `p-3 sm:p-4`: a child that bleeds with `-mx-3` alone leaves a 4px gap from `sm` — use `-mx-3 sm:-mx-4`.
- Sticky first columns: tint rows with `.row-mine` / the built-in hover (background images), not `bg-*` on the `<td>`.
- Team colors are data: anything drawn in a team color (dots, bars, logo fills) needs a hairline
  (`ring-1 ring-inset ring-black/10 dark:ring-white/30`) or near-white / near-black team colors vanish in one theme.
- Two sides of a matchup must share a score baseline: stretch the sides (`items-stretch`) and pin the score block
  with `mt-auto`, so a long team name that wraps to two lines doesn't push one score lower than the other.

## 8. Migrating an area page (checklist)

Work top to bottom; most lines are a class swap. Check each page at 375 and 430 (light + dark) and 1400.

| Find | Replace with |
|---|---|
| `rounded-lg border border-line bg-panel shadow-panel` (hand-rolled card) | `Panel` (titled) or `.card` |
| hand-rolled card header (`border-b px-3 py-2 font-bold uppercase …`) | `Panel title=… subtitle=… actions={<MoreLink>}` |
| `text-[11px] font-bold uppercase tracking-wide text-muted` kicker | `.eyebrow` / `SectionLabel` |
| stat boxes `rounded border border-line p-2 text-center` | `StatTile` (cards) or `rounded-lg bg-sunken px-3 py-2` + `.numeral` value |
| progress bars `h-2 rounded bg-gray-200` | `Meter` |
| scores / win % / money as plain text | `ScoreNumber` / `LiveNumber` / `.numeral font-semibold` (never wrap) |
| win-probability bars | `WinProbBar` (+ two `.numeral` percentages) |
| in-page section tabs | `TabLinks` (sections) · `SegmentedLinks` / `SegmentedControl` (2–5 views / filters) |
| filter pill rows | `Chip` inside `ScrollRow className="-mx-3 gap-2 px-3"` |
| sticky header bar `bg-panel/95 backdrop-blur border-b` | `sticky top-0 z-20 bar-top -mx-3 px-3 sm:mx-0 sm:rounded-lg` |
| bottom save / bid / propose bar (`fixed bottom-14 …` / `sticky bottom-[60px] …`) | `StickyActionBar` |
| my team's table row / card | `.row-mine` / `.mine` / `TeamIdentity mine` |
| LIVE / Final / Upcoming text | `GameStatus`, `LiveDot` |
| `text-green-600` / `text-red-600` for +/- numbers | `text-win` / `text-loss` |
| `text-gold-500/600`, `text-amber-500/600` text | `text-gold-700 dark:text-gold-400`, `text-amber-700 dark:text-amber-300` |
| `bg-white`, `bg-gray-*`, `text-gray-*`, `border-gray-*` | `bg-panel` / `bg-sunken`, `text-ink` / `text-muted`, `border-line` |
| custom checkbox switches | `Toggle` |
| `<select>` / `<input>` without `.input` | `.input` inside `Field` |
| loading `animate-pulse bg-gray-200` blocks | `Skeleton` |
| a wide table that is the page's main content | phones: `ListGroup`/`ListRow` (`md:hidden`) + table `hidden md:block` |
| text under 11px outside a badge / position tag | 11px+ (`text-[11px]`, `text-xs`) |

Done means: no horizontal scroll at 360, no `backdrop-` / `bg-*/9x` in the diff, every number tabular, dark mode
checked, primary actions ≥ 40px on phones, nothing hidden behind the tab bar.
