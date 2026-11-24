// Tabs for the personal settings area (/settings/*) — server-safe.
import { TabLinks } from "@/components/ui/core";

export function SettingsTabs({ active, userId }: { active: "profile" | "notifications" | "inbox"; userId: string }) {
  return (
    <TabLinks
      active={active}
      tabs={[
        { key: "profile", label: "Profile & Team", href: "/settings/profile" },
        { key: "notifications", label: "Notifications & Phone Alerts", href: "/settings/notifications" },
        { key: "inbox", label: "My Notifications", href: "/notifications" },
        { key: "public", label: "View My Public Profile →", href: `/managers/${userId}` },
      ]}
    />
  );
}
