import { StandingsSkeleton } from "@/components/standings/skeleton";

export default function Loading() {
  return <StandingsSkeleton title="Playoffs" rows={8} rail={false} />;
}
