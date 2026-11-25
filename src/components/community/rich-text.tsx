// Renders markdown-lite (bold, italic, strike, code, links, @mentions). Text is rendered as React text
// nodes, never as HTML, so user input is always escaped. Works in server and client components.
import Link from "next/link";
import { parseRichText, type MentionTarget, type RichToken } from "@/lib/chat/format";
import { cn } from "@/lib/utils";

function render(tokens: RichToken[], meId: string | undefined, keyPrefix: string): React.ReactNode[] {
  return tokens.map((t, i) => {
    const key = `${keyPrefix}${i}`;
    switch (t.t) {
      case "text":
        return t.v;
      case "bold":
        return <strong key={key} className="font-semibold">{render(t.c, meId, key + "-")}</strong>;
      case "italic":
        return <em key={key}>{render(t.c, meId, key + "-")}</em>;
      case "strike":
        return <s key={key}>{render(t.c, meId, key + "-")}</s>;
      case "code":
        return (
          <code key={key} className="rounded bg-sunken px-1 py-px font-mono text-[0.85em] text-ink ring-1 ring-line">
            {t.v}
          </code>
        );
      case "link":
        return t.external ? (
          <a key={key} href={t.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="link break-all">
            {t.label}
          </a>
        ) : (
          <Link key={key} href={t.href} className="link break-all">
            {t.label}
          </Link>
        );
      case "mention": {
        const me = !!meId && (t.userId === meId || t.everyone);
        const cls = cn(
          "rounded px-0.5 font-semibold",
          me ? "bg-brand-600/[0.18] text-brand-700 dark:bg-brand-400/30 dark:text-brand-200" : "bg-brand-600/[0.08] text-brand-700 dark:bg-brand-400/15 dark:text-brand-300",
        );
        return t.userId ? (
          <Link key={key} href={`/managers/${t.userId}`} className={cls}>
            {t.v}
          </Link>
        ) : (
          <span key={key} className={cls}>
            {t.v}
          </span>
        );
      }
    }
  });
}

export function RichText({ text, mentions = [], meId, className }: { text: string; mentions?: MentionTarget[]; meId?: string; className?: string }) {
  return <span className={cn("whitespace-pre-wrap break-words [overflow-wrap:anywhere]", className)}>{render(parseRichText(text, mentions), meId, "rt")}</span>;
}
