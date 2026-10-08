"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  ChevronRight,
  Menu,
  AlertTriangle,
  AlertCircle,
  TrendingUp,
  ShoppingCart,
} from "lucide-react";
import { pathLabel } from "./nav";
import type { AppUser } from "./app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { userInitials } from "@/lib/utils";

const severityIcon: Record<string, React.ComponentType<{ size: number; className?: string }>> = {
  danger: AlertCircle,
  warning: AlertTriangle,
  info: TrendingUp,
};

interface Notification {
  id: string;
  tipo: "stock" | "venta" | "compra";
  titulo: string;
  mensaje: string;
  severidad: "danger" | "warning" | "info";
  href: string;
  fecha: string;
  leido: boolean;
}

export function Topbar({
  onToggleSidebar,
  user,
}: {
  onToggleSidebar: () => void;
  user: AppUser;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const notifRef = useRef<HTMLDivElement>(null);

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setNotifLoading(true);
    try {
      const res = await fetch("/api/notificaciones");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      }
    } catch {
      console.error("Error loading notifications");
    } finally {
      setNotifLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (href: string) => {
    router.push(href);
    setNotifOpen(false);
  };

  const fmtDate = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Ahora";
    if (mins < 60) return `Hace ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Hace ${hours}h`;
    return date.toLocaleDateString("es-BO", { day: "2-digit", month: "short" });
  };

  return (
    <header className="relative flex h-14 flex-shrink-0 items-center gap-4 border-b border-border bg-card px-4 print:hidden">
      <motion.span
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformOrigin: "left" }}
        className="absolute bottom-0 left-0 h-[3px] w-16 bg-primary"
      />

      <Button
        variant="ghost"
        size="icon-lg"
        onClick={onToggleSidebar}
        aria-label="Alternar menú lateral"
      >
        <Menu size={16} />
      </Button>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="hidden sm:inline">PosBit</span>
        <ChevronRight size={12} />
        <span className="font-medium text-foreground">{pathLabel(pathname)}</span>
      </div>

      <div className="flex-1" />

      {/* Notificaciones */}
      <div ref={notifRef} className="relative">
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={() => {
            setNotifOpen(!notifOpen);
            if (!notifOpen) fetchNotifications();
          }}
          aria-label="Notificaciones"
        >
          <Bell size={15} />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>

        <AnimatePresence>
          {notifOpen && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-border bg-card shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <h3 className="text-sm font-semibold text-foreground">Notificaciones</h3>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">
                    {unreadCount} sin leer
                  </span>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto">
                {notifLoading ? (
                  <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                    Cargando...
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
                    <Bell size={20} className="mb-2 text-muted-foreground/40" />
                    Sin notificaciones
                  </div>
                ) : (
                  <div className="py-1">
                    {notifications.slice(0, 15).map((notif) => {
                      const SevIcon = severityIcon[notif.severidad] ?? Bell;
                      const severityColors: Record<string, string> = {
                        danger: "text-danger bg-danger-soft",
                        warning: "text-warning bg-warning-soft",
                        info: "text-info bg-info-soft",
                      };
                      return (
                        <button
                          key={notif.id}
                          onClick={() => handleSelect(notif.href)}
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent ${
                            !notif.leido ? "bg-muted/30" : ""
                          }`}
                        >
                          <div
                            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded ${severityColors[notif.severidad]}`}
                          >
                            <SevIcon size={14} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{notif.titulo}</span>
                              {!notif.leido && (
                                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                              )}
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">{notif.mensaje}</div>
                            <div className="mt-1 text-[10px] text-muted-foreground/60">
                              {fmtDate(notif.fecha)}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Avatar initials={userInitials(user.name)} size="md" />
    </header>
  );
}
