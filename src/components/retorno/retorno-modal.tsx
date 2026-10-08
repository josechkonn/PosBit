"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fmt } from "@/lib/format";

interface Producto {
  id: number;
  codigo: string;
  nombre: string;
  stock: number;
}

interface Venta {
  id: number;
  numero: string;
  cliente_nombre?: string | null;
  cliente?: string | null;
}

interface Compra {
  id: number;
  numero: string;
  proveedor_nombre?: string | null;
}

interface ItemSeleccionado {
  producto_id: number;
  cantidad: number;
}

interface RetornoModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  initialTipo?: "Cliente" | "Proveedor";
  initialVentaId?: number;
  initialCompraId?: number;
}

export function RetornoModal({ open, onClose, onSuccess, initialTipo, initialVentaId, initialCompraId }: RetornoModalProps) {
  const [tipo, setTipo] = useState("Cliente");
  const [clienteId, setClienteId] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [ventaId, setVentaId] = useState("");
  const [compraId, setCompraId] = useState("");
  const [abonarCredito, setAbonarCredito] = useState(true);
  const [fecha, setFecha] = useState("");
  const [motivo, setMotivo] = useState("");

  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [items, setItems] = useState<ItemSeleccionado[]>([]);

  const [productos, setProductos] = useState<Producto[]>([]);
  const [clientes, setClientes] = useState<{ id: number; nombre: string }[]>([]);
  const [proveedores, setProveedores] = useState<{ id: number; nombre: string }[]>([]);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setTipo(initialTipo || "Cliente");
      setClienteId("");
      setProveedorId("");
      setVentaId(initialVentaId ? String(initialVentaId) : "");
      setCompraId(initialCompraId ? String(initialCompraId) : "");
      setAbonarCredito(true);
      setFecha(new Date().toISOString().split("T")[0]);
      setMotivo("");
      setProductoId("");
      setCantidad("1");
      setItems([]);
      setError("");

      Promise.all([
        fetch("/api/productos?limit=100").then((r) => r.json()),
        fetch("/api/clientes?limit=500&activos=true").then((r) => r.json()),
        fetch("/api/proveedores?limit=100").then((r) => r.json()),
        fetch("/api/ventas").then((r) => r.json()),
        fetch("/api/compras").then((r) => r.json()),
      ]).then(([prodData, cliData, provData, ventasData, comprasData]) => {
        setProductos(prodData.productos || []);
        setClientes((cliData.data || []).filter((c: any) => c.activo !== false));
        setProveedores((provData.data || []).filter((p: any) => p.activo !== false));
        setVentas(ventasData.ventas || []);
        setCompras(comprasData.compras || []);
      }).catch(() => setError("No se pudieron cargar los datos"));
    }
  }, [open]);

  const addItem = () => {
    if (!productoId || !parseInt(cantidad, 10) || parseInt(cantidad, 10) <= 0) return;
    const producto = productos.find((p) => p.id === parseInt(productoId, 10));
    if (!producto) return;

    setItems((prev) => {
      const exists = prev.find((i) => i.producto_id === producto.id);
      if (exists) {
        return prev.map((i) =>
          i.producto_id === producto.id ? { ...i, cantidad: i.cantidad + parseInt(cantidad, 10) } : i
        );
      }
      return [...prev, { producto_id: producto.id, cantidad: parseInt(cantidad, 10) }];
    });
    setCantidad("1");
    setProductoId("");
  };

  const removeItem = (productoId: number) => {
    setItems((prev) => prev.filter((i) => i.producto_id !== productoId));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError("");

    try {
      const body: any = {
        tipo,
        fecha,
        motivo: motivo || null,
        items,
      };
      if (tipo === "Cliente") {
        body.cliente_id = clienteId ? parseInt(clienteId, 10) : null;
        body.venta_id = ventaId ? parseInt(ventaId, 10) : null;
        body.abonar_credito = abonarCredito;
      } else {
        body.proveedor_id = proveedorId ? parseInt(proveedorId, 10) : null;
        body.compra_id = compraId ? parseInt(compraId, 10) : null;
      }

      const res = await fetch("/api/retornos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al registrar retorno");
      const montoMsg =
        data?.total_moneda !== undefined && data?.total_moneda !== null
          ? ` — ${fmt(data.total_moneda, data.moneda_codigo || "USD")}`
          : "";
      onSuccess(`Retorno ${tipo} registrado exitosamente${montoMsg}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  const itemsConProducto = items.map((i) => {
    const p = productos.find((x) => x.id === i.producto_id);
    return { ...i, nombre: p?.nombre || `Producto #${i.producto_id}`, codigo: p?.codigo || "" };
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo Retorno"
      className="max-w-2xl w-[90vw]"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={loading || items.length === 0}
            className="flex-1"
          >
            {loading ? "Registrando..." : "Registrar Retorno"}
          </Button>
        </>
      }
    >
      {error && (
        <div className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <Field label="Tipo de retorno">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="Cliente">Retorno de Cliente (producto devuelto a la bodega)</option>
            <option value="Proveedor">Devolución a Proveedor (producto que sale a devolver)</option>
          </Select>
        </Field>

        {tipo === "Cliente" ? (
          <>
            <Field label="Cliente">
              <Select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
                <option value="">Consumidor Final / Sin cliente</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </Select>
            </Field>
            <Field label="Venta de referencia (opcional)">
              <Select value={ventaId} onChange={(e) => setVentaId(e.target.value)}>
                <option value="">Sin venta asociada</option>
                {ventas.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.numero} — {v.cliente_nombre || v.cliente || "Consumidor Final"}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <div className="text-sm">
                <span className="font-medium">Abonar al crédito de la venta</span>
                <p className="text-xs text-muted-foreground">Descuenta el monto devuelto de la deuda del cliente</p>
              </div>
              <Switch checked={abonarCredito} onCheckedChange={setAbonarCredito} disabled={!ventaId} />
            </div>
          </>
        ) : (
          <>
            <Field label="Proveedor">
              <Select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
                <option value="">Selecciona un proveedor</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </Select>
            </Field>
            <Field label="Compra de referencia (opcional)">
              <Select value={compraId} onChange={(e) => setCompraId(e.target.value)}>
                <option value="">Sin compra asociada</option>
                {compras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.numero} — {c.proveedor_nombre || "Proveedor"}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha">
            <Input value={fecha} onChange={(e) => setFecha(e.target.value)} type="date" />
          </Field>
          <Field label="Motivo (opcional)">
            <Input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: producto dañado, mal cálculo..."
              maxLength={500}
            />
          </Field>
        </div>

        <div className="rounded-lg border border-border/60 p-3">
          <p className="mb-2 text-sm font-semibold text-foreground">Productos</p>
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-6">
              <Select value={productoId} onChange={(e) => setProductoId(e.target.value)}>
                <option value="">Selecciona un producto</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.codigo} — {p.nombre} (existencias: {p.stock})
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-3">
              <Input
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                type="number"
                min={1}
                placeholder="Cant."
              />
            </div>
            <div className="col-span-3">
              <Button variant="outline" className="w-full" onClick={addItem} disabled={!productoId}>
                <Plus size={13} /> Agregar
              </Button>
            </div>
          </div>

          {itemsConProducto.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {itemsConProducto.map((i) => (
                <div
                  key={i.producto_id}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium">{i.nombre}</span>
                    {i.codigo && <span className="ml-2 font-mono text-xs text-muted-foreground">{i.codigo}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold">x{i.cantidad}</span>
                    <button
                      onClick={() => removeItem(i.producto_id)}
                      className="text-red-400 hover:text-red-500"
                      aria-label="Quitar"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
