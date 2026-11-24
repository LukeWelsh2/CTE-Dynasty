import { SignupForm } from "../forms";

export const metadata = { title: "Join the league" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return <SignupForm code={code} />;
}
