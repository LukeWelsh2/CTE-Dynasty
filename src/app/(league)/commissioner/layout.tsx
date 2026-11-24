import { requireCommissioner } from "@/lib/league";
import { CommishNav } from "@/components/commissioner/commish-nav";

export default async function CommissionerLayout({ children }: { children: React.ReactNode }) {
  await requireCommissioner();
  return (
    <div>
      <CommishNav />
      {children}
    </div>
  );
}
