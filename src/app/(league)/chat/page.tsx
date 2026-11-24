import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ChatIndex() {
  redirect("/chat/general");
}
