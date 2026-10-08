"use client";

import { useState, useEffect } from "react";
import { Check, Loader2, Lock, Save } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { userInitials } from "@/lib/utils";

interface ConfigItem {
  clave: string;
  valor: string;
  tipo: string;
  descripcion: string;
}

export default function ConfiguracionPage() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [userData, setUserData] = useState<{ name: string; email: string; role: string } | null>(null);

  const getVal = (clave: string) => config[clave] ?? "";

  const setVal = (clave: string, valor: string) => {
    setConfig((prev) => ({ ...prev, [clave]: valor }));
    setHasChanges(true);
    setSaved(false);
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const [configRes, meRes] = await Promise.all([
          fetch("/api/configuracion"),
          fetch("/api/me"),
        ]);

        if (configRes.ok) {
          const data: ConfigItem[] = await configRes.json();
          const map: Record<string, string> = {};
          data.forEach((item) => {
            map[item.clave] = item.valor;
          });
          setConfig(map);
        }

        if (meRes.ok) {
          const { user } = await meRes.json();
          if (user) {
            setUserData({
              name: user.name,
              email: user.email,
              role: user.role ?? "usuario",
            });
          }
        }
      } catch (err) {
        console.error("Error loading config:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");

    try {
      for (const [clave, valor] of Object.entries(config)) {
        await fetch("/api/configuracion", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clave, valor }),
        });
      }
      setSaved(true);
      setHasChanges(false);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError("Error al guardar la configuracion");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const userRole = userData?.role ?? "usuario";

  if (userRole !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
          <Lock size={32} className="text-muted-foreground" />
        </div>
        <h2 className="mt-6 text-xl font-bold text-foreground">Sin acceso</h2>
        <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
          No tienes permisos para acceder a la configuracion. Contacta al administrador.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Configuracion"
        subtitle="Ajustes generales del sistema de inventario"
      />

      {error && (
        <div className="mb-4 rounded-lg border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {saved && (
        <div className="mb-4 rounded-lg border border-success/20 bg-success-soft px-4 py-3 text-sm text-success">
          <Check size={14} className="mr-1 inline" />
          Configuracion guardada correctamente
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Datos de la Empresa</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Nombre de la Empresa">
                  <Input
                    value={getVal("empresa_nombre")}
                    onChange={(e) => setVal("empresa_nombre", e.target.value)}
                  />
                </Field>
                <Field label="RIF">
                  <Input
                    value={getVal("empresa_nit")}
                    onChange={(e) => setVal("empresa_nit", e.target.value)}
                  />
                </Field>
                <Field label="Direccion">
                  <Input
                    value={getVal("empresa_direccion")}
                    onChange={(e) => setVal("empresa_direccion", e.target.value)}
                  />
                </Field>
                <Field label="Ciudad">
                  <Input
                    value={getVal("empresa_ciudad")}
                    onChange={(e) => setVal("empresa_ciudad", e.target.value)}
                  />
                </Field>
                <Field label="Telefono">
                  <Input
                    value={getVal("empresa_telefono")}
                    onChange={(e) => setVal("empresa_telefono", e.target.value)}
                  />
                </Field>
                <Field label="Correo">
                  <Input
                    type="email"
                    value={getVal("empresa_email")}
                    onChange={(e) => setVal("empresa_email", e.target.value)}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Configuracion de Inventario</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-foreground">Existencias mínimas por defecto</span>
                <Input
                  type="number"
                  value={getVal("inventario_stock_minimo")}
                  onChange={(e) => setVal("inventario_stock_minimo", e.target.value)}
                  className="w-32"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-foreground">Metodo de costeo</span>
                <Select
                  value={getVal("inventario_metodo_costeo")}
                  onChange={(e) => setVal("inventario_metodo_costeo", e.target.value)}
                  className="w-64"
                >
                  <option value="FIFO">FIFO (Primeras entradas, primeras salidas)</option>
                  <option value="LIFO">LIFO (Ultimas entradas, primeras salidas)</option>
                  <option value="Promedio">Promedio ponderado</option>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-foreground">Alertas de existencias bajas</span>
                <div className="flex items-center gap-2">
                  <Switch
                    defaultChecked={getVal("inventario_alertas_stock") === "true"}
                    onCheckedChange={(checked) =>
                      setVal("inventario_alertas_stock", checked ? "true" : "false")
                    }
                  />
                  <span className="text-xs text-muted-foreground">
                    {getVal("inventario_alertas_stock") === "true" ? "Activado" : "Desactivado"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Perfil de Usuario</CardTitle>
            </CardHeader>
            <CardContent>
              {userData && (
                <>
                  <div className="mb-4 flex flex-col items-center gap-3">
                    <Avatar initials={userInitials(userData.name)} size="lg" />
                    <div className="text-center">
                      <div className="text-sm font-semibold">{userData.name}</div>
                      <div className="text-xs capitalize text-muted-foreground">{userData.role}</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Input defaultValue={userData.email} disabled />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Informacion del Sistema</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Tecnología</span>
                <span className="font-mono font-medium text-foreground">Next.js 16</span>
              </div>
              <div className="flex justify-between">
                <span>Base de datos</span>
                <span className="font-mono font-medium text-foreground">PostgreSQL</span>
              </div>
              <div className="flex justify-between">
                <span>Autenticacion</span>
                <span className="font-mono font-medium text-foreground">Better Auth</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button size="lg" onClick={handleSave} disabled={!hasChanges || saving}>
          {saving ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Guardando...
            </>
          ) : saved ? (
            <>
              <Check size={14} /> Guardado
            </>
          ) : (
            <>
              <Save size={14} /> Guardar Cambios
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
