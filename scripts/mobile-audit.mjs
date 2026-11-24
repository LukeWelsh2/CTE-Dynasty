// Mobile layout audit: loads pages at phone widths and reports what breaks on small screens.
//
//   node scripts/mobile-audit.mjs --out /tmp/audit [--widths 360,390,430] [--user email] [--shots] [paths…]
//
// With no paths it audits every page route (dynamic segments filled from the database via psql
// using DATABASE_URL). For each page + width it records: horizontal page overflow and the elements
// that stick out, tap targets under 24px, form fields with text under 16px (iOS zooms on focus),
// text clipped without an ellipsis, HTTP status and runtime errors. Writes <out>/report.json and
// <out>/report.md (+ full-page screenshots at 390px with --shots). Exit code 1 if anything failed.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};
const base = opt("--base", process.env.BASE_URL || "http://localhost:3000");
const out = opt("--out", "./mobile-audit");
const widths = opt("--widths", "360,390").split(",").map(Number);
const user = opt("--user", "commish@ctedynasty.local");
const password = opt("--password", process.env.SEED_PASSWORD || "ctedynasty");
const shots = flag("--shots");
const authOnly = flag("--auth-pages");
fs.mkdirSync(out, { recursive: true });

function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const m = env.match(/^DATABASE_URL="?([^"\n]+)"?/m);
  return m ? m[1].replace(/\?schema=public$/, "") : null;
}
function q(sql) {
  const url = dbUrl();
  if (!url) return "";
  try {
    return execSync(`psql "${url.replace(/\?.*$/, "")}" -tAc ${JSON.stringify(sql)}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function defaultPaths() {
  const league = q(`select id from "League" order by "createdAt" limit 1`);
  const team = q(`select id from "Team" where "leagueId"='${league}' order by "createdAt" offset 1 limit 1`);
  const marcus = q(`select id from "User" where email='marcus@ctedynasty.local'`);
  const trade = q(`select id from "Trade" where "leagueId"='${league}' order by "createdAt" desc limit 1`);
  const matchupNow = q(`select m.id from "Matchup" m join "League" l on l.id=m."leagueId" where m."leagueId"='${league}' and m.status<>'FINAL' order by m.week, m.id limit 1`);
  const matchupFinal = q(`select id from "Matchup" where "leagueId"='${league}' and status='FINAL' order by week desc, id limit 1`);
  const recapWeek = q(`select max(week) from "WeeklyRecap" where "leagueId"='${league}'`) || "1";
  const proposal = q(`select id from "RuleProposal" where "leagueId"='${league}' order by "createdAt" desc limit 1`);
  const star = q(`select "playerId" from "RosterSpot" where "leagueId"='${league}' order by salary desc limit 1`) || "9509";
  const routes = [
    "/", "/team", "/team/insights", "/team/contracts", "/team/picks", "/team/keepers", "/teams", team && `/teams/${team}`,
    "/players", "/players?status=available", `/players/${star}`, "/players/KC", "/news", "/injuries",
    "/scoring", matchupNow && `/scoring/${matchupNow}`, matchupFinal && `/scoring/${matchupFinal}`, "/schedule",
    "/standings", "/standings?view=division", "/standings/power", "/playoffs",
    "/trades", "/trades/new", "/trades/calculator", "/trades/history", "/trades/block", trade && `/trades/${trade}`,
    "/transactions", "/waivers", team && `/waivers/fab/${team}`,
    "/draft", "/draft/rookie", "/draft/auction", "/draft/board", "/draft/results", "/draft/lottery", "/rookies",
    "/chat/general", "/managers", marcus && `/managers/${marcus}`, "/history", "/league", "/rules", "/rules/suggestions", proposal && `/rules/suggestions/${proposal}`,
    "/notifications", "/settings/profile", "/settings/notifications", "/recaps", `/recaps/${recapWeek}`,
    "/commissioner", "/commissioner/settings", "/commissioner/settings?tab=roster", "/commissioner/settings?tab=salaryCap", "/commissioner/settings/scoring",
    "/commissioner/members", "/commissioner/rosters", "/commissioner/schedule", "/commissioner/season", "/commissioner/system", "/commissioner/trades",
  ];
  return routes.filter(Boolean);
}

const paths = args.length ? args : authOnly ? ["/login", "/signup", "/forgot", "/join"] : defaultPaths();

// Runs in the page: what sticks out, what's too small, what's clipped.
function inspect() {
  const vw = window.innerWidth;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
  };
  // inside a horizontal scroll container (tables etc.) or a clipping ancestor → not a page overflow
  const contained = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") {
        const pr = p.getBoundingClientRect();
        if (pr.right <= vw + 1) return true;
      }
    }
    return false;
  };
  const desc = (el) => {
    const cls = (typeof el.className === "string" ? el.className : el.getAttribute("class") || "").trim().split(/\s+/).slice(0, 6).join(".");
    const txt = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 50);
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${txt ? ` "${txt}"` : ""}`;
  };
  const overflowPx = Math.max(0, document.documentElement.scrollWidth - vw);
  const sticking = [];
  for (const el of document.querySelectorAll("body *")) {
    if (sticking.length >= 12) break;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && r.width > 0 && r.height > 0 && visible(el) && !contained(el)) {
      // report the outermost offender only
      if (!sticking.some((s) => s.el.contains(el))) sticking.push({ el, right: Math.round(r.right) });
    }
  }
  const small = [];
  for (const el of document.querySelectorAll('a[href], button, [role="button"], select, input:not([type="hidden"]), summary, label[for]')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (el.tagName === "A" && cs.display === "inline") continue; // inline text links
    if (el.closest(".sr-only, [aria-hidden=true]")) continue;
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio") && el.closest("label")) continue;
    const r = el.getBoundingClientRect();
    // WCAG 2.5.8 minimum target size; text links in a row (player names) get a little slack
    const min = el.tagName === "A" && !el.querySelector("svg") ? 18 : 24;
    if (r.width < min || r.height < min) small.push(`${desc(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  const zoomInputs = [];
  for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select")) {
    if (!visible(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) zoomInputs.push(`${desc(el)} ${fs}px`);
  }
  const clipped = [];
  for (const el of document.querySelectorAll("body *")) {
    if (clipped.length >= 12) break;
    if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX !== "hidden" && cs.overflowX !== "clip") continue;
    if (cs.textOverflow === "ellipsis") continue;
    if (el.closest(".sr-only") || el.getBoundingClientRect().width <= 2) continue;
    if (el.scrollWidth > el.clientWidth + 2 && visible(el)) clipped.push(desc(el));
  }
  return {
    overflowPx,
    sticking: sticking.map((s) => `${desc(s.el)} → right ${s.right}px`),
    smallTargets: small.length,
    smallExamples: small.slice(0, 8),
    zoomInputs,
    clipped,
  };
}

const browser = await chromium.launch();
const report = [];
async function session(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  if (!authOnly) {
    await page.goto(base + "/login", { waitUntil: "load", timeout: 120000 });
    await page.fill('input[name="email"]', user);
    await page.fill('input[name="password"]', password);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
  }
  return { ctx, page };
}

for (const width of widths) {
  const { ctx, page } = await session(width);
  for (const p of paths) {
    const errors = [];
    const onErr = (e) => errors.push(String(e.message || e).slice(0, 200));
    const onConsole = (m) => m.type() === "error" && !/Failed to load resource|favicon|espncdn|sleepercdn/.test(m.text()) && errors.push(m.text().slice(0, 200));
    page.on("pageerror", onErr);
    page.on("console", onConsole);
    let status = 0;
    try {
      const res = await page.goto(base + p, { waitUntil: "load", timeout: 120000 });
      status = res?.status() ?? 0;
      await page.waitForFunction(() => !document.querySelector(".animate-pulse"), null, { timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(600);
      const bodyText = await page.locator("body").innerText().catch(() => "");
      if (/Unhandled Runtime Error|Application error|Internal Server Error|This page could not be found/i.test(bodyText)) errors.push("error page / runtime error text");
      const r = await page.evaluate(inspect);
      const name = p.replace(/[/?=&]+/g, "_").replace(/^_/, "") || "home";
      if (shots && width === 390) await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
      report.push({ path: p, width, status, errors, ...r });
      const flagLine = [r.overflowPx ? `OVERFLOW ${r.overflowPx}px` : "", r.zoomInputs.length ? `zoom-inputs ${r.zoomInputs.length}` : "", r.clipped.length ? `clipped ${r.clipped.length}` : "", r.smallTargets ? `small ${r.smallTargets}` : "", errors.length ? `ERRORS ${errors.length}` : ""].filter(Boolean).join(" · ");
      console.log(`${width} ${status} ${p} ${flagLine || "ok"}`);
    } catch (e) {
      report.push({ path: p, width, status, errors: [...errors, String(e).slice(0, 200)], overflowPx: 0, sticking: [], smallTargets: 0, smallExamples: [], zoomInputs: [], clipped: [] });
      console.log(`${width} ERR ${p} ${String(e).slice(0, 120)}`);
    }
    page.off("pageerror", onErr);
    page.off("console", onConsole);
  }
  await ctx.close();
}
await browser.close();

fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const bad = report.filter((r) => r.status >= 400 || r.status === 0 || r.errors.length || r.overflowPx || r.zoomInputs.length || r.clipped.length);
const md = [
  `# Mobile audit (${user}, widths ${widths.join("/")})`,
  "",
  `${report.length} page loads · ${bad.length} with problems · small tap targets on ${report.filter((r) => r.smallTargets).length}`,
  "",
  ...report
    .filter((r) => r.status >= 400 || r.status === 0 || r.errors.length || r.overflowPx || r.zoomInputs.length || r.clipped.length || r.smallTargets)
    .map((r) =>
      [
        `## ${r.path} @ ${r.width}px — status ${r.status}`,
        r.errors.length ? `- errors: ${r.errors.join(" | ")}` : "",
        r.overflowPx ? `- page overflows by ${r.overflowPx}px; sticking out: ${r.sticking.join("; ")}` : "",
        r.zoomInputs.length ? `- fields under 16px: ${r.zoomInputs.join("; ")}` : "",
        r.clipped.length ? `- clipped text: ${r.clipped.join("; ")}` : "",
        r.smallTargets ? `- ${r.smallTargets} tap targets under 24px, e.g. ${r.smallExamples.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
].join("\n");
fs.writeFileSync(path.join(out, "report.md"), md);
console.log(`\nreport: ${path.join(out, "report.md")}`);
process.exit(bad.some((r) => r.status >= 400 || r.status === 0 || r.errors.length || r.overflowPx) ? 1 : 0);
