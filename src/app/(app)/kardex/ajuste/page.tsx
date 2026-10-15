"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Minus, Plus, Search, Trash2, Save, Package } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface PresentacionBusqueda {
  id: string;
  nombre: string;
  unidades: number;
  activo: boolean;
  codigo?: string | null;
}

interface ProductoSearch {
  id: number;
  codigo: string;
  nombre: string;
  stock: number;
  presentaciones?: PresentacionBusqueda[] | null;
}

interface AjusteItem {
  id: string; // temp id for UI
  producto_id: number;
  codigo: string;
  nombre: string;
  tipo: "Entrada" | "Salida";
  cantidad: number;
  motivo: string;
  stock_actual: number;
  /**
   * CAJA con la que se está ajustando (null = por unidad).
   *
   * OJO: el movimiento se guarda SIEMPRE en UNIDADES, que es la unidad base del
   * inventario. La caja solo cambia cómo se escribe la cantidad: escribir "2"
   * con una caja de 24 unidades equivale a 48. El servidor recalcula ese
   * producto, así que aquí solo se manda el factor.
   */
  presentacion_id?: string | null;
  presentacion_nombre?: string | null;
  presentacion_unidades?: number | null;
  /** Factor de la caja elegida; 1 = por unidad. */
  factor: number;
  /** Cajas del producto, para poder cambiar de Unidad a Caja en la línea. */
  presentaciones?: PresentacionBusqueda[];
}

export default function AjusteKardexPage() {
  const router = useRouter();
  const { toast } = useToast();

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProductoSearch[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<any>(null);

  // Form State
  const [items, setItems] = useState<AjusteItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Product search with debounce ──
  useEffect(() => {
    if (searchQuery.trim().length < 1) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }

    setSearchLoading(true);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/productos/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(Array.isArray(data) ? data : []);
          setSearchOpen(true);
        }
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(searchTimeout.current);
  }, [searchQuery]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── Global Barcode Scanner & Search Logic ──
  /**
   * Agrega (o suma 1) una línea de ajuste. `pres` no es solo cosmético: fija el
   * factor por el que la cantidad se convierte a unidades al guardar.
   *
   * Una unidad y una caja del MISMO producto son líneas DISTINTAS (igual que en
   * el POS): si se pidió "1 caja" y ya hay una línea de "1 unidad", no se deben
   * sumar, porque cuentan cosas distintas.
   */
  const agregarOIncrementarProducto = (p: ProductoSearch, pres?: PresentacionBusqueda | null) => {
    const factor = pres?.unidades && pres.unidades > 1 ? pres.unidades : 1;
    setItems((prev) => {
      const index = prev.findIndex(
        (i) => i.producto_id === p.id && (i.presentacion_id ?? null) === (pres?.id ?? null)
      );
      if (index >= 0) {
        const copy = [...prev];
        copy[index] = {
          ...copy[index],
          cantidad: copy[index].cantidad + 1,
        };
        return copy;
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          producto_id: p.id,
          codigo: p.codigo,
          nombre: p.nombre,
          tipo: "Entrada",
          cantidad: 1,
          motivo: "Ajuste manual",
          stock_actual: p.stock,
          presentacion_id: pres?.id ?? null,
          presentacion_nombre: pres?.nombre ?? null,
          presentacion_unidades: pres?.unidades ?? null,
          factor,
          presentaciones: (p.presentaciones ?? []).filter((pr) => pr.activo !== false),
        },
      ];
    });
  };

  /** Cambia la caja de una línea y recalcula su equivalencia en unidades. */
  const handleCambiarPresentacion = (itemId: string, presentacionId: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const cajas = item.presentaciones ?? [];
        const pres = cajas.find((pr) => pr.id === presentacionId) || null;
        return {
          ...item,
          presentacion_id: pres?.id ?? null,
          presentacion_nombre: pres?.nombre ?? null,
          presentacion_unidades: pres?.unidades ?? null,
          factor: pres?.unidades && pres.unidades > 1 ? pres.unidades : 1,
        };
      })
    );
  };

  const agregarPorTexto = async (queryStr: string, limpiar: boolean = true) => {
    const q = queryStr.trim();
    if (!q) return;

    try {
      setSearchLoading(true);
      // Endpoint único de resolución: decide producto-vs-caja con la misma
      // regla que el POS, en vez de comparar códigos a mano aquí.
      const res = await fetch(`/api/productos/por-codigo?codigo=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.found && data.producto) {
          const prod = data.producto as ProductoSearch;
          const pres = (data.presentacion as PresentacionBusqueda | null) ?? null;
          agregarOIncrementarProducto(prod, pres);
          if (limpiar) {
            setSearchQuery("");
            setSearchOpen(false);
          }
          toast(
            pres ? `${prod.nombre} (${pres.nombre} ×${pres.unidades}) agregado` : `Producto agregado: ${prod.nombre}`,
            "success"
          );
          return;
        }
      }

      // Sin coincidencia unívoca: se muestran los candidatos para elegir a mano.
      const fallback = await fetch(`/api/productos/search?q=${encodeURIComponent(q)}`);
      if (fallback.ok) {
        const data = await fallback.json();
        const lista: ProductoSearch[] = Array.isArray(data) ? data : [];
        if (lista.length > 0) {
          setSearchResults(lista);
          setSearchOpen(true);
        } else {
          toast("No se encontró ningún producto con ese código", "error");
        }
      } else {
        toast("Error al buscar producto", "error");
      }
    } catch {
      toast("Error al buscar producto", "error");
    } finally {
      setSearchLoading(false);
    }
  };

  // Ref con la versión más reciente para el listener global del lector de barras
  const agregarPorTextoRef = useRef(agregarPorTexto);
  useEffect(() => {
    agregarPorTextoRef.current = agregarPorTexto;
  });

  const barcodeBuffer = useRef("");
  const lastKeyTime = useRef<number>(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return; // Ignorar si el usuario está escribiendo en un input
      }

      const now = Date.now();
      if (now - lastKeyTime.current > 50) {
        barcodeBuffer.current = ""; // Resetear si es tipeo humano lento
      }
      lastKeyTime.current = now;

      if (e.key === "Enter") {
        const code = barcodeBuffer.current.trim();
        if (code) {
          void agregarPorTextoRef.current(code, true);
        }
        barcodeBuffer.current = "";
      } else if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const code = searchQuery.trim();
      if (code) {
        void agregarPorTexto(code, true);
      }
    }
  };

  const handleSelectProduct = (p: ProductoSearch) => {
    agregarOIncrementarProducto(p);
    setSearchQuery("");
    setSearchOpen(false);
  };

  const handleUpdateItem = (id: string, field: keyof AjusteItem, value: any) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          return { ...item, [field]: value };
        }
        return item;
      })
    );
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleSave = async () => {
    if (items.length === 0) {
      toast("Agrega al menos un producto para ajustar", "warning");
      return;
    }

    for (const item of items) {
      if (item.cantidad <= 0 || isNaN(item.cantidad)) {
        toast(`La cantidad de ${item.nombre} debe ser mayor a 0`, "warning");
        return;
      }
      // La validación de existencias compara en UNIDADES, que es como se guarda
      // el movimiento: "1 caja" de 24 con 20 en stock no alcanza.
      const unidades = item.cantidad * item.factor;
      if (item.tipo === "Salida" && unidades > item.stock_actual) {
        toast(`Existencias insuficientes para ${item.nombre} (Existencias: ${item.stock_actual})`, "error");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/kardex/ajustes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      if (res.ok) {
        toast("Ajustes registrados con éxito", "success");
        router.push("/kardex");
      } else {
        const errorData = await res.json();
        toast(errorData.error || "Error al registrar ajustes", "error");
      }
    } catch (err) {
      console.error(err);
      toast("Error de conexión", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {/* Header */}
      <div className="flex-none bg-card border-b border-border/60">
        <div className="flex h-16 items-center px-4 sm:px-6 justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:flex text-muted-foreground hover:text-foreground"
              onClick={() => router.back()}
            >
              <ArrowLeft size={18} />
            </Button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Ajuste de Inventario</h1>
              <p className="text-sm text-muted-foreground hidden sm:block">Entradas y salidas manuales</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => router.back()}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting || items.length === 0} className="shadow-md shadow-primary/20">
              {isSubmitting ? <Loader2 size={16} className="animate-spin mr-2" /> : <Save size={16} className="mr-2" />}
              Guardar Ajustes
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-muted/20 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          
          {/* Main Card */}
          <div className="rounded-2xl border border-border/60 bg-card shadow-sm">
            
            {/* Search Bar */}
            <div className="p-4 sm:p-6 border-b border-border/60 bg-muted/10 rounded-t-2xl">
              <div className="relative max-w-xl mx-auto" ref={searchRef}>
                <div className="relative group">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 transition-colors group-focus-within:text-primary" size={18} />
                  <Input
                    placeholder="Escanear código de barras o buscar producto..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    className="pl-10 h-12 bg-background/50 border-border/60 hover:bg-background focus:bg-background transition-colors text-base rounded-xl"
                  />
                  {searchLoading && (
                    <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                      <Loader2 size={16} className="animate-spin" />
                    </div>
                  )}
                </div>

                <AnimatePresence>
                  {searchOpen && searchResults.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.15 }}
                      className="absolute left-0 right-0 top-full z-50 mt-2 rounded-xl border border-border/60 bg-card shadow-xl overflow-hidden max-h-[300px] overflow-y-auto"
                    >
                      <div className="py-2">
                        {searchResults.map((p) => (
                          <button
                            key={p.id}
                            className="w-full px-4 py-2.5 text-left hover:bg-muted/50 transition-colors flex items-center justify-between group"
                            onClick={() => handleSelectProduct(p)}
                          >
                            <div>
                              <div className="font-medium text-foreground group-hover:text-primary transition-colors">{p.nombre}</div>
                              <div className="text-xs text-muted-foreground font-mono mt-0.5">{p.codigo}</div>
                            </div>
                            <div className="text-sm font-mono bg-muted/50 px-2 py-1 rounded-md text-muted-foreground group-hover:bg-background group-hover:text-foreground transition-colors">
                              Existencias: {p.stock}
                            </div>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Items Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/30 text-muted-foreground border-b border-border/60">
                  <tr>
                    <th className="px-6 py-3 font-medium">Producto</th>
                    <th className="px-6 py-3 font-medium">Tipo</th>
                    <th className="px-6 py-3 font-medium w-32">Cantidad</th>
                    <th className="px-6 py-3 font-medium">Motivo</th>
                    <th className="px-6 py-3 font-medium w-16 text-center">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center text-muted-foreground/50">
                            <Package size={24} />
                          </div>
                          <p>Busca un producto arriba para agregarlo al ajuste</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/10 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-medium text-foreground">{item.nombre}</div>
                          <div className="text-xs text-muted-foreground font-mono flex items-center gap-2 mt-1">
                            <span>{item.codigo}</span>
                            <span className="opacity-50">•</span>
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[10px]",
                              item.stock_actual > 0 ? "bg-primary/10 text-primary" : "bg-danger/10 text-danger"
                            )}>Existencias actuales: {item.stock_actual}</span>
                          </div>
                          {/* Selector Unidad / Caja. El movimiento se sigue
                              guardando en unidades: la caja solo multiplica. */}
                          {(item.presentaciones ?? []).length > 0 && (
                            <div className="mt-2 flex flex-col gap-1">
                              <Select
                                value={item.presentacion_id ?? ""}
                                onChange={(e) => handleCambiarPresentacion(item.id, e.target.value)}
                                className="w-full sm:w-56 bg-background text-xs"
                                aria-label="Unidad de venta"
                              >
                                <option value="">Unidad · {item.stock_actual} disp.</option>
                                {(item.presentaciones ?? []).map((pr) => (
                                  <option key={pr.id} value={pr.id}>
                                    {pr.nombre} ×{pr.unidades} · {Math.floor(item.stock_actual / pr.unidades)} disp.
                                    {pr.codigo ? ` · ${pr.codigo}` : ""}
                                  </option>
                                ))}
                              </Select>
                              {item.factor > 1 && (
                                <span className="text-[11px] text-muted-foreground font-mono">
                                  {item.cantidad || 0} × {item.factor} ={" "}
                                  <span className="font-bold text-foreground">
                                    {(item.cantidad || 0) * item.factor}
                                  </span>{" "}
                                  unidades
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <Select 
                            value={item.tipo} 
                            onChange={(e) => handleUpdateItem(item.id, "tipo", e.target.value)}
                            className="w-full sm:w-32 bg-background"
                          >
                            <option value="Entrada">Entrada (+)</option>
                            <option value="Salida">Salida (-)</option>
                          </Select>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center">
                            <button
                              className="w-8 h-8 flex items-center justify-center border border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors rounded-l-md"
                              onClick={() => {
                                const newQ = Math.max(1, item.cantidad - 1);
                                handleUpdateItem(item.id, "cantidad", newQ);
                              }}
                            >
                              <Minus size={14} />
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={item.cantidad || ""}
                              onChange={(e) => {
                                const val = parseInt(e.target.value);
                                handleUpdateItem(item.id, "cantidad", isNaN(val) ? "" : val);
                              }}
                              className="w-16 h-8 text-center border-y border-border/60 bg-background text-sm focus:outline-none focus:border-primary/50"
                            />
                            <button
                              className="w-8 h-8 flex items-center justify-center border border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors rounded-r-md"
                              onClick={() => {
                                handleUpdateItem(item.id, "cantidad", item.cantidad + 1);
                              }}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                          {item.tipo === "Salida" && item.cantidad > item.stock_actual && (
                            <div className="text-[10px] text-danger mt-1 font-medium bg-danger/10 px-1 py-0.5 rounded inline-block">
                              Supera el stock
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <Input
                            placeholder="Ej: Conteo, Daño..."
                            value={item.motivo}
                            onChange={(e) => handleUpdateItem(item.id, "motivo", e.target.value)}
                            className="bg-background w-full min-w-[150px]"
                          />
                        </td>
                        <td className="px-6 py-4 text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-danger hover:bg-danger/10"
                            onClick={() => handleRemoveItem(item.id)}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            
          </div>

        </div>
      </div>
    </div>
  );
}
