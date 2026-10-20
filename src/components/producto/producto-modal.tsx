"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Barcode, Check, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { CategoriaModal } from "@/components/categoria/categoria-modal";
import { MarcaModal } from "@/components/marca/marca-modal";
import { ProveedorModal } from "@/components/proveedor/proveedor-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Field } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { ComboboxMulti } from "@/components/ui/combobox-multi";
import { ComboboxCreatable } from "@/components/ui/combobox-creatable";
import { Table, Tr, Td } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { fmt, fmtDateTime } from "@/lib/format";
import { redondear, precioUnidadDesdePresentacion, margenSobreCosto, precioPresentacionSegunModo, type ModoVentaPresentacion } from "@/lib/money";
import { aplicarReglasRedondeo, type ReglasRedondeo } from "@/lib/redondeo";
import { useReglasConversion } from "@/lib/use-reglas-conversion";

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
  margen_ganancia?: number;
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
  presentaciones?: Array<{
    id: string;
    nombre: string;
    unidades: number;
    activo: boolean;
    precio: number;
    costo: number;
    modo_venta?: ModoVentaPresentacion;
    precio_override?: number | null;
    margen_override?: number | null;
  }>;
  /** CPP por unidad en la moneda de COMPRA del producto (0 si aún no hay compras). */
  costo_promedio?: number | null;
  /** Proveedores asociados (relación N:M). */
  proveedores?: Array<{ id: string | number; nombre: string }>;
}

/** Fila de presentación en el formulario (unidades como string para el input). */
/**
 * Fila del editor de presentaciones.
 *
 * El COSTO nunca se guarda por presentación: se deriva del CPP. Solo el PRECIO
 * puede ser propio, según `modo_venta`:
 *   derivado → precio = precio_unidad × unidades (sigue el comportamiento actual)
 *   fijo     → precio = precio_override (mayorista a precio acordado)
 *   margen   → precio = CPP × unidades × (1 + margen_override/100)
 */
interface PresentacionForm {
  key: string;
  id?: string;
  nombre: string;
  unidades: string;
  activo: boolean;
  /**
   * Código de barras PROPIO de la caja. Vacío = la caja no se escanea y solo
   * se agrega desde el desplegable. Único en todo el catálogo (el backend
   * rechaza que dos cajas, o una caja y un producto, lo compartan).
   */
  codigoBarras: string;
  modo_venta: ModoVentaPresentacion;
  precio_override: string;
  margen_override: string;
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
  { id: 2, label: "Precios y presentaciones" },
  { id: 3, label: "Existencias" },
];

/** Nombres comunes de presentaciones sugeridos en el buscador (se puede teclear cualquiera). */
const PRESENTACIONES_SUGERIDAS = [
  "Caja",
  "Bolsa",
  "Paquete",
  "Docena",
  "Media docena",
  "Fardo",
  "Blíster",
  "Bulto",
  "Saco",
  "Kilo",
  "Litro",
  "Galón",
];

interface PresentacionPriceInputProps {
  value: number;
  onChange: (val: string) => void;
  decimales: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

function PresentacionPriceInput({
  value,
  onChange,
  decimales,
  disabled,
  placeholder = "Calculado...",
  className,
}: PresentacionPriceInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [localVal, setLocalVal] = useState("");

  useEffect(() => {
    if (!isFocused) {
      setLocalVal(value > 0 ? String(value) : "");
    }
  }, [value, isFocused]);

  return (
    <Input
      type="number"
      min="0"
      step={1 / Math.pow(10, decimales)}
      disabled={disabled}
      value={isFocused ? localVal : value > 0 ? String(value) : ""}
      onFocus={() => {
        setIsFocused(true);
        setLocalVal(value > 0 ? String(value) : "");
      }}
      onBlur={() => {
        setIsFocused(false);
        setLocalVal(value > 0 ? String(value) : "");
      }}
      onChange={(e) => {
        const v = e.target.value;
        setLocalVal(v);
        onChange(v);
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}

/**
 * Campo de existencias que acepta UNIDADES o cualquier presentación.
 *
 * El inventario siempre vive en unidades, así que el selector no cambia lo que
 * se guarda: solo cambia cómo se teclea. Escribir `2` en "Caja ×20" guarda 40
 * unidades, y el texto auxiliar muestra siempre el equivalente para que no
 * haya que hacer la cuenta mental.
 */
function StockConPresentaciones({
  valor,
  total,
  unidadActual,
  presentaciones,
  factor,
  onValor,
  onUnidad,
  label,
  placeholder = "0",
}: {
  valor: string;
  /** Total en UNIDADES (lo que se guarda). */
  total: number;
  unidadActual: string;
  presentaciones: PresentacionForm[];
  factor: (key: string) => number;
  onValor: (texto: string) => void;
  onUnidad: (key: string) => void;
  label: string;
  placeholder?: string;
}) {
  // Solo se ofrecen las presentaciones con unidades válidas (las que el
  // servidor exigiría); el resto no serviría para convertir nada.
  const opciones = [
    { key: "", nombre: "Unidades", u: 1 },
    ...presentaciones.map((p) => ({
      key: p.key,
      nombre: p.nombre.trim() || "—",
      u: factor(p.key),
    })),
  ].filter((o, i, arr) => o.u > 0 && arr.findIndex((x) => x.key === o.key) === i);

  const factorActual = factor(unidadActual);
  const esCaja = factorActual > 1;
  // El redondeo a entero puede "perder" fracciones (0.03 cajas × 20 = 0.6 → 1).
  const exacto = (parseFloat(valor) || 0) * factorActual;
  const seRedondeo = esCaja && Math.abs(exacto - Math.round(exacto)) > 1e-9;

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          type="number"
          min="0"
          step="any"
          value={valor}
          onChange={(e) => onValor(e.target.value)}
          placeholder={placeholder}
          className="flex-1 font-mono"
        />
        <select
          value={unidadActual}
          onChange={(e) => onUnidad(e.target.value)}
          aria-label="Unidad de las existencias"
          className="h-9 w-[9.5rem] shrink-0 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none"
        >
          {opciones.map((o) => (
            <option key={o.key} value={o.key}>
              {o.nombre}
              {o.u > 1 ? ` (×${o.u})` : ""}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">
        {esCaja ? (
          <>
            ={" "}
            <span className="font-mono font-medium text-foreground">{total}</span> unidades
            {seRedondeo && " (se redondea a entero)"}
          </>
        ) : (
          "El inventario siempre se guarda en unidades."
        )}
      </p>
    </div>
  );
}

/**
 * Estado de la verificación en vivo de un código de barras.
 * - `vacio`     no hay nada que verificar (campo en blanco)
 * - `libre`     comprobado contra el servidor y no existe
 * - `ocupado`   ya lo usa otro producto o caja → `mensaje` lo explica
 */
interface VerificacionCodigo {
  estado: "vacio" | "libre" | "ocupado";
  mensaje?: string;
}
const VERIF_IDLE: VerificacionCodigo = { estado: "vacio" };

/** Texto que se muestra bajo el campo mientras tecleas un código. */
function pistaVerificacion(v: VerificacionCodigo | undefined): {
  texto: string;
  clase: string;
} | null {
  if (!v || v.estado === "vacio") return null;
  if (v.estado === "libre") {
    return { texto: "Código disponible", clase: "text-success-strong" };
  }
  return { texto: v.mensaje || "Este código ya está en uso", clase: "text-danger-strong" };
}

/** Clases del input según el estado de la verificación. */
function clasesInputCodigo(v: VerificacionCodigo | undefined, base: string): string {
  if (v?.estado === "ocupado") return `${base} border-danger-border bg-danger-soft/40 focus:border-danger`;
  if (v?.estado === "libre") return `${base} border-success-border`;
  return base;
}

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

  // ── Verificación de códigos de barras MIENTRAS se escribe ──
  // Evita descubrir el duplicado recién al pulsar Guardar. Es una ayuda, no un
  // candado: el servidor sigue validando al guardar (por si otro usuario tomó
  // el código entre la verificación y el guardado).
  const [verifCodigo, setVerifCodigo] = useState<VerificacionCodigo>(VERIF_IDLE);
  const [verifCajas, setVerifCajas] = useState<Record<string, VerificacionCodigo>>({});

  // Combine prop currencies or loaded fallback currencies
  const effectiveMonedas = useMemo(() => {
    if (monedasProp && monedasProp.length > 0) return monedasProp;
    return internalMonedas;
  }, [monedasProp, internalMonedas]);

  // Reglas del motor Set & Forget: el COSTO de compra se convierte con el
  // método de compras y el PRECIO de venta con el de ventas (directa o
  // triangulación), igual que calculan las APIs y las compras.
  const { convertirProducto } = useReglasConversion(effectiveMonedas);

  // Form fields
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [imagen, setImagen] = useState<string | null>(null);
  const [categoriaId, setCategoriaId] = useState("");
  const [marcaId, setMarcaId] = useState("");
  const [proveedorIds, setProveedorIds] = useState<string[]>([]);
  const [stockMinimo, setStockMinimo] = useState(5);
  const [activo, setActivo] = useState(true);
  const [ivaIncluido, setIvaIncluido] = useState(true);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);

  // ── Existencias: se captura en unidades O en una presentación ──────────────
  // El inventario SIEMPRE vive en unidades. `stock` es ese total (lo que se
  // guarda) y `stockTexto` es lo que se teclea, en la unidad que marque
  // `stockUnidadId`. Se separan para que escribir "0.03" no se reescriba a
  // "0.05" al redondear, y para que borrar la presentación seleccionada no
  // cambie el total en silencio.
  const [stock, setStock] = useState(0);
  const [stockTexto, setStockTexto] = useState("0");
  const [stockUnidadId, setStockUnidadId] = useState<string>("");

  // Presentaciones (Caja, Bolsa...). La unidad base es implícita (factor 1).
  const [presentaciones, setPresentaciones] = useState<PresentacionForm[]>([]);

  /** Unidades que representa una presentación del formulario (1 si no hay). */
  const factorDe = useCallback(
    (key: string): number => {
      const p = presentaciones.find((x) => x.key === key);
      const u = p ? parseInt(p.unidades, 10) : NaN;
      return Number.isInteger(u) && u > 1 ? u : 1;
    },
    [presentaciones]
  );

  const factorStock = factorDe(stockUnidadId);

  /** Teclear en la unidad vigente recalcula el total en unidades. */
  const teclearStock = (texto: string) => {
    setStockTexto(texto);
    setStock(Math.max(0, Math.round((parseFloat(texto) || 0) * factorDe(stockUnidadId))));
  };

  /**
   * Cambia la unidad de captura CONSERVANDO el total. Si hay 40 unidades y se
   * pasa a "Caja ×20" el campo pasa a 2, no a 40 (que serían 800 unidades).
   */
  const cambiarUnidadStock = (key: string) => {
    const totalActual = stock;
    const factor = factorDe(key);
    setStockUnidadId(key);
    setStockTexto(factor > 1 ? String(redondear(totalActual / factor, 3)) : String(totalActual));
  };

  // Si se borra la presentación con la que se está capturando, la captura vuelve
  // a unidades conservando el total. `stock` NO va en las dependencias a
  // propósito: en este render sigue siendo el total correcto.
  useEffect(() => {
    if (stockUnidadId && !presentaciones.some((p) => p.key === stockUnidadId)) {
      setStockUnidadId("");
      setStockTexto(String(stock));
    }
  }, [presentaciones, stockUnidadId]);

  // ── Verificación en vivo del código del PRODUCTO ──
  // Debounce de 400ms: se sigue escribiendo sin cortar, y solo se consulta
  // cuando el usuario deja de teclear un momento. Al editar se excluye el
  // propio producto para que su código actual no se marque como duplicado.
  useEffect(() => {
    const cod = codigo.trim();
    if (cod.length < 2) {
      setVerifCodigo(VERIF_IDLE);
      return;
    }
    let cancelado = false;
    setVerifCodigo((v) => (v.estado === "ocupado" ? v : { ...v }));

    const t = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ tipo: "producto", codigo: cod });
        if (producto?.id) qs.set("excluirProductoId", String(producto.id));
        const res = await fetch(`/api/productos/verificar-codigo?${qs}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelado) return;
        const r = data?.resultados?.[cod];
        setVerifCodigo(
          r && r.disponible === false ? { estado: "ocupado", mensaje: r.mensaje } : { estado: "libre" }
        );
      } catch {
        /* sin red: se deja el campo sin marca; el servidor valida al guardar */
      }
    }, 400);

    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [codigo, producto?.id]);

  // ── Verificación en vivo de los códigos de las CAJAS ──
  // Se manda la lista completa en una sola consulta en vez de una por fila, así
  // que agregar diez cajas no genera diez viajes. Además se detectan aquí los
  // códigos repetidos DENTRO de la propia lista, que el servidor no puede ver
  // hasta que se guarda.
  const codigosCaja = useMemo(
    () =>
      presentaciones
        .map((p) => ({ key: p.key, codigo: p.codigoBarras.trim() }))
        .filter((c) => c.codigo.length >= 2),
    [presentaciones]
  );

  useEffect(() => {
    if (codigosCaja.length === 0) {
      setVerifCajas({});
      return;
    }
    let cancelado = false;

    const t = setTimeout(async () => {
      // Repetición dentro del propio formulario: se marca el aviso sin red.
      const repetidos = new Set<string>();
      const vistos = new Set<string>();
      for (const c of codigosCaja) {
        const k = c.codigo.toLowerCase();
        if (vistos.has(k)) repetidos.add(c.codigo);
        vistos.add(k);
      }

      let libres: Record<string, { disponible: boolean; mensaje: string }> = {};
      try {
        const qs = new URLSearchParams({ tipo: "caja" });
        for (const c of codigosCaja) qs.append("codigo", c.codigo);
        if (producto?.id) qs.set("excluirProductoId", String(producto.id));
        const res = await fetch(`/api/productos/verificar-codigo?${qs}`);
        if (res.ok) libres = (await res.json())?.resultados ?? {};
      } catch {
        /* sin red: solo se avisa lo local */
      }
      if (cancelado) return;

      const siguiente: Record<string, VerificacionCodigo> = {};
      for (const c of codigosCaja) {
        if (repetidos.has(c.codigo)) {
          siguiente[c.key] = { estado: "ocupado", mensaje: "Este código está repetido en las cajas de este producto" };
          continue;
        }
        const r = libres[c.codigo];
        siguiente[c.key] =
          r && r.disponible === false ? { estado: "ocupado", mensaje: r.mensaje } : { estado: "libre" };
      }
      setVerifCajas(siguiente);
    }, 400);

    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [codigosCaja, producto?.id]);

  // Estado del buscador para agregar presentaciones nuevas
  const [nuevaPresNombre, setNuevaPresNombre] = useState("");
  const [nuevaPresUnidades, setNuevaPresUnidades] = useState("2");
  const [nuevaPresCodigo, setNuevaPresCodigo] = useState("");

  // Verificación en vivo del código que se está ESCRIBIENDO para la caja nueva
  // (aún no está en `presentaciones`, así que no la cubre el efecto de la tabla).
  const [verifNuevaPres, setVerifNuevaPres] = useState<VerificacionCodigo>(VERIF_IDLE);
  useEffect(() => {
    const cod = nuevaPresCodigo.trim();
    if (cod.length < 2) {
      setVerifNuevaPres(VERIF_IDLE);
      return;
    }
    let cancelado = false;
    const t = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ tipo: "caja", codigo: cod });
        if (producto?.id) qs.set("excluirProductoId", String(producto.id));
        const res = await fetch(`/api/productos/verificar-codigo?${qs}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelado) return;
        const r = data?.resultados?.[cod];
        setVerifNuevaPres(
          r && r.disponible === false ? { estado: "ocupado", mensaje: r.mensaje } : { estado: "libre" }
        );
      } catch {
        /* sin red: el servidor valida al guardar */
      }
    }, 400);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [nuevaPresCodigo, producto?.id]);

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
  // Margen de ganancia % (regla global de precios): define → autocalcula el
  // precio de venta; editar el precio a mano → recalcula el margen mostrado.
  const [margenGanancia, setMargenGanancia] = useState("");

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
   * indicada. La conversión respeta el método del motor (`convertirProducto`):
   * el COSTO de compra usa la regla de compras (directa o triangulación) y el
   * PRECIO de venta la de ventas. En modo directo es la arista directa
   * (p. ej. COP ↔ BS = 3.2), igual que antes.
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
            ? convertirProducto(
                valor,
                refMoneda,
                m,
                field === "precioCompra" ? "compra" : "venta",
                dec
              ).toFixed(dec)
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
   * venta con la regla de COMPRAS del motor (directa o triangulación).
   */
  const compraEnVentaMoneda = (compra: number): number => {
    if (!costoMoneda || !ventaMoneda) return compra;
    return convertirProducto(compra, costoMoneda, ventaMoneda, "compra", Number(ventaMoneda.decimales ?? 2));
  };

  // Regla global de redondeo de precios (Configuración → Precios). Se pide por
  // la API al abrir el modal para que el botón "Redondear" aparezca (o no)
  // según lo que el administrador tenga configurado, sin que el modal adivine.
  // Se lee por HTTP y no importando `global-config.ts` porque ese módulo arrastra
  // la capa de BD y rompería la build de este Client Component.
  const [cfgRedondeo, setCfgRedondeo] = useState<ReglasRedondeo | null>(null);
  const [msgRedondeo, setMsgRedondeo] = useState("");
  useEffect(() => {
    if (!open) return;
    let vigente = true;
    fetch("/api/configuracion-global")
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (vigente && c) {
          setCfgRedondeo({
            redondeo_activo: c.redondeo_activo === true,
            redondeo_multiplo: Number(c.redondeo_multiplo) > 0 ? Number(c.redondeo_multiplo) : 0,
            redondeo_no_bajar_de_costo: c.redondeo_no_bajar_de_costo !== false,
          });
        }
      })
      .catch(() => {
        /* sin config no se ofrece el botón; el backend sigue aplicando la regla */
      });
    return () => {
      vigente = false;
    };
  }, [open]);

  const actualizarPrecio = (monedaId: string, field: "precioVenta" | "precioCompra", value: string) => {
    // Si el operador vuelve a tocar un precio, el aviso del último redondeo
    // queda obsoleto (ya no describe lo que hay en pantalla).
    setMsgRedondeo("");
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

    // Sincronía con el margen %: si cambia el COSTO y el usuario ya definió un
    // margen, se re-aplica automáticamente al precio de venta; si cambia el
    // PRECIO DE VENTA a mano, el margen mostrado se recalcula del cociente.
    const valorNum = parseFloat(value) || 0;
    if (field === "precioCompra" && valorNum > 0) {
      if (margenGanancia !== "") {
        const margen = parseFloat(margenGanancia);
        if (Number.isFinite(margen) && margen >= 0 && ventaMonedaId) {
          const costoEnVenta = compraEnVentaMoneda(valorNum);
          // Pasa por el mismo cálculo que al escribir el margen, para que el
          // precio resultante también cumpla el redondeo global.
          const precioNuevo = precioDesdeMargen(costoEnVenta, margen);
          setPreciosPorMoneda((prev) => ({
            ...prev,
            [ventaMonedaId]: { ...prev[ventaMonedaId], precioVenta: String(precioNuevo) },
          }));
          derivarCampo("precioVenta", ventaMonedaId, precioNuevo, false);
        }
      }
    } else if (field === "precioVenta" && valorNum > 0) {
      const costoCompra = costoMonedaId
        ? parseFloat(preciosPorMoneda[costoMonedaId]?.precioCompra || "") || 0
        : 0;
      const costoEnVenta = compraEnVentaMoneda(costoCompra);
      if (costoEnVenta > 0) {
        const margenCalc = (valorNum / costoEnVenta - 1) * 100;
        setMargenGanancia(String(redondear(Math.max(0, margenCalc), 2)));
      }
    } else if (valorNum === 0 && field === "precioVenta") {
      setMargenGanancia("");
    }
  };

  /**
   * Precio de venta derivado del margen. Es el MISMO cálculo que hace el
   * backend al guardar, incluida la regla global de redondeo: si difieren, la
   * pantalla muestra un precio que al guardar cambia solo.
   */
  const precioDesdeMargen = (costoEnVenta: number, margen: number): number => {
    const dec = Number(ventaMoneda?.decimales ?? 2);
    const bruto =
      margen > 0
        ? redondear(costoEnVenta * (1 + margen / 100), dec)
        : redondear(costoEnVenta, dec);
    return cfgRedondeo
      ? aplicarReglasRedondeo(bruto, cfgRedondeo, costoEnVenta).precio
      : bruto;
  };

  /**
   * Regla global de precios: margen % → precio de venta autocalculado desde el
   * costo en la moneda de COMPRA, convertido a la moneda de VENTA.
   */
  const aplicarMargen = (margen: number) => {
    if (!ventaMonedaId || !costoMonedaId) return;
    const costoCompra = parseFloat(preciosPorMoneda[costoMonedaId]?.precioCompra || "") || 0;
    if (costoCompra <= 0) return;
    const costoEnVenta = compraEnVentaMoneda(costoCompra);
    const precioNuevo = precioDesdeMargen(costoEnVenta, margen);
    setPreciosPorMoneda((prev) => ({
      ...prev,
      [ventaMonedaId]: { ...prev[ventaMonedaId], precioVenta: String(precioNuevo) },
    }));
    derivarCampo("precioVenta", ventaMonedaId, precioNuevo, false);
  };

  const handleMargenChange = (v: string) => {
    setMargenGanancia(v);
    const margen = parseFloat(v);
    if (Number.isFinite(margen) && margen >= 0) aplicarMargen(margen);
  };

  // Margen REAL (informativo): rentabilidad efectiva del precio de venta sobre
  // el costo de compra, ambos en la moneda de VENTA. A diferencia del margen de
  // arriba (la regla que autocalcula el precio), este refleja lo que quedó tras
  // una edición manual o el redondeo global. Convierte el costo con el método
  // configurado (regla de compras), igual que el resto del sistema.
  const precioVentaRef = parseFloat(preciosPorMoneda[ventaMonedaId ?? ""]?.precioVenta || "") || 0;
  const costoCompraRef = parseFloat(preciosPorMoneda[costoMonedaId ?? ""]?.precioCompra || "") || 0;
  const costoEnVentaRef = costoCompraRef > 0 ? compraEnVentaMoneda(costoCompraRef) : 0;
  const margenReal = margenSobreCosto(precioVentaRef, costoEnVentaRef);

  // Margen real del producto tal como está GUARDADO (modo vista): usa la fila
  // de la moneda de VENTA (`es_base`) que ya deriva la API con el método global.
  const filaVentaVista = producto?.precios?.find((p) => p.es_base);
  const margenRealVista = filaVentaVista
    ? margenSobreCosto(filaVentaVista.precio, filaVentaVista.costo)
    : null;

  // ── Presentaciones (Caja, Bolsa...) ──────────────────────────────────────
  // La unidad es la fuente de verdad: el precio de la presentación se deriva
  // del precio unitario de la moneda de VENTA. En el formulario ambos son
  // editables (bidireccional): escribir el precio de la caja reescribe el
  // unitario y re-deriva las demás monedas.
  const decVenta = Number(ventaMoneda?.decimales ?? 2);
  const precioUnidadVenta = () => parseFloat(preciosPorMoneda[ventaMonedaId || ""]?.precioVenta || "") || 0;

  /** Al escribir el precio de una presentación → despeja el precio unitario. */
  const cambiarPrecioPresentacion = (valor: string, unidades: number) => {
    if (!ventaMonedaId) return;
    const trimmed = valor.trim();
    if (!trimmed || parseFloat(trimmed) <= 0) {
      actualizarPrecio(ventaMonedaId, "precioVenta", "");
      return;
    }
    const n = parseFloat(trimmed);
    if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(unidades) || unidades <= 1) return;
    const unit = precioUnidadDesdePresentacion(n, unidades, decVenta);
    actualizarPrecio(ventaMonedaId, "precioVenta", unit > 0 ? String(unit) : "");
  };

  // Costo de presentación (moneda de COMPRA): escribir el costo de la caja
  // (p. ej. 480) despeja el costo unitario (480 ÷ 24 = 20). El CPP real que
  // sale del inventario se muestra aparte, como referencia.
  const decCosto = Number(costoMoneda?.decimales ?? 2);
  const precioUnidadCosto = () => parseFloat(preciosPorMoneda[costoMonedaId || ""]?.precioCompra || "") || 0;

  /** CPP real del producto por unidad, en la moneda de COMPRA. */
  const cppReal = () => Number(producto?.costo_promedio) || 0;

  /** Costo de la caja según el CPP (referencia, no editable). */
  const costoCppDe = (unidades: number) =>
    unidadesValidas(unidades) ? redondear(cppReal() * unidades, decCosto) : 0;

  /**
 * Costo por unidad de la presentación, SIEMPRE en la moneda de VENTA (que es
 * donde vive el precio) para que el margen compare dos números comparables.
 *
 * La fuente es el costo de compra que se está editando en el formulario, y se
 * convierte con `compraEnVentaMoneda` (la misma regla que ya usa el "margen
 * real" y la validación "compra ≤ venta"). Antes se comparaba contra
 * `costo_promedio` crudo, que vive en la moneda de COMPRA real del producto:
 * si el formulario mostraba otra moneda, el margen salía inventado.
 *
 * Si no hay costo escrito, se usa el que YA vino convertido desde la API
 * (`presentacion.costo`, que la API calcula con la moneda real del producto).
 */
const costoUnitarioEnVenta = (p: PresentacionForm): number => {
  const escrito = precioUnidadCosto();
  if (escrito > 0) return compraEnVentaMoneda(escrito);
  const deApi = Number(producto?.presentaciones?.find((pr) => pr.id === p.id)?.costo);
  const u = parseInt(p.unidades, 10);
  return Number.isFinite(deApi) && deApi > 0 && u > 1 ? deApi / u : 0;
};

/** Precio de la presentación según su modo, para la vista previa de la tabla. */
const precioSegunModo = (p: PresentacionForm, unidades: number) =>
  precioPresentacionSegunModo({
    unidades,
    precioUnidad: precioUnidadVenta(),
    costoUnitario: costoUnitarioEnVenta(p),
    modo: p.modo_venta,
    precioOverride: p.precio_override,
    margenOverride: p.margen_override,
    decimales: decVenta,
  });

/** Al escribir el costo de una presentación → despeja el costo unitario. */
const cambiarPrecioPresentacionCosto = (valor: string, unidades: number) => {
  if (!costoMonedaId) return;
  const trimmed = valor.trim();
  if (!trimmed || parseFloat(trimmed) <= 0) {
    actualizarPrecio(costoMonedaId, "precioCompra", "");
    return;
  }
  const n = parseFloat(trimmed);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(unidades) || unidades <= 1) return;
  const unit = precioUnidadDesdePresentacion(n, unidades, decCosto);
  actualizarPrecio(costoMonedaId, "precioCompra", unit > 0 ? String(unit) : "");
};

/** Agrega una presentación desde el buscador (nombre + unidades). */
  const unidadesValidas = (u: number) => Number.isInteger(u) && u > 1;

const agregarPresentacionDesdePicker = () => {
    const nombrePres = nuevaPresNombre.trim();
    const unidadesNum = parseInt(nuevaPresUnidades, 10);
    if (!nombrePres) {
      setError("Escribe o elige el nombre de la presentación");
      return;
    }
    if (!Number.isInteger(unidadesNum) || unidadesNum < 2) {
      setError("Las unidades de la presentación deben ser enteras y mayores a 1");
      return;
    }
    // No se agrega una caja con un código que ya existe: el aviso ya está en
    // pantalla, así que acá solo se corta la acción en vez de dejar que el
    // error aparezca recién al Guardar.
    if (nuevaPresCodigo.trim().length >= 2 && verifNuevaPres.estado === "ocupado") {
      setError(`No se puede agregar la caja: ${verifNuevaPres.mensaje || "ese código ya está en uso"}`);
      return;
    }
    setPresentaciones((prev) => [
      ...prev,
      {
        key: `pres-nueva-${Date.now()}-${Math.random()}`,
        nombre: nombrePres,
        unidades: String(unidadesNum),
        activo: true,
        codigoBarras: nuevaPresCodigo.trim(),
        modo_venta: "derivado",
        precio_override: "",
        margen_override: "",
      },
    ]);
    setNuevaPresNombre("");
    setNuevaPresCodigo("");
  };

  const actualizarPresentacion = (key: string, cambios: Partial<PresentacionForm>) => {
    setPresentaciones((prev) => prev.map((p) => (p.key === key ? { ...p, ...cambios } : p)));
  };

  const eliminarPresentacion = (key: string) => {
    setPresentaciones((prev) => prev.filter((p) => p.key !== key));
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
      if (nueva) {
        setProveedorIds((prev) =>
          prev.includes(String(nueva.id)) ? prev : [...prev, String(nueva.id)]
        );
      }
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
    setNuevaPresNombre("");
    setNuevaPresUnidades("2");

    if (producto && (mode === "edit" || mode === "view")) {
      setCodigo(producto.codigo);
      setNombre(producto.nombre);
      setDescripcion(producto.descripcion || "");
      setImagen(producto.imagen || null);
      setCategoriaId(producto.categoria_id?.toString() || "");
      setMarcaId(producto.marca_id?.toString() || "");
      setProveedorIds((producto.proveedores || []).map((p) => String(p.id)));
      setStockUnidadId(""); // siempre se abre en unidades
      setStock(producto.stock ?? 0);
      setStockTexto(String(producto.stock ?? 0));
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

      setPresentaciones(
        (producto.presentaciones || []).map((pr) => ({
          key: `pres-${pr.id}`,
          id: pr.id,
          nombre: pr.nombre,
          unidades: String(pr.unidades),
          activo: pr.activo,
          codigoBarras: (pr as any).codigo ?? "",
          modo_venta: pr.modo_venta ?? "derivado",
          precio_override: pr.precio_override != null ? String(pr.precio_override) : "",
          margen_override: pr.margen_override != null ? String(pr.margen_override) : "",
        }))
      );
      setMargenGanancia(producto.margen_ganancia != null ? String(producto.margen_ganancia) : "");
    } else if (mode === "create") {
      setCodigo("");
      setNombre("");
      setDescripcion("");
      setImagen(null);
      setPendingImageFile(null);
      setCategoriaId("");
      setMarcaId("");
      setProveedorIds(defaultProveedorId ? [defaultProveedorId.toString()] : []);
      setStockUnidadId("");
      setStock(0);
      setStockTexto("0");
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
      setPresentaciones([]);
      setMargenGanancia("");
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

  /** ¿Se puede redondear con la configuración actual? */
  const redondeoDisponible = !!cfgRedondeo?.redondeo_activo && Number(cfgRedondeo?.redondeo_multiplo) > 0;

  /**
   * Aplica la regla de redondeo global al precio de venta de la moneda de
   * venta. Es un botón MANUAL a propósito: la regla se respeta siempre al
   * derivar el precio del margen, pero si el operador escribió un precio a
   * mano (o quiere un precio "bonito" del múltiplo) hay que pedirlo, porque
   * redondear sin permiso cambia lo que el producto cuesta.
   */
  const redondearPrecioVenta = () => {
    if (!cfgRedondeo || !ventaMonedaId) return;
    const actual = parseFloat(preciosPorMoneda[ventaMonedaId]?.precioVenta || "") || 0;
    if (actual <= 0) {
      setMsgRedondeo("Escribe primero un precio de venta para poder redondearlo");
      return;
    }
    const costoCompra = costoMonedaId
      ? parseFloat(preciosPorMoneda[costoMonedaId]?.precioCompra || "") || 0
      : 0;
    const suelo = compraEnVentaMoneda(costoCompra);
    const { precio, redondeado } = aplicarReglasRedondeo(actual, cfgRedondeo, suelo);
    if (!redondeado) {
      setMsgRedondeo(`El precio ${fmt(actual, ventaMoneda?.codigo)} ya es múltiplo de ${cfgRedondeo.redondeo_multiplo}`);
      return;
    }
    const moneda = ventaMonedaId;
    setPreciosPorMoneda((prev) => ({
      ...prev,
      [moneda]: { ...prev[moneda], precioVenta: String(precio) },
    }));
    derivarCampo("precioVenta", moneda, precio, false);
    // El margen se recalcula del precio NUEVO: si no, la pantalla mostraría un
    // margen que ya no corresponde al precio redondeado.
    if (suelo > 0) {
      setMargenGanancia(String(redondear(Math.max(0, (precio / suelo - 1) * 100), 2)));
    }
    setMsgRedondeo(
      `Redondeado a múltiplo de ${cfgRedondeo.redondeo_multiplo}: ${fmt(actual, ventaMoneda?.codigo)} → ${fmt(precio, ventaMoneda?.codigo)}`
    );
  };

  /**
   * Botón "Redondear" + aviso del resultado. Comparte el cálculo del margen
   * real, así que se usa igual en el paso de creación y en el de edición.
   * Solo aparece si Configuración → Precios tiene el redondeo ACTIVO con un
   * múltiplo válido; si está apagado, el operador no ve un botón inútil.
   */
  const renderBotonRedondear = () => {
    if (!redondeoDisponible || !cfgRedondeo) return null;
    const mult = cfgRedondeo.redondeo_multiplo;
    const cod = ventaMoneda?.codigo;
    return (
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={redondearPrecioVenta}
            disabled={!ventaMonedaId || !(parseFloat(preciosPorMoneda[ventaMonedaId ?? ""]?.precioVenta || "") || 0)}
            title={`Ajusta el precio de venta al múltiplo de ${mult} configurado en Configuración → Precios`}
          >
            <Barcode size={13} className="mr-1.5" />
            Redondear a múltiplo de {mult}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Aplica a <span className="font-semibold text-foreground">{cod ?? "—"}</span>, la moneda de venta.
            {cfgRedondeo.redondeo_no_bajar_de_costo && " Nunca baja del costo."}
          </span>
        </div>
        {msgRedondeo && (
          <p
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] font-medium ${
              msgRedondeo.startsWith("Redondeado")
                ? "border-success-border bg-success-soft text-success-strong"
                : "border-border bg-muted/40 text-muted-foreground"
            }`}
          >
            {msgRedondeo.startsWith("Redondeado") && <CheckCircle2 size={12} className="shrink-0" />}
            {msgRedondeo}
          </p>
        )}
      </div>
    );
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {    const file = e.target.files?.[0];
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

      // Presentaciones (misma pestaña): cada fila requiere nombre y unidades
      // enteras > 1, el modo de precio elegido debe tener su valor, y los
      // códigos de barras no pueden repetirse.
      const vistos = new Set<string>();
      for (const p of presentaciones) {
        const nombreP = p.nombre.trim();
        if (!nombreP) {
          setError("Toda presentación necesita un nombre");
          return false;
        }
        const unidades = parseInt(p.unidades, 10);
        if (!Number.isInteger(unidades) || unidades <= 1) {
          setError(`Presentación "${nombreP}": las unidades deben ser un número entero mayor a 1`);
          return false;
        }
        // El código de barras es único en todo el catálogo. Se comprueba aquí
        // lo que se puede ver sin red (dos cajas de ESTE producto) para no
        // dejar ni siquiera llegar al error del servidor; el choque con otras
        // cajas o con un producto lo avisa el backend al guardar.
        const codigo = p.codigoBarras.trim();
        if (codigo) {
          if (vistos.has(codigo.toLowerCase())) {
            setError(`El código de barras "${codigo}" está repetido en las cajas de este producto`);
            return false;
          }
          vistos.add(codigo.toLowerCase());
        }
        const modo: ModoVentaPresentacion = p.modo_venta ?? "derivado";
        if (modo === "fijo") {
          const po = parseFloat(p.precio_override);
          if (!Number.isFinite(po) || po < 0) {
            setError(`Presentación "${nombreP}": pusiste modo "precio fijo" pero no escribiste el precio de la caja`);
            return false;
          }
        }
        if (modo === "margen") {
          const mo = parseFloat(p.margen_override);
          if (!Number.isFinite(mo) || mo < 0) {
            setError(`Presentación "${nombreP}": pusiste modo "por margen" pero no escribiste el margen %`);
            return false;
          }
        }
      }
      return true;
    }
    return true;
  };

  const nextStep = () => {
    setError("");
    if (validateStep(step)) {
      setStep((s) => Math.min(s + 1, STEPS.length));
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
        proveedor_ids: proveedorIds
          .map((id) => parseInt(id, 10))
          .filter((n) => Number.isInteger(n) && n > 0),
        proveedor_id: proveedorIds[0] ? parseInt(proveedorIds[0], 10) : null,
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

      // Presentaciones: el COSTO nunca se envía (se deriva del CPP). El precio sí
      // puede ser propio según el modo; solo se manda el override del modo
      // activo. `validateStep` ya garantiza que el override exista, así que
      // aquí nunca se degrada una fila a 'derivado' a espaldas del usuario.
      body.presentaciones = presentaciones
        .map((p) => {
          const modo: ModoVentaPresentacion = p.modo_venta ?? "derivado";
          const po = modo === "fijo" ? parseFloat(p.precio_override) : NaN;
          const mo = modo === "margen" ? parseFloat(p.margen_override) : NaN;
          return {
            ...(p.id ? { id: p.id } : {}),
            nombre: p.nombre.trim(),
            unidades: parseInt(p.unidades, 10),
            activo: p.activo,
            // Vacío = la caja no se escanea, solo se agrega desde el desplegable.
            codigo: p.codigoBarras.trim() || null,
            modo_venta: modo,
            precio_override: modo === "fijo" && Number.isFinite(po) && po >= 0 ? po : null,
            margen_override: modo === "margen" && Number.isFinite(mo) && mo >= 0 ? mo : null,
          };
        })
        .filter((p) => p.nombre && Number.isInteger(p.unidades) && p.unidades > 1);

      // Margen de ganancia %: regla global; define el precio de venta en cascada.
      body.margen_ganancia = margenGanancia !== "" ? Math.max(0, parseFloat(margenGanancia) || 0) : 0;

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
        onSuccess(data.message || `Producto "${producto.nombre}" procesado exitosamente`);
        onClose();
        return;
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

  // En los modos con formulario (crear/editar) se fija una ALTURA MÍNIMA
  // relativa al viewport (78% de la pantalla): así el modal no "salta" al
  // cambiar de pestaña/paso con distinto contenido (entre 78vh y 90vh), y el
  // pie (Cancelar/Guardar/Siguiente) queda siempre anclado a la parte baja.
  // El paso de presentaciones lleva una tabla de 8 columnas (nombre, código,
  // unidades, modo, costo, precio, activo y acciones). Con `max-w-4xl` no
  // entraban y había que hacer scroll horizontal para ver el PRECIO, que es
  // justo la columna que más importa. `max-w-6xl` la deja entera en pantalla
  // en una ventana de 1400px (la de Electron) y sigue siendo 92vw en una
  // pantalla chica, donde el scroll horizontal sigue siendo el respaldo.
  const stepWidth = isFormMode ? "max-w-6xl w-[94vw] min-h-[78vh]" : "max-w-xl w-[90vw]";

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

  /**
   * Sección reutilizable de PRESENTACIONES (Caja, Bolsa...). La unidad es la
   * base: el costo y el precio de la presentación se derivan del unitario y
   * ambos son editables (bidireccional). Se muestra como TABLA, con un
   * buscador (selector con texto libre) para agregar presentaciones al mayor.
   */
  const renderPresentaciones = () => (
    <div className="space-y-3">
      {/* Buscador/selector para agregar presentaciones */}
      <div className="flex items-end gap-3">
        <div className="flex-1 min-w-0">
          <Label className="text-xs">Presentación</Label>
          <ComboboxCreatable
            options={PRESENTACIONES_SUGERIDAS.map((n) => ({ value: n.toLowerCase(), label: n }))}
            value={nuevaPresNombre}
            onChange={setNuevaPresNombre}
            placeholder="Caja, Bolsa, Paquete..."
            emptyLabel="Escribe el nombre de la presentación"
          />
        </div>
        <div className="w-20 shrink-0">
          <Label className="text-xs">Unidades</Label>
          <Input
            type="number"
            min={2}
            step={1}
            value={nuevaPresUnidades}
            onChange={(e) => setNuevaPresUnidades(e.target.value)}
            placeholder="24"
          />
        </div>
        <div className="w-40 shrink-0">
          <Label className="text-xs flex items-center gap-1">
            <Barcode size={12} className="text-muted-foreground" />
            Código
          </Label>
          <Input
            value={nuevaPresCodigo}
            onChange={(e) => setNuevaPresCodigo(e.target.value)}
            placeholder="Opcional"
            maxLength={50}
            aria-invalid={verifNuevaPres.estado === "ocupado"}
            className={clasesInputCodigo(verifNuevaPres, "")}
          />
          {pistaVerificacion(verifNuevaPres) && (
            <p
              className={`mt-1 flex items-start gap-1 text-[10px] leading-tight font-medium ${
                verifNuevaPres.estado === "ocupado" ? "text-danger-strong" : "text-success-strong"
              }`}
            >
              {verifNuevaPres.estado === "ocupado" ? (
                <AlertCircle size={11} className="mt-px shrink-0" />
              ) : (
                <CheckCircle2 size={11} className="mt-px shrink-0" />
              )}
              <span>{pistaVerificacion(verifNuevaPres)!.texto}</span>
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={agregarPresentacionDesdePicker}
          className="h-10 shrink-0"
        >
          <Plus size={14} /> Agregar
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        El código es opcional y único en todo el catálogo. Con código, la caja se puede
        escanear para cobrarla como caja; sin él, solo se agrega desde el desplegable.
      </p>

      {presentaciones.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          Sin presentaciones. El producto se vende y compra por Unidad.
        </div>
      ) : (
        <Table
          headers={[
            "Presentación",
            "Código",
            "Unid.",
            "Modo precio",
            `Costo compra (${costoMoneda?.codigo ?? "—"})`,
            `Precio venta (${ventaMoneda?.codigo ?? "—"})`,
            "Activo",
            "Acciones",
          ]}
        >
          {presentaciones.map((p) => {
            const unidadesNum = parseInt(p.unidades, 10);
            const ok = unidadesValidas(unidadesNum);
            const modo: ModoVentaPresentacion = p.modo_venta ?? "derivado";
            const r = ok
              ? precioSegunModo(p, unidadesNum)
              : { precio: 0, precioUnitario: 0, costo: 0, margen: null, bajoCosto: false, masBarataQueDetalle: false };
            const costoCaja = ok ? redondear(precioUnidadCosto() * unidadesNum, decCosto) : 0;
            const cppCaja = ok ? costoCppDe(unidadesNum) : 0;
            // El CPP guardado vive en la moneda de COMPRA real del producto; si el usuario
// está viendo otra moneda en el formulario, la comparación no sería válida.
            const cppMismaMoneda = costoMonedaId === (producto?.moneda_costo_id || producto?.moneda_base_id || null);
            const difiereDelCpp =
              cppMismaMoneda && cppCaja > 0 && Math.abs(cppCaja - costoCaja) > Math.pow(10, -decCosto) / 2;
            const num = (n: number) =>
              n.toLocaleString("es-BO", { minimumFractionDigits: decVenta, maximumFractionDigits: decVenta });
            return (
              <Tr key={p.key} className="align-middle">
                <Td>
                  <Input
                    value={p.nombre}
                    onChange={(e) => actualizarPresentacion(p.key, { nombre: e.target.value })}
                    placeholder="Caja, Bolsa..."
                    maxLength={100}
                    className="h-8 w-32"
                  />
                </Td>
                {/* Código de barras de la caja: es lo que se escanea para
                    cobrarla como caja. Vacío = solo agregable desde el desplegable. */}
                <Td>
                  <Input
                    value={p.codigoBarras}
                    onChange={(e) => actualizarPresentacion(p.key, { codigoBarras: e.target.value })}
                    placeholder="Sin código"
                    maxLength={50}
                    aria-invalid={verifCajas[p.key]?.estado === "ocupado"}
                    className={`h-8 w-32 font-mono text-xs ${
                      p.codigoBarras.trim() && verifCajas[p.key]?.estado !== "libre"
                        ? "border-dashed text-muted-foreground"
                        : ""
                    } ${clasesInputCodigo(verifCajas[p.key], "")}`}
                  />
                  {pistaVerificacion(verifCajas[p.key]) && (
                    <p
                      className={`mt-1 flex items-start gap-1 text-[10px] leading-tight font-medium ${
                        verifCajas[p.key]?.estado === "ocupado" ? "text-danger-strong" : "text-success-strong"
                      }`}
                    >
                      {verifCajas[p.key]?.estado === "ocupado" ? (
                        <AlertCircle size={11} className="mt-px shrink-0" />
                      ) : (
                        <CheckCircle2 size={11} className="mt-px shrink-0" />
                      )}
                      <span>{pistaVerificacion(verifCajas[p.key])!.texto}</span>
                    </p>
                  )}
                </Td>
                <Td>
                  <Input
                    type="number"
                    min="2"
                    step="1"
                    value={p.unidades}
                    onChange={(e) => actualizarPresentacion(p.key, { unidades: e.target.value })}
                    placeholder="24"
                    className="h-8 w-16 text-center"
                  />
                </Td>
                <Td>
                  <select
                    value={modo}
                    onChange={(e) =>
                      actualizarPresentacion(p.key, { modo_venta: e.target.value as ModoVentaPresentacion })
                    }
                    className="h-8 w-[6.5rem] rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="derivado">Derivado</option>
                    <option value="fijo">Precio fijo</option>
                    <option value="margen">Por margen</option>
                  </select>
                </Td>
                <Td>
                  <div className="flex flex-col gap-0.5">
                    <PresentacionPriceInput
                      decimales={decCosto}
                      disabled={!costoMoneda}
                      value={ok ? costoCaja : 0}
                      onChange={(val) => cambiarPrecioPresentacionCosto(val, unidadesNum)}
                      placeholder="Calculado..."
                      className="h-8 w-28 text-right font-mono disabled:bg-muted/90 disabled:text-muted-foreground"
                    />
                    {ok && costoMoneda && precioUnidadCosto() > 0 && (
                      <span className="text-xs font-medium text-foreground/80">
                        = {costoMoneda.simbolo}
                        {precioUnidadCosto().toLocaleString("es-BO", {
                          minimumFractionDigits: decCosto,
                          maximumFractionDigits: decCosto,
                        })}{" "}
                        / unid.
                      </span>
                    )}
                    {difiereDelCpp && (
                      <span
                        className="text-[11px] leading-tight text-muted-foreground"
                        title="Costo promedio ponderado real, según las compras registradas. Es el costo que usa el inventario."
                      >
                        CPP real: {costoMoneda?.simbolo}
                        {cppCaja.toLocaleString("es-BO", {
                          minimumFractionDigits: decCosto,
                          maximumFractionDigits: decCosto,
                        })}
                      </span>
                    )}
                  </div>
                </Td>
                <Td>
                  <div className="flex flex-col gap-0.5">
                    {modo === "margen" ? (
                      <>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min="0"
                            step="0.1"
                            value={p.margen_override}
                            onChange={(e) => actualizarPresentacion(p.key, { margen_override: e.target.value })}
                            placeholder="15"
                            className="h-8 w-20 text-right font-mono"
                          />
                          <span className="text-xs text-muted-foreground">%</span>
                        </div>
                        {ok && r.precio > 0 && (
                          <span className="text-xs font-medium text-foreground/80">
                            = {ventaMoneda?.simbolo ?? ""}
                            {num(r.precio)}
                          </span>
                        )}
                      </>
                    ) : modo === "fijo" ? (
                      <PresentacionPriceInput
                        decimales={decVenta}
                        value={p.precio_override === "" ? 0 : Number(p.precio_override)}
                        onChange={(val) => actualizarPresentacion(p.key, { precio_override: Number(val) === 0 ? "" : String(val) })}
                        placeholder="0.00"
                        className="h-8 w-28 text-right font-mono"
                      />
                    ) : (
                      <PresentacionPriceInput
                        decimales={decVenta}
                        value={ok ? r.precio : 0}
                        onChange={(val) => cambiarPrecioPresentacion(val, unidadesNum)}
                        placeholder="Calculado..."
                        className="h-8 w-28 text-right font-mono"
                      />
                    )}
                    {ok && r.precio > 0 && ventaMoneda && (
                      <span className="text-xs font-medium text-foreground/80">
                        = {ventaMoneda.simbolo}
                        {num(r.precioUnitario)} / unid.
                        {r.margen !== null && ` · ${r.margen}%`}
                      </span>
                    )}
                    {ok && r.bajoCosto && (
                      <span className="text-xs font-medium text-red-500">Por debajo del costo</span>
                    )}
                  </div>
                </Td>
                <Td>
                  <Switch
                    checked={p.activo}
                    onCheckedChange={(v) => actualizarPresentacion(p.key, { activo: v })}
                  />
                </Td>
                <Td>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => eliminarPresentacion(p.key)}
                    aria-label="Eliminar presentación"
                    className="h-8 w-8"
                  >
                    <Trash2 size={14} />
                  </Button>
                </Td>
              </Tr>
            );
          })}
        </Table>
      )}
    </div>
  );

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
          {isFormMode && mode === "create" && step < STEPS.length && (
            <Button onClick={nextStep} className="flex-1">
              Siguiente <ChevronRight size={14} />
            </Button>
          )}
          {isFormMode && mode === "create" && step === STEPS.length && (
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

      {/* Tabs para el modo EDICIÓN: cada sección en su propia pestaña */}
      {mode === "edit" && (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setError("");
                setStep(s.id);
              }}
              className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors ${
                s.id === step
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
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
                  className={clasesInputCodigo(verifCodigo, "")}
                  aria-invalid={verifCodigo.estado === "ocupado"}
                />
                {pistaVerificacion(verifCodigo) && (
                  <p
                    className={`mt-1.5 flex items-center gap-1 text-[11px] font-medium ${pistaVerificacion(verifCodigo)!.clase}`}
                  >
                    {verifCodigo.estado === "ocupado" ? (
                      <AlertCircle size={12} className="shrink-0" />
                    ) : (
                      <CheckCircle2 size={12} className="shrink-0" />
                    )}
                    {pistaVerificacion(verifCodigo)!.texto}
                  </p>
                )}
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
            
            <div>
              <Label>Proveedores</Label>
              <div className="flex items-start gap-1.5">
                <ComboboxMulti
                  className="flex-1"
                  options={proveedores.map((p) => ({ value: p.id.toString(), label: p.nombre }))}
                  value={proveedorIds}
                  onChange={setProveedorIds}
                  placeholder="Buscar y seleccionar proveedores..."
                  emptyLabel="Sin proveedores"
                />
                <button
                  type="button"
                  onClick={() => setModalAnidado("proveedor")}
                  title="Nuevo proveedor"
                  aria-label="Nuevo proveedor"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                >
                  <Plus size={16} />
                </button>
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

        {/* STEP 2: Precios y presentaciones (combinados: primero el al mayor,
           debajo los valores unitarios por moneda, todos sincronizados) */}
        {mode === "create" && step === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="space-y-5"
          >
            <p className="text-xs text-muted-foreground">
              Escribe el costo y precio por presentación (Caja, Bolsa...); la unidad se calcula sola.
            </p>

            {renderPresentaciones()}

            <div className="rounded-lg border border-border/60 bg-muted/15 px-4 py-3">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-sm font-medium">Margen de ganancia (%)</Label>
                  <p className="mb-1.5 text-[11px] text-muted-foreground">
                    Con él se autocalcula el precio de venta desde el costo.
                  </p>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={margenGanancia}
                    onChange={(e) => handleMargenChange(e.target.value)}
                    placeholder="0"
                  />
                  {renderBotonRedondear()}
                </div>
                <div>
                  <Label className="text-sm font-medium text-warning-strong">Margen real</Label>
                  <p className="mb-1.5 text-[11px] text-muted-foreground">
                    Precio de venta vs. costo de compra (en la moneda de venta).
                  </p>
                  <div className="flex items-center rounded border border-warning-border bg-warning/10 px-3 py-2">
                    <span className="font-mono text-sm font-semibold text-warning-strong">
                      {margenReal == null ? "—" : `${margenReal.toFixed(2)} %`}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Precios unitarios por moneda
              </span>
              <span className="h-px flex-1 bg-border/60" />
            </div>

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

        {/* STEP 3: Existencias */}
        {mode === "create" && step === 3 && (
          <motion.div
            key="step4"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <StockConPresentaciones
                label="Existencias iniciales"
                valor={stockTexto}
                total={stock}
                unidadActual={stockUnidadId}
                presentaciones={presentaciones}
                factor={factorDe}
                onValor={teclearStock}
                onUnidad={cambiarUnidadStock}
              />
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
                <span className="text-muted-foreground">Presentaciones:</span>
                <span className="font-medium">
                  {presentaciones.length > 0
                    ? presentaciones
                        .map((p) => `${p.nombre.trim() || "—"} ×${p.unidades || "?"}`)
                        .join(", ")
                    : "— (se vende por Unidad)"}
                </span>
                <span className="text-muted-foreground">Existencias:</span>
                <span className="font-mono font-medium">
                  {stock} uds.
                  {factorStock > 1 && (
                    <span className="ml-1 text-muted-foreground">
                      ({stockTexto} ×
                      {presentaciones.find((p) => p.key === stockUnidadId)?.nombre.trim() || "?"})
                    </span>
                  )}
                </span>
              </div>
            </div>
          </motion.div>
        )}

        {/* Edit STEP 1: Información */}
        {mode === "edit" && step === 1 && (
          <motion.div
            key="edit-paso1"
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
                  maxLength={50}
                  className={clasesInputCodigo(verifCodigo, "")}
                  aria-invalid={verifCodigo.estado === "ocupado"}
                />
                {pistaVerificacion(verifCodigo) && (
                  <p
                    className={`mt-1.5 flex items-center gap-1 text-[11px] font-medium ${pistaVerificacion(verifCodigo)!.clase}`}
                  >
                    {verifCodigo.estado === "ocupado" ? (
                      <AlertCircle size={12} className="shrink-0" />
                    ) : (
                      <CheckCircle2 size={12} className="shrink-0" />
                    )}
                    {pistaVerificacion(verifCodigo)!.texto}
                  </p>
                )}
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

            <div>
              <Label>Proveedores</Label>
              <div className="flex items-start gap-1.5">
                <ComboboxMulti
                  className="flex-1"
                  options={proveedores.map((p) => ({ value: p.id.toString(), label: p.nombre }))}
                  value={proveedorIds}
                  onChange={setProveedorIds}
                  placeholder="Buscar y seleccionar proveedores..."
                  emptyLabel="Sin proveedores"
                />
                <button
                  type="button"
                  onClick={() => setModalAnidado("proveedor")}
                  title="Nuevo proveedor"
                  aria-label="Nuevo proveedor"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Edit STEP 2: Precios y presentaciones (combinados) */}
        {mode === "edit" && step === 2 && (
          <motion.div
            key="edit-paso2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="space-y-5"
          >
            <p className="text-xs text-muted-foreground">
              Escribe el costo y precio por presentación (Caja, Bolsa...); la unidad se calcula sola.
            </p>

            {renderPresentaciones()}

            <div className="rounded-lg border border-border/60 bg-muted/15 px-4 py-3">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-sm font-medium">Margen de ganancia (%)</Label>
                  <p className="mb-1.5 text-[11px] text-muted-foreground">
                    Con él se autocalcula el precio de venta desde el costo.
                  </p>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={margenGanancia}
                    onChange={(e) => handleMargenChange(e.target.value)}
                    placeholder="0"
                  />
                  {renderBotonRedondear()}
                </div>
                <div>
                  <Label className="text-sm font-medium text-warning-strong">Margen real</Label>
                  <p className="mb-1.5 text-[11px] text-muted-foreground">
                    Precio de venta vs. costo de compra (en la moneda de venta).
                  </p>
                  <div className="flex items-center rounded border border-warning-border bg-warning/10 px-3 py-2">
                    <span className="font-mono text-sm font-semibold text-warning-strong">
                      {margenReal == null ? "—" : `${margenReal.toFixed(2)} %`}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Precios unitarios por moneda
              </span>
              <span className="h-px flex-1 bg-border/60" />
            </div>

            {effectiveMonedas.map((m) => renderMonedaCard(m, "edit"))}
          </motion.div>
        )}

        {/* Edit STEP 3: Existencias */}
        {mode === "edit" && step === 3 && (
          <motion.div
            key="edit-paso3"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <StockConPresentaciones
                label="Existencias"
                valor={stockTexto}
                total={stock}
                unidadActual={stockUnidadId}
                presentaciones={presentaciones}
                factor={factorDe}
                onValor={teclearStock}
                onUnidad={cambiarUnidadStock}
              />
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

            {margenRealVista != null && (
              <div className="flex items-center justify-between rounded border border-warning-border bg-warning/10 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-warning-strong">
                  Margen real
                </span>
                <span className="font-mono text-sm font-semibold text-warning-strong">
                  {margenRealVista.toFixed(2)} %
                </span>
              </div>
            )}

            <div>
              <Label>Presentaciones</Label>
              {(!producto.presentaciones || producto.presentaciones.length === 0) ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Sin presentaciones (solo Unidad)
                </p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {producto.presentaciones.map((pr) => (
                    <div key={pr.id} className="flex items-center justify-between text-sm gap-2">
                      <span className="text-muted-foreground">
                        {pr.nombre} · 1 = {pr.unidades} unid.
                        {!pr.activo && " (inactiva)"}
                        {pr.modo_venta && pr.modo_venta !== "derivado" && (
                          <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] font-medium uppercase text-muted-foreground/80">
                            {pr.modo_venta === "fijo" ? "precio fijo" : `margen ${pr.margen_override}%`}
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-xs text-foreground font-medium shrink-0">
                        {/* El precio de la presentación vive en la MONEDA DE VENTA
                            del producto (`moneda_base_id`), no en la base del
                            sistema: formatearlo con `es_base` lo rotulaba mal. */}
                        {(() => {
                          const mc = producto.moneda_base_id
                            ? effectiveMonedas.find((m) => m.id === producto.moneda_base_id)?.codigo
                            : undefined;
                          return fmt(pr.precio, mc || "USD");
                        })()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
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
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Si el producto no tiene compras ni ventas registradas, se eliminará definitivamente del sistema. Si ya tiene transacciones asociadas, se moverá de forma segura al <strong>Basurero</strong> para no interferir en ventas, compras ni kardex.
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

