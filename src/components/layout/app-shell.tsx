"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, LogOut } from "lucide-react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { ToastProvider } from "@/components/ui/toast";
import { Avatar } from "@/components/ui/avatar";
import { signOut } from "@/lib/auth-client";
import { userInitials } from "@/lib/utils";

export interface AppUser {
  name: string;
  email: string;
  role: string;
}

export function AppShell({ children, user }: { children: React.ReactNode; user: AppUser }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  // El POS es una pantalla de una sola columna: sin sidebar, con su propio
  // header mínimo (el logo de PosBit regresa al resto del sistema).
  const esPOS = typeof pathname === "string" && (pathname === "/pos" || pathname.startsWith("/pos/"));

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        {!esPOS && <Sidebar open={sidebarOpen} user={user} />}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {esPOS ? (
            <header className="relative flex h-14 flex-shrink-0 items-center gap-3 border-b border-border bg-card px-4 print:hidden">
              <span className="absolute bottom-0 left-0 h-[3px] w-16 rounded-tr bg-primary" />

              <Link
                href="/dashboard"
                title="Volver al sistema"
                aria-label="Volver al sistema"
                className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-muted"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-sm font-black text-primary-foreground">
                  P
                </span>
                <span className="text-sm font-bold tracking-tight text-foreground">PosBit</span>
              </Link>

              <ChevronRight size={12} className="text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">Punto de Venta</span>

              <div className="flex-1" />

              <div className="flex items-center gap-2.5">
                <div className="hidden min-w-0 text-right sm:block">
                  <div className="truncate text-xs font-semibold text-foreground">{user.name}</div>
                  <div className="truncate text-[10px] capitalize text-muted-foreground">{user.role}</div>
                </div>
                <Avatar initials={userInitials(user.name)} size="md" />
                <button
                  onClick={handleSignOut}
                  aria-label="Cerrar sesión"
                  title="Cerrar sesión"
                  className="flex-shrink-0 cursor-pointer text-muted-foreground/60 transition-colors hover:text-foreground"
                >
                  <LogOut size={15} />
                </button>
              </div>
            </header>
          ) : (
            <Topbar user={user} onToggleSidebar={() => setSidebarOpen((o) => !o)} />
          )}
          <main className="flex-1 overflow-y-auto p-5">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
