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

interface ProductoSearch {
  id: number;
  codigo: string;
  nombre: string;
  stock: number;
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
  const agregarOIncrementarProducto = (p: ProductoSearch) => {
    setItems((prev) => {
      const index = prev.findIndex((i) => i.producto_id === p.id);
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
        },
      ];
    });
  };

  const agregarPorTexto = async (queryStr: string, limpiar: boolean = true) => {
    const q = queryStr.trim();
    if (!q) return;

    try {
      setSearchLoading(true);
      const res = await fetch(`/api/productos/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        const lista: ProductoSearch[] = Array.isArray(data) ? data : [];
        const lowerQ = q.toLowerCase();

        // Coincidencia exacta por código de barras o único resultado
        const match =
          lista.find((p) => p.codigo.trim().toLowerCase() === lowerQ) ||
          (lista.length === 1 ? lista[0] : null);

        if (match) {
          agregarOIncrementarProducto(match);
          if (limpiar) {
            setSearchQuery("");
            setSearchOpen(false);
          }
          toast(`Producto agregado: ${match.nombre}`, "success");
        } else if (lista.length > 0) {
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
      if (item.tipo === "Salida" && item.cantidad > item.stock_actual) {
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
