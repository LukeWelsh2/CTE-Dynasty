import { getLeagueContext } from "@/lib/league";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

export default async function LeagueLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getLeagueContext();
  return <AppShell ctx={ctx}>{children}</AppShell>;
}
