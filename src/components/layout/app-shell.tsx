"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { ToastProvider } from "@/components/ui/toast";

export interface AppUser {
  name: string;
  email: string;
  role: string;
}

export function AppShell({ children, user }: { children: React.ReactNode; user: AppUser }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar open={sidebarOpen} user={user} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar user={user} onToggleSidebar={() => setSidebarOpen((o) => !o)} />
          <main className="flex-1 overflow-y-auto p-5">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
