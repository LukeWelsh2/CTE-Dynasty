// Acquisition quote for the add / claim / drop dialogs (always fresh: roster, cap, FAB, limits, locks).
import { getLeagueContextOrNull } from "@/lib/league";
import { buildQuote } from "@/lib/players/acquire";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getLeagueContextOrNull();
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return Response.json({ error: "Invalid player id" }, { status: 400 });
  const quote = await buildQuote(ctx, id);
  if (!quote) return Response.json({ error: "Player not found" }, { status: 404 });
  return Response.json(quote, { headers: { "cache-control": "no-store" } });
}
