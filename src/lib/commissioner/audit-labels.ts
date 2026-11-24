// Human-readable labels for AuditLog actions (every module's commissioner actions) and a short summary of
// an audit row's details. Pure + client-safe.
import { SECTION_LABELS, type SettingsSection } from "@/lib/commissioner/settings-meta";

/** Human label for an audit action */
export const AUDIT_LABELS: Record<string, string> = {
  "settings.update": "Updated league settings",
  "settings.revert": "Reverted league settings",
  "scoring.update": "Updated scoring rules",
  "dues.update": "Updated the dues tracker",
  "member.invite": "Created an invite",
  "member.invite_revoke": "Revoked an invite",
  "member.invite_resend": "Re-sent an invite",
  "member.role": "Changed a member's role",
  "member.remove": "Removed a member",
  "member.assign": "Assigned a team owner",
  "member.replace": "Replaced a team's manager",
  "league.invite_code": "Reset the league invite code",
  "team.update": "Edited a team",
  "team.create": "Added an expansion team",
  "roster.update": "Edited a roster spot",
  "roster.force_add": "Force-added a player",
  "roster.force_drop": "Force-dropped a player",
  "roster.move": "Moved a player between teams",
  "roster.dead_money_forgive": "Forgave dead money",
  "roster.amnesty": "Used an amnesty cut",
  "faab.adjust": "Adjusted FAB",
  "pick.owner": "Changed draft pick ownership",
  "schedule.regenerate": "Regenerated the schedule",
  "schedule.week_edit": "Edited a week's matchups",
  "score.adjust": "Added a score adjustment",
  "score.adjust_delete": "Removed a score adjustment",
  "score.recalc": "Recalculated a week",
  "league.week_override": "Changed the league week",
  "job.run": "Ran a background job",
  "announcement.create": "Posted an announcement",
  "announcement.pin": "Pinned / unpinned an announcement",
  "announcement.delete": "Deleted an announcement",
  "system.test_email": "Sent a test email",
  "system.test_push": "Sent a test push",
  // actions logged by other modules' commissioner tools
  "chat.delete_message": "Deleted a chat message",
  "draft.bid_on_behalf": "Bid for a team in the auction",
  "draft.complete": "Completed a draft",
  "draft.create": "Created a draft",
  "draft.delete": "Deleted a draft",
  "draft.lottery": "Ran the draft lottery",
  "draft.lottery_clear": "Cleared the draft lottery",
  "draft.nominate_on_behalf": "Nominated for a team",
  "draft.order": "Set the draft order",
  "draft.order_reset": "Reset the draft order",
  "draft.pause": "Paused a draft",
  "draft.pick_on_behalf": "Made a pick for a team",
  "draft.resume": "Resumed a draft",
  "draft.schedule": "Scheduled a draft",
  "draft.start": "Started a draft",
  "draft.undo_lot": "Undid an auction lot",
  "draft.undo_pick": "Undid a draft pick",
  "keepers.clear": "Cleared keeper designations",
  "keepers.lock": "Locked keepers",
  "keepers.window": "Set the keeper window",
  "lineup.edit": "Edited a team's lineup",
  "playoffs.recompute": "Recomputed the playoffs",
  "proposal.apply": "Applied a rule proposal",
  "proposal.comment_delete": "Deleted a proposal comment",
  "proposal.delete": "Deleted a rule proposal",
  "proposal.edit": "Edited a rule proposal",
  "proposal.status": "Changed a proposal's status",
  "recap.generate": "Generated a weekly recap",
  "recap.send": "Sent a weekly recap",
  "rookies.rankings_edit": "Edited rookie rankings",
  "roster.drop": "Dropped a player for a team",
  "season.phase": "Changed the season phase",
  "season.rollover": "Rolled over the season",
  "season.week_override": "Changed the league week",
  "settings.proposal": "Changed settings from a proposal",
  "team.branding": "Changed team branding",
  "team.logo": "Changed a team logo",
  "trade.approve": "Approved a trade",
  "trade.block_remove": "Removed a trade block listing",
  "trade.cancel": "Cancelled a trade",
  "trade.force_complete": "Force-completed a trade",
  "trade.reverse": "Reversed a trade",
  "trade.veto": "Vetoed a trade",
  "waivers.process_now": "Processed waivers",
  "contract.extension": "Extended a contract",
  "contract.franchise_tag": "Franchise-tagged a player",
  "contract.rookie_option": "Exercised a rookie option",
  "keepers.designate": "Designated a keeper for a team",
  "keepers.undesignate": "Removed a keeper for a team",
  "live.simulation.start": "Started a live scoring simulation",
  "live.simulation.reset": "Reset the live scoring simulation",
  "roster.activate": "Activated a player from IR",
  "roster.ir": "Moved a player to IR",
  "roster.promote": "Promoted a taxi player",
  "roster.taxi": "Moved a player to the taxi squad",
  "rookies.rankings_refresh": "Refreshed rookie rankings",
  "rookies.rankings_restore": "Restored a rookie ranking",
  "rookies.rankings_unpin": "Unpinned a rookie ranking",
};

export function auditLabel(action: string): string {
  if (AUDIT_LABELS[action]) return AUDIT_LABELS[action];
  const [scope, ...rest] = action.split(".");
  const verb = rest.join(" ").replace(/_/g, " ");
  return `${scope.charAt(0).toUpperCase()}${scope.slice(1)}${verb ? `: ${verb}` : ""}`;
}

/** Short description of an audit row's details */
export function auditDetail(details: unknown): string {
  if (!details || typeof details !== "object") return "";
  const d = details as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ["summary", "headline", "title", "note", "team", "player", "reason"]) {
    const v = typeof d[k] === "string" ? (d[k] as string).trim() : "";
    // skip values the summary already spells out (e.g. the team or note inside "Commissioner added $1 FAB to …")
    if (v && !parts.some((p) => p.includes(v))) parts.push(v);
  }
  if (!parts.length && typeof d.week === "number") parts.push(`Week ${d.week}`);
  if (typeof d.version === "number") parts.push(`v${d.version}`);
  if (Array.isArray(d.sections)) parts.push((d.sections as string[]).map((s) => SECTION_LABELS[s as SettingsSection] ?? s).join(", "));
  return parts.join(" · ");
}
