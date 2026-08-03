import { auth } from "@/server/auth";
import { InboxClient } from "./inbox-client";

export default async function InboxPage() {
  const session = await auth();

  return (
    <InboxClient
      currentUserId={session?.user?.id ?? ""}
      isAdmin={session?.user?.role === "OWNER" || session?.user?.role === "SUPERADMIN"}
    />
  );
}
