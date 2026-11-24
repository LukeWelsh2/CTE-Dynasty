// Link-based pagination ("Showing 1–50 of 3,412 · ‹ 1 2 3 … ›")
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Pagination({ page, pages, total, perPage, href, className }: { page: number; pages: number; total: number; perPage: number; href: (p: number) => string; className?: string }) {
  const from = total ? (page - 1) * perPage + 1 : 0;
  const to = Math.min(total, page * perPage);
  const nums = pageNumbers(page, pages);
  const cls = "inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-line px-2 text-xs font-semibold sm:h-8 sm:min-w-8";
  return (
    <nav aria-label="Pagination" className={cn("flex flex-wrap items-center justify-between gap-2 py-2 text-xs text-muted", className)}>
      <span>
        Showing <b className="text-ink">{from.toLocaleString()}</b>–<b className="text-ink">{to.toLocaleString()}</b> of <b className="text-ink">{total.toLocaleString()}</b>
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          {page > 1 ? (
            <Link href={href(page - 1)} className={cn(cls, "bg-panel text-ink hover:bg-sunken")} aria-label="Previous page" scroll={false}>
              <ChevronLeft size={14} />
            </Link>
          ) : (
            <span className={cn(cls, "opacity-40")} aria-hidden>
              <ChevronLeft size={14} />
            </span>
          )}
          {nums.map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} className="px-1">
                …
              </span>
            ) : (
              <Link
                key={n}
                href={href(n)}
                scroll={false}
                aria-current={n === page ? "page" : undefined}
                className={cn(cls, n === page ? "border-brand-700 bg-brand-700 text-white dark:border-brand-500 dark:bg-brand-600" : "bg-panel text-ink hover:bg-sunken")}
              >
                {n}
              </Link>
            ),
          )}
          {page < pages ? (
            <Link href={href(page + 1)} className={cn(cls, "bg-panel text-ink hover:bg-sunken")} aria-label="Next page" scroll={false}>
              <ChevronRight size={14} />
            </Link>
          ) : (
            <span className={cn(cls, "opacity-40")} aria-hidden>
              <ChevronRight size={14} />
            </span>
          )}
        </div>
      )}
    </nav>
  );
}

function pageNumbers(page: number, pages: number): (number | null)[] {
  const set = new Set<number>([1, pages, page, page - 1, page + 1]);
  const list = [...set].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (let i = 0; i < list.length; i++) {
    if (i && list[i]! - list[i - 1]! > 1) out.push(null);
    out.push(list[i]!);
  }
  return out;
}
