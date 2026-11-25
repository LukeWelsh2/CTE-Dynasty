"use client";
// Notification inbox list: grouped by day, mark read / unread, live arrivals via the user's SSE topic.
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Bell,
  CalendarClock,
  Circle,
  CircleCheck,
  ClipboardList,
  Flame,
  Gavel,
  HeartPulse,
  Megaphone,
  MessageCircle,
  Newspaper,
  Scale,
  Trophy,
  Waves,
} from "lucide-react";
import { toast } from "sonner";
import { useLiveEvents } from "@/lib/realtime/client";
import { markNotificationsAction } from "@/lib/profiles/actions";
import { cn } from "@/lib/utils";

export interface InboxItem {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  body: string;
  url: string | null;
  read: boolean;
  time: string; // formatted in league tz
  ago: string;
}

export interface InboxDay {
  label: string;
  items: InboxItem[];
}

// icons tell the type apart; colour stays quiet (grey circle) — unread rows carry the one blue
const ICONS: Record<string, { icon: typeof Bell }> = {
  TOUCHDOWN: { icon: Flame },
  TRADE: { icon: ArrowLeftRight },
  WAIVER_RESULT: { icon: Waves },
  CHAT: { icon: MessageCircle },
  DRAFT: { icon: Gavel },
  AUCTION_OUTBID: { icon: Gavel },
  INJURY: { icon: HeartPulse },
  LINEUP_WARNING: { icon: ClipboardList },
  RECAP: { icon: Newspaper },
  RULE_PROPOSAL: { icon: Scale },
  KEEPER_DEADLINE: { icon: CalendarClock },
  PLAYOFFS: { icon: Trophy },
  COMMISSIONER: { icon: Megaphone },
};

function iconFor(type: string) {
  return ICONS[type] ?? ICONS[type.split("_")[0]] ?? { icon: Bell };
}

export function NotificationList({ days, userId }: { days: InboxDay[]; userId: string }) {
  const router = useRouter();
  const [readOverride, setReadOverride] = useState<Record<string, boolean>>({});
  const [, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLiveEvents([`user:${userId}`], (e) => {
    if (e.type !== "notification") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 400);
  });

  const isRead = (n: InboxItem) => readOverride[n.id] ?? n.read;
  const setRead = (n: InboxItem, read: boolean) => {
    setReadOverride((o) => ({ ...o, [n.id]: read }));
    start(async () => {
      const res = await markNotificationsAction({ ids: [n.id], unread: !read });
      if (!res.ok) {
        toast.error(res.error);
        setReadOverride((o) => ({ ...o, [n.id]: !read }));
      }
    });
  };

  return (
    <div className="space-y-4">
      {days.map((d) => (
        <section key={d.label} aria-label={d.label}>
          <h2 className="eyebrow mb-1.5 px-1">{d.label}</h2>
          <ul className="card divide-y divide-line/70 overflow-hidden">
            {d.items.map((n) => {
              const read = isRead(n);
              const { icon: Icon } = iconFor(n.type);
              const content = (
                <>
                  <span
                    className={cn(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      read ? "bg-sunken text-muted" : "bg-brand-600/[0.1] text-brand-600 dark:bg-brand-400/15 dark:text-brand-400",
                    )}
                  >
                    <Icon size={17} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className={cn("min-w-0 text-[15px] leading-5 sm:text-sm", read ? "font-medium text-ink/80" : "font-semibold text-ink")}>{n.title}</span>
                      <span className="shrink-0 whitespace-nowrap pt-px text-[12px] text-muted" title={n.time}>
                        {n.ago}
                      </span>
                    </span>
                    {n.body && <span className="mt-0.5 block whitespace-pre-line text-[13px] leading-[18px] text-muted">{n.body}</span>}
                    <span className="mt-1 block truncate text-[12px] text-muted">
                      {n.typeLabel} · {n.time}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={n.id} className={cn("group relative flex items-stretch", !read && "bg-brand-600/[0.04] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.06]")}>
                  {n.url ? (
                    <Link href={n.url} onClick={() => !read && setRead(n, true)} className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 pr-1 transition-colors hover:bg-sunken/60">
                      {content}
                    </Link>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 pr-1">{content}</div>
                  )}
                  <button
                    type="button"
                    onClick={() => setRead(n, !read)}
                    className="flex w-11 shrink-0 items-center justify-center text-muted transition-colors hover:bg-sunken hover:text-ink"
                    aria-label={read ? `Mark “${n.title}” as unread` : `Mark “${n.title}” as read`}
                    title={read ? "Mark as unread" : "Mark as read"}
                  >
                    {read ? <Circle size={17} /> : <CircleCheck size={19} className="text-brand-600 dark:text-brand-400" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
