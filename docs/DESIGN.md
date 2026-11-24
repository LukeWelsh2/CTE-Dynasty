# CTE Dynasty — Design language ("tech-forward refresh")

The look is an **evolution** of the CBS-style league site: same information architecture, same navy +
championship-gold brand, same density. What changes is the finish: Apple-Sports-grade materials, type and
numerals. Every page is built from the UI kit (`@/components/ui/core`, `@/components/ui/client`) and the
classes in `src/app/globals.css`. If a recipe below exists, use it verbatim instead of hand-rolling classes.

## 1. Principles

1. **Calm surfaces, loud numbers.** Neutral, layered surfaces; scores, win %, cap space and records are the
   heroes, set in big tabular numerals (`ScoreNumber`).
2. **Depth from light, not lines.** Cards float on soft multi-layer shadows with a hairline ring; inner
   separators are hairlines (`border-line/70`). Heavy borders, boxed headers and grey bars are out.
3. **Glass only for chrome.** Translucent blur is reserved for things that float over content: the bottom
   tab bar, sticky action/score bars, sheets, menus. Content cards stay opaque.
4. **Phone first.** 44px targets for primary actions, thumb-reachable bars above the tab bar, safe areas,
   single column under `sm`, nothing hidden behind the tab bar.
5. **Motion with meaning.** Live things pulse, scores tween and flash, sheets slide; everything is 120–300ms,
   ease-out, and disappears under `prefers-reduced-motion`.

## 2. Tokens

### Color (Tailwind names → CSS variables in `globals.css`, light / dark)

| Token | Use | Light | Dark |
|---|---|---|---|
| `bg-surface` | page background | `#f0f3f8` | `#05070c` (near-black) |
| `bg-panel` | cards, tables | `#ffffff` | `#11151e` |
| `bg-raised` | menus, sheets, modals, popovers | `#ffffff` | `#1a1f2b` (lighter = higher, like iOS) |
| `bg-sunken` | **fills inside cards**: table header, input fill, hover, chips, segmented track | `#f4f6fa` | `#1b212d` |
| `border-line` | hairlines, separators (use `/70` inside cards) | `#e1e6ee` | `#282f3e` |
| `text-ink` | primary text | `#0c1322` | `#edf1f7` |
| `text-muted` | secondary text (≥4.5:1 on panel) | `#5b687e` | `#919cb0` |
| `text-faint` | tertiary: placeholders, chevrons, disabled | `#919caf` | `#646f82` |
| `brand-50…950` | navy scale (unchanged hex) — primary actions `brand-600/700`, links `brand-600` / `dark:brand-300`, tints `brand-500/10` | | |
| `gold-50…900` | championship gold — accents, "mine" highlights, kickers. **Gold text on light: `text-gold-700 dark:text-gold-400`** (gold-500/600 fail contrast as text on white) | | |
| `live` `#e11d48`, `win` `#16a34a`, `loss` `#dc2626` | semantic; text or solid fills | | |

Rules: never use raw `bg-white`/`bg-gray-*`/`text-gray-*` for surfaces or text — dark mode breaks. Tints are
`bg-<color>-500/10` (light) + `dark:bg-<color>-400/15` and text `text-<color>-700 dark:text-<color>-300`.
"Mine" (my team / my matchup) = `bg-gold-400/10` + a 2px gold inset accent (`shadow-[inset_3px_0_0_theme(colors.gold.500)]`)
or the `.row-mine` class on table rows.

### Surfaces & elevation

| Level | Recipe |
|---|---|
| 0 page | `bg-surface` (set on `<body>`) |
| 1 card | `.card` = `rounded-card bg-panel shadow-card` (shadow includes the hairline ring; no `border`) |
| 1 hero | `.hero-surface` (navy gradient + gold glow, white text) — the matchup hero, home hero, auth |
| 2 floating | `bg-raised shadow-pop rounded-xl` (menus) / `rounded-t-sheet` (sheets) |
| chrome | `.glass` (panel-tinted blur) or `.glass-chrome` (navy blur) |

Legacy `rounded-lg border border-line bg-panel shadow-panel` still works and looks right (softer border and
shadow); new code uses `.card`.

### Radius

`rounded-sm` 4 · `rounded` 6 (badges) · `rounded-md` 8 (small controls, tags) · `rounded-control` 10
(buttons, inputs) · `rounded-lg` 12 (tiles, list items) · `rounded-card` 16 (cards/panels) · `rounded-xl` 16 ·
`rounded-2xl` 20 (hero, sticky bars) · `rounded-sheet` 22 (sheet top corners) · `rounded-full` (chips,
segmented controls, pills, avatars).

### Shadow

`shadow-card` (hairline ring + 2 soft layers) · `shadow-panel` (soft, no ring — legacy cards that keep a
border) · `shadow-pop` (ring + deep float: menus, sheets, sticky bars) · `shadow-btn` (inner highlight +
1px drop: filled buttons) · `shadow-glow-live` (red halo for live pills). Dark mode swaps the drop shadows for
a white hairline + top highlight automatically (variables).

### Spacing rhythm (4px grid)

Page gutter `px-3 sm:px-4` (AppShell). Card padding `p-3 sm:p-4`; card header `px-3 py-2.5 sm:px-4`.
Gap between cards `gap-4` (`space-y-4`); inside cards `gap-3`; inside rows `gap-2`–`gap-3`.
Rows: dense desktop table rows 32–36px; phone list rows ≥ 52px (`ListRow`).

### Type

Fonts are self-hosted (`public/fonts`, OFL): **Inter Variable** with optical sizing (UI + numerals; at large
sizes it automatically uses the Display cut) and **Barlow Condensed** 600/700/800 (sporty display). Fallbacks
are Apple-first (`-apple-system`, `SF Pro Text`), so a failed load still looks native on iPhone.

| Role | Recipe |
|---|---|
| Page title | `PageHeader` → `font-display text-[30px] sm:text-[36px] font-extrabold uppercase leading-[1.02] tracking-[0.01em]` |
| Section / card title | `Panel title` → `font-display text-[17px] font-bold uppercase tracking-[0.04em]` |
| Kicker / overline | `.overline` (11px, 700, uppercase, tracking .12em, muted) · gold kicker: `.overline text-gold-700 dark:text-gold-400` |
| Row title | `text-[15px] font-semibold` (phones) / `text-sm font-semibold` (dense desktop) |
| Body | `text-sm` (14px) `text-ink`; secondary `text-muted` |
| Caption / meta | `text-xs text-muted` (12px). **Nothing meaningful below 11px**; 10px only for badge-like tags |
| Numerals | `ScoreNumber` / `.numeral` (tabular, tight tracking). Sizes: sm 15 · md 22 · lg 32→40 · xl 44→56 |
| Sheet / menu title | `text-[17px] font-semibold` (sentence case, Inter) |
| Form label | `.label` (13px, medium, muted, sentence case) |

Global: tabular numbers everywhere (`font-feature-settings: "tnum"`), `text-wrap: balance` on headings, never
let a number wrap (`whitespace-nowrap` on scores/money).

### Motion

| Token | Value | Use |
|---|---|---|
| `duration-150` / `ease-out` | 150ms | press, hover, color |
| `duration-200` / `ease-out-expo` | 200ms | toggles, segmented thumb, menus |
| `duration-300` / `ease-out-expo` | 300ms | sheets, drawer |
| 700ms | | win-prob bar width, number tween |
| `ease-out-expo` = `cubic-bezier(0.22,1,0.36,1)`, `ease-spring` = `cubic-bezier(0.34,1.56,0.64,1)` | | |

Animations: `animate-flash` (score change), `animate-score-pop`, `animate-sheet`, `animate-drawer`,
`animate-fade-in`, `.skeleton` shimmer, `.live-dot` ping. All are disabled by the global
`prefers-reduced-motion` rule — don't add your own motion without `motion-safe:`.

## 3. Materials

```css
.glass         /* panel-tinted: rgb(var(--c-panel) / .72) + saturate(180%) blur(20px); solid panel fallback */
.glass-raised  /* sheet/menu: rgb(var(--c-raised) / .82) + blur(24px) */
.glass-chrome  /* navy: rgb(var(--c-chrome) / .86) + blur(20px); used for top-level chrome over content */
```

Every glass class falls back to an opaque color when `backdrop-filter` is unsupported, and pairs with a
hairline (`shadow-pop` or `border-line/60`). Never put body text on glass over busy content without the
`.72+` opacity these classes already use.

## 4. Component cookbook

Imports: `import { … } from "@/components/ui/core"` (server-safe) and `"@/components/ui/client"` (client).

### Page header
```tsx
<PageHeader kicker="2026 season · Week 12" title="Standings" subtitle="Top 6 make the playoffs"
  actions={<ButtonLink href="/playoffs" variant="secondary" size="sm">Bracket</ButtonLink>} />
```
Section nav under it: `<TabLinks tabs={…} active="power" />` (refined underline). For 2–5 view/filter
options use `<SegmentedLinks options={[{ key, label, href }]} active=… />` (URL state) or the client
`<SegmentedControl options={[{ value, label }]} value onChange />`. Add `full` to stretch on phones.

### Section panel (card with title)
```tsx
<Panel title="Standings" subtitle="Top 6 make the playoffs" actions={<MoreLink href="/standings">Full standings</MoreLink>}>
  …
</Panel>
<Panel title="Roster" noPad>{/* table bleeds to the card edge */}<div className="overflow-x-auto"><table className="tbl">…</table></div></Panel>
```
A card without a title: `<div className="card p-3 sm:p-4">`. Small group heading inside a card:
`<SectionLabel right={…}>Key dates</SectionLabel>`.

### Data table (desktop-dense)
```tsx
<div className="overflow-x-auto scroll-thin"><table className="tbl">
  <thead><tr><th>Player</th><th className="num">Pts</th></tr></thead>
  <tbody><tr className={cn(mine && "row-mine")}><td>…</td><td className="num">12.4</td></tr></tbody>
</table></div>
```
`.tbl` gives: 11px uppercase header on `bg-sunken`, hairline rows, 12px outer cell inset, hover tint,
`.num` right-aligned tabular cells, `.group-row` navy band, `.tbl-compact`. Sticky first column on phones:
`<th className="tbl-sticky">` / `<td className="tbl-sticky">` (opaque bg + right hairline) inside an
`overflow-x-auto` wrapper.

### Card list on phones (when the table is the main content)
```tsx
<div className="md:hidden"><ListGroup title="Starters">
  <ListRow href={`/players/${p.id}`} leading={<PlayerHeadshot player={p} size={36} />}
    title={p.fullName} subtitle={`${p.position} · ${p.team}`} trailing={<ScoreNumber value={pts} size="sm" />} chevron />
</ListGroup></div>
<div className="hidden md:block">{/* the .tbl */}</div>
```
Rows are ≥ 52px, truncate the title (pass `title` text — `ListRow` sets the `title` attribute), keep the key
number in `trailing` so nothing scrolls sideways.

### Stat tile
```tsx
<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
  <StatTile label="Cap space" value={fmtMoney(room)} sub="of $300" tone={room < 0 ? "bad" : undefined} />
</div>
```
Value is set in large tabular numerals; pass words as `value={<span className="text-xl">Open</span>}`.

### Buttons & actions
| Intent | Recipe |
|---|---|
| Primary (Save, Propose, Claim, Accept, Set lineup) | `<Button>` / `<SubmitButton>` / `<ButtonLink>` (navy gradient, `shadow-btn`). On phones use `size="md"` (40px) or `lg` (44px); `w-full sm:w-auto` in sheets/forms |
| Secondary | `variant="secondary"` (raised white button with hairline) |
| Tinted (prominent secondary, e.g. "Add to watch list") | `variant="tinted"` |
| Ghost / toolbar | `variant="ghost"`; text-only link-button `variant="plain"` |
| Destructive | `variant="danger"`; confirmations via `ActionButton confirm="…"` |
| Gold (one per screen, celebratory/urgent: "Fix lineup", "Draft now") | `variant="gold"` |
| Icon-only | `<IconButton label="Close"><X size={18} /></IconButton>` (always labelled, 40px on phones) |
| "View all" in headers | `<MoreLink href="…">Full standings</MoreLink>` |

All buttons have a press state (`active:scale-[0.97]`) and a focus ring. Never put two primary buttons side by side.

### Sticky action bar (Save / Bid / Propose) above the tab bar
```tsx
{dirty && (
  <StickyActionBar>
    <span className="mr-auto text-sm font-semibold">3 unsaved changes</span>
    <Button variant="ghost" size="md" onClick={reset}>Reset</Button>
    <Button size="md" onClick={save}>Save lineup</Button>
  </StickyActionBar>
)}
```
Phones: fixed, glass, rounded-2xl, floating 8px above the tab bar (`bottom: calc(var(--tabbar-h) + .5rem)`),
safe-area aware, and it renders its own spacer so the end of the page is never hidden. md+: sticky to the
bottom of its container (`desktop="static"` to keep it in flow). Hand-rolled bars: use
`bottom-[calc(var(--tabbar-h)+0.5rem)]` — never `bottom-14`/`bottom-[60px]` (ignores the home indicator).

### Sheet / modal
`<Modal open onClose title="Claim player" footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button>Claim</Button></>}>`.
Phones: bottom sheet with a grabber, `rounded-t-sheet`, body scrolls inside, footer pinned above the home
indicator. ≥ sm: centered dialog. Keep the primary action in `footer` (right-most).

### Menus
`<Dropdown trigger={…} align="right">` with rows `className={menuItemClass}` (`<Link className={menuItemClass}>`).
Menus are raised glass, rounded-xl, rows are inset rounded and 40px tall on phones.

### Chips & filters
```tsx
<ScrollRow className="-mx-3 gap-2 px-3"> {/* horizontal on phones, snaps, fades its edge */}
  <Chip href="?pos=ALL" active={pos === "ALL"}>All</Chip>
  <Chip href="?pos=QB" active={pos === "QB"} count={12}>QB</Chip>
</ScrollRow>
```
Client chips: `<button className={chipClass(active)}>`. Compact static tags: `.chip`.

### Switches & inputs
`<Toggle name="x" label="Email me" />` (iOS switch). Fields: `<Field label="Team name" hint="…"><input className="input" /></Field>`;
`.input` is a filled field with a hairline and a 4px focus ring; works for `<select>` and `<textarea>` too.

### Empty state · skeleton · alerts
`<EmptyState icon={<Inbox size={22} />} title="No pending claims">Place a claim from…</EmptyState>`.
Loading: `<Skeleton className="h-4 w-32" />` (shimmer; `circle` for avatars) — never flat grey blocks.
`<Alert tone="warn" icon>` (tones info / warn / error / success; `icon` adds the tone icon).

### Live indicator & game status
`<LiveDot />` (pulsing red dot; `className="bg-white"` on red fills). `<GameStatus status={m.status} />`
renders the LIVE (pulsing pill) / Final / Upcoming badge consistently.

### Score numerals
```tsx
<ScoreNumber value={side.score} decimals={2} size="xl" dim={!winning} />   {/* static */}
<LiveNumber value={side.score} decimals={2} className="numeral text-[44px] font-bold" />   {/* tweens + flashes on change (client) */}
```

### Win-probability bar
`<WinProbBar left={myWinProb} leftColor={myColor} rightColor={oppColor} size="md" glow label="…" />` —
two rounded segments with a gap; the favourite's side glows. `size="xs"` for scoreboard tiles.

### Team / player identity rows
```tsx
<TeamIdentity team={team} size={28} sub={`${record} · ${owner}`} href={`/teams/${team.id}`} mine={team.id === myTeamId} />
<PlayerLink player={p} showHeadshot size={32} />
```
Names truncate with a `title` attribute; `mine` tints the name brand-colored. Team logos are squircles.

### Badges
`<Badge tone="green|red|amber|brand|gold|purple|neutral|live">` — tinted pills, 11px uppercase.
`<PosBadge pos="WR" />`, `<InjuryTag status="Questionable" />` unchanged API.

### Horizontal rows (tabs, pills, ticker)
`ScrollRow` (`@/components/ui/scroll-row`): snaps, fades the edge with more content, scrolls the active
child (`aria-current` / `aria-selected` / `data-active`) into view.

## 5. Shell facts other pages rely on

- `--tabbar-h` CSS variable = tab bar height incl. safe area on phones, `0px` from `md`. Tailwind spacing
  `tabbar` (`bottom-tabbar`, `pb-tabbar`) maps to it.
- The top bar is **not** sticky; page-level sticky elements can keep `top-0`.
- `<main>` reserves room for the tab bar; fixed bars must sit at `bottom-[calc(var(--tabbar-h)+0.5rem)]`.
- Toasts appear at the top on phones (clear of bottom bars).
- Breakpoints: phone < 640 (`sm`), tablet 640–767, tab bar hidden from `md` (768), desktop rail from `lg`.
