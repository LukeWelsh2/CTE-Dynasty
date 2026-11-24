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

const ICONS: Record<string, { icon: typeof Bell; tone: string }> = {
  TOUCHDOWN: { icon: Flame, tone: "bg-red-600" },
  TRADE: { icon: ArrowLeftRight, tone: "bg-brand-600" },
  WAIVER_RESULT: { icon: Waves, tone: "bg-emerald-600" },
  CHAT: { icon: MessageCircle, tone: "bg-sky-600" },
  DRAFT: { icon: Gavel, tone: "bg-violet-600" },
  AUCTION_OUTBID: { icon: Gavel, tone: "bg-violet-600" },
  INJURY: { icon: HeartPulse, tone: "bg-orange-600" },
  LINEUP_WARNING: { icon: ClipboardList, tone: "bg-amber-600" },
  RECAP: { icon: Newspaper, tone: "bg-slate-600" },
  RULE_PROPOSAL: { icon: Scale, tone: "bg-teal-600" },
  KEEPER_DEADLINE: { icon: CalendarClock, tone: "bg-yellow-600" },
  PLAYOFFS: { icon: Trophy, tone: "bg-gold-500" },
  COMMISSIONER: { icon: Megaphone, tone: "bg-brand-800" },
};

function iconFor(type: string) {
  return ICONS[type] ?? ICONS[type.split("_")[0]] ?? { icon: Bell, tone: "bg-slate-500" };
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
          <h2 className="sticky top-0 z-10 -mx-1 mb-1 bg-surface/95 px-1 py-1 text-[11px] font-bold uppercase tracking-wide text-muted backdrop-blur">{d.label}</h2>
          <ul className="overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
            {d.items.map((n) => {
              const read = isRead(n);
              const { icon: Icon, tone } = iconFor(n.type);
              const content = (
                <>
                  <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white", tone)}>
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className={cn("text-sm", read ? "font-medium text-ink/80" : "font-bold text-ink")}>{n.title}</span>
                      <span className="shrink-0 text-[11px] text-muted" title={n.time}>
                        {n.ago}
                      </span>
                    </span>
                    <span className="mt-0.5 block whitespace-pre-line text-[13px] leading-snug text-muted">{n.body}</span>
                    <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-muted/80">
                      {n.typeLabel} · {n.time}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={n.id} className={cn("group relative flex items-stretch border-b border-line last:border-0", !read && "bg-brand-50/60 dark:bg-brand-900/20")}>
                  {!read && <span className="absolute inset-y-0 left-0 w-1 bg-brand-600" aria-hidden />}
                  {n.url ? (
                    <Link href={n.url} onClick={() => !read && setRead(n, true)} className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 hover:bg-sunken/60">
                      {content}
                    </Link>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5">{content}</div>
                  )}
                  <button
                    type="button"
                    onClick={() => setRead(n, !read)}
                    className="flex w-10 shrink-0 items-center justify-center text-muted hover:bg-sunken hover:text-ink"
                    aria-label={read ? `Mark “${n.title}” as unread` : `Mark “${n.title}” as read`}
                    title={read ? "Mark as unread" : "Mark as read"}
                  >
                    {read ? <Circle size={15} /> : <CircleCheck size={17} className="text-brand-600 dark:text-brand-300" />}
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
