// /notifications — my inbox. Main question: "What's new for me?" Title + "N unread" subline, All / Unread switch,
// type chips (with counts), then notifications grouped by day; mark read / unread per row; settings one tap away.
import type { Metadata } from "next";
import { BellRing, Settings } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { NOTIFICATION_DEFAULTS } from "@/lib/notify";
import { groupNotificationTypes } from "@/lib/profiles/schema";
import { deleteReadNotificationsAction, markNotificationsAction } from "@/lib/profiles/actions";
import { ButtonLink, Chip, EmptyState, IconButton, PageHeader, SegmentedLinks } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { ActionButton } from "@/components/ui/client";
import { SettingsTabs } from "@/components/community/settings-tabs";
import { NotificationList, type InboxDay } from "@/components/community/notification-list";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

const PAGE = 40;

function dayKey(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ group?: string; unread?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await getLeagueContext();
  const tz = ctx.settings.general.timezone;

  // every type we know about plus any legacy types present in the inbox
  const typeCounts = await db.notification.groupBy({ by: ["type"], where: { userId: ctx.user.id }, _count: { _all: true } });
  const unreadCounts = await db.notification.groupBy({ by: ["type"], where: { userId: ctx.user.id, readAt: null }, _count: { _all: true } });
  const allTypes = [...new Set([...Object.keys(NOTIFICATION_DEFAULTS), ...typeCounts.map((t) => t.type)])];
  const groups = groupNotificationTypes(allTypes);
  const countOf = (types: string[], src: typeof typeCounts) => src.filter((t) => types.includes(t.type)).reduce((a, t) => a + t._count._all, 0);
  const total = typeCounts.reduce((a, t) => a + t._count._all, 0);
  const totalUnread = unreadCounts.reduce((a, t) => a + t._count._all, 0);

  const group = groups.find((g) => g.key === sp.group) ?? null;
  const unreadOnly = sp.unread === "1";
  const page = Math.max(1, Math.min(50, Number(sp.page) || 1));
  const where = { userId: ctx.user.id, ...(group ? { type: { in: group.types } } : {}), ...(unreadOnly ? { readAt: null } : {}) };
  const [rows, matching] = await Promise.all([db.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: PAGE * page }), db.notification.count({ where })]);

  const labelOf = (t: string) => (NOTIFICATION_DEFAULTS as Record<string, { label: string }>)[t]?.label ?? t.replace(/_/g, " ").toLowerCase();
  const today = dayKey(new Date(), tz);
  const yesterday = dayKey(new Date(Date.now() - 86_400_000), tz);
  const days: InboxDay[] = [];
  for (const n of rows) {
    const k = dayKey(n.createdAt, tz);
    const label = k === today ? "Today" : k === yesterday ? "Yesterday" : n.createdAt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: k.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric", timeZone: tz });
    let day = days[days.length - 1];
    if (!day || day.label !== label) days.push((day = { label, items: [] }));
    day.items.push({
      id: n.id,
      type: n.type,
      typeLabel: labelOf(n.type),
      title: n.title,
      body: n.body,
      url: n.url && n.url.startsWith("/") ? n.url : null,
      read: !!n.readAt,
      time: n.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }),
      ago: timeAgo(n.createdAt),
    });
  }

  const href = (o: { group?: string | null; unread?: boolean; page?: number }) => {
    const q = new URLSearchParams();
    const g = o.group === undefined ? group?.key : o.group;
    const u = o.unread === undefined ? unreadOnly : o.unread;
    if (g) q.set("group", g);
    if (u) q.set("unread", "1");
    if (o.page && o.page > 1) q.set("page", String(o.page));
    const s = q.toString();
    return s ? `/notifications?${s}` : "/notifications";
  };
  return (
    <div className="mx-auto max-w-4xl">
      <SettingsTabs active="inbox" userId={ctx.user.id} />
      <PageHeader
        title="Notifications"
        subtitle={total ? `${totalUnread} unread · ${total} total` : "Alerts about your team and the league"}
        actions={
          <>
            {totalUnread > 0 && (
              <ActionButton action={async () => { "use server"; return markNotificationsAction({ all: true }); }} variant="primary" size="md">
                Mark all read
              </ActionButton>
            )}
            {total - totalUnread > 0 && (
              <ActionButton action={deleteReadNotificationsAction} confirm="Delete every notification you've already read?" variant="secondary" size="md">
                Clear read
              </ActionButton>
            )}
            <IconButton href="/settings/notifications" label="Alert settings" variant="secondary">
              <Settings size={18} />
            </IconButton>
          </>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3 lg:sticky lg:top-4">
          <SegmentedLinks
            full
            ariaLabel="Read state"
            active={unreadOnly ? "unread" : "all"}
            options={[
              { key: "all", label: `All${(group ? countOf(group.types, typeCounts) : total) ? ` · ${group ? countOf(group.types, typeCounts) : total}` : ""}`, href: href({ unread: false, page: 1 }) },
              { key: "unread", label: `Unread${(group ? countOf(group.types, unreadCounts) : totalUnread) ? ` · ${group ? countOf(group.types, unreadCounts) : totalUnread}` : ""}`, href: href({ unread: true, page: 1 }) },
            ]}
          />
          <ScrollRow as="nav" aria-label="Filter by type" snap={false} className="-mx-3 gap-2 px-3 lg:mx-0 lg:flex-wrap lg:px-0">
            <Chip href={href({ group: null, page: 1 })} active={!group} count={unreadOnly ? totalUnread : total} scroll={false}>
              Everything
            </Chip>
            {groups.map((g) => {
              const n = countOf(g.types, unreadOnly ? unreadCounts : typeCounts);
              return (
                <Chip key={g.key} href={href({ group: g.key, page: 1 })} active={group?.key === g.key} count={n || null} scroll={false}>
                  {g.label}
                </Chip>
              );
            })}
          </ScrollRow>
        </div>

        <div className="min-w-0">
          {rows.length === 0 ? (
            <EmptyState title={unreadOnly ? "You're all caught up" : total ? "Nothing here" : "No notifications yet"} icon={<BellRing size={28} />}>
              {unreadOnly
                ? "No unread notifications" + (group ? ` in ${group.label.toLowerCase()}.` : ".")
                : total
                  ? `No ${group ? group.label.toLowerCase() + " " : ""}notifications to show.`
                  : "Trade offers, waiver results, touchdown alerts, @mentions and league news will show up here."}
              <div className="mt-3 flex justify-center gap-2">
                {(group || unreadOnly) && (
                  <ButtonLink href="/notifications" variant="secondary" size="md">
                    Show everything
                  </ButtonLink>
                )}
                <ButtonLink href="/settings/notifications" variant="ghost" size="md">
                  Alert settings
                </ButtonLink>
              </div>
            </EmptyState>
          ) : (
            <>
              <NotificationList days={days} userId={ctx.user.id} />
              <div className="mt-3 flex items-center justify-between text-[13px] text-muted">
                <span>
                  Showing {rows.length} of {matching}
                </span>
                {rows.length < matching && (
                  <ButtonLink href={href({ page: page + 1 })} variant="secondary" size="md">
                    Load older
                  </ButtonLink>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
