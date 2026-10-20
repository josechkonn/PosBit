"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  Cloud,
  CloudOff,
  RefreshCw,
  WifiOff,
  CheckCircle2,
  AlertTriangle,
  Settings,
  ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SyncStatusData {
  config: {
    dispositivo_id: string;
    nombre_dispositivo: string;
    modo_conexion: "desactivado" | "api_nube" | "db_directa";
    auto_sync: boolean;
    intervalo_segundos: number;
    ultima_sincronizacion_push: string | null;
    ultima_sincronizacion_pull: string | null;
    ultimo_estado: string;
    ultimo_error: string | null;
  };
  pending: {
    totalPendientes: number;
    porTabla: Record<string, number>;
  };
}

export function CloudSyncBadge() {
  const [isOnline, setIsOnline] = useState(true);
  const [status, setStatus] = useState<SyncStatusData | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sync?action=status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {
      // Silencioso en caso de recarga
    }
  }, []);

  const triggerSync = useCallback(
    async (manual = false) => {
      if (syncingRef.current) return;
      if (!navigator.onLine) {
        if (manual) {
          setLastMessage("Sin conexión a internet. Sigue trabajando en modo local.");
        }
        return;
      }

      syncingRef.current = true;
      setSyncing(true);
      if (manual) setLastMessage(null);

      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync_now" }),
        });
        const data = await res.json();
        if (manual) {
          setLastMessage(data.mensaje || data.error || "Sincronización finalizada");
        }
        await fetchStatus();
      } catch {
        if (manual) {
          setLastMessage("No se pudo conectar con la nube en este momento.");
        }
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    },
    [fetchStatus]
  );

  // Detectar estado de red del sistema operativo / navegador
  useEffect(() => {
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);

    const handleOnline = () => {
      setIsOnline(true);
      setLastMessage("Conexión restablecida. Sincronizando cambios pendientes...");
      triggerSync(false);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setLastMessage("Sin internet: trabajando en base de datos local.");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [triggerSync]);

  // Cargar estado inicial
  useEffect(() => {
    fetchStatus();
    const statusTimer = setInterval(fetchStatus, 15000);
    return () => clearInterval(statusTimer);
  }, [fetchStatus]);

  // Auto-sync periódico cuando está activado y hay internet
  useEffect(() => {
    if (!status?.config) return;
    const { modo_conexion, auto_sync, intervalo_segundos } = status.config;
    if (modo_conexion === "desactivado" || !auto_sync || !isOnline) return;

    const ms = Math.max(10, intervalo_segundos || 30) * 1000;
    const timer = setInterval(() => {
      if (navigator.onLine) {
        triggerSync(false);
      }
    }, ms);

    return () => clearInterval(timer);
  }, [status?.config, isOnline, triggerSync]);

  // Cerrar popover al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const cfg = status?.config;
  const pendientes = status?.pending?.totalPendientes ?? 0;
  const isConfigured = cfg && cfg.modo_conexion !== "desactivado";
  const hasError = isConfigured && cfg?.ultimo_estado === "error";

  const fmtTime = (iso: string | null | undefined) => {
    if (!iso) return "Nunca";
    const d = new Date(iso);
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diffSec < 60) return "Hace instantes";
    if (diffSec < 3600) return `Hace ${Math.floor(diffSec / 60)} min`;
    return d.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div ref={popRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) fetchStatus();
        }}
        title="Estado de Nube y Modo Offline"
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-all",
          !isOnline
            ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
            : syncing
              ? "border-primary/40 bg-primary/10 text-primary"
              : hasError
                ? "border-danger/40 bg-danger/10 text-danger"
                : isConfigured
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
        )}
      >
        {!isOnline ? (
          <WifiOff size={13} className="shrink-0" />
        ) : syncing ? (
          <RefreshCw size={13} className="shrink-0 animate-spin" />
        ) : hasError ? (
          <CloudOff size={13} className="shrink-0" />
        ) : (
          <Cloud size={13} className="shrink-0" />
        )}

        <span className="hidden md:inline">
          {!isOnline
            ? pendientes > 0
              ? `Offline (${pendientes})`
              : "Modo Offline"
            : syncing
              ? "Sincronizando..."
              : hasError
                ? "Error Nube"
                : isConfigured
                  ? pendientes > 0
                    ? `Nube (${pendientes})`
                    : "Sincronizado"
                  : "Modo Local"}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-border bg-card p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-md",
                    !isOnline
                      ? "bg-amber-500/15 text-amber-500"
                      : isConfigured
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {!isOnline ? <WifiOff size={15} /> : <Cloud size={15} />}
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-foreground">
                    {cfg?.nombre_dispositivo || "Caja Principal"}
                  </h4>
                  <p className="text-[11px] text-muted-foreground">
                    {!isOnline
                      ? "Sin internet · Operando localmente"
                      : isConfigured
                        ? cfg?.modo_conexion === "db_directa"
                          ? "Conectado a PostgreSQL Cloud"
                          : "Conectado a PosBit Cloud API"
                        : "Operando solo en base local"}
                  </p>
                </div>
              </div>
              <Link
                href="/configuracion"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Configurar Nube"
              >
                <Settings size={14} />
              </Link>
            </div>

            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-1.5">
                <span className="text-muted-foreground">Cambios locales pendientes</span>
                <span className="font-mono font-semibold text-foreground">{pendientes}</span>
              </div>

              <div className="flex items-center justify-between px-1 text-[11px]">
                <span className="text-muted-foreground">Última subida (Push):</span>
                <span className="font-medium text-foreground">
                  {fmtTime(cfg?.ultima_sincronizacion_push)}
                </span>
              </div>

              <div className="flex items-center justify-between px-1 text-[11px]">
                <span className="text-muted-foreground">Última descarga (Pull):</span>
                <span className="font-medium text-foreground">
                  {fmtTime(cfg?.ultima_sincronizacion_pull)}
                </span>
              </div>

              {cfg?.ultimo_error && (
                <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger/10 p-2 text-[11px] text-danger">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span className="line-clamp-3">{cfg.ultimo_error}</span>
                </div>
              )}

              {lastMessage && (
                <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2 text-[11px] text-foreground">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-primary" />
                  <span>{lastMessage}</span>
                </div>
              )}
            </div>

            <div className="mt-3 flex gap-2 border-t border-border/60 pt-3">
              {isConfigured ? (
                <Button
                  size="sm"
                  className="w-full gap-1.5 text-xs"
                  disabled={syncing || !isOnline}
                  onClick={() => triggerSync(true)}
                >
                  {syncing ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      Sincronizando...
                    </>
                  ) : (
                    <>
                      <ArrowUpDown size={13} />
                      Sincronizar ahora
                    </>
                  )}
                </Button>
              ) : (
                <Link
                  href="/configuracion"
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Settings size={13} />
                  Configurar Sincronización Nube
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
