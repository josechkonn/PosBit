"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Cloud,
  Check,
  AlertTriangle,
  Loader2,
  RefreshCw,
  ArrowUpFromLine,
  ArrowDownToLine,
  Smartphone,
  Server,
  PlugZap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface SyncConfigState {
  dispositivo_id: string;
  nombre_dispositivo: string;
  modo_conexion: "desactivado" | "api_nube" | "db_directa";
  cloud_url: string;
  cloud_api_key: string;
  cloud_database_url: string;
  auto_sync: boolean;
  intervalo_segundos: number;
  ultima_sincronizacion_push: string | null;
  ultima_sincronizacion_pull: string | null;
  ultimo_estado: string;
  ultimo_error: string | null;
  es_nube_central?: boolean;
}

interface HistorialItem {
  id: string;
  fecha: string;
  direccion: string;
  registros_subidos: number;
  registros_bajados: number;
  estado: string;
  detalle: string;
  duracion_ms: number;
}

export function CloudSyncCard() {
  const [cfg, setCfg] = useState<SyncConfigState>({
    dispositivo_id: "",
    nombre_dispositivo: "Caja Principal",
    modo_conexion: "desactivado",
    cloud_url: "",
    cloud_api_key: "",
    cloud_database_url: "",
    auto_sync: true,
    intervalo_segundos: 30,
    ultima_sincronizacion_push: null,
    ultima_sincronizacion_pull: null,
    ultimo_estado: "sin_configurar",
    ultimo_error: null,
  });

  const [pendingCount, setPendingCount] = useState(0);
  const [historial, setHistorial] = useState<HistorialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncAction, setSyncAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tipo: "success" | "error"; texto: string } | null>(
    null
  );

  const loadSyncConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/sync/config");
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setCfg({
            dispositivo_id: data.config.dispositivo_id || "",
            nombre_dispositivo: data.config.nombre_dispositivo || "Caja Principal",
            modo_conexion: data.config.modo_conexion || "desactivado",
            cloud_url: data.config.cloud_url || "",
            cloud_api_key: data.config.cloud_api_key || "",
            cloud_database_url: data.config.cloud_database_url || "",
            auto_sync: data.config.auto_sync !== false,
            intervalo_segundos: Number(data.config.intervalo_segundos) || 30,
            ultima_sincronizacion_push: data.config.ultima_sincronizacion_push,
            ultima_sincronizacion_pull: data.config.ultima_sincronizacion_pull,
            ultimo_estado: data.config.ultimo_estado || "sin_configurar",
            ultimo_error: data.config.ultimo_error || null,
            es_nube_central: Boolean(data.config.es_nube_central),
          });
        }
        setPendingCount(data.pending?.totalPendientes ?? 0);
        setHistorial(Array.isArray(data.historial) ? data.historial : []);
      }
    } catch {
      // Ignorar errores de carga inicial
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSyncConfig();
  }, [loadSyncConfig]);

  const handleSaveConfig = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/sync/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar la configuración");
      setFeedback({
        tipo: "success",
        texto: "Configuración de sincronización en la nube guardada correctamente.",
      });
      await loadSyncConfig();
    } catch (err: any) {
      setFeedback({
        tipo: "error",
        texto: err?.message || "Error al guardar la configuración de nube",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test_connection",
          modo_conexion: cfg.modo_conexion,
          cloud_url: cfg.cloud_url,
          cloud_api_key: cfg.cloud_api_key,
          cloud_database_url: cfg.cloud_database_url,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "No se pudo establecer conexión con la nube");
      }
      setFeedback({ tipo: "success", texto: data.mensaje });
    } catch (err: any) {
      setFeedback({
        tipo: "error",
        texto: err?.message || "Error al probar conexión",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleRunSync = async (action: "sync_now" | "push_all" | "pull_all") => {
    setSyncAction(action);
    setFeedback(null);
    try {
      // Primero guardamos la configuración vigente para asegurarnos de usar las credenciales actuales
      await fetch("/api/sync/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });

      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || data.mensaje || "Error durante la sincronización");
      }
      setFeedback({
        tipo: "success",
        texto: `${data.mensaje} (${data.duracion_ms} ms)`,
      });
      await loadSyncConfig();
    } catch (err: any) {
      setFeedback({
        tipo: "error",
        texto: err?.message || "Error al sincronizar con la nube",
      });
      await loadSyncConfig();
    } finally {
      setSyncAction(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 size={18} className="animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Cloud size={16} className="text-primary" />
            Sincronización Nube, Multi-PC y App Móvil (Offline-First)
          </span>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
              cfg.es_nube_central
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : cfg.modo_conexion === "desactivado"
                  ? "bg-muted text-muted-foreground"
                  : cfg.ultimo_estado === "error"
                    ? "bg-danger/10 text-danger"
                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            )}
          >
            {cfg.es_nube_central
              ? "Servidor Nube Central"
              : cfg.modo_conexion === "desactivado"
                ? "Solo Local"
                : cfg.ultimo_estado === "error"
                  ? "Error de conexión"
                  : "Activo"}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {cfg.es_nube_central && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-foreground">
            <div className="flex items-center gap-2 font-semibold text-emerald-600 dark:text-emerald-400">
              <Check size={14} />
              Estás directamente en el Servidor PosBit Cloud (Base de Datos Central en Tiempo Real)
            </div>
            <p className="mt-1 text-muted-foreground">
              En esta página web todos tus productos, ventas y precios ya están guardados directamente en la nube (Supabase).
              Para conectar tus <strong>PCs de Escritorio</strong> o la <strong>App Móvil</strong> a esta nube, usa en esos equipos el modo{" "}
              <strong>Servidor PosBit Cloud (API HTTPS)</strong> con la URL:{" "}
              <code className="rounded bg-background px-1.5 py-0.5 font-mono text-foreground">
                {typeof window !== "undefined" ? window.location.origin : "https://pos-bit-pi.vercel.app"}
              </code>
            </p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Este equipo trabaja siempre sobre su base de datos local (nunca se detiene si se corta el
          internet). Al activar la nube, sincroniza automáticamente ventas, inventario, precios y
          clientes con otras computadoras y con la App Móvil Expo.
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Nombre de esta Computadora / Caja">
            <Input
              value={cfg.nombre_dispositivo}
              onChange={(e) => setCfg({ ...cfg, nombre_dispositivo: e.target.value })}
              placeholder="Ej. Caja 1 - Tienda Centro, Laptop Dueño..."
            />
          </Field>

          <Field label="Modo de Conexión a la Nube">
            <Select
              value={cfg.modo_conexion}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  modo_conexion: e.target.value as SyncConfigState["modo_conexion"],
                })
              }
            >
              <option value="desactivado">Desactivado (Solo Base de Datos Local)</option>
              <option value="db_directa">
                PostgreSQL en la Nube Directo (Supabase / Neon / Railway)
              </option>
              <option value="api_nube">
                Servidor PosBit Cloud (API HTTPS + App Móvil Expo)
              </option>
            </Select>
          </Field>
        </div>

        {cfg.modo_conexion === "db_directa" && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Server size={14} className="text-primary" />
              Conexión a Base de Datos PostgreSQL en la Nube
            </div>
            <p className="text-xs text-muted-foreground">
              Pega la cadena de conexión (`DATABASE_URL`) de tu proyecto en{" "}
              <strong>Supabase</strong>, <strong>Neon.tech</strong> o <strong>Railway</strong>.
              Todas las computadoras que usen esta misma URL compartirán los datos automáticamente.
            </p>
            <Field label="URL de PostgreSQL en la Nube (Connection String)">
              <Input
                type="password"
                value={cfg.cloud_database_url}
                onChange={(e) => setCfg({ ...cfg, cloud_database_url: e.target.value })}
                placeholder="postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres"
              />
            </Field>
          </div>
        )}

        {cfg.modo_conexion === "api_nube" && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Smartphone size={14} className="text-primary" />
              Conexión vía API PosBit Cloud (Compatible con App Móvil APK y Multi-PC)
            </div>
            <p className="text-xs text-muted-foreground">
              Conecta esta computadora y la aplicación móvil Expo a tu servidor PosBit desplegado en
              la nube mediante HTTPS seguro.
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="URL del Servidor en la Nube">
                <Input
                  value={cfg.cloud_url}
                  onChange={(e) => setCfg({ ...cfg, cloud_url: e.target.value })}
                  placeholder="https://mi-posbit.up.railway.app"
                />
              </Field>
              <Field label="Clave Secreta de Sincronización (API Key / Token)">
                <Input
                  type="password"
                  value={cfg.cloud_api_key}
                  onChange={(e) => setCfg({ ...cfg, cloud_api_key: e.target.value })}
                  placeholder="Clave definida en CLOUD_SYNC_SECRET"
                />
              </Field>
            </div>
          </div>
        )}

        {cfg.modo_conexion !== "desactivado" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-3">
              <div>
                <span className="text-sm text-foreground">
                  Sincronización automática en segundo plano
                </span>
                <p className="text-xs text-muted-foreground">
                  Sincroniza sola cuando hay internet y al instante cuando vuelve la conexión tras
                  un corte.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={cfg.auto_sync}
                  onCheckedChange={(checked) => setCfg({ ...cfg, auto_sync: checked })}
                />
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Cada</span>
                  <Input
                    type="number"
                    min="5"
                    max="3600"
                    value={String(cfg.intervalo_segundos)}
                    onChange={(e) =>
                      setCfg({ ...cfg, intervalo_segundos: Math.max(5, Number(e.target.value) || 30) })
                    }
                    className="w-20"
                  />
                  <span className="text-xs text-muted-foreground">seg</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing || saving || Boolean(syncAction)}
              >
                {testing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <PlugZap size={14} />
                )}
                Probar Conexión
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={() => handleRunSync("sync_now")}
                disabled={testing || saving || Boolean(syncAction)}
              >
                {syncAction === "sync_now" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Sincronizar Ahora ({pendingCount} pendientes)
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRunSync("push_all")}
                disabled={testing || saving || Boolean(syncAction)}
                title="Sube todo el catálogo, clientes y ventas de esta PC para inicializar la base de datos en la nube"
              >
                {syncAction === "push_all" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ArrowUpFromLine size={14} />
                )}
                Subir Todo a la Nube
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRunSync("pull_all")}
                disabled={testing || saving || Boolean(syncAction)}
                title="Descarga todos los datos desde la nube hacia esta computadora (ideal al instalar en una 2da PC)"
              >
                {syncAction === "pull_all" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ArrowDownToLine size={14} />
                )}
                Descargar Todo de la Nube
              </Button>
            </div>
          </>
        )}

        <div className="flex items-center justify-between border-t pt-3">
          <div className="text-[11px] text-muted-foreground">
            ID Dispositivo:{" "}
            <span className="font-mono text-foreground">
              {cfg.dispositivo_id ? cfg.dispositivo_id.slice(0, 13) + "..." : "local"}
            </span>
          </div>
          <Button size="sm" onClick={handleSaveConfig} disabled={saving}>
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Guardando...
              </>
            ) : (
              <>
                <Check size={14} /> Guardar Ajustes de Nube
              </>
            )}
          </Button>
        </div>

        {feedback && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border p-2.5 text-xs",
              feedback.tipo === "success"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-danger/20 bg-danger/10 text-danger"
            )}
          >
            {feedback.tipo === "success" ? (
              <Check size={14} className="mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            )}
            <span>{feedback.texto}</span>
          </div>
        )}

        {historial.length > 0 && (
          <div className="border-t pt-3">
            <h4 className="mb-2 text-xs font-semibold text-foreground">
              Últimas Sincronizaciones
            </h4>
            <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1 text-[11px]">
              {historial.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded border border-border/60 bg-muted/20 px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        item.estado === "ok" ? "bg-emerald-500" : "bg-danger"
                      )}
                    />
                    <span className="font-medium capitalize text-foreground">{item.direccion}</span>
                    <span className="text-muted-foreground">
                      (↑{item.registros_subidos} · ↓{item.registros_bajados})
                    </span>
                  </div>
                  <span className="text-muted-foreground">
                    {new Date(item.fecha).toLocaleTimeString("es-VE", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}{" "}
                    · {item.duracion_ms}ms
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
