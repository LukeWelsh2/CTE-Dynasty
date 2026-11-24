// Player quick-card data (bio, status, this week, season line, last 5 games, latest news, owner/contract).
import { getLeagueContextOrNull } from "@/lib/league";
import { loadPlayerCard } from "@/lib/players/profile";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getLeagueContextOrNull();
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return Response.json({ error: "Invalid player id" }, { status: 400 });
  const card = await loadPlayerCard(ctx, id);
  if (!card) return Response.json({ error: "Player not found" }, { status: 404 });
  return Response.json(card, { headers: { "cache-control": "no-store" } });
}
