import { AppShell } from "@/components/layout/app-shell";
import { requireSession } from "@/lib/auth-server";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const { user } = session;

  return (
    <ConfirmProvider>
      <AppShell
        user={{
          name: user.name,
          email: user.email,
          role: (user as { role?: string }).role ?? "cajero",
        }}
      >
        {children}
      </AppShell>
    </ConfirmProvider>
  );
}
