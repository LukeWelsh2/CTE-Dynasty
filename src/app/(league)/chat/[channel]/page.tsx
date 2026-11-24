// Live league chat. /chat/<slug> — public channels (general, trash-talk, trades, transactions) and DMs.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLeagueContext } from "@/lib/league";
import { chatMembers, DEFAULT_CHANNEL_ORDER, loadMessages, markRead, userChannels } from "@/lib/chat/server";
import { ChatApp } from "@/components/community/chat-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "League Chat" };

export default async function ChatChannelPage({ params }: { params: Promise<{ channel: string }> }) {
  const { channel: slug } = await params;
  const ctx = await getLeagueContext();
  const members = await chatMembers(ctx.league.id);
  const channels = await userChannels(ctx.league.id, ctx.user.id, members);
  const active = channels.find((c) => c.slug === decodeURIComponent(slug));
  if (!active) notFound();
  const initial = await loadMessages(active.id);
  await markRead(active.id, ctx.user.id);
  const list = channels.map((c) => (c.id === active.id ? { ...c, unread: 0 } : c));
  return (
    <ChatApp
      key={active.id}
      me={{ id: ctx.user.id, isCommish: ctx.isCommish }}
      tz={ctx.settings.general.timezone}
      channels={list}
      channelOrder={DEFAULT_CHANNEL_ORDER}
      activeId={active.id}
      initial={initial}
      members={members}
    />
  );
}
