import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowedTransitions,
  checkPatchShape,
  matchesStatus,
  mergePatch,
  parsePatchText,
  patchPaths,
  sortProposals,
  tallyVotes,
  voteOutcome,
  votingEnded,
  votingOpen,
  PROPOSAL_CATEGORIES,
  CATEGORY_VALUES,
  closedVoteNotice,
} from "@/lib/proposals/logic";
import { DEFAULT_SETTINGS, resolveSettings, withTombstones } from "@/lib/settings/schema";
import {
  brandingSchema,
  contrastRatio,
  deviceLabel,
  groupNotificationTypes,
  hourLabel,
  normalizePhone,
  notificationPrefsSchema,
  NOTIFICATION_HINTS,
  profileSchema,
  readSocials,
  resolvePrefs,
  socialLinks,
} from "@/lib/profiles/schema";
import { isUploadUrl, sniffImage, UPLOAD_NAME } from "@/lib/profiles/images";
import { NOTIFICATION_DEFAULTS } from "@/lib/notify";
import {
  continuesPrevious,
  dayKey,
  dmSlugFor,
  dmTitle,
  extractMentions,
  groupByDay,
  groupReactions,
  matchMembers,
  mentionQueryAt,
  normalizeMessage,
  parseRichText,
  plainText,
  safeHref,
  sortChannels,
  toggleReaction,
  upsertMessage,
  type ChatMessageDTO,
} from "@/lib/chat/format";
import { RateLimiter } from "@/lib/chat/rate-limit";

// ───────────────────────────── Rule proposals ─────────────────────────────

test("proposal categories match the schema comment and are unique", () => {
  assert.deepEqual([...CATEGORY_VALUES].sort(), ["CAP", "DRAFT", "FUN", "GENERAL", "KEEPERS", "PLAYOFFS", "ROSTER", "SCORING", "TRADES", "WAIVERS"]);
  assert.equal(new Set(PROPOSAL_CATEGORIES.map((c) => c.label)).size, PROPOSAL_CATEGORIES.length);
});

test("allowedTransitions: author withdraws, commissioner runs the workflow", () => {
  const p = { status: "OPEN", authorId: "a" };
  assert.deepEqual(allowedTransitions(p, { userId: "a", isCommish: false }), ["WITHDRAWN"]);
  assert.deepEqual(allowedTransitions(p, { userId: "x", isCommish: false }), []);
  assert.deepEqual(allowedTransitions(p, { userId: "c", isCommish: true }), ["VOTING", "ADOPTED", "REJECTED", "TABLED"]);
  assert.deepEqual(allowedTransitions({ status: "VOTING", authorId: "a" }, { userId: "c", isCommish: true }), ["OPEN", "ADOPTED", "REJECTED", "TABLED"]);
  // commissioner who is also the author can withdraw too
  assert.ok(allowedTransitions({ status: "VOTING", authorId: "c" }, { userId: "c", isCommish: true }).includes("WITHDRAWN"));
  assert.deepEqual(allowedTransitions({ status: "ADOPTED", authorId: "a" }, { userId: "c", isCommish: true }), []);
  assert.deepEqual(allowedTransitions({ status: "TABLED", authorId: "a" }, { userId: "c", isCommish: true }), ["OPEN", "VOTING"]);
  assert.deepEqual(allowedTransitions({ status: "WITHDRAWN", authorId: "a" }, { userId: "a", isCommish: false }), ["OPEN"]);
  assert.deepEqual(allowedTransitions({ status: "WITHDRAWN", authorId: "a" }, { userId: "c", isCommish: true }), []);
});

test("votingOpen / votingEnded respect status and deadline", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  assert.equal(votingOpen({ status: "OPEN", votingEndsAt: null }, now), true);
  assert.equal(votingOpen({ status: "VOTING", votingEndsAt: "2026-11-25T00:00:00Z" }, now), true);
  assert.equal(votingOpen({ status: "VOTING", votingEndsAt: "2026-11-24T11:59:00Z" }, now), false);
  assert.equal(votingEnded({ status: "VOTING", votingEndsAt: "2026-11-24T11:59:00Z" }, now), true);
  assert.equal(votingEnded({ status: "VOTING", votingEndsAt: null }, now), false);
  assert.equal(votingOpen({ status: "ADOPTED", votingEndsAt: null }, now), false);
});

test("tallyVotes + voteOutcome use the share of the whole league", () => {
  const t = tallyVotes([1, 1, 1, 1, 1, 1, -1, -1, 0], 12);
  assert.equal(t.support, 6);
  assert.equal(t.oppose, 2);
  assert.equal(t.abstain, 1);
  assert.equal(t.cast, 9);
  assert.equal(t.leagueSupport, 0.5);
  assert.equal(t.supportShare, 0.75);
  const o = voteOutcome(t, 67);
  assert.equal(o.needed, 9); // ceil(0.67 * 12) = 9
  assert.equal(o.passes, false);
  assert.equal(o.short, 3);
  assert.equal(voteOutcome(tallyVotes(Array(9).fill(1), 12), 67).passes, true);
  // exact thresholds don't round up an extra vote
  assert.equal(voteOutcome(tallyVotes([], 12), 50).needed, 6);
  assert.equal(voteOutcome(tallyVotes([], 12), 75).needed, 9);
  // never more managers than votes counted
  assert.equal(tallyVotes([1, 1, 1], 2).managers, 3);
});

test("sortProposals: top, newest, ending soon", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  const base = { resolvedAt: null };
  const list = [
    { id: "a", status: "OPEN", createdAt: "2026-11-01", votingEndsAt: null, support: 3, oppose: 0, ...base },
    { id: "b", status: "VOTING", createdAt: "2026-11-10", votingEndsAt: "2026-11-30", support: 1, oppose: 4, ...base },
    { id: "c", status: "VOTING", createdAt: "2026-11-05", votingEndsAt: "2026-11-26", support: 5, oppose: 1, ...base },
    { id: "d", status: "ADOPTED", createdAt: "2026-11-20", votingEndsAt: "2026-11-15", support: 9, oppose: 1, resolvedAt: "2026-11-16" },
    { id: "e", status: "VOTING", createdAt: "2026-10-01", votingEndsAt: "2026-11-20", support: 2, oppose: 2, ...base },
  ];
  assert.deepEqual(sortProposals(list, "top", now).map((p) => p.id), ["d", "c", "a", "e", "b"]);
  assert.deepEqual(sortProposals(list, "newest", now).map((p) => p.id), ["d", "b", "c", "a", "e"]);
  assert.deepEqual(sortProposals(list, "ending", now).map((p) => p.id), ["c", "b", "e", "a", "d"]);
});

test("matchesStatus filters", () => {
  assert.equal(matchesStatus("OPEN", "active"), true);
  assert.equal(matchesStatus("VOTING", "active"), true);
  assert.equal(matchesStatus("ADOPTED", "active"), false);
  assert.equal(matchesStatus("ADOPTED", "all"), true);
  assert.equal(matchesStatus("TABLED", "TABLED"), true);
});

test("parsePatchText accepts objects only", () => {
  assert.deepEqual(parsePatchText(""), { ok: true, patch: null });
  assert.deepEqual(parsePatchText("  {}  "), { ok: true, patch: null });
  assert.equal(parsePatchText("{ nope").ok, false);
  assert.equal(parsePatchText("[1,2]").ok, false);
  assert.equal(parsePatchText('"x"').ok, false);
  const ok = parsePatchText('{ "roster": { "taxiSlots": 5 } }');
  assert.ok(ok.ok && ok.patch && (ok.patch.roster as { taxiSlots: number }).taxiSlots === 5);
  assert.equal(parsePatchText("x".repeat(20_001)).ok, false);
});

test("checkPatchShape flags unknown paths and type mismatches but allows record maps", () => {
  assert.deepEqual(checkPatchShape({ roster: { taxiSlots: 5 } }, DEFAULT_SETTINGS), []);
  assert.deepEqual(checkPatchShape({ scoring: { positionOverrides: { TE: { rec: 1.75 } } } }, DEFAULT_SETTINGS), []);
  assert.deepEqual(checkPatchShape({ scoring: { rules: { some_new_stat: 2 } } }, DEFAULT_SETTINGS), []);
  assert.match(checkPatchShape({ roster: { taxiSlotz: 5 } }, DEFAULT_SETTINGS)[0], /Unknown setting “roster.taxiSlotz”/);
  assert.match(checkPatchShape({ bogus: 1 }, DEFAULT_SETTINGS)[0], /Unknown setting “bogus”/);
  assert.match(checkPatchShape({ roster: { taxiSlots: "5" } }, DEFAULT_SETTINGS)[0], /must be a number/);
  assert.match(checkPatchShape({ roster: 5 }, DEFAULT_SETTINGS)[0], /must be an object/);
  assert.match(checkPatchShape({ roster: { slots: { QB: 1 } } }, DEFAULT_SETTINGS)[0], /must be a list/);
  // nullable values may be cleared
  assert.deepEqual(checkPatchShape({ trades: { deadlineWeek: null } }, DEFAULT_SETTINGS), []);
});

test("mergePatch merges deeply and keeps removed map entries removed", () => {
  const merged = mergePatch(DEFAULT_SETTINGS, { roster: { taxiSlots: 5 }, scoring: { positionOverrides: { TE: { rec: 1.75 } } } });
  assert.equal(merged.roster.taxiSlots, 5);
  assert.equal(merged.roster.benchSize, DEFAULT_SETTINGS.roster.benchSize);
  assert.equal(merged.scoring.positionOverrides.TE?.rec, 1.75);
  // a league that removed every position override keeps them removed after an unrelated patch
  const noOverrides = resolveSettings(withTombstones({ ...DEFAULT_SETTINGS, scoring: { ...DEFAULT_SETTINGS.scoring, positionOverrides: {} } }));
  const after = mergePatch(noOverrides, { roster: { taxiSlots: 4 } });
  assert.deepEqual(after.scoring.positionOverrides, {});
  assert.equal(after.roster.taxiSlots, 4);
});

test("patchPaths flattens leaves", () => {
  assert.deepEqual(patchPaths({ roster: { taxiSlots: 5, irSlots: 3 }, trades: { deadlineWeek: null } }), [
    { path: "roster.taxiSlots", value: 5 },
    { path: "roster.irSlots", value: 3 },
    { path: "trades.deadlineWeek", value: null },
  ]);
});

// ───────────────────────────── Profiles & notifications ─────────────────────────────

test("every notification type appears exactly once in the settings table, with a hint", () => {
  const types = Object.keys(NOTIFICATION_DEFAULTS);
  assert.ok(types.includes("TRADE_CANCELLED") && types.includes("PLAYOFFS"));
  const groups = groupNotificationTypes(types);
  const flat = groups.flatMap((g) => g.types);
  assert.equal(flat.length, types.length);
  assert.deepEqual([...flat].sort(), [...types].sort());
  assert.ok(!groups.some((g) => g.key === "other"), "no notification type should fall into 'Other'");
  for (const t of types) assert.ok(NOTIFICATION_HINTS[t], `missing hint for ${t}`);
  // unknown types are still listed
  assert.deepEqual(groupNotificationTypes(["TOUCHDOWN", "LEGACY_X"]).map((g) => g.key), ["scoring", "other"]);
});

test("resolvePrefs merges stored values over defaults and drops unknown types", () => {
  const p = resolvePrefs(NOTIFICATION_DEFAULTS, { TOUCHDOWN: { push: false }, NOPE: { push: true, email: true, inApp: true } });
  assert.equal(p.TOUCHDOWN.push, false);
  assert.equal(p.TOUCHDOWN.inApp, NOTIFICATION_DEFAULTS.TOUCHDOWN.inApp);
  assert.equal(p.TRADE_PROPOSED.email, true);
  assert.equal((p as Record<string, unknown>).NOPE, undefined);
  assert.equal(Object.keys(p).length, Object.keys(NOTIFICATION_DEFAULTS).length);
});

test("normalizePhone", () => {
  assert.equal(normalizePhone("(555) 123-4567"), "+15551234567");
  assert.equal(normalizePhone("1-555-123-4567"), "+15551234567");
  assert.equal(normalizePhone("+44 7700 900123"), "+447700900123");
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone("12345"), "invalid");
});

test("notificationPrefsSchema refinements", () => {
  const base = { prefs: {}, tdScope: "MY_MATCHUP" as const, quietHours: false, quietStart: 23, quietEnd: 8, weeklyRecapEmail: true, smsEnabled: false, phone: "" };
  assert.equal(notificationPrefsSchema.safeParse(base).success, true);
  assert.equal(notificationPrefsSchema.safeParse({ ...base, quietHours: true, quietStart: 5, quietEnd: 5 }).success, false);
  assert.equal(notificationPrefsSchema.safeParse({ ...base, smsEnabled: true }).success, false);
  assert.equal(notificationPrefsSchema.safeParse({ ...base, smsEnabled: true, phone: "555 123 4567" }).success, true);
  assert.equal(notificationPrefsSchema.safeParse({ ...base, tdScope: "EVERYTHING" }).success, false);
});

test("profileSchema normalizes socials, numbers and blanks", () => {
  const d = profileSchema.parse({
    name: "  Marcus Reed ",
    displayName: "",
    bio: "Hi",
    motto: "",
    location: "",
    favoriteNflTeam: "DET",
    favoritePlayer: "",
    yearsPlaying: "12",
    managerStyle: "Rebuilder",
    timezone: "America/Chicago",
    phone: "",
    showEmail: true,
    showPhone: false,
    socials: { x: "@marcus", instagram: "https://instagram.com/marc.us/", website: "https://example.com" },
  });
  assert.equal(d.name, "Marcus Reed");
  assert.equal(d.displayName, null);
  assert.equal(d.yearsPlaying, 12);
  assert.equal(d.phone, null);
  assert.deepEqual(d.socials, { x: "marcus", instagram: "marc.us", website: "https://example.com" });
  assert.equal(profileSchema.safeParse({ ...d, yearsPlaying: "abc", socials: {}, displayName: "", bio: "", motto: "", location: "", favoritePlayer: "", managerStyle: "", phone: "" }).success, false);
  assert.equal(profileSchema.safeParse({ ...d, favoriteNflTeam: "XXX", yearsPlaying: "", socials: {}, displayName: "", bio: "", motto: "", location: "", favoritePlayer: "", managerStyle: "", phone: "" }).success, false);
  assert.equal(profileSchema.safeParse({ ...d, timezone: "Mars/Olympus", yearsPlaying: "", socials: {}, displayName: "", bio: "", motto: "", location: "", favoritePlayer: "", managerStyle: "", phone: "" }).success, false);
  assert.equal(profileSchema.safeParse({ ...d, socials: { website: "javascript:alert(1)" }, yearsPlaying: "", displayName: "", bio: "", motto: "", location: "", favoritePlayer: "", managerStyle: "", phone: "" }).success, false);
});

test("socials: legacy twitter key and safe links only", () => {
  assert.deepEqual(readSocials({ twitter: "old", tiktok: " tt ", bogus: "x" }), { x: "old", tiktok: "tt" });
  const links = socialLinks({ x: "cte", website: "https://cte.example.com/" });
  assert.deepEqual(links.map((l) => [l.key, l.href, l.value]), [
    ["x", "https://x.com/cte", "@cte"],
    ["website", "https://cte.example.com/", "cte.example.com"],
  ]);
  assert.deepEqual(socialLinks({ website: "javascript:alert(1)" }), []);
});

test("brandingSchema uppercases abbreviations and validates colors", () => {
  const d = brandingSchema.parse({ teamId: "t1", name: "Helmet to Helmet", abbrev: "h2h", motto: "", primaryColor: "#1D4ED8", secondaryColor: "#f59e0b" });
  assert.equal(d.abbrev, "H2H");
  assert.equal(d.primaryColor, "#1d4ed8");
  assert.equal(d.motto, null);
  assert.equal(brandingSchema.safeParse({ ...d, abbrev: "TOOLONG" }).success, false);
  assert.equal(brandingSchema.safeParse({ ...d, primaryColor: "red" }).success, false);
});

test("contrastRatio, hourLabel, deviceLabel", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  assert.ok(contrastRatio("#f5b301", "#ffffff") < 3);
  assert.equal(hourLabel(0), "12:00 AM");
  assert.equal(hourLabel(13), "1:00 PM");
  assert.deepEqual(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"), { device: "iPhone", browser: "Home Screen app", icon: "phone" });
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1").browser, "Safari");
  assert.deepEqual(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"), { device: "Android phone", browser: "Chrome", icon: "phone" });
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0").browser, "Edge");
  assert.equal(deviceLabel(null).device, "Unknown device");
});

// ───────────────────────────── Uploads ─────────────────────────────

test("sniffImage decides the type from magic bytes", () => {
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])), "png");
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpg");
  assert.equal(sniffImage(new TextEncoder().encode("GIF89a....")), "gif");
  assert.equal(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])), "webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>")), null);
  assert.equal(sniffImage(new TextEncoder().encode("<html><script>")), null);
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50])), null);
});

test("upload URLs are strict (no path tricks)", () => {
  const name = "0123456789abcdef0123456789abcdef.png";
  assert.ok(UPLOAD_NAME.test(name));
  assert.equal(isUploadUrl(`/api/upload/${name}`), true);
  assert.equal(isUploadUrl(`/api/upload/../secrets/${name}`), false);
  assert.equal(isUploadUrl(`/api/upload/${name}?x=1`), false);
  assert.equal(isUploadUrl("https://evil.example.com/a.png"), false);
  assert.equal(isUploadUrl(`/api/upload/0123456789abcdef0123456789abcdef.svg`), false);
  assert.equal(isUploadUrl(null), false);
});

// ───────────────────────────── Chat ─────────────────────────────

test("chat rich text: safe links only, mentions resolved, plain text preview", () => {
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("//evil.com"), null);
  assert.deepEqual(safeHref("/trades/1"), { href: "/trades/1", external: false });
  const toks = parseRichText("**hi** [x](javascript:alert(1)) @Marcus Reed see https://example.com.", [{ userId: "u1", names: ["Marcus Reed"] }]);
  assert.equal(toks[0].t, "bold");
  assert.ok(toks.some((t) => t.t === "text" && t.v.includes("[x](javascript:alert(1))")));
  assert.ok(toks.some((t) => t.t === "mention" && t.userId === "u1"));
  assert.ok(toks.some((t) => t.t === "link" && t.href === "https://example.com"));
  assert.equal(plainText("**Big** news [here](/x)  today", 100), "Big news here today");
});

test("chat reactions + DM helpers", () => {
  const g = groupReactions([
    { emoji: "🔥", userId: "a" },
    { emoji: "👍", userId: "b" },
    { emoji: "🔥", userId: "b" },
    { emoji: "🔥", userId: "a" },
  ]);
  assert.deepEqual(g, [
    { emoji: "🔥", userIds: ["a", "b"] },
    { emoji: "👍", userIds: ["b"] },
  ]);
  assert.deepEqual(toggleReaction(g, "👍", "b"), [{ emoji: "🔥", userIds: ["a", "b"] }]);
  assert.deepEqual(toggleReaction(g, "💯", "c").at(-1), { emoji: "💯", userIds: ["c"] });
  const h = (s: string) => Buffer.from(s).toString("hex");
  assert.equal(dmSlugFor(["b", "a"], h), dmSlugFor(["a", "b", "a"], h));
  assert.equal(dmTitle(["me", "x"], "me", (id) => (id === "x" ? "Xavier" : undefined)), "Xavier");
  assert.equal(dmTitle(["me"], "me", () => undefined), "Notes to self");
});

test("RateLimiter enforces a minimum interval and a burst cap", () => {
  const rl = new RateLimiter(1000, { count: 3, windowMs: 10_000 });
  assert.equal(rl.check("u", 0).ok, true);
  assert.equal(rl.check("u", 500).ok, false);
  assert.equal(rl.check("u", 1000).ok, true);
  assert.equal(rl.check("u", 2000).ok, true);
  const blocked = rl.check("u", 3000);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0);
  assert.equal(rl.check("other", 3000).ok, true);
  assert.equal(rl.check("u", 10_001).ok, true);
});

test("closedVoteNotice reports the tally and whether the vote passed", () => {
  const pass = tallyVotes([1, 1, 1, 1, 1, 1, 1, 1, -1, 0], 12);
  const n1 = closedVoteNotice("Bigger taxi", pass, voteOutcome(pass, 67));
  assert.match(n1.chat, /8 support, 1 oppose, 1 abstain/);
  assert.match(n1.chat, /has the 9 votes needed|fell 1 vote short of the 9 needed/);
  const fail = tallyVotes([1, 1, -1, -1, -1], 12);
  const n2 = closedVoteNotice("Bigger taxi", fail, voteOutcome(fail, 50));
  assert.match(n2.body, /fell 4 votes short of the 6 needed/);
  assert.equal(n2.title, "Voting closed: Bigger taxi");
  assert.match(n2.commishBody, /Adopt, reject or table/);
  const yes = tallyVotes([1, 1, 1, 1, 1, 1, 1], 12);
  assert.match(closedVoteNotice("X", yes, voteOutcome(yes, 50)).chat, /has the 6 votes needed to pass/);
});

test("chat composer: @mention query at the caret and member ranking", () => {
  assert.deepEqual(mentionQueryAt("hey @mar", 8), { query: "mar", start: 4 });
  assert.deepEqual(mentionQueryAt("@", 1), { query: "", start: 0 });
  assert.equal(mentionQueryAt("email me at a@b.com", 19), null);
  assert.equal(mentionQueryAt("hey @marcus reed again", 22), null);
  const members = [
    { displayName: "Marcus Reed", name: "Marcus Reed", team: { name: "Helmet to Helmet" } },
    { displayName: "Big Mo", name: "Mo Smith", team: { name: "Marching Band" } },
    { displayName: "Sam Patel", name: "Sam Patel", team: { name: "Lights Out" } },
  ];
  assert.deepEqual(matchMembers(members, "mar").map((m) => m.displayName), ["Big Mo", "Marcus Reed"]);
  assert.deepEqual(matchMembers(members, "reed").map((m) => m.displayName), ["Marcus Reed"]);
  assert.equal(matchMembers(members, "").length, 3);
  const m = extractMentions("hi @Marcus Reed and @everyone, not @nobody", [{ userId: "u1", names: ["Marcus Reed"] }]);
  assert.deepEqual(m, { userIds: ["u1"], everyone: true });
});

test("chat day grouping uses the league time zone", () => {
  // 03:30 UTC on Nov 24 is still Nov 23 in New York
  assert.equal(dayKey("2026-11-24T03:30:00Z", "America/New_York"), "2026-11-23");
  assert.equal(dayKey("2026-11-24T03:30:00Z", "UTC"), "2026-11-24");
  const now = new Date("2026-11-24T18:00:00Z");
  const groups = groupByDay(
    [{ createdAt: "2026-11-23T03:00:00Z" }, { createdAt: "2026-11-23T20:00:00Z" }, { createdAt: "2026-11-24T15:00:00Z" }],
    "America/New_York",
    now,
  );
  assert.deepEqual(
    groups.map((g) => [g.key, g.label, g.items.length]),
    [
      ["2026-11-22", "Sunday, Nov 22", 1],
      ["2026-11-23", "Yesterday", 1],
      ["2026-11-24", "Today", 1],
    ],
  );
});

test("chat message list helpers: header grouping, upsert order, raw system rows", () => {
  const base = { kind: "USER" as const, userId: "a", replyToId: null };
  assert.equal(continuesPrevious({ ...base, createdAt: "2026-11-24T10:00:00Z" }, { ...base, createdAt: "2026-11-24T10:04:00Z" }), true);
  assert.equal(continuesPrevious({ ...base, createdAt: "2026-11-24T10:00:00Z" }, { ...base, createdAt: "2026-11-24T10:06:00Z" }), false);
  assert.equal(continuesPrevious({ ...base, createdAt: "2026-11-24T10:00:00Z" }, { ...base, userId: "b", createdAt: "2026-11-24T10:01:00Z" }), false);
  assert.equal(continuesPrevious({ ...base, createdAt: "2026-11-24T10:00:00Z" }, { ...base, replyToId: "x", createdAt: "2026-11-24T10:01:00Z" }), false);

  const mk = (id: string, createdAt: string, body = id): ChatMessageDTO => ({ id, channelId: "c", userId: "a", kind: "USER", body, data: null, replyTo: null, replyToId: null, editedAt: null, deletedAt: null, createdAt, reactions: [], card: null });
  let list = [mk("1", "2026-11-24T10:00:00Z"), mk("3", "2026-11-24T10:02:00Z")];
  list = upsertMessage(list, mk("2", "2026-11-24T10:01:00Z"));
  assert.deepEqual(list.map((m) => m.id), ["1", "2", "3"]);
  list = upsertMessage(list, mk("2", "2026-11-24T10:01:00Z", "edited"));
  assert.equal(list.length, 3);
  assert.equal(list[1].body, "edited");

  // postSystemMessage publishes the raw Prisma row (Date objects, flat reaction rows)
  const raw = { id: "s1", channelId: "c", userId: null, kind: "TRADE", body: "Trade!", data: { tradeId: "t1" }, createdAt: new Date("2026-11-24T10:00:00Z"), editedAt: null, deletedAt: null, reactions: [{ emoji: "🔥", userId: "u" }] };
  const n = normalizeMessage(raw)!;
  assert.equal(n.kind, "TRADE");
  assert.equal(n.createdAt, "2026-11-24T10:00:00.000Z");
  assert.deepEqual(n.reactions, [{ emoji: "🔥", userIds: ["u"] }]);
  assert.equal(normalizeMessage({ id: 1 }), null);
  assert.equal(normalizeMessage({ id: "x", channelId: "c", kind: "WEIRD" })!.kind, "SYSTEM");
});

test("sortChannels: default channels in order, then DMs by latest activity", () => {
  const ch = (slug: string, type: string, last: string | null) => ({ id: slug, slug, name: slug, topic: null, type, memberIds: [], unread: 0, lastMessageAt: last });
  const sorted = sortChannels([ch("dm-old", "DM", "2026-11-01"), ch("transactions", "ANNOUNCEMENTS", null), ch("dm-new", "DM", "2026-11-20"), ch("general", "PUBLIC", null), ch("zzz", "PUBLIC", null)], ["general", "trash-talk", "trades", "transactions"]);
  assert.deepEqual(sorted.map((c) => c.slug), ["general", "transactions", "zzz", "dm-new", "dm-old"]);
});
