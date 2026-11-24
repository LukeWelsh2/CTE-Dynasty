// PLACEHOLDER — replaced by the League Home module.
import { getLeagueContext } from "@/lib/league";
import { PageHeader, Panel } from "@/components/ui/core";

export default async function HomePage() {
  const ctx = await getLeagueContext();
  return (
    <div>
      <PageHeader kicker={`Week ${ctx.week}`} title={ctx.league.name} subtitle={ctx.settings.general.commissionerMessage} />
      <Panel title="Welcome">Home page coming soon.</Panel>
    </div>
  );
}
