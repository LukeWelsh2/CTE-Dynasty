// Logs into the running dev server and loads pages, reporting HTTP status, runtime errors and
// (optionally) saving screenshots. Use it to verify pages actually render.
//
//   node scripts/dev-check.mjs /players /players/4046 --shots /tmp/shots [--mobile] [--user email] [--base http://localhost:3000]
//
// Exit code 1 if any page failed (status >= 400, error overlay, or uncaught page errors).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// playwright is not a project dependency (pre-installed globally in dev containers; otherwise: npx playwright install chromium)
const { chromium } = require("playwright");
import fs from "node:fs";

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
const shots = opt("--shots", null);
const user = opt("--user", "commish@ctedynasty.local");
const password = opt("--password", process.env.SEED_PASSWORD || "ctedynasty");
const mobile = flag("--mobile");
const paths = args.length ? args : ["/"];

if (shots) fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
let failed = false;

// login
await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', user);
await page.fill('input[name="password"]', password);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 }), page.click('button[type="submit"]')]);

for (const p of paths) {
  const errors = [];
  const onErr = (e) => errors.push(`pageerror: ${e.message}`);
  const onConsole = (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (t.includes("hydrated but some attributes") || t.includes("Download the React DevTools")) return;
    errors.push(`console: ${t.slice(0, 400)}`);
  };
  page.on("pageerror", onErr);
  page.on("console", onConsole);
  let status = 0;
  try {
    const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle", timeout: 120_000 });
    status = res?.status() ?? 0;
    await page.waitForTimeout(800);
  } catch (e) {
    errors.push(`navigation: ${e.message}`);
  }
  const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 4000);
  const hasErrorText = /Unhandled Runtime Error|Application error|Internal Server Error|This page could not be found/i.test(bodyText);
  if (shots) {
    const file = `${shots}/${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}${mobile ? "_mobile" : ""}.png`;
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  }
  const bad = status >= 400 || hasErrorText || errors.some((e) => e.startsWith("pageerror"));
  if (bad) failed = true;
  console.log(`${bad ? "FAIL" : "OK  "} ${status} ${p}`);
  if (hasErrorText) console.log("   body: " + bodyText.replace(/\s+/g, " ").slice(0, 600));
  for (const e of errors.slice(0, 8)) console.log("   " + e);
  page.off("pageerror", onErr);
  page.off("console", onConsole);
}

await browser.close();
process.exit(failed ? 1 : 0);
