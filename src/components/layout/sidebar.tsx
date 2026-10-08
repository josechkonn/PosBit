"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { LogOut } from "lucide-react";
import { navGroups, getNavGroupsForRole } from "./nav";
import type { AppUser } from "./app-shell";
import { Avatar } from "@/components/ui/avatar";
import { signOut } from "@/lib/auth-client";
import { cn, userInitials } from "@/lib/utils";

export function Sidebar({ open, user }: { open: boolean; user: AppUser }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? 224 : 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={cn(
        "flex flex-shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar print:hidden"
      )}
    >
      <div className="flex h-full w-56 flex-col">
        {/* Marca */}
        <div className="border-b border-sidebar-border px-5 py-5">
          <div>
            <div className="text-sm font-bold leading-tight text-white">PosBit</div>
            <div className="text-[10px] leading-tight text-sidebar-foreground/50">
              Inventario
            </div>
          </div>
        </div>

        {/* Navegación */}
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
          {getNavGroupsForRole(user.role).map((group) => (
            <div key={group.label}>
              <div className="mb-2 flex items-center gap-2 px-2">
                <span className="h-px flex-1 bg-sidebar-border/60" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-sidebar-foreground/40">
                  {group.label}
                </span>
                <span className="h-px flex-1 bg-sidebar-border/60" />
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "relative flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-sm transition-colors",
                        active
                          ? "font-medium text-white"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="sidebar-active"
                          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-primary"
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        />
                      )}
                      <item.icon size={15} className="flex-shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Usuario + cerrar sesión */}
        <div className="border-t border-sidebar-border px-3 py-4">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-accent">
            <Avatar initials={userInitials(user.name)} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-white">{user.name}</div>
              <div className="truncate text-[10px] capitalize text-sidebar-foreground/50">
                {user.role}
              </div>
            </div>
            <button
              onClick={handleSignOut}
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
              className="flex-shrink-0 cursor-pointer text-sidebar-foreground/40 transition-colors hover:text-white"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </div>
    </motion.aside>
  );
}
