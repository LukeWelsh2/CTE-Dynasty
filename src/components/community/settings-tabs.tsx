// Tabs for the personal settings area (/settings/*) — server-safe.
import { TabLinks } from "@/components/ui/core";

export function SettingsTabs({ active, userId }: { active: "profile" | "notifications" | "inbox"; userId: string }) {
  return (
    <TabLinks
      active={active}
      tabs={[
        { key: "inbox", label: "Inbox", href: "/notifications" },
        { key: "notifications", label: "Alert settings", href: "/settings/notifications" },
        { key: "profile", label: "Profile & team", href: "/settings/profile" },
        { key: "public", label: "Public profile", href: `/managers/${userId}` },
      ]}
    />
  );
}
