import { requireUser } from "@/lib/auth/session";
import { JoinForm } from "../forms";

export const metadata = { title: "Join a league" };

export default async function JoinPage() {
  await requireUser();
  return <JoinForm />;
}
