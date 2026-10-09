"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { CategoriaModal } from "@/components/categoria/categoria-modal";
import { MarcaModal } from "@/components/marca/marca-modal";
import { ProveedorModal } from "@/components/proveedor/proveedor-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { fmt, fmtDateTime } from "@/lib/format";
import { convertir, redondear } from "@/lib/money";

interface Moneda {
  id: string;
  codigo: string;
  simbolo: string;
  tasa: number | string;
  tasa_ref_moneda_id?: string | null;
  decimales: number;
  es_base: boolean;
  activo?: boolean;
}

interface Producto {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  imagen: string | null;
  categoria_id: string | null;
  marca_id: string | null;
  moneda_base_id?: string | null;
  moneda_costo_id?: string | null;
  stock: number;
  stock_minimo: number;
  activo: boolean;
  iva_incluido: boolean;
  precio_base: number;
  costo_base: number;
  categoria_nombre: string | null;
  marca_nombre: string | null;
  precios: Array<{
    moneda_id: string;
    moneda_codigo: string;
    moneda_simbolo: string;
    precio: number;
    costo: number;
    es_base: boolean;
  }>;
}

interface Categoria {
  id: string;
  nombre: string;
}

interface Marca {
  id: string;
  nombre: string;
}

interface Proveedor {
  id: string;
  nombre: string;
}

type ProductoModalMode = "create" | "edit" | "view" | "delete";

interface ProductoModalProps {
  open: boolean;
  mode: ProductoModalMode;
  producto: Producto | null;
  monedas: Moneda[];
  defaultProveedorId?: string | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const STEPS = [
  { id: 1, label: "Información" },
  { id: 2, label: "Precios" },
  { id: 3, label: "Existencias" },
];

export function ProductoModal({ open, mode, producto, monedas: monedasProp, defaultProveedorId, onClose, onSuccess }: ProductoModalProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [internalMonedas, setInternalMonedas] = useState<Moneda[]>([]);
  const [loadingMonedas, setLoadingMonedas] = useState(false);
  // Modal anidado abierto desde el "+" (categoría, marca o proveedor)
  const [modalAnidado, setModalAnidado] = useState<"categoria" | "marca" | "proveedor" | null>(null);

  // Combine prop currencies or loaded fallback currencies
  const effectiveMonedas = useMemo(() => {
    if (monedasProp && monedasProp.length > 0) return monedasProp;
    return internalMonedas;
  }, [monedasProp, internalMonedas]);

  // Form fields
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [imagen, setImagen] = useState<string | null>(null);
  const [categoriaId, setCategoriaId] = useState("");
  const [marcaId, setMarcaId] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [stock, setStock] = useState(0);
  const [stockMinimo, setStockMinimo] = useState(5);
  const [activo, setActivo] = useState(true);
  const [ivaIncluido, setIvaIncluido] = useState(true);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);

  // Pricing: cada moneda tiene su precio de venta y su precio de compra. La
  // moneda de VENTA y la de COMPRA se eligen por separado (p. ej. costo en USD
  // y precio de venta en COP): `moneda_base_id` / `moneda_costo_id`.
  interface PrecioEntry {
    precioVenta: string;
    precioCompra: string;
  }
  const [preciosPorMoneda, setPreciosPorMoneda] = useState<Record<string, PrecioEntry>>({});
  const [ventaMonedaId, setVentaMonedaId] = useState<string | null>(null);
  const [costoMonedaId, setCostoMonedaId] = useState<string | null>(null);

  const ventaMoneda = useMemo(
    () => effectiveMonedas.find((m) => m.id === ventaMonedaId),
    [effectiveMonedas, ventaMonedaId]
  );
  const costoMoneda = useMemo(
    () => effectiveMonedas.find((m) => m.id === costoMonedaId),
    [effectiveMonedas, costoMonedaId]
  );

  /**
   * Re-calcula `field` en TODAS las monedas a partir de la moneda de referencia
   * indicada. Los precios se derivan con `convertir` (respeta la arista directa
   * de referencia, p. ej. COP ↔ BS = 3.2, en modo directo).
   * `limpiar`: si el valor de la referencia está vacío, ¿poner "" en las demás?
   */
  const derivarCampo = (
    field: "precioVenta" | "precioCompra",
    refId: string | null,
    valor: number,
    limpiar: boolean
  ) => {
    if (!refId) return;
    const refMoneda = effectiveMonedas.find((m) => m.id === refId);
    if (!refMoneda) return;

    setPreciosPorMoneda((prev) => {
      const next = { ...prev };
      for (const m of effectiveMonedas) {
        if (m.id === refId) continue;
        const dec = m.decimales ?? 2;
        const current = prev[m.id] || { precioVenta: "", precioCompra: "" };
        const nuevo =
          valor > 0
            ? convertir(valor, refMoneda, m, effectiveMonedas, dec).toFixed(dec)
            : limpiar
              ? ""
              : current[field];
        next[m.id] =
          field === "precioVenta" ? { ...current, precioVenta: nuevo } : { ...current, precioCompra: nuevo };
      }
      return next;
    });
  };

  /** Cambia la moneda de referencia de VENTA y rederiva los precios de venta. */
  const cambiarVentaRef = (monedaId: string) => {
    setVentaMonedaId(monedaId);
    const valor = parseFloat(preciosPorMoneda[monedaId]?.precioVenta || "") || 0;
    derivarCampo("precioVenta", monedaId, valor, false);
  };

  /** Cambia la moneda de referencia de COMPRA y rederiva los precios de compra. */
  const cambiarCostoRef = (monedaId: string) => {
    setCostoMonedaId(monedaId);
    const valor = parseFloat(preciosPorMoneda[monedaId]?.precioCompra || "") || 0;
    derivarCampo("precioCompra", monedaId, valor, false);
  };

  /**
   * El precio de compra y el de venta pueden estar en monedas distintas: para
   * compararlos (regla "compra ≤ venta") se convierte el costo a la moneda de
   * venta con las tasas actuales.
   */
  const compraEnVentaMoneda = (compra: number): number => {
    if (!costoMoneda || !ventaMoneda) return compra;
    return convertir(compra, costoMoneda, ventaMoneda, effectiveMonedas, Number(ventaMoneda.decimales ?? 2));
  };

  const actualizarPrecio = (monedaId: string, field: "precioVenta" | "precioCompra", value: string) => {
    setPreciosPorMoneda((prev) => ({
      ...prev,
      [monedaId]: { ...prev[monedaId], [field]: value },
    }));

    // Solo la moneda de REFERENCIA de ese campo redera las demás monedas
    const esReferencia =
      (field === "precioVenta" && monedaId === ventaMonedaId) ||
      (field === "precioCompra" && monedaId === costoMonedaId);
    if (!esReferencia) return;

    derivarCampo(field, monedaId, parseFloat(value) || 0, true);
  };

  // Load categories, brands, and fallback currencies
  const cargarCategorias = async (): Promise<Categoria[]> => {
    try {
      const data = await fetch("/api/categorias").then((r) => r.json());
      const lista: Categoria[] = Array.isArray(data) ? data : [];
      setCategorias(lista);
      return lista;
    } catch {
      return [];
    }
  };

  const cargarMarcas = async (): Promise<Marca[]> => {
    try {
      const data = await fetch("/api/marcas").then((r) => r.json());
      const lista: Marca[] = Array.isArray(data) ? data : [];
      setMarcas(lista);
      return lista;
    } catch {
      return [];
    }
  };

  const cargarProveedores = async (): Promise<Proveedor[]> => {
    try {
      const data = await fetch("/api/proveedores?page=1&limit=500").then((r) => r.json());
      const lista: Proveedor[] = Array.isArray(data) ? data : data.data || [];
      setProveedores(lista);
      return lista;
    } catch {
      return [];
    }
  };

  // Cierra el modal anidado y regresa al formulario del producto
  const cerrarModalAnidado = () => setModalAnidado(null);

  // Al crear desde el "+": recarga la lista, preselecciona lo nuevo y notifica
  const trasCrearAnidado = async (tipo: "categoria" | "marca" | "proveedor", mensaje: string) => {
    if (tipo === "categoria") {
      const previas = categorias.map((c) => c.id);
      const nueva = (await cargarCategorias()).find((c) => !previas.includes(c.id));
      if (nueva) setCategoriaId(String(nueva.id));
    } else if (tipo === "marca") {
      const previas = marcas.map((m) => m.id);
      const nueva = (await cargarMarcas()).find((m) => !previas.includes(m.id));
      if (nueva) setMarcaId(String(nueva.id));
    } else {
      const previos = proveedores.map((p) => p.id);
      const nueva = (await cargarProveedores()).find((p) => !previos.includes(p.id));
      if (nueva && !defaultProveedorId) setProveedorId(String(nueva.id));
    }
    onSuccess(mensaje);
  };

  useEffect(() => {
    if (open) {
      cargarCategorias();
      cargarMarcas();
      cargarProveedores();
      if (!monedasProp || monedasProp.length === 0) {
        setLoadingMonedas(true);
        fetch("/api/monedas")
          .then((r) => r.json())
          .then((data) => {
            if (Array.isArray(data)) {
              setInternalMonedas(data.filter((m: Moneda) => m.activo !== false));
            }
          })
          .catch(() => {})
          .finally(() => setLoadingMonedas(false));
      }
    }
  }, [open, monedasProp]);

  // Reset form on open
  useEffect(() => {
    if (!open) return;

    setError("");
    setStep(1);
    setModalAnidado(null);

    if (producto && (mode === "edit" || mode === "view")) {
      setCodigo(producto.codigo);
      setNombre(producto.nombre);
      setDescripcion(producto.descripcion || "");
      setImagen(producto.imagen || null);
      setCategoriaId(producto.categoria_id?.toString() || "");
      setMarcaId(producto.marca_id?.toString() || "");
      // @ts-ignore: `proveedor_id` might not be in the Producto interface yet
      setProveedorId(producto.proveedor_id?.toString() || "");
      setStock(producto.stock);
      setStockMinimo(producto.stock_minimo);
      setActivo(producto.activo);
      setIvaIncluido(producto.iva_incluido ?? true);

      // Populate per-currency prices for editing
      const precios: Record<string, { precioVenta: string; precioCompra: string }> = {};
      for (const p of producto.precios || []) {
        precios[p.moneda_id] = {
          precioVenta: p.precio.toString(),
          precioCompra: p.costo.toString(),
        };
      }
      setPreciosPorMoneda(precios);

      // Moneda de referencia de VENTA (precio_base) y de COMPRA (costo_base);
      // sin moneda de compra guardada = misma que la de venta (comportamiento
      // anterior). El costo puede tener su propia moneda.
      const monedaVentaInicial =
        producto.moneda_base_id ||
        producto.precios?.find((p) => p.es_base)?.moneda_id ||
        (effectiveMonedas.length > 0
          ? (effectiveMonedas.find((m) => m.es_base) || effectiveMonedas[0]).id
          : null);
      setVentaMonedaId(monedaVentaInicial);
      setCostoMonedaId(producto.moneda_costo_id || monedaVentaInicial);
    } else if (mode === "create") {
      setCodigo("");
      setNombre("");
      setDescripcion("");
      setImagen(null);
      setPendingImageFile(null);
      setCategoriaId("");
      setMarcaId("");
      setProveedorId(defaultProveedorId?.toString() || "");
      setStock(0);
      setStockMinimo(5);
      setActivo(true);
      setIvaIncluido(true);

      const empty: Record<string, { precioVenta: string; precioCompra: string }> = {};
      for (const m of effectiveMonedas) {
        empty[m.id] = { precioVenta: "", precioCompra: "" };
      }
      setPreciosPorMoneda(empty);

      const defaultBase = effectiveMonedas.find((m) => m.es_base) || effectiveMonedas[0];
      if (defaultBase) {
        setVentaMonedaId(defaultBase.id);
        setCostoMonedaId(defaultBase.id);
      }
    }
  }, [producto, mode, open]);

  // Ensure prices entries and the reference currencies are updated when effectiveMonedas arrives
  useEffect(() => {
    if (!open || effectiveMonedas.length === 0) return;

    setPreciosPorMoneda((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const m of effectiveMonedas) {
        if (!next[m.id]) {
          next[m.id] = { precioVenta: "", precioCompra: "" };
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    const defaultId = () => {
      const defaultBase = effectiveMonedas.find((m) => m.es_base) || effectiveMonedas[0];
      return defaultBase ? defaultBase.id : null;
    };
    setVentaMonedaId((prev) => (prev && effectiveMonedas.some((m) => m.id === prev) ? prev : defaultId()));
    setCostoMonedaId((prev) => (prev && effectiveMonedas.some((m) => m.id === prev) ? prev : defaultId()));
  }, [open, effectiveMonedas]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");

    if (producto?.id) {
      setUploadingImage(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("producto_id", producto.id.toString());

        const res = await fetch("/api/productos/imagen", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al subir la imagen");

        setImagen(data.url);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        setUploadingImage(false);
      }
    } else {
      setImagen(URL.createObjectURL(file));
      setPendingImageFile(file);
    }
  };

  const handleRemoveImage = async () => {
    if (producto?.id) {
      try {
        const res = await fetch(`/api/productos/imagen?producto_id=${producto.id}`, {
          method: "DELETE",
        });

        if (res.ok) {
          setImagen(null);
        }
      } catch (err) {
        console.error("Error removing image:", err);
      }
    } else {
      if (imagen?.startsWith("blob:")) URL.revokeObjectURL(imagen);
      setImagen(null);
      setPendingImageFile(null);
    }
  };

  const validateStep = (s: number): boolean => {
    if (s === 1) {
      if (!codigo.trim()) { setError("El código es requerido"); return false; }
      if (!nombre.trim()) { setError("El nombre es requerido"); return false; }
      return true;
    }
    if (s === 2) {
      if (!ventaMonedaId) { setError("Selecciona una moneda de venta"); return false; }
      if (!costoMonedaId) { setError("Selecciona una moneda de compra"); return false; }
      const entryVenta = preciosPorMoneda[ventaMonedaId];
      const entryCosto = preciosPorMoneda[costoMonedaId];
      if (!entryCosto || entryCosto.precioCompra === "" || parseFloat(entryCosto.precioCompra) < 0) { setError("Ingresa un precio de compra válido para la moneda de compra"); return false; }
      if (!entryVenta || !entryVenta.precioVenta || parseFloat(entryVenta.precioVenta) <= 0) { setError("Ingresa un precio de venta válido para la moneda de venta"); return false; }

      const compra = parseFloat(entryCosto.precioCompra);
      const venta = parseFloat(entryVenta.precioVenta);
      // Cada precio puede estar en una moneda distinta: se comparan convertidos
      if (compraEnVentaMoneda(compra) > venta) {
        setError("El precio de compra no puede ser mayor al precio de venta");
        return false;
      }
      return true;
    }
    return true;
  };

  const nextStep = () => {
    setError("");
    if (validateStep(step)) {
      setStep((s) => Math.min(s + 1, 3));
    }
  };

  const prevStep = () => {
    setError("");
    setStep((s) => Math.max(s - 1, 1));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError("");

    try {
      const body: Record<string, unknown> = {
        codigo,
        nombre,
        descripcion: descripcion || null,
        categoria_id: categoriaId || null,
        marca_id: marcaId || null,
        proveedor_id: proveedorId || null,
        stock,
        stock_minimo: stockMinimo,
        activo,
        iva_incluido: ivaIncluido,
        moneda_base_id: ventaMonedaId,
        moneda_costo_id: costoMonedaId,
      };

      const preciosMap: Record<string, { precio: number; costo: number }> = {};
      for (const m of effectiveMonedas) {
        const entry = preciosPorMoneda[m.id];
        if (entry) {
          preciosMap[m.id] = {
            precio: parseFloat(entry.precioVenta) || 0,
            costo: parseFloat(entry.precioCompra) || 0,
          };
        }
      }
      body.precios = preciosMap;

      const ventaEntry = ventaMonedaId ? preciosPorMoneda[ventaMonedaId] : null;
      const costoEntry = costoMonedaId ? preciosPorMoneda[costoMonedaId] : null;
      const precioVenta = ventaEntry?.precioVenta ? parseFloat(ventaEntry.precioVenta) : 0;
      const precioCompra = costoEntry?.precioCompra ? parseFloat(costoEntry.precioCompra) : 0;

      if (compraEnVentaMoneda(precioCompra) > precioVenta) {
        throw new Error("El precio de compra no puede ser mayor al precio de venta");
      }

      // `precio_base` se guarda EN LA MONEDA DE VENTA (moneda_base_id) y
      // `costo_base` EN LA DE COMPRA (moneda_costo_id), tal cual se escribieron
      const decVenta = Number(ventaMoneda?.decimales ?? 2);
      const decCosto = Number(costoMoneda?.decimales ?? 2);

      if (mode === "create") {
        if (!ventaMonedaId) throw new Error("Selecciona una moneda de venta");
        if (!costoMonedaId) throw new Error("Selecciona una moneda de compra");
        body.precio_base = precioVenta;
        body.costo_base = precioCompra;

        const res = await fetch("/api/productos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al crear producto");

        if (pendingImageFile && data?.id) {
          const imgFormData = new FormData();
          imgFormData.append("file", pendingImageFile);
          imgFormData.append("producto_id", data.id.toString());
          const imgRes = await fetch("/api/productos/imagen", { method: "POST", body: imgFormData });
          if (!imgRes.ok) {
            const imgErr = await imgRes.json().catch(() => ({}));
            console.error("Error al subir imagen del producto:", imgErr);
            throw new Error(imgErr.error || "Se creó el producto pero falló la carga de la imagen");
          }
        }
      } else if (mode === "edit" && producto) {
        body.id = producto.id;
        if (ventaMonedaId && ventaEntry?.precioVenta) {
          body.precio_base = redondear(precioVenta, decVenta);
        }
        if (costoMonedaId && costoEntry?.precioCompra) {
          body.costo_base = redondear(precioCompra, decCosto);
        }

        const res = await fetch("/api/productos", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al actualizar producto");
      } else if (mode === "delete" && producto) {
        const res = await fetch(`/api/productos?id=${producto.id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al eliminar producto");
      }

      const successMessages: Record<string, string> = {
        create: `Producto "${nombre}" creado exitosamente`,
        edit: `Producto "${nombre}" actualizado exitosamente`,
        delete: `Producto eliminado exitosamente`,
      };
      onSuccess(successMessages[mode] || "Operación exitosa");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  const isFormMode = mode === "create" || mode === "edit";
  const isDeleteMode = mode === "delete";
  const isViewMode = mode === "view";

  const titles: Record<ProductoModalMode, string> = {
    create: "Nuevo Producto",
    edit: "Editar Producto",
    view: "Detalle del Producto",
    delete: "Eliminar Producto",
  };

  const stepWidth = isFormMode ? "max-w-4xl w-[92vw]" : "max-w-xl w-[90vw]";

  /**
   * Tarjeta de una moneda en el paso de precios: permite marcarla como moneda
   * de referencia de COMPRA y/o de VENTA y edita sus dos precios (los que no
   * son referencia de su campo se muestran auto-calculados).
   */
  const renderMonedaCard = (m: Moneda, prefijo: "create" | "edit") => {
    const esVenta = m.id === ventaMonedaId;
    const esCosto = m.id === costoMonedaId;
    const esRef = esVenta || esCosto;
    const entry = preciosPorMoneda[m.id];
    const tasa = typeof m.tasa === "string" ? parseFloat(m.tasa) : Number(m.tasa);

    return (
      <div
        key={m.id}
        className={`rounded-lg border p-4 space-y-3 transition-colors ${
          esRef ? "border-primary bg-primary/5 shadow-sm" : "border-border/70 bg-muted/60 opacity-85"
        }`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold flex-1 min-w-0">
            {m.simbolo} {m.codigo} {m.es_base ? "(Moneda Base del Sistema)" : `(Tasa: ${tasa})`}
          </span>
          {esCosto && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              Ref. compra
            </span>
          )}
          {esVenta && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              Ref. venta
            </span>
          )}
          {!esRef && (
            <span className="text-[10px] font-medium text-muted-foreground bg-muted/80 px-2 py-0.5 rounded-full">
              Auto-calculado
            </span>
          )}
        </div>

        <div className="flex items-center gap-5">
          <label
            htmlFor={`${prefijo}-costo-${m.id}`}
            className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
          >
            <input
              type="radio"
              name={`${prefijo}MonedaCostoRef`}
              id={`${prefijo}-costo-${m.id}`}
              checked={esCosto}
              onChange={() => cambiarCostoRef(m.id)}
              className="h-4 w-4 accent-primary cursor-pointer"
            />
            Moneda de compra
          </label>
          <label
            htmlFor={`${prefijo}-venta-${m.id}`}
            className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
          >
            <input
              type="radio"
              name={`${prefijo}MonedaVentaRef`}
              id={`${prefijo}-venta-${m.id}`}
              checked={esVenta}
              onChange={() => cambiarVentaRef(m.id)}
              className="h-4 w-4 accent-primary cursor-pointer"
            />
            Moneda de venta
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className={`text-xs ${!esCosto ? "text-muted-foreground" : ""}`}>Precio de compra ({m.codigo})</Label>
            <Input
              type="number"
              step={1 / Math.pow(10, m.decimales ?? 2)}
              min="0"
              disabled={!esCosto}
              readOnly={!esCosto}
              className={!esCosto ? "bg-muted/90 text-muted-foreground cursor-not-allowed border-border/50 select-none" : ""}
              value={entry?.precioCompra ?? ""}
              onChange={(e) => actualizarPrecio(m.id, "precioCompra", e.target.value)}
              placeholder={esCosto ? `0.${"0".repeat(m.decimales ?? 2)}` : "Calculado..."}
            />
          </div>
          <div>
            <Label className={`text-xs ${!esVenta ? "text-muted-foreground" : ""}`}>Precio de venta ({m.codigo})</Label>
            <Input
              type="number"
              step={1 / Math.pow(10, m.decimales ?? 2)}
              min="0"
              disabled={!esVenta}
              readOnly={!esVenta}
              className={!esVenta ? "bg-muted/90 text-muted-foreground cursor-not-allowed border-border/50 select-none" : ""}
              value={entry?.precioVenta ?? ""}
              onChange={(e) => actualizarPrecio(m.id, "precioVenta", e.target.value)}
              placeholder={esVenta ? `0.${"0".repeat(m.decimales ?? 2)}` : "Calculado..."}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={titles[mode]}
      footer={
        <>
          {isFormMode && mode === "create" && step > 1 ? (
            <Button variant="outline" onClick={prevStep} disabled={loading}>
              <ChevronLeft size={14} /> Anterior
            </Button>
          ) : (
            <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
              {isFormMode || isDeleteMode ? "Cancelar" : "Cerrar"}
            </Button>
          )}
          {isFormMode && mode === "create" && step > 1 && (
            <Button variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
          )}
          {isFormMode && mode === "create" && step < 3 && (
            <Button onClick={nextStep} className="flex-1">
              Siguiente <ChevronRight size={14} />
            </Button>
          )}
          {isFormMode && mode === "create" && step === 3 && (
            <Button onClick={handleSubmit} disabled={loading} className="flex-1">
              {loading ? <Loader2 size={14} className="animate-spin" /> : "Crear Producto"}
            </Button>
          )}
          {isFormMode && mode === "edit" && (
            <Button onClick={handleSubmit} disabled={loading || !nombre.trim()} className="flex-1">
              {loading ? <Loader2 size={14} className="animate-spin" /> : "Guardar"}
            </Button>
          )}
          {isDeleteMode && (
            <Button variant="destructive" onClick={handleSubmit} disabled={loading} className="flex-1">
              {loading ? <Loader2 size={14} className="animate-spin" /> : "Eliminar"}
            </Button>
          )}
        </>
      }
      className={stepWidth}
    >
      {error && <Alert variant="danger">{error}</Alert>}

      {/* Stepper for create mode */}
      {mode === "create" && (
        <div className="mb-6 flex items-center gap-2">
          {STEPS.map((s) => {
            const isClickable = s.id < step;
            return (
              <div key={s.id} className="flex flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={() => isClickable && setStep(s.id)}
                  disabled={!isClickable}
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    s.id < step
                      ? "bg-primary text-primary-foreground cursor-pointer hover:opacity-80"
                      : s.id === step
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                  }`}
                >
                  {s.id < step ? <Check size={12} /> : s.id}
                </button>
                <span
                  onClick={() => isClickable && setStep(s.id)}
                  className={`text-xs font-medium ${isClickable ? "cursor-pointer hover:underline" : ""} ${
                    s.id === step ? "text-foreground font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {s.label}
                </span>
                {s.id < STEPS.length && (
                  <div className={`h-px flex-1 ${s.id < step ? "bg-primary" : "bg-border"}`} />
                )}
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* STEP 1: Basic Info */}
        {mode === "create" && step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Código</Label>
                <Input
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  placeholder="Ej: HAR-001"
                  autoFocus
                  maxLength={50}
                />
              </div>
              <div>
                <Label>Nombre</Label>
                <Input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej: Harina de maíz 1kg"
                  maxLength={200}
                />
              </div>
            </div>

            {/* Image Upload */}
            <div>
              <Label>Imagen del producto</Label>
              <div className="mt-2 flex items-center gap-4">
                {imagen ? (
                  <div className="relative group">
                    <img
                      src={imagen}
                      alt={nombre}
                      className="h-20 w-20 rounded-lg border border-border object-cover"
                    />
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border hover:border-primary/50 transition-colors">
                    <span className="text-2xl text-muted-foreground/50">+</span>
                    <span className="text-[10px] text-muted-foreground">Subir</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageUpload}
                      disabled={uploadingImage}
                    />
                  </label>
                )}
                {uploadingImage && (
                  <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-border bg-muted">
                    <Loader2 size={16} className="animate-spin text-muted-foreground" />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  JPG, PNG, WebP o GIF. Máx 2MB.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Categoría</Label>
                <div className="flex items-center gap-1.5">
                  <Combobox
                    className="flex-1"
                    options={[{ value: "", label: "Sin categoría" }, ...categorias.map((c) => ({ value: c.id.toString(), label: c.nombre }))]}
                    value={categoriaId}
                    onChange={setCategoriaId}
                    placeholder="Seleccionar categoría"
                    emptyLabel="Sin categorías"
                  />
                  <button
                    type="button"
                    onClick={() => setModalAnidado("categoria")}
                    title="Nueva categoría"
                    aria-label="Nueva categoría"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
              <div>
                <Label>Marca</Label>
                <div className="flex items-center gap-1.5">
                  <Combobox
                    className="flex-1"
                    options={[{ value: "", label: "Sin marca" }, ...marcas.map((m) => ({ value: m.id.toString(), label: m.nombre }))]}
                    value={marcaId}
                    onChange={setMarcaId}
                    placeholder="Seleccionar marca"
                    emptyLabel="Sin marcas"
                  />
                  <button
                    type="button"
                    onClick={() => setModalAnidado("marca")}
                    title="Nueva marca"
                    aria-label="Nueva marca"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Proveedor</Label>
                <div className="flex items-center gap-1.5">
                  <Combobox
                    className="flex-1"
                    options={[{ value: "", label: "Sin proveedor" }, ...proveedores.map((p) => ({ value: p.id.toString(), label: p.nombre }))]}
                    value={proveedorId}
                    onChange={setProveedorId}
                    placeholder="Seleccionar proveedor"
                    emptyLabel="Sin proveedores"
                    disabled={!!defaultProveedorId}
                  />
                  {!defaultProveedorId && (
                    <button
                      type="button"
                      onClick={() => setModalAnidado("proveedor")}
                      title="Nuevo proveedor"
                      aria-label="Nuevo proveedor"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                    >
                      <Plus size={16} />
                    </button>
                  )}
                </div>
                {!!defaultProveedorId && (
                  <p className="text-xs text-muted-foreground mt-1">Proveedor bloqueado porque estás creando desde una compra.</p>
                )}
              </div>
            </div>

            <div>
              <Label>Descripción</Label>
              <textarea
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Ej: Harina de maíz precocida, marca PAN..."
                rows={3}
                maxLength={500}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div>
                <Label className="text-sm">IVA Incluido</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {ivaIncluido ? "El precio ya incluye el IVA (16%)" : "El IVA se calculará en el punto de venta"}
                </p>
              </div>
              <Switch
                checked={ivaIncluido}
                onCheckedChange={setIvaIncluido}
              />
            </div>
          </motion.div>
        )}

        {/* STEP 2: Pricing */}
        {mode === "create" && step === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <p className="text-xs text-muted-foreground">
              Define el precio de compra y el de venta de cada producto. Puedes usar una
              moneda distinta para cada uno (p. ej. costo en USD y precio de venta en COP).
            </p>

            {loadingMonedas ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                <Loader2 className="animate-spin" size={24} />
                <span className="text-xs">Cargando monedas...</span>
              </div>
            ) : effectiveMonedas.length === 0 ? (
              <Alert variant="danger">
                No hay monedas activas registradas. Ve a la sección de Configuración/Monedas para habilitar al menos una moneda.
              </Alert>
            ) : (
              effectiveMonedas.map((m) => renderMonedaCard(m, "create"))
            )}
          </motion.div>
        )}

        {/* STEP 3: Stock */}
        {mode === "create" && step === 3 && (
          <motion.div
            key="step3"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Existencias iniciales</Label>
                <Input
                  type="number"
                  min="0"
                  value={stock}
                  onChange={(e) => setStock(parseInt(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Existencias mínimas</Label>
                <Input
                  type="number"
                  min="0"
                  value={stockMinimo}
                  onChange={(e) => setStockMinimo(parseInt(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label>Activo</Label>
              <Switch defaultChecked={activo} onCheckedChange={setActivo} />
            </div>

            {/* Summary */}
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Resumen del producto
              </p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Código:</span>
                <span className="font-mono font-medium">{codigo || "—"}</span>
                <span className="text-muted-foreground">Nombre:</span>
                <span className="font-medium">{nombre || "—"}</span>
                <span className="text-muted-foreground">Moneda de compra:</span>
                <span className="font-mono font-medium">
                  {costoMoneda ? `${costoMoneda.simbolo} ${costoMoneda.codigo}` : "—"}
                </span>
                <span className="text-muted-foreground">Precio de compra (Costo):</span>
                <span className="font-mono font-medium">
                  {costoMoneda && preciosPorMoneda[costoMoneda.id]?.precioCompra
                    ? `${costoMoneda.simbolo} ${parseFloat(preciosPorMoneda[costoMoneda.id].precioCompra).toLocaleString("es-BO", { minimumFractionDigits: costoMoneda.decimales ?? 2, maximumFractionDigits: costoMoneda.decimales ?? 2 })}`
                    : "—"}
                </span>
                <span className="text-muted-foreground">Moneda de venta:</span>
                <span className="font-mono font-medium">
                  {ventaMoneda ? `${ventaMoneda.simbolo} ${ventaMoneda.codigo}` : "—"}
                </span>
                <span className="text-muted-foreground">Precio de venta:</span>
                <span className="font-mono font-medium">
                  {ventaMoneda && preciosPorMoneda[ventaMoneda.id]?.precioVenta
                    ? `${ventaMoneda.simbolo} ${parseFloat(preciosPorMoneda[ventaMoneda.id].precioVenta).toLocaleString("es-BO", { minimumFractionDigits: ventaMoneda.decimales ?? 2, maximumFractionDigits: ventaMoneda.decimales ?? 2 })}`
                    : "—"}
                </span>
                <span className="text-muted-foreground">Existencias:</span>
                <span className="font-mono font-medium">{stock} uds.</span>
              </div>
            </div>
          </motion.div>
        )}

        {/* Edit mode: normal form */}
        {mode === "edit" && (
          <motion.div
            key="edit"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Código</Label>
                <Input
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  placeholder="Ej: HAR-001"
                  maxLength={50}
                />
              </div>
              <div>
                <Label>Nombre</Label>
                <Input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej: Harina de maíz 1kg"
                  maxLength={200}
                />
              </div>
            </div>

            {/* Image Upload */}
            <div>
              <Label>Imagen del producto</Label>
              <div className="mt-2 flex items-center gap-4">
                {imagen ? (
                  <div className="relative group">
                    <img
                      src={imagen}
                      alt={nombre}
                      className="h-20 w-20 rounded-lg border border-border object-cover"
                    />
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border hover:border-primary/50 transition-colors">
                    <span className="text-2xl text-muted-foreground/50">+</span>
                    <span className="text-[10px] text-muted-foreground">Subir</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageUpload}
                      disabled={uploadingImage}
                    />
                  </label>
                )}
                {uploadingImage && (
                  <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-border bg-muted">
                    <Loader2 size={16} className="animate-spin text-muted-foreground" />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  JPG, PNG, WebP o GIF. Máx 2MB.
                </p>
              </div>
            </div>

            <div>
              <Label>Descripción</Label>
              <textarea
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Ej: Harina precocida marca PAN 1kg"
                rows={2}
                maxLength={500}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div>
                <Label className="text-sm">IVA Incluido</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {ivaIncluido ? "El precio ya incluye el IVA (16%)" : "El IVA se calculará en el punto de venta"}
                </p>
              </div>
              <Switch
                checked={ivaIncluido}
                onCheckedChange={setIvaIncluido}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Categoría</Label>
                <Combobox
                  options={[{ value: "", label: "Sin categoría" }, ...categorias.map((c) => ({ value: c.id.toString(), label: c.nombre }))]}
                  value={categoriaId}
                  onChange={setCategoriaId}
                  placeholder="Seleccionar categoría"
                  emptyLabel="Sin categorías"
                />
              </div>
              <div>
                <Label>Marca</Label>
                <Combobox
                  options={[{ value: "", label: "Sin marca" }, ...marcas.map((m) => ({ value: m.id.toString(), label: m.nombre }))]}
                  value={marcaId}
                  onChange={setMarcaId}
                  placeholder="Seleccionar marca"
                  emptyLabel="Sin marcas"
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Precios por moneda. Elige por separado la moneda de compra y la de venta;
              pueden ser distintas (p. ej. costo en USD y precio de venta en COP).
            </p>

            {effectiveMonedas.map((m) => renderMonedaCard(m, "edit"))}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Existencias</Label>
                <Input
                  type="number"
                  min="0"
                  value={stock}
                  onChange={(e) => setStock(parseInt(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Existencias mínimas</Label>
                <Input
                  type="number"
                  min="0"
                  value={stockMinimo}
                  onChange={(e) => setStockMinimo(parseInt(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label>Activo</Label>
              <Switch defaultChecked={activo} onCheckedChange={setActivo} />
            </div>
          </motion.div>
        )}

        {/* View mode */}
        {mode === "view" && producto && (
          <motion.div
            key="view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <Label>Código</Label>
                <p className="font-mono font-medium">{producto.codigo}</p>
              </div>
              <div>
                <Label>Existencias</Label>
                <p className="font-mono font-medium">{producto.stock} uds.</p>
              </div>
            </div>
            <div>
              <Label>Nombre</Label>
              <p className="font-medium">{producto.nombre}</p>
            </div>
            <div>
              <Label>Descripción</Label>
              <p className="text-sm text-muted-foreground">{producto.descripcion || "—"}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <Label>Categoría</Label>
                <p className="font-medium">{producto.categoria_nombre || "—"}</p>
              </div>
              <div>
                <Label>Marca</Label>
                <p className="font-medium">{producto.marca_nombre || "—"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Label className="mb-0">IVA</Label>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${producto.iva_incluido ? "bg-primary/10 text-primary" : "bg-warning/10 text-warning"}`}>
                {producto.iva_incluido ? "Incluido (16%)" : "Excluido"}
              </span>
            </div>
            <div>
              <Label>Precios por moneda</Label>
              <div className="mt-2 space-y-1.5">
                {producto.precios?.filter((p) => p.moneda_id !== null).map((p) => (
                  <div key={p.moneda_id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {p.moneda_simbolo} {p.moneda_codigo} {p.es_base && "(Base)"}
                    </span>
                    <div className="flex gap-4 font-mono text-xs">
                      <span className="text-muted-foreground">Costo: {fmt(p.costo, p.moneda_codigo)}</span>
                      <span className="text-foreground font-medium">Precio: {fmt(p.precio, p.moneda_codigo)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <Label>Existencias</Label>
                <p className="font-mono font-bold">{producto.stock} uds.</p>
              </div>
              <div>
                <Label>Existencias mínimas</Label>
                <p className="font-mono">{producto.stock_minimo} uds.</p>
              </div>
            </div>
            <div>
              <Label>Estado</Label>
              <div className="mt-1">
                <StatusBadge status={producto.activo ? "Activo" : "Inactivo"} />
              </div>
            </div>
          </motion.div>
        )}

        {/* Delete mode */}
        {isDeleteMode && producto && (
          <motion.div
            key="delete"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            <p className="text-sm text-muted-foreground">
              ¿Estás seguro de que deseas eliminar el producto{" "}
              <span className="font-semibold text-foreground">{producto.nombre}</span> ({producto.codigo})?
            </p>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-600">
              Esta acción no se puede deshacer. Si el producto tiene compras o ventas asociadas, no podrá eliminarse.
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modales anidados: se abren con el "+" y al cerrarse se regresa aquí */}
      <CategoriaModal
        open={modalAnidado === "categoria"}
        mode="create"
        categoria={null}
        onClose={cerrarModalAnidado}
        onSuccess={(msg) => trasCrearAnidado("categoria", msg)}
      />
      <MarcaModal
        open={modalAnidado === "marca"}
        mode="create"
        marca={null}
        onClose={cerrarModalAnidado}
        onSuccess={(msg) => trasCrearAnidado("marca", msg)}
      />
      <ProveedorModal
        open={modalAnidado === "proveedor"}
        mode="create"
        proveedor={null}
        onClose={cerrarModalAnidado}
        onSuccess={(msg) => trasCrearAnidado("proveedor", msg)}
      />
    </Modal>
  );
}

