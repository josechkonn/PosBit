import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Modal,
  AppState,
  Share,
  Image,
  PanResponder,
  Animated,
  Alert,
} from "react-native";
import Feather from "./src/lib/icons";
import {
  LocalMoneda,
  LocalConfiguracionGlobal,
  LocalCaja,
  LocalMetodoPago,
  LocalCategoria,
  LocalProducto,
  LocalPresentacion,
  LocalCliente,
  LocalCredito,
  LocalAbono,
  LocalVentaPendiente,
  LocalVentaRemota,
  LocalVentaItemRemoto,
  getLocalMonedas,
  getLocalConfiguracionGlobal,
  getLocalCajas,
  getLocalMetodosPago,
  getLocalCategorias,
  getLocalProductos,
  getLocalClientes,
  getLocalCreditos,
  getLocalAbonosByCredito,
  getLocalVentasRemotas,
  getLocalVentaItemsRemotos,
  getVentasLocales,
  getAbonosLocalesPendientes,
  createOfflineSale,
  getMeta,
} from "./src/lib/local-db";
import {
  getStoredSession,
  clearStoredSession,
  loginMobile,
  syncMobileWithCloud,
  saveClienteCloud,
  patchClienteLimiteCloud,
  registrarAbonoMobile,
  pagarDeudaGlobalMobile,
  fetchClientePerfilCloud,
} from "./src/lib/sync-client";

const DEFAULT_CLOUD_URL = "https://pos-bit-pi.vercel.app";
const AUTO_SYNC_INTERVAL_MS = 10_000;

/**
 * Paleta oficial PosBit v2.6 "Con Alma" (idéntica a src/app/globals.css)
 */
const THEME = {
  background: "#eae9e7",
  foreground: "#1c1917",
  card: "#ffffff",
  border: "#d6d3ce",
  inputBg: "#f5f4f2",
  primary: "#f97316",
  primary600: "#ea580c",
  primary700: "#c2410c",
  accent: "#fff7ed",
  secondary: "#fef3e8",
  muted: "#e5e2de",
  mutedForeground: "#6b6560",
  sidebar: "#1c1917",
  sidebarForeground: "#a8a29e",
  sidebarAccent: "#292524",
  sidebarBorder: "#292524",
  success: "#10b981",
  successStrong: "#047857",
  successSoft: "#ecfdf5",
  successBorder: "#a7f3d0",
  warning: "#f59e0b",
  warningStrong: "#b45309",
  warningSoft: "#fffbeb",
  warningBorder: "#fde68a",
  danger: "#ef4444",
  dangerStrong: "#b91c1c",
  dangerSoft: "#fef2f2",
  dangerBorder: "#fecaca",
  info: "#3b82f6",
  infoStrong: "#1d4ed8",
  infoSoft: "#eff6ff",
  infoBorder: "#bfdbfe",
  rose: "#f43f5e",
  sky: "#0ea5e9",
};

type AppRoute = "dashboard" | "pos" | "clientes" | "creditos" | "ventas" | "productos" | "config";

interface CartItem {
  product: LocalProducto;
  qty: number;
  presentacion: LocalPresentacion | null;
  descuentoStr?: string;
}

interface HeldCart {
  id: number;
  items: CartItem[];
  clienteId: string | null;
  hora: string;
}

interface LineaPago {
  key: number;
  metodoId: string;
  montoStr: string;
}

interface CobroExtra {
  key: number;
  concepto: string;
  montoStr: string;
  monedaCodigo: string;
}

interface PerfilMoneda {
  moneda_id: string;
  codigo: string;
  simbolo: string;
  es_base: boolean;
  decimales: number;
  limite: number;
  deuda: number;
}

const PRESETS_COBRO_EXTRA = ["Producto", "Delivery", "Envío", "Bolsa", "Propina", "Servicio"];

function claveLinea(productoId: number, presentacionId?: string | null): string {
  return `${productoId}::${presentacionId ?? "unit"}`;
}

function claveDe(item: CartItem): string {
  return claveLinea(item.product.id, item.presentacion?.id);
}

function unidadesDeLinea(item: CartItem): number {
  return item.qty * (item.presentacion?.unidades ?? 1);
}

function maxQtyDeLinea(item: CartItem): number {
  const factor = item.presentacion?.unidades ?? 1;
  return Math.max(0, Math.floor(item.product.stock / factor));
}

function userInitials(name?: string | null): string {
  if (!name) return "PB";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getMetodoEmoji(tipo?: string, nombre?: string): string {
  const t = `${tipo || ""} ${nombre || ""}`.toLowerCase();
  if (t.includes("efectivo") || t.includes("cash")) return "💵";
  if (t.includes("punto") || t.includes("tarjeta") || t.includes("card")) return "💳";
  if (t.includes("pago móvil") || t.includes("pago movil") || t.includes("movil")) return "📱";
  if (t.includes("zelle") || t.includes("binance") || t.includes("zinli")) return "⚡";
  if (t.includes("transferencia") || t.includes("banco") || t.includes("banesco")) return "🏦";
  return "💰";
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<{
    serverUrl: string;
    token: string;
    user: { id: string; name: string; email: string; role: string };
  } | null>(null);

  // Login Form
  const [serverUrlInput, setServerUrlInput] = useState(DEFAULT_CLOUD_URL);
  const [showAdvancedServer, setShowAdvancedServer] = useState(false);
  const [emailInput, setEmailInput] = useState("admin@admin.com");
  const [passwordInput, setPasswordInput] = useState("123123123");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Navigation & Drawer
  const [route, setRoute] = useState<AppRoute>("pos");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  // Catalog & Data State
  const [monedas, setMonedas] = useState<LocalMoneda[]>([]);
  const [cfgGlobal, setCfgGlobal] = useState<LocalConfiguracionGlobal>({
    metodo_conversion_compras: "directa",
    metodo_conversion_ventas: "directa",
    moneda_transito_compras_id: null,
    moneda_transito_ventas_id: null,
  });
  const [cajas, setCajas] = useState<LocalCaja[]>([]);
  const [metodosPago, setMetodosPago] = useState<LocalMetodoPago[]>([]);
  const [categorias, setCategorias] = useState<LocalCategoria[]>([]);
  const [productos, setProductos] = useState<LocalProducto[]>([]);
  const [clientes, setClientes] = useState<LocalCliente[]>([]);
  const [creditosData, setCreditosData] = useState<{
    creditos: LocalCredito[];
    por_cobrar: Array<{ codigo: string; simbolo: string; monto: number }>;
    pendientes: number;
    pagados: number;
  }>({ creditos: [], por_cobrar: [], pendientes: 0, pagados: 0 });
  const [ventasLocales, setVentasLocales] = useState<LocalVentaPendiente[]>([]);
  const [ventasRemotas, setVentasRemotas] = useState<LocalVentaRemota[]>([]);
  const [ventaItemsRemotos, setVentaItemsRemotos] = useState<LocalVentaItemRemoto[]>([]);
  const [abonosPendCount, setAbonosPendCount] = useState(0);

  // Sync Status
  const [syncing, setSyncing] = useState(false);
  const [lastSyncIso, setLastSyncIso] = useState<string | null>(null);
  const [syncOnline, setSyncOnline] = useState(true);
  const syncInFlightRef = useRef(false);

  // POS State
  const [posSubView, setPosSubView] = useState<"catalogo" | "carrito">("catalogo");
  const [posSearch, setPosSearch] = useState("");
  const [posCategoriaId, setPosCategoriaId] = useState<string | null>(null);
  const [monedaSeleccionada, setMonedaSeleccionada] = useState<string>("COP");
  const [metodoPagoSeleccionado, setMetodoPagoSeleccionado] = useState<string>("");
  const [cajaSeleccionada, setCajaSeleccionada] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [showHeldModal, setShowHeldModal] = useState(false);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [showClientePickerModal, setShowClientePickerModal] = useState(false);
  const [clientePickerSearch, setClientePickerSearch] = useState("");
  const [checkoutClientSearch, setCheckoutClientSearch] = useState("");
  const [checkoutClientDropdownOpen, setCheckoutClientDropdownOpen] = useState(false);
  const [cartClientSearch, setCartClientSearch] = useState("");
  const [cartClientDropdownOpen, setCartClientDropdownOpen] = useState(false);

  // POS Checkout Modal State
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showMetodoPickerModal, setShowMetodoPickerModal] = useState(false);
  const [checkoutMetodoDropdownOpen, setCheckoutMetodoDropdownOpen] = useState(false);
  const checkoutScrollRef = useRef<ScrollView>(null);
  const checkoutClientSearchRef = useRef<TextInput>(null);
  const [modoMixto, setModoMixto] = useState(false);
  const [lineasPago, setLineasPago] = useState<LineaPago[]>([]);
  const [cobrosExtra, setCobrosExtra] = useState<CobroExtra[]>([]);
  const [showCobrosExtra, setShowCobrosExtra] = useState(false);
  const [descuentoGlobalStr, setDescuentoGlobalStr] = useState("");
  const [observacionesVenta, setObservacionesVenta] = useState("");
  const [submittingSale, setSubmittingSale] = useState(false);
  const [grantingCredit, setGrantingCredit] = useState(false);
  const [creditoSolicitado, setCreditoSolicitado] = useState(false);
  const [limiteInputStr, setLimiteInputStr] = useState("");
  const [receiptModal, setReceiptModal] = useState<any | null>(null);

  // Modal Finalizar Venta: Arrastrar hacia abajo para cerrar (PanResponder suave y sensible)
  const checkoutSheetTranslateY = useRef(new Animated.Value(0)).current;
  const checkoutPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gs) => {
        return gs.dy > 3 && Math.abs(gs.dy) > Math.abs(gs.dx);
      },
      onMoveShouldSetPanResponderCapture: (_, gs) => {
        return gs.dy > 5 && Math.abs(gs.dy) > Math.abs(gs.dx);
      },
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) {
          checkoutSheetTranslateY.setValue(gs.dy);
        }
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 60 || gs.vy > 0.3) {
          Animated.timing(checkoutSheetTranslateY, {
            toValue: 650,
            duration: 180,
            useNativeDriver: true,
          }).start(() => {
            setShowCheckoutModal(false);
            checkoutSheetTranslateY.setValue(0);
          });
        } else {
          Animated.spring(checkoutSheetTranslateY, {
            toValue: 0,
            bounciness: 4,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const handleCloseCheckout = useCallback(() => {
    setShowCheckoutModal(false);
    setCreditoSolicitado(false);
    checkoutSheetTranslateY.setValue(0);
  }, [checkoutSheetTranslateY]);

  // Clientes Module & Perfil del Cliente State
  const [clientesSearch, setClientesSearch] = useState("");
  const [perfilClienteId, setPerfilClienteId] = useState<string | null>(null);
  const [perfilTab, setPerfilTab] = useState<"ventas" | "creditos" | "retornos" | "productos">("ventas");
  const [perfilCloudData, setPerfilCloudData] = useState<{
    detalle: any | null;
    ventas: any[];
    ventaItems: any[];
    creditos: any[];
    retornos: any[];
    retornoItems: any[];
  } | null>(null);
  const [perfilLoadingCloud, setPerfilLoadingCloud] = useState(false);
  const [ventaDetailModal, setVentaDetailModal] = useState<{ venta: any; items: any[] } | null>(null);

  // Modal Ajustar Límite de Crédito (clon de CreditoLimiteModal web)
  const [creditoLimiteCliente, setCreditoLimiteCliente] = useState<LocalCliente | null>(null);
  const [clLimMonedaId, setClLimMonedaId] = useState<string>("");
  const [clLimOperacion, setClLimOperacion] = useState<"add" | "remove">("add");
  const [clLimMontoStr, setClLimMontoStr] = useState<string>("");
  const [savingCreditoLimite, setSavingCreditoLimite] = useState(false);

  // Modal Pagar Deuda Global / Abono Global FIFO (clon de PagarDeudaModal web)
  const [pagoDeudaCliente, setPagoDeudaCliente] = useState<LocalCliente | null>(null);
  const [pdMonedaId, setPdMonedaId] = useState<string>("");
  const [pdMontoStr, setPdMontoStr] = useState<string>("");
  const [pdMetodoPagoId, setPdMetodoPagoId] = useState<string>("");
  const [pdCajaId, setPdCajaId] = useState<string>("");
  const [pdObs, setPdObs] = useState<string>("");
  const [savingPagoDeuda, setSavingPagoDeuda] = useState(false);

  const [clienteModalOpen, setClienteModalOpen] = useState(false);
  const [editingCliente, setEditingCliente] = useState<LocalCliente | null>(null);
  const [clFormNombre, setClFormNombre] = useState("");
  const [clFormTipo, setClFormTipo] = useState<"Persona Natural" | "Empresa">("Persona Natural");
  const [clFormDoc, setClFormDoc] = useState("");
  const [clFormTel, setClFormTel] = useState("");
  const [clFormEmail, setClFormEmail] = useState("");
  const [clFormCiudad, setClFormCiudad] = useState("");
  const [clFormDir, setClFormDir] = useState("");
  const [clFormRecibeCredito, setClFormRecibeCredito] = useState(false);
  const [clFormLimites, setClFormLimites] = useState<Record<string, string>>({});
  const [savingCliente, setSavingCliente] = useState(false);

  // Créditos / Deudores Module State
  const [creditosEstadoFilter, setCreditosEstadoFilter] = useState<"Todos" | "Pendiente" | "Parcial" | "Pagado">("Todos");
  const [creditosSearch, setCreditosSearch] = useState("");
  const [abonoModalCredito, setAbonoModalCredito] = useState<LocalCredito | null>(null);
  const [abonoModoMixto, setAbonoModoMixto] = useState(false);
  const [abonoMontoStr, setAbonoMontoStr] = useState("");
  const [abonoMetodoId, setAbonoMetodoId] = useState("");
  const [abonoLineas, setAbonoLineas] = useState<LineaPago[]>([]);
  const [abonoObs, setAbonoObs] = useState("");
  const [savingAbono, setSavingAbono] = useState(false);
  const [historialCredito, setHistorialCredito] = useState<LocalCredito | null>(null);
  const [historialAbonos, setHistorialAbonos] = useState<LocalAbono[]>([]);

  // Productos & Ventas Search
  const [productosSearch, setProductosSearch] = useState("");
  const [ventasSearch, setVentasSearch] = useState("");

  const showToast = useCallback((text: string, type: "success" | "error" | "info" = "success") => {
    setToastMsg({ text, type });
    setTimeout(() => {
      setToastMsg((prev) => (prev?.text === text ? null : prev));
    }, 3200);
  }, []);

  const refreshLocalState = useCallback(async (search = "") => {
    const [m, cfg, c, mp, cats, p, cls, creds, vl, vr, vir, abPend, lastIso] = await Promise.all([
      getLocalMonedas(),
      getLocalConfiguracionGlobal(),
      getLocalCajas(),
      getLocalMetodosPago(),
      getLocalCategorias(),
      getLocalProductos(search),
      getLocalClientes(),
      getLocalCreditos(),
      getVentasLocales(),
      getLocalVentasRemotas(),
      getLocalVentaItemsRemotos(),
      getAbonosLocalesPendientes(),
      getMeta("last_pull_iso"),
    ]);

    setMonedas(m);
    setCfgGlobal(cfg);
    setCajas(c);
    setMetodosPago(mp);
    setCategorias(cats);
    setProductos(p);
    setClientes(cls);
    setCreditosData(creds);
    setVentasLocales(vl);
    setVentasRemotas(vr);
    setVentaItemsRemotos(vir);
    setAbonosPendCount(abPend.length);
    setLastSyncIso(lastIso);

    if (m.length > 0) {
      setMonedaSeleccionada((prev) => {
        if (prev && m.some((x) => x.codigo === prev)) return prev;
        const cop = m.find((x) => x.codigo === "COP");
        if (cop) return "COP";
        const base = m.find((x) => x.es_base === 1) || m[0];
        return base.codigo;
      });
    }
    if (mp.length > 0) {
      setMetodoPagoSeleccionado((prev) => {
        if (prev && mp.some((x) => String(x.id) === String(prev))) {
          return prev;
        }
        const mpCop = mp.find((x) => x.moneda_codigo === "COP") || mp[0];
        return String(mpCop.id);
      });
      setCajaSeleccionada((prev) => {
        if (prev && c.some((cx) => String(cx.id) === String(prev))) {
          return prev;
        }
        const curMp = mp.find((x) => String(x.id) === String(metodoPagoSeleccionado));
        if (curMp?.caja_id) return String(curMp.caja_id);
        return c[0]?.id ? String(c[0].id) : "";
      });
    }
  }, []);

  useEffect(() => {
    let unmounted = false;
    const safetyTimer = setTimeout(() => {
      if (!unmounted) setBooting(false);
    }, 2500);

    (async () => {
      try {
        const stored = await getStoredSession();
        if (stored.serverUrl && !unmounted) setServerUrlInput(stored.serverUrl);
        if (stored.serverUrl && stored.token && stored.user && !unmounted) {
          setSession({
            serverUrl: stored.serverUrl,
            token: stored.token,
            user: stored.user,
          });
          await refreshLocalState().catch((err) => console.warn("refreshLocalState boot warning:", err));
        }
      } catch (e) {
        console.warn("Boot error:", e);
      } finally {
        clearTimeout(safetyTimer);
        if (!unmounted) setBooting(false);
      }
    })();

    return () => {
      unmounted = true;
      clearTimeout(safetyTimer);
    };
  }, [refreshLocalState]);

  const posSearchRef = useRef(posSearch);
  posSearchRef.current = posSearch;

  const runSilentSync = useCallback(async () => {
    if (!session || syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    setSyncing(true);
    try {
      await syncMobileWithCloud();
      setSyncOnline(true);
      await refreshLocalState(posSearchRef.current);
    } catch (err) {
      console.warn("Silent sync warning:", err);
      setSyncOnline(false);
    } finally {
      syncInFlightRef.current = false;
      setSyncing(false);
    }
  }, [session, refreshLocalState]);

  useEffect(() => {
    if (!session) return;
    runSilentSync();
    const interval = setInterval(runSilentSync, 45_000);
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") runSilentSync();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [session, runSilentSync]);

  useEffect(() => {
    if (!session) return;
    const t = setTimeout(() => {
      getLocalProductos(posSearch).then(setProductos);
    }, 200);
    return () => clearTimeout(t);
  }, [posSearch, session]);

  // ── Motor Oficial de Monedas y Conversión (idéntico a src/lib/money.ts de la Web) ──
  const activeMonedaObj = useMemo(
    () => monedas.find((m) => m.codigo === monedaSeleccionada) || monedas[0] || null,
    [monedas, monedaSeleccionada]
  );

  const baseMonedaSistema = useMemo(
    () => monedas.find((m) => m.es_base === 1) || monedas[0] || null,
    [monedas]
  );

  const decMoneda = useCallback(
    (cod?: string) => {
      const m = monedas.find((x) => x.codigo === (cod || monedaSeleccionada));
      return Number(m?.decimales ?? 2);
    },
    [monedas, monedaSeleccionada]
  );

  const redondear = useCallback((valor: number, decimales = 2): number => {
    if (!Number.isFinite(valor)) return 0;
    const factor = Math.pow(10, decimales);
    return Math.round((valor + Number.EPSILON) * factor) / factor;
  }, []);

  const tasaNumerica = useCallback((m: LocalMoneda | null | undefined): number => {
    const t = Number(m?.tasa);
    return Number.isFinite(t) && t > 0 ? t : 1;
  }, []);

  const tasaDirectaUsd = useCallback((m: LocalMoneda | null | undefined): number | null => {
    if (!m?.usa_tasa_usd_directa) return null;
    const t = Number(m.tasa_usd_directa);
    return Number.isFinite(t) && t > 0 ? t : null;
  }, []);

  const tasaUsd = useCallback(
    (moneda: LocalMoneda | null | undefined, catalogo: LocalMoneda[] = monedas): number => {
      if (!moneda) return 1;
      const directa = tasaDirectaUsd(moneda);
      if (directa !== null) return directa;

      let tasa = tasaNumerica(moneda);
      const vistos = new Set<string>([String(moneda.id)]);
      let refId = moneda.tasa_ref_moneda_id ?? null;
      let saltos = 0;

      while (refId !== null && refId !== undefined && saltos++ < 10) {
        const refClave = String(refId);
        if (vistos.has(refClave)) break;
        vistos.add(refClave);
        const ref = catalogo.find((x) => String(x.id) === refClave);
        if (!ref) break;
        tasa *= tasaNumerica(ref);
        refId = ref.tasa_ref_moneda_id ?? null;
      }
      return tasa;
    },
    [monedas, tasaDirectaUsd, tasaNumerica]
  );

  const tasaPar = useCallback(
    (
      desde: LocalMoneda | null | undefined,
      hasta: LocalMoneda | null | undefined,
      catalogo: LocalMoneda[] = monedas
    ): number => {
      if (!desde || !hasta) return 1;
      if (String(desde.id) === String(hasta.id)) return 1;

      const refDesde =
        desde.tasa_ref_moneda_id == null ? null : String(desde.tasa_ref_moneda_id);
      if (refDesde !== null && refDesde === String(hasta.id)) {
        const x =
          tasaDirectaUsd(desde) !== null
            ? tasaNumerica(desde)
            : tasaUsd(desde, catalogo) / tasaUsd(hasta, catalogo);
        return x > 0 ? 1 / x : 1;
      }

      const refHasta =
        hasta.tasa_ref_moneda_id == null ? null : String(hasta.tasa_ref_moneda_id);
      if (refHasta !== null && refHasta === String(desde.id)) {
        const x =
          tasaDirectaUsd(hasta) !== null
            ? tasaNumerica(hasta)
            : tasaUsd(hasta, catalogo) / tasaUsd(desde, catalogo);
        return x > 0 ? x : 1;
      }

      const tDesde = tasaUsd(desde, catalogo);
      if (tDesde <= 0) return 1;
      return tasaUsd(hasta, catalogo) / tDesde;
    },
    [monedas, tasaDirectaUsd, tasaNumerica, tasaUsd]
  );

  const convertirConRegla = useCallback(
    (
      monto: number,
      desde: LocalMoneda | null | undefined,
      hasta: LocalMoneda | null | undefined,
      lado: "ventas" | "compras" = "ventas",
      decimales?: number
    ): number => {
      if (!Number.isFinite(monto) || !desde || !hasta) return 0;
      if (String(desde.id) === String(hasta.id)) return monto;
      const dec = decimales ?? Number(hasta.decimales ?? 2);
      const metodo =
        lado === "compras"
          ? cfgGlobal.metodo_conversion_compras
          : cfgGlobal.metodo_conversion_ventas;
      const transitoId =
        lado === "compras"
          ? cfgGlobal.moneda_transito_compras_id
          : cfgGlobal.moneda_transito_ventas_id;
      const monedaTransito = transitoId
        ? monedas.find((m) => String(m.id) === String(transitoId)) || null
        : null;

      if (metodo === "triangulacion" && monedaTransito) {
        const factor =
          tasaPar(desde, monedaTransito, monedas) *
          tasaPar(monedaTransito, hasta, monedas);
        return redondear(monto * factor, dec);
      }
      return redondear(monto * tasaPar(desde, hasta, monedas), dec);
    },
    [cfgGlobal, monedas, tasaPar, redondear]
  );

  const convertirMonto = useCallback(
    (
      monto: number,
      origenIdOrCod: string | null | undefined,
      destinoCod: string,
      lado: "ventas" | "compras" = "ventas"
    ): number => {
      if (!monto || !Number.isFinite(monto)) return 0;
      const origen =
        monedas.find(
          (m) => String(m.id) === String(origenIdOrCod) || m.codigo === origenIdOrCod
        ) ||
        baseMonedaSistema ||
        monedas[0];
      const destino =
        monedas.find(
          (m) => m.codigo === destinoCod || String(m.id) === String(destinoCod)
        ) || activeMonedaObj;
      if (!origen || !destino) return monto;
      return convertirConRegla(monto, origen, destino, lado, Number(destino.decimales ?? 2));
    },
    [monedas, baseMonedaSistema, activeMonedaObj, convertirConRegla]
  );

  const fmt = useCallback(
    (val: number, codMoneda?: string) => {
      const cod = codMoneda || monedaSeleccionada;
      const m = monedas.find((x) => x.codigo === cod) || activeMonedaObj;
      const sym = m?.simbolo || "$";
      const dec = Number(m?.decimales ?? 2);
      return `${sym} ${(Number(val) || 0).toLocaleString("es-VE", {
        minimumFractionDigits: Math.min(2, dec),
        maximumFractionDigits: dec,
      })}`;
    },
    [monedas, monedaSeleccionada, activeMonedaObj]
  );

  const precioUnitarioEnMoneda = useCallback(
    (p: LocalProducto, codMoneda = monedaSeleccionada): number => {
      return convertirMonto(Number(p.precio_base) || 0, p.moneda_base_id, codMoneda, "ventas");
    },
    [convertirMonto, monedaSeleccionada]
  );

  const costoUnitarioEnMoneda = useCallback(
    (p: LocalProducto, codMoneda = monedaSeleccionada): number => {
      return convertirMonto(
        Number(p.costo_base) || 0,
        p.moneda_costo_id || p.moneda_base_id,
        codMoneda,
        "compras"
      );
    },
    [convertirMonto, monedaSeleccionada]
  );

  const preciosProductoTresMonedas = useCallback(
    (p: LocalProducto) => {
      return monedas.map((m) => ({
        id: m.id,
        codigo: m.codigo,
        simbolo: m.simbolo,
        es_base_prod: String(m.id) === String(p.moneda_base_id || baseMonedaSistema?.id),
        precio: precioUnitarioEnMoneda(p, m.codigo),
        costo: costoUnitarioEnMoneda(p, m.codigo),
      }));
    },
    [monedas, baseMonedaSistema, precioUnitarioEnMoneda, costoUnitarioEnMoneda]
  );

  const precioDeLineaEnMoneda = useCallback(
    (item: CartItem, codMoneda = monedaSeleccionada): number => {
      const pres = item.presentacion;
      if (!pres) return precioUnitarioEnMoneda(item.product, codMoneda);
      if (pres.modo_venta === "fijo" && pres.precio_override != null && pres.precio_override > 0) {
        return convertirMonto(Number(pres.precio_override), item.product.moneda_base_id, codMoneda);
      }
      return precioUnitarioEnMoneda(item.product, codMoneda) * (pres.unidades || 1);
    },
    [precioUnitarioEnMoneda, convertirMonto, monedaSeleccionada]
  );

  const totalLineaEnMoneda = useCallback(
    (item: CartItem, codMoneda = monedaSeleccionada): number => {
      const dec = decMoneda(codMoneda);
      const factor = Math.pow(10, dec);
      return Math.round(precioDeLineaEnMoneda(item, codMoneda) * item.qty * factor) / factor;
    },
    [precioDeLineaEnMoneda, decMoneda, monedaSeleccionada]
  );

  const descuentoDeLinea = useCallback(
    (item: CartItem, codMoneda = monedaSeleccionada): number => {
      const raw = (item.descuentoStr ?? "").trim();
      if (!raw) return 0;
      const bruto = totalLineaEnMoneda(item, codMoneda);
      if (bruto <= 0) return 0;
      const esPct = raw.endsWith("%");
      const numStr = (esPct ? raw.slice(0, -1) : raw).replace(",", ".");
      const val = parseFloat(numStr);
      if (!Number.isFinite(val) || val <= 0) return 0;
      const monto = esPct ? bruto * (Math.min(100, val) / 100) : val;
      const dec = decMoneda(codMoneda);
      const factor = Math.pow(10, dec);
      return Math.min(bruto, Math.round(monto * factor) / factor);
    },
    [totalLineaEnMoneda, decMoneda, monedaSeleccionada]
  );

  // ── Selección de Método de Pago (cambia moneda igual que en la web) ──
  const handleSelectMetodoPago = useCallback(
    (metodoId: string) => {
      setMetodoPagoSeleccionado(metodoId);
      const mp = metodosPago.find((m) => String(m.id) === String(metodoId));
      if (mp) {
        if (mp.caja_id) setCajaSeleccionada(String(mp.caja_id));
        if (mp.moneda_codigo) {
          setMonedaSeleccionada(mp.moneda_codigo);
        } else if (mp.moneda_id) {
          const mon = monedas.find((x) => String(x.id) === String(mp.moneda_id));
          if (mon) setMonedaSeleccionada(mon.codigo);
        }
      }
    },
    [metodosPago, monedas]
  );

  // ── Funciones del Carrito POS ──
  const addToCart = useCallback(
    (p: LocalProducto, pres: LocalPresentacion | null = null) => {
      if (p.stock <= 0) {
        showToast(`Sin existencias de ${p.nombre}`, "error");
        return;
      }
      const targetKey = claveLinea(p.id, pres?.id);
      setCart((prev) => {
        const existing = prev.find((c) => claveDe(c) === targetKey);
        if (existing) {
          const maxQty = maxQtyDeLinea({ ...existing, product: p });
          if (existing.qty + 1 > maxQty) {
            showToast(`Solo hay ${p.stock} unidades disponibles de ${p.nombre}`, "error");
            return prev;
          }
          return prev.map((c) => (claveDe(c) === targetKey ? { ...c, qty: c.qty + 1 } : c));
        }
        const nueva: CartItem = { product: p, qty: 1, presentacion: pres };
        if (maxQtyDeLinea(nueva) < 1) {
          showToast(`Stock insuficiente para ${pres?.nombre || p.nombre}`, "error");
          return prev;
        }
        return [...prev, nueva];
      });
    },
    [showToast]
  );

  const decreaseOrRemoveFromCart = useCallback((productId: number) => {
    setCart((prev) => {
      const matchingIndices = prev
        .map((c, idx) => (c.product.id === productId ? idx : -1))
        .filter((idx) => idx !== -1);
      if (matchingIndices.length === 0) return prev;
      const targetIdx = matchingIndices[matchingIndices.length - 1];
      const targetItem = prev[targetIdx];
      if (targetItem.qty > 1) {
        return prev.map((c, idx) => (idx === targetIdx ? { ...c, qty: c.qty - 1 } : c));
      } else {
        return prev.filter((_, idx) => idx !== targetIdx);
      }
    });
  }, []);

  const updateCartQty = useCallback(
    (clave: string, delta: number) => {
      setCart((prev) => {
        const item = prev.find((c) => claveDe(c) === clave);
        if (!item) return prev;
        const nextQty = item.qty + delta;
        if (nextQty <= 0) {
          return prev.filter((c) => claveDe(c) !== clave);
        }
        const maxQty = maxQtyDeLinea(item);
        if (nextQty > maxQty) {
          showToast(`Solo hay ${item.product.stock} unidades de ${item.product.nombre}`, "error");
          return prev;
        }
        return prev.map((c) => (claveDe(c) === clave ? { ...c, qty: nextQty } : c));
      });
    },
    [showToast]
  );

  const cambiarPresentacionLinea = useCallback((clave: string, pres: LocalPresentacion | null) => {
    setCart((prev) => {
      const item = prev.find((c) => claveDe(c) === clave);
      if (!item) return prev;
      const maxQty = Math.max(1, Math.floor(item.product.stock / (pres?.unidades ?? 1)));
      return prev.map((c) =>
        claveDe(c) === clave ? { ...c, presentacion: pres, qty: Math.min(maxQty, c.qty) } : c
      );
    });
  }, []);

  const setDescuentoLinea = useCallback((clave: string, val: string) => {
    const limpio = val.replace(/[^0-9.,%]/g, "").slice(0, 10);
    setCart((prev) =>
      prev.map((c) => (claveDe(c) === clave ? { ...c, descuentoStr: limpio } : c))
    );
  }, []);

  const handlePauseCart = useCallback(() => {
    if (cart.length === 0) return;
    const now = new Date();
    const hora = now.toTimeString().slice(0, 5);
    setHeldCarts((prev) => [
      ...prev,
      { id: Date.now(), items: cart, clienteId, hora },
    ]);
    setCart([]);
    setClienteId(null);
    showToast("Venta puesta en espera", "info");
  }, [cart, clienteId, showToast]);

  const handleResumeCart = useCallback(
    (held: HeldCart) => {
      setCart(held.items);
      setClienteId(held.clienteId);
      setHeldCarts((prev) => prev.filter((h) => h.id !== held.id));
      setShowHeldModal(false);
      setPosSubView("carrito");
    },
    []
  );

  // ── Totales del Carrito ──
  const subtotal = useMemo(
    () => cart.reduce((acc, c) => acc + totalLineaEnMoneda(c, monedaSeleccionada), 0),
    [cart, totalLineaEnMoneda, monedaSeleccionada]
  );

  const tax = useMemo(
    () =>
      cart.reduce((acc, c) => {
        if (c.product.iva_incluido !== 0) return acc;
        return acc + Math.round(totalLineaEnMoneda(c, monedaSeleccionada) * 0.16 * 100) / 100;
      }, 0),
    [cart, totalLineaEnMoneda, monedaSeleccionada]
  );

  const descuentoLineas = useMemo(
    () => cart.reduce((acc, c) => acc + descuentoDeLinea(c, monedaSeleccionada), 0),
    [cart, descuentoDeLinea, monedaSeleccionada]
  );

  const descuentoGlobal = useMemo(() => {
    const n = parseFloat(descuentoGlobalStr.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [descuentoGlobalStr]);

  const descuentoTotal = descuentoLineas + descuentoGlobal;

  const totalCobrosExtraEnMoneda = useCallback(
    (codDestino = monedaSeleccionada) => {
      return cobrosExtra.reduce((acc, ce) => {
        const m = parseFloat(ce.montoStr.replace(",", "."));
        if (!Number.isFinite(m) || m <= 0) return acc;
        return acc + convertirMonto(m, ce.monedaCodigo, codDestino);
      }, 0);
    },
    [cobrosExtra, convertirMonto, monedaSeleccionada]
  );

  const total = useMemo(
    () => Math.max(0, subtotal - descuentoTotal + tax + totalCobrosExtraEnMoneda(monedaSeleccionada)),
    [subtotal, descuentoTotal, tax, totalCobrosExtraEnMoneda, monedaSeleccionada]
  );

  // Desglose del carrito expresado en cualquier moneda con la regla de precios y tasas del POS
  const calcularDesgloseEnMoneda = useCallback(
    (codMoneda: string) => {
      if (!codMoneda || codMoneda === monedaSeleccionada) {
        return {
          subtotal,
          impuesto: tax,
          descuento: descuentoTotal,
          cobrosExtra: totalCobrosExtraEnMoneda(monedaSeleccionada),
          total,
        };
      }
      let sub = 0;
      let taxMoneda = 0;
      for (const c of cart) {
        const importe = totalLineaEnMoneda(c, codMoneda);
        sub += importe;
        if (c.product.iva_incluido === 0) {
          taxMoneda += Math.round(importe * 0.16 * 100) / 100;
        }
      }
      const escala = subtotal > 0 ? sub / subtotal : 0;
      const dec = decMoneda(codMoneda);
      const factor = Math.pow(10, dec);
      const descuentoMoneda = Math.round(descuentoTotal * escala * factor) / factor;
      const cobros = totalCobrosExtraEnMoneda(codMoneda);
      const tot = Math.max(0, sub - descuentoMoneda + taxMoneda + cobros);
      return {
        subtotal: sub,
        impuesto: taxMoneda,
        descuento: descuentoMoneda,
        cobrosExtra: cobros,
        total: tot,
      };
    },
    [cart, total, monedaSeleccionada, totalLineaEnMoneda, subtotal, tax, descuentoTotal, decMoneda, totalCobrosExtraEnMoneda]
  );

  // Total del carrito expresado en cualquier moneda con la regla de precios y tasas del POS
  const calcularTotalEnMoneda = useCallback(
    (codMoneda: string): number => {
      return calcularDesgloseEnMoneda(codMoneda).total;
    },
    [calcularDesgloseEnMoneda]
  );

  const clienteSeleccionadoObj = useMemo(
    () => (clienteId ? clientes.find((c) => c.id === clienteId) || null : null),
    [clientes, clienteId]
  );

  const filteredCheckoutClientes = useMemo(() => {
    const q = checkoutClientSearch.toLowerCase().trim();
    if (!q) return clientes.slice(0, 20);
    return clientes
      .filter(
        (c) =>
          c.nombre.toLowerCase().includes(q) ||
          (c.documento && c.documento.toLowerCase().includes(q)) ||
          (c.telefono && c.telefono.toLowerCase().includes(q))
      )
      .slice(0, 30);
  }, [clientes, checkoutClientSearch]);

  const filteredCartClientes = useMemo(() => {
    const q = cartClientSearch.toLowerCase().trim();
    if (!q) return clientes.slice(0, 20);
    return clientes
      .filter(
        (c) =>
          c.nombre.toLowerCase().includes(q) ||
          (c.documento && c.documento.toLowerCase().includes(q)) ||
          (c.telefono && c.telefono.toLowerCase().includes(q))
      )
      .slice(0, 30);
  }, [clientes, cartClientSearch]);

  // Cálculos de Pago Simple / Mixto en el Modal de Checkout
  const totalPagadoEnMonedaVenta = useMemo(() => {
    return lineasPago.reduce((acc, lp) => {
      const mp = metodosPago.find((x) => String(x.id) === String(lp.metodoId));
      const codLinea = mp?.moneda_codigo || monedaSeleccionada;
      const strVal = lp.montoStr.trim();
      const vacio = strVal === "";
      if (!modoMixto && lineasPago.length === 1) {
        if (vacio) {
          return total;
        }
        const totalEsperado = calcularTotalEnMoneda(codLinea);
        const m = parseFloat(strVal.replace(",", "."));
        if (Math.abs(m - totalEsperado) <= 0.005) {
          return total;
        }
        return convertirMonto(m, codLinea, monedaSeleccionada, "ventas");
      }
      const m = parseFloat(strVal.replace(",", "."));
      if (!Number.isFinite(m) || m <= 0) return acc;
      return acc + convertirMonto(m, codLinea, monedaSeleccionada, "ventas");
    }, 0);
  }, [lineasPago, metodosPago, monedaSeleccionada, convertirMonto, modoMixto, calcularTotalEnMoneda, total]);

  const faltaPorPagar = Math.max(0, Math.round((total - totalPagadoEnMonedaVenta) * 100) / 100);
  const vueltoEnMonedaVenta = Math.max(0, Math.round((totalPagadoEnMonedaVenta - total) * 100) / 100);

  // Información de Crédito del Cliente Seleccionado en la Moneda de la Venta / Método
  const infoCreditoCliente = useMemo(() => {
    if (!clienteSeleccionadoObj) return null;
    const mpObj = metodosPago.find(
      (m) => String(m.id) === String(lineasPago[0]?.metodoId || metodoPagoSeleccionado)
    );
    const cod = !modoMixto && mpObj?.moneda_codigo ? mpObj.moneda_codigo : monedaSeleccionada;
    const limRow = clienteSeleccionadoObj.limites_credito.find((l) => l.codigo === cod);
    const deudaRow = clienteSeleccionadoObj.deuda_total.find((d) => d.codigo === cod);
    const limite = Number(limRow?.limite ?? 0);
    const deuda = Number(deudaRow?.monto ?? 0);
    const disponible = Math.max(0, limite - deuda);
    return {
      recibe: clienteSeleccionadoObj.recibe_credito === 1,
      limite,
      deuda,
      disponible,
      monedaCodigo: cod,
    };
  }, [
    clienteSeleccionadoObj,
    monedaSeleccionada,
    modoMixto,
    lineasPago,
    metodoPagoSeleccionado,
    metodosPago,
  ]);

  const clienteSinCreditoSuficiente = useMemo(() => {
    if (!clienteSeleccionadoObj) return false;
    if (!infoCreditoCliente) return true;
    if (!infoCreditoCliente.recibe) return true;
    const totalAVerificar = (!modoMixto && infoCreditoCliente.monedaCodigo)
      ? calcularTotalEnMoneda(infoCreditoCliente.monedaCodigo)
      : total;
    return infoCreditoCliente.disponible < totalAVerificar;
  }, [clienteSeleccionadoObj, infoCreditoCliente, modoMixto, calcularTotalEnMoneda, total]);

  // Abrir Modal de Checkout inicializando la línea de pago en la moneda del método seleccionado
  const handleOpenCheckout = useCallback(() => {
    setCreditoSolicitado(false);
    if (cart.length === 0) {
      showToast("Agrega al menos un producto al carrito", "error");
      return;
    }
    const mpDefaultId = metodoPagoSeleccionado || (metodosPago[0] ? String(metodosPago[0].id) : "");
    const mpObj = metodosPago.find((x) => String(x.id) === String(mpDefaultId));
    const codMetodo = mpObj?.moneda_codigo || monedaSeleccionada;
    if (codMetodo && codMetodo !== monedaSeleccionada) {
      setMonedaSeleccionada(codMetodo);
    }
    const totalEnMonedaMetodo = calcularTotalEnMoneda(codMetodo);
    const dec = decMoneda(codMetodo);

    setModoMixto(false);
    setLineasPago([
      {
        key: 1,
        metodoId: mpDefaultId,
        montoStr: "",
      },
    ]);
    if (infoCreditoCliente) {
      setLimiteInputStr(String(infoCreditoCliente.limite || 0));
    }
    setCheckoutClientSearch("");
    setCheckoutClientDropdownOpen(false);
    checkoutSheetTranslateY.setValue(0);
    setShowCheckoutModal(true);
  }, [
    cart.length,
    metodoPagoSeleccionado,
    metodosPago,
    monedaSeleccionada,
    calcularTotalEnMoneda,
    decMoneda,
    infoCreditoCliente,
    showToast,
  ]);

  const handleSelectMetodoCheckout = useCallback(
    (mpId: string) => {
      setMetodoPagoSeleccionado(mpId);
      const mp = metodosPago.find((m) => String(m.id) === String(mpId));
      if (mp) {
        if (mp.caja_id) setCajaSeleccionada(String(mp.caja_id));
        const codNuevo = mp.moneda_codigo || monedaSeleccionada;
        if (codNuevo) {
          setMonedaSeleccionada(codNuevo);
        }
        const totalEnMoneda = calcularTotalEnMoneda(codNuevo);
        const dec = decMoneda(codNuevo);
        setLineasPago([
          {
            key: 1,
            metodoId: mpId,
            montoStr: "",
          },
        ]);
      }
    },
    [metodosPago, monedaSeleccionada, calcularTotalEnMoneda, decMoneda]
  );

  // Otorgar o ajustar límite de crédito directamente desde el Checkout
  const handleAjustarLimiteCheckout = useCallback(
    async (nuevoLimite: number, codMonedaOverride?: string) => {
      const cod = codMonedaOverride || monedaSeleccionada;
      const targetMoneda = monedas.find((m) => m.codigo === cod) || activeMonedaObj;
      if (!clienteSeleccionadoObj || !targetMoneda) return;
      setGrantingCredit(true);
      try {
        await patchClienteLimiteCloud({
          id: clienteSeleccionadoObj.id,
          moneda_id: targetMoneda.id,
          limite: Math.max(0, nuevoLimite),
          recibe_credito: true,
        });
        await refreshLocalState(posSearch);
        setLimiteInputStr(String(Math.max(0, nuevoLimite)));
        showToast(`Límite en ${targetMoneda.codigo} actualizado a ${fmt(nuevoLimite, targetMoneda.codigo)}`, "success");
      } catch (e: any) {
        showToast(e?.message || "Error al actualizar límite", "error");
      } finally {
        setGrantingCredit(false);
      }
    },
    [clienteSeleccionadoObj, activeMonedaObj, refreshLocalState, posSearch, monedaSeleccionada, monedas, fmt, showToast]
  );

  // Procesar Venta (Contado, Todo a Crédito o Parcial / Mixto)
  const handleConfirmSale = useCallback(
    async (modeOverride?: "completo" | "credito" | "personalizado") => {
      if (cart.length === 0 || !activeMonedaObj) return;

      const isCreditoTotal = modeOverride === "credito";
      const isPagoCompleto = modeOverride === "completo";

      const metodoObj =
        metodosPago.find((m) => String(m.id) === String(metodoPagoSeleccionado)) ||
        metodosPago[0] ||
        null;

      const codVentaFinal =
        !modoMixto && metodoObj?.moneda_codigo ? metodoObj.moneda_codigo : monedaSeleccionada;
      const monedaFinalObj =
        monedas.find((m) => m.codigo === codVentaFinal) || activeMonedaObj;

      const desglose = calcularDesgloseEnMoneda(codVentaFinal);
      const totalFinal = desglose.total;

      const strSimple = (lineasPago[0]?.montoStr ?? "").trim();
      const vacioSimple = !modoMixto && strSimple === "";
      const montoSimpleTyped = parseFloat(strSimple.replace(",", ".")) || 0;

      const montoPagadoFinal = isCreditoTotal
        ? 0
        : isPagoCompleto || vacioSimple
        ? totalFinal
        : Math.min(
            totalFinal,
            modoMixto
              ? totalPagadoEnMonedaVenta
              : montoSimpleTyped
          );

      const saldoACredito = Math.max(0, Math.round((totalFinal - montoPagadoFinal) * 100) / 100);
      const usaCredito = isCreditoTotal || saldoACredito > 0.009;

      if (usaCredito && !clienteSeleccionadoObj) {
        showToast("Selecciona un cliente para registrar la venta a crédito", "error");
        setCheckoutClientDropdownOpen(true);
        checkoutScrollRef.current?.scrollTo({ y: 0, animated: true });
        setTimeout(() => {
          checkoutClientSearchRef.current?.focus();
        }, 100);
        return;
      }

      if (usaCredito) {
        const limRow = clienteSeleccionadoObj?.limites_credito.find((l) => l.codigo === codVentaFinal);
        const deudaRow = clienteSeleccionadoObj?.deuda_total.find((d) => d.codigo === codVentaFinal);
        const limVal = Number(limRow?.limite ?? 0);
        const deuVal = Number(deudaRow?.monto ?? 0);
        const dispVal = Math.max(0, limVal - deuVal);
        const recibeCred = clienteSeleccionadoObj?.recibe_credito === 1;

        if (!recibeCred || dispVal < saldoACredito - 0.01) {
          setCreditoSolicitado(true);
          showToast(
            `${clienteSeleccionadoObj?.nombre} no tiene crédito suficiente en ${codVentaFinal}. Pulsa "Otorgar Crédito Rápido".`,
            "error"
          );
          return;
        }
      }

      setSubmittingSale(true);
      try {
        const itemsPayload = cart.map((c) => {
          const unidades = unidadesDeLinea(c);
          const importeBruto = totalLineaEnMoneda(c, codVentaFinal);
          const precioExacto = importeBruto / (c.qty || 1);
          return {
            producto_id: c.product.id,
            nombre: c.presentacion
              ? `${c.product.nombre} (${c.presentacion.nombre} x${c.presentacion.unidades})`
              : c.product.nombre,
            cantidad: unidades,
            precio_unit: precioExacto,
            subtotal: importeBruto,
            descuento: descuentoDeLinea(c, codVentaFinal),
            presentacion_id: c.presentacion?.id || null,
            presentacion_nombre: c.presentacion?.nombre || null,
            presentacion_unidades: c.presentacion?.unidades || null,
            cantidad_presentaciones: c.presentacion ? c.qty : null,
            precio_presentacion: c.presentacion ? precioDeLineaEnMoneda(c, codVentaFinal) : null,
          };
        });

        const pagosPayload = !isCreditoTotal
          ? modoMixto || lineasPago.length > 1
            ? lineasPago
                .map((lp) => {
                  const m = parseFloat(lp.montoStr.replace(",", "."));
                  const mp = metodosPago.find((x) => String(x.id) === String(lp.metodoId));
                  const mon = monedas.find((x) => x.codigo === (mp?.moneda_codigo || codVentaFinal));
                  return {
                    metodo_pago_id: lp.metodoId,
                    caja_id: mp?.caja_id || cajaSeleccionada || null,
                    moneda_id: mon?.id || monedaFinalObj.id,
                    monto: Number.isFinite(m) && m > 0 ? m : 0,
                  };
                })
                .filter((p) => p.monto > 0)
            : (() => {
                const mp = metodoObj;
                const mon = monedas.find((x) => x.codigo === (mp?.moneda_codigo || codVentaFinal));
                const m = isPagoCompleto || vacioSimple
                  ? totalFinal
                  : parseFloat((lineasPago[0]?.montoStr || "").replace(",", "."));
                return Number.isFinite(m) && m > 0
                  ? [
                      {
                        metodo_pago_id: mp ? String(mp.id) : null,
                        caja_id: mp?.caja_id || cajaSeleccionada || null,
                        moneda_id: mon?.id || monedaFinalObj.id,
                        monto: m,
                      },
                    ]
                  : undefined;
              })()
          : undefined;

        const cobrosExtraPayload = cobrosExtra
          .map((ce) => {
            const m = parseFloat(ce.montoStr.replace(",", "."));
            const mon = monedas.find((x) => x.codigo === ce.monedaCodigo) || monedaFinalObj;
            return {
              descripcion: ce.concepto.trim() || "Cobro extra",
              monto: Number.isFinite(m) && m > 0 ? m : 0,
              moneda_id: mon.id,
            };
          })
          .filter((c) => c.monto > 0);

        const ventaCreada = await createOfflineSale({
          cliente_id: clienteSeleccionadoObj?.id || null,
          cliente_nombre: clienteSeleccionadoObj?.nombre || "Consumidor Final",
          moneda_id: monedaFinalObj.id,
          tipo_pago: usaCredito ? "Credito" : "Contado",
          metodo_pago_id: metodoObj ? String(metodoObj.id) : null,
          caja_id: metodoObj?.caja_id ? String(metodoObj.caja_id) : cajaSeleccionada || null,
          subtotal: desglose.subtotal,
          impuesto: desglose.impuesto,
          descuento: desglose.descuento,
          total: totalFinal,
          monto_pagado: montoPagadoFinal,
          observaciones: observacionesVenta.trim() || undefined,
          pagos: pagosPayload,
          cobros_extra: cobrosExtraPayload.length > 0 ? cobrosExtraPayload : undefined,
          items: itemsPayload,
        });

        const vueltoFinal = Math.max(0, Math.round((montoPagadoFinal - totalFinal) * 100) / 100);

        handleCloseCheckout();
        setReceiptModal({
          numero: ventaCreada.numero,
          fecha: ventaCreada.fecha,
          cliente: ventaCreada.cliente_nombre,
          moneda: codVentaFinal,
          tipo_pago: usaCredito
            ? montoPagadoFinal > 0
              ? "Crédito Parcial"
              : "Crédito"
            : modoMixto
            ? "Pago Mixto"
            : metodoObj?.nombre || "Contado",
          subtotal: desglose.subtotal,
          impuesto: desglose.impuesto,
          descuento: desglose.descuento,
          cobrosExtra: desglose.cobrosExtra,
          total: totalFinal,
          montoPagado: montoPagadoFinal,
          saldoCredito: saldoACredito,
          vuelto: isPagoCompleto || isCreditoTotal ? 0 : vueltoFinal,
          items: itemsPayload,
        });

        setCart([]);
        setClienteId(null);
        setDescuentoGlobalStr("");
        setObservacionesVenta("");
        setCobrosExtra([]);
        setPosSubView("catalogo");
        setSubmittingSale(false);

        // Actualizar en segundo plano sin congelar la UI
        refreshLocalState(posSearch).catch((err) => console.warn("Error refreshing state:", err));
        runSilentSync();
      } catch (e: any) {
        showToast(e?.message || "No se pudo registrar la venta", "error");
        setSubmittingSale(false);
      }
    },
    [
      cart,
      activeMonedaObj,
      total,
      totalPagadoEnMonedaVenta,
      clienteSeleccionadoObj,
      infoCreditoCliente,
      monedaSeleccionada,
      fmt,
      metodosPago,
      metodoPagoSeleccionado,
      cajaSeleccionada,
      modoMixto,
      lineasPago,
      monedas,
      cobrosExtra,
      calcularDesgloseEnMoneda,
      observacionesVenta,
      totalLineaEnMoneda,
      descuentoDeLinea,
      precioDeLineaEnMoneda,
      refreshLocalState,
      posSearch,
      runSilentSync,
      showToast,
    ]
  );

  // ── Login & Logout ──
  const handleLogin = async () => {
    setLoginError(null);
    if (!emailInput.trim() || !passwordInput) {
      setLoginError("Ingresa tu correo electrónico y contraseña.");
      return;
    }
    setLoginLoading(true);
    try {
      const targetUrl = serverUrlInput.trim() || DEFAULT_CLOUD_URL;
      const data = await loginMobile(targetUrl, emailInput.trim(), passwordInput);
      setSession({
        serverUrl: targetUrl.replace(/\/+$/, ""),
        token: data.token,
        user: data.user,
      });
      await refreshLocalState();
    } catch (e: any) {
      setLoginError(e?.message || "Error al iniciar sesión");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await clearStoredSession();
    setDrawerOpen(false);
    setSession(null);
    setCart([]);
  };

  // ── Modal Crear / Editar Cliente ──
  const openCreateClienteModal = useCallback(
    (cli?: LocalCliente | null, initialNombre?: string) => {
      if (cli) {
        setEditingCliente(cli);
        setClFormNombre(cli.nombre);
        setClFormTipo(cli.tipo === "Empresa" ? "Empresa" : "Persona Natural");
        setClFormDoc(cli.documento || "");
        setClFormTel(cli.telefono || "");
        setClFormEmail(cli.email || "");
        setClFormCiudad(cli.ciudad || "");
        setClFormDir(cli.direccion || "");
        setClFormRecibeCredito(cli.recibe_credito === 1);
        const map: Record<string, string> = {};
        for (const m of monedas) {
          const found = cli.limites_credito.find((l) => String(l.moneda_id) === String(m.id) || l.codigo === m.codigo);
          map[m.id] = String(found?.limite ?? 0);
        }
        setClFormLimites(map);
      } else {
        setEditingCliente(null);
        setClFormNombre(initialNombre || "");
        setClFormTipo("Persona Natural");
        setClFormDoc("");
        setClFormTel("");
        setClFormEmail("");
        setClFormCiudad("");
        setClFormDir("");
        setClFormRecibeCredito(true);
        const map: Record<string, string> = {};
        for (const m of monedas) {
          map[m.id] = m.es_base ? "100" : "0";
        }
        setClFormLimites(map);
      }
      setClienteModalOpen(true);
    },
    [monedas]
  );

  const handleSaveCliente = async () => {
    if (!clFormNombre.trim()) {
      showToast("El nombre del cliente es obligatorio", "error");
      return;
    }
    setSavingCliente(true);
    try {
      const limitesArr = monedas.map((m) => ({
        moneda_id: m.id,
        limite: Math.max(0, parseFloat((clFormLimites[m.id] || "0").replace(",", ".")) || 0),
      }));
      const saved = await saveClienteCloud({
        id: editingCliente?.id || undefined,
        nombre: clFormNombre.trim(),
        tipo: clFormTipo,
        documento: clFormDoc.trim() || null,
        telefono: clFormTel.trim() || null,
        email: clFormEmail.trim() || null,
        ciudad: clFormCiudad.trim() || null,
        direccion: clFormDir.trim() || null,
        recibe_credito: clFormRecibeCredito,
        limites_credito: limitesArr,
        activo: true,
      });
      await refreshLocalState(posSearch);
      if (saved?.id && route === "pos") {
        setClienteId(String(saved.id));
      }
      if (perfilClienteId) {
        fetchClientePerfilCloud(perfilClienteId).then((res) => {
          if (res) setPerfilCloudData(res);
        });
      }
      setClienteModalOpen(false);
      showToast(editingCliente ? "Cliente actualizado" : "Cliente creado", "success");
    } catch (e: any) {
      showToast(e?.message || "Error al guardar cliente", "error");
    } finally {
      setSavingCliente(false);
    }
  };

  // ── Modal Registrar Abono a Crédito ──
  const openAbonoModal = useCallback(
    (cr: LocalCredito) => {
      setAbonoModalCredito(cr);
      setAbonoModoMixto(false);
      // Buscar método de pago de la misma moneda del crédito si existe
      const mpMatch =
        metodosPago.find((m) => m.moneda_codigo === cr.moneda_codigo) || metodosPago[0];
      const mpId = mpMatch ? String(mpMatch.id) : "";
      setAbonoMetodoId(mpId);
      setAbonoMontoStr(cr.saldo.toFixed(decMoneda(cr.moneda_codigo)));
      setAbonoLineas([{ key: 1, metodoId: mpId, montoStr: cr.saldo.toFixed(decMoneda(cr.moneda_codigo)) }]);
      setAbonoObs("");
    },
    [metodosPago, decMoneda]
  );

  const handleSelectMetodoAbono = useCallback(
    (mpId: string) => {
      const mpNuevo = metodosPago.find((x) => String(x.id) === String(mpId));
      const mpAnterior = metodosPago.find((x) => String(x.id) === String(abonoMetodoId));
      const codAnterior = mpAnterior?.moneda_codigo || abonoModalCredito?.moneda_codigo;
      const codNuevo = mpNuevo?.moneda_codigo || abonoModalCredito?.moneda_codigo;

      if (codAnterior && codNuevo && codAnterior !== codNuevo) {
        const val = parseFloat(abonoMontoStr.replace(",", "."));
        if (Number.isFinite(val) && val > 0) {
          const monAnterior = monedas.find((m) => m.codigo === codAnterior);
          const monNuevo = monedas.find((m) => m.codigo === codNuevo);
          if (monAnterior && monNuevo) {
            const dec = Number(monNuevo.decimales ?? 2);
            const conv = convertirConRegla(val, monAnterior, monNuevo, "ventas", dec);
            setAbonoMontoStr(String(conv));
          }
        }
      }
      setAbonoMetodoId(mpId);
    },
    [metodosPago, abonoMetodoId, abonoModalCredito, abonoMontoStr, monedas, convertirConRegla]
  );

  const handleConfirmAbono = async () => {
    if (!abonoModalCredito) return;
    setSavingAbono(true);
    try {
      const fechaHoy = new Date().toISOString().split("T")[0];
      if (!abonoModoMixto) {
        const montoNum = parseFloat(abonoMontoStr.replace(",", "."));
        if (!Number.isFinite(montoNum) || montoNum <= 0) {
          showToast("Ingresa un monto válido mayor a 0", "error");
          setSavingAbono(false);
          return;
        }
        const mp = metodosPago.find((m) => String(m.id) === String(abonoMetodoId)) || metodosPago[0];
        const codAbono = mp?.moneda_codigo || abonoModalCredito.moneda_codigo;
        const monAbono =
          monedas.find((m) => m.codigo === codAbono) ||
          monedas.find((m) => String(m.id) === String(abonoModalCredito.moneda_id)) ||
          monedas[0];
        const equivCredito = convertirMonto(montoNum, monAbono?.codigo, abonoModalCredito.moneda_codigo);

        if (equivCredito > abonoModalCredito.saldo + 0.05) {
          showToast(
            `El abono (${fmt(equivCredito, abonoModalCredito.moneda_codigo)}) supera el saldo pendiente (${fmt(abonoModalCredito.saldo, abonoModalCredito.moneda_codigo)})`,
            "error"
          );
          setSavingAbono(false);
          return;
        }

        await registrarAbonoMobile({
          credito_id: abonoModalCredito.id,
          cliente_id: abonoModalCredito.cliente_id,
          fecha: fechaHoy,
          monto: montoNum,
          moneda_id: monAbono.id,
          monto_en_moneda_credito: equivCredito,
          metodo_pago_id: mp ? String(mp.id) : null,
          caja_id: mp?.caja_id ? String(mp.caja_id) : null,
          observaciones: abonoObs.trim() || null,
        });
      } else {
        let totalEquiv = 0;
        const lineasPayload = [];
        for (const l of abonoLineas) {
          const m = parseFloat(l.montoStr.replace(",", "."));
          if (!Number.isFinite(m) || m <= 0) continue;
          const mp = metodosPago.find((x) => String(x.id) === String(l.metodoId)) || metodosPago[0];
          const mon =
            monedas.find((x) => x.codigo === mp?.moneda_codigo) ||
            monedas.find((x) => String(x.id) === String(abonoModalCredito.moneda_id)) ||
            monedas[0];
          totalEquiv += convertirMonto(m, mon.codigo, abonoModalCredito.moneda_codigo);
          lineasPayload.push({
            monto: m,
            moneda_id: mon.id,
            metodo_pago_id: mp ? String(mp.id) : null,
            caja_id: mp?.caja_id ? String(mp.caja_id) : null,
          });
        }
        if (lineasPayload.length === 0) {
          showToast("Agrega al menos una línea de abono válida", "error");
          setSavingAbono(false);
          return;
        }
        await registrarAbonoMobile({
          credito_id: abonoModalCredito.id,
          cliente_id: abonoModalCredito.cliente_id,
          fecha: fechaHoy,
          monto: totalEquiv,
          moneda_id: abonoModalCredito.moneda_id,
          monto_en_moneda_credito: totalEquiv,
          metodo_pago_id: lineasPayload[0].metodo_pago_id,
          caja_id: lineasPayload[0].caja_id,
          lineas: lineasPayload,
          observaciones: abonoObs.trim() || null,
        });
      }

      setAbonoModalCredito(null);
      await refreshLocalState(posSearch);
      if (perfilClienteId) {
        fetchClientePerfilCloud(perfilClienteId).then((res) => {
          if (res) setPerfilCloudData(res);
        });
      }
      runSilentSync();
      showToast("Abono registrado correctamente", "success");
    } catch (e: any) {
      showToast(e?.message || "Error al registrar abono", "error");
    } finally {
      setSavingAbono(false);
    }
  };

  const openHistorialAbonos = async (cr: LocalCredito) => {
    setHistorialCredito(cr);
    const list = await getLocalAbonosByCredito(cr.id);
    setHistorialAbonos(list);
  };

  // ── Perfil del Cliente (Clon completo de /clientes/[id] de la Web) ──
  const openPerfilCliente = useCallback(async (cid: string) => {
    setPerfilClienteId(cid);
    setPerfilTab("ventas");
    setPerfilCloudData(null);
    setRoute("clientes");
    setPerfilLoadingCloud(true);
    try {
      const cloud = await fetchClientePerfilCloud(cid);
      if (cloud) {
        setPerfilCloudData(cloud);
      }
    } finally {
      setPerfilLoadingCloud(false);
    }
  }, []);

  const perfilClienteObj = useMemo(() => {
    if (!perfilClienteId) return null;
    const local = clientes.find((c) => String(c.id) === String(perfilClienteId));
    if (local) return local;
    if (perfilCloudData?.detalle?.cliente) {
      const cl = perfilCloudData.detalle.cliente;
      return {
        id: String(cl.id),
        nombre: String(cl.nombre),
        tipo: String(cl.tipo || "Persona Natural"),
        documento: cl.documento || null,
        email: cl.email || null,
        telefono: cl.telefono || null,
        ciudad: cl.ciudad || null,
        direccion: cl.direccion || null,
        recibe_credito: cl.recibe_credito ? 1 : 0,
        limite_credito: Number(cl.limite_credito) || 0,
        activo: cl.activo ? 1 : 0,
        limites_credito: Array.isArray(cl.monedas)
          ? cl.monedas.map((m: any) => ({
              moneda_id: String(m.moneda_id),
              codigo: String(m.codigo),
              simbolo: String(m.simbolo || "$"),
              es_base: Boolean(m.es_base),
              limite: Number(m.limite) || 0,
            }))
          : [],
        deuda_total: Array.isArray(cl.monedas)
          ? cl.monedas
              .filter((m: any) => Number(m.deuda) > 0.005)
              .map((m: any) => ({
                codigo: String(m.codigo),
                simbolo: String(m.simbolo || "$"),
                monto: Number(m.deuda) || 0,
              }))
          : [],
        ventas_count: Number(cl.ventas_count) || 0,
      } as LocalCliente;
    }
    return null;
  }, [clientes, perfilClienteId, perfilCloudData]);

  // Monedas del perfil con límite y deuda en cada moneda activa (calculada en vivo para actualizarse de inmediato tras el pago)
  const perfilMonedas = useMemo<PerfilMoneda[]>(() => {
    if (!perfilClienteObj) return [];
    return monedas.map((m) => {
      const limRow = perfilClienteObj.limites_credito.find(
        (l) => String(l.moneda_id) === String(m.id) || l.codigo === m.codigo
      );
      const deudaReal = creditosData.creditos
        .filter(
          (cr) =>
            String(cr.cliente_id) === String(perfilClienteId) &&
            cr.estado !== "Pagado" &&
            Number(cr.saldo) > 0.009 &&
            (String(cr.moneda_id) === String(m.id) || cr.moneda_codigo === m.codigo)
        )
        .reduce((sum, cr) => sum + Number(cr.saldo || 0), 0);

      return {
        moneda_id: m.id,
        codigo: m.codigo,
        simbolo: m.simbolo,
        es_base: m.es_base === 1,
        decimales: Number(m.decimales ?? 2),
        limite: Number(limRow?.limite ?? 0),
        deuda: deudaReal,
      };
    });
  }, [perfilClienteObj, creditosData.creditos, monedas, perfilClienteId]);

  // Ventas del cliente (combina servidor o SQLite local + ventas móviles pendientes)
  const perfilVentas = useMemo(() => {
    if (!perfilClienteId) return [];
    if (Array.isArray(perfilCloudData?.ventas) && perfilCloudData.ventas.length > 0) {
      return perfilCloudData.ventas;
    }
    const remotasCli = ventasRemotas
      .filter((v) => String(v.cliente_id) === String(perfilClienteId))
      .map((v) => {
        const itemsCnt = ventaItemsRemotos.filter((vi) => String(vi.venta_id) === String(v.id)).length;
        const cr = creditosData.creditos.find((c) => String(c.venta_id) === String(v.id));
        return {
          ...v,
          items_count: itemsCnt,
          credito_id: cr?.id || null,
          credito_saldo: cr?.saldo || 0,
          credito_estado: cr?.estado || null,
        };
      });
    const localesCli = ventasLocales
      .filter((v) => String(v.cliente_id) === String(perfilClienteId) && v.sincronizado === 0)
      .map((v) => {
        const mon = monedas.find((m) => String(m.id) === String(v.moneda_id));
        let parsedItems: any[] = [];
        try {
          parsedItems = JSON.parse(v.items_json || "[]");
        } catch {}
        return {
          id: v.id,
          numero: v.numero,
          cliente_id: v.cliente_id,
          cliente_nombre: v.cliente_nombre,
          fecha: v.fecha,
          total: v.total,
          moneda_id: v.moneda_id,
          moneda_codigo: mon?.codigo || "USD",
          moneda_simbolo: mon?.simbolo || "$",
          tipo_pago: v.tipo_pago || "Contado",
          metodo_pago_nombre: "App Móvil (En cola)",
          estado: "Sincronizando",
          items_count: parsedItems.length,
          local_items: parsedItems,
        };
      });
    return [...localesCli, ...remotasCli];
  }, [perfilClienteId, perfilCloudData, ventasRemotas, ventaItemsRemotos, creditosData.creditos, ventasLocales, monedas]);

  // Créditos del cliente
  const perfilCreditos = useMemo(() => {
    if (!perfilClienteId) return [];
    const localCreds = creditosData.creditos.filter((cr) => String(cr.cliente_id) === String(perfilClienteId));
    if (localCreds.length > 0) return localCreds;
    if (Array.isArray(perfilCloudData?.creditos)) {
      return perfilCloudData.creditos.map((r: any) => ({
        id: String(r.id),
        numero: String(r.numero),
        venta_id: r.venta_id ? String(r.venta_id) : null,
        venta_numero: r.venta_numero || null,
        cliente_id: String(r.cliente_id),
        cliente_nombre: String(r.cliente_nombre || perfilClienteObj?.nombre || ""),
        cliente_documento: r.cliente_documento || null,
        cliente_telefono: r.cliente_telefono || null,
        fecha: String(r.fecha || "").slice(0, 10),
        fecha_vencimiento: null,
        moneda_id: String(r.moneda_id),
        moneda_codigo: String(r.moneda_codigo || "USD"),
        moneda_simbolo: String(r.moneda_simbolo || "$"),
        monto_total: Number(r.monto_total) || 0,
        saldo: Number(r.saldo) || 0,
        abonado: Number(r.abonado) || Math.max(0, (Number(r.monto_total) || 0) - (Number(r.saldo) || 0)),
        estado: r.estado || "Pendiente",
        abonos_count: Number(r.abonos_count) || 0,
      }));
    }
    return [];
  }, [perfilClienteId, creditosData.creditos, perfilCloudData, perfilClienteObj]);

  // Retornos del cliente
  const perfilRetornos = useMemo(() => {
    if (!perfilClienteId) return [];
    return Array.isArray(perfilCloudData?.retornos) ? perfilCloudData.retornos : [];
  }, [perfilClienteId, perfilCloudData]);

  // Top Productos más comprados por el cliente (usa el ranking del servidor o lo calcula de SQLite)
  const perfilTopProductos = useMemo(() => {
    if (!perfilClienteId) return [];
    if (Array.isArray(perfilCloudData?.detalle?.top_productos) && perfilCloudData.detalle.top_productos.length > 0) {
      return perfilCloudData.detalle.top_productos;
    }
    // Cálculo offline instantáneo desde ventas_remotas + venta_items_remotos
    const ventaIdsSet = new Set(
      ventasRemotas
        .filter((v) => String(v.cliente_id) === String(perfilClienteId))
        .map((v) => String(v.id))
    );
    const map = new Map<
      number,
      {
        producto_id: number;
        codigo: string;
        nombre: string;
        cantidad_total: number;
        ventasSet: Set<string>;
        monto_base: number;
      }
    >();
    for (const vi of ventaItemsRemotos) {
      if (!ventaIdsSet.has(String(vi.venta_id))) continue;
      const pid = Number(vi.producto_id);
      const curr = map.get(pid) || {
        producto_id: pid,
        codigo: vi.producto_codigo || `#${pid}`,
        nombre: vi.producto_nombre || "Producto",
        cantidad_total: 0,
        ventasSet: new Set<string>(),
        monto_base: 0,
      };
      curr.cantidad_total += Number(vi.cantidad) || 0;
      curr.ventasSet.add(String(vi.venta_id));
      curr.monto_base += Math.max(0, (Number(vi.subtotal_base) || 0) - (Number(vi.descuento_base) || 0));
      map.set(pid, curr);
    }
    return Array.from(map.values())
      .map((x) => ({
        producto_id: x.producto_id,
        codigo: x.codigo,
        nombre: x.nombre,
        cantidad_total: x.cantidad_total,
        veces: x.ventasSet.size,
        monto_base: x.monto_base,
      }))
      .sort((a, b) => b.monto_base - a.monto_base)
      .slice(0, 20);
  }, [perfilClienteId, perfilCloudData, ventasRemotas, ventaItemsRemotos]);

  // Estadísticas agregadas del perfil (Total comprado USD, Ticket promedio USD, Última compra)
  const perfilStats = useMemo(() => {
    if (perfilCloudData?.detalle?.stats) {
      return {
        ventas_count: Number(perfilCloudData.detalle.stats.ventas_count || perfilVentas.length),
        retornos_count: Number(perfilCloudData.detalle.stats.retornos_count || perfilRetornos.length),
        total_comprado_base: Number(perfilCloudData.detalle.stats.total_comprado_base || 0),
        ticket_promedio_base: Number(perfilCloudData.detalle.stats.ticket_promedio_base || 0),
        ultima_compra: perfilCloudData.detalle.stats.ultima_compra || (perfilVentas[0]?.fecha ?? null),
      };
    }
    const baseCod = baseMonedaSistema?.codigo || "USD";
    let sumaBase = 0;
    let ultima: string | null = null;
    for (const v of perfilVentas) {
      const mCod = v.moneda_codigo || baseCod;
      sumaBase += convertirMonto(Number(v.total) || 0, mCod, baseCod);
      if (v.fecha && (!ultima || String(v.fecha) > ultima)) {
        ultima = String(v.fecha).slice(0, 10);
      }
    }
    const cnt = perfilVentas.length;
    return {
      ventas_count: cnt,
      retornos_count: perfilRetornos.length,
      total_comprado_base: sumaBase,
      ticket_promedio_base: cnt > 0 ? sumaBase / cnt : 0,
      ultima_compra: ultima,
    };
  }, [perfilCloudData, perfilVentas, perfilRetornos, baseMonedaSistema, convertirMonto]);

  // Ver ítems de una factura en el perfil
  const handleOpenVentaDetail = useCallback(
    (v: any) => {
      if (Array.isArray(v.local_items)) {
        setVentaDetailModal({ venta: v, items: v.local_items });
        return;
      }
      const cloudItems = Array.isArray(perfilCloudData?.ventaItems)
        ? perfilCloudData.ventaItems.filter((i: any) => String(i.venta_id) === String(v.id))
        : [];
      if (cloudItems.length > 0) {
        setVentaDetailModal({ venta: v, items: cloudItems });
        return;
      }
      const localItems = ventaItemsRemotos.filter((i) => String(i.venta_id) === String(v.id));
      setVentaDetailModal({ venta: v, items: localItems });
    },
    [perfilCloudData, ventaItemsRemotos]
  );

  // ── Modal Ajustar Límite de Crédito (clon de CreditoLimiteModal web) ──
  const openAjustarCreditoModal = useCallback(
    (cli: LocalCliente, monedaInicialId?: string, op: "add" | "remove" = "add") => {
      setCreditoLimiteCliente(cli);
      const baseM = monedas.find((m) => m.es_base === 1) || monedas[0];
      setClLimMonedaId(monedaInicialId || baseM?.id || "");
      setClLimOperacion(op);
      setClLimMontoStr("");
    },
    [monedas]
  );

  const handleCambioMonedaAjustarCredito = useCallback(
    (nuevaMonedaId: string) => {
      if (nuevaMonedaId === clLimMonedaId) return;
      const val = parseFloat(clLimMontoStr.replace(",", "."));
      if (Number.isFinite(val) && val > 0) {
        const monAnterior =
          monedas.find((m) => String(m.id) === String(clLimMonedaId)) || baseMonedaSistema;
        const monNueva = monedas.find((m) => String(m.id) === String(nuevaMonedaId));
        if (monAnterior && monNueva) {
          const dec = Number(monNueva.decimales ?? 2);
          const conv = convertirConRegla(val, monAnterior, monNueva, "ventas", dec);
          setClLimMontoStr(String(conv));
        }
      }
      setClLimMonedaId(nuevaMonedaId);
    },
    [clLimMonedaId, clLimMontoStr, monedas, baseMonedaSistema, convertirConRegla]
  );

  const handleConfirmAjustarCredito = async () => {
    if (!creditoLimiteCliente || !clLimMonedaId) return;
    const val = parseFloat(clLimMontoStr.replace(",", "."));
    if (!Number.isFinite(val) || val <= 0) {
      showToast("Ingresa un monto válido mayor a 0", "error");
      return;
    }
    const limRow = creditoLimiteCliente.limites_credito.find(
      (l) => String(l.moneda_id) === String(clLimMonedaId)
    );
    const limiteActual = Number(limRow?.limite ?? 0);
    const nuevoLimite =
      clLimOperacion === "add" ? limiteActual + val : Math.max(0, limiteActual - val);
    const monObj = monedas.find((m) => String(m.id) === String(clLimMonedaId));

    setSavingCreditoLimite(true);
    try {
      await patchClienteLimiteCloud({
        id: creditoLimiteCliente.id,
        moneda_id: clLimMonedaId,
        limite: nuevoLimite,
        ...(clLimOperacion === "add" ? { recibe_credito: true } : {}),
      });
      await refreshLocalState(posSearch);
      if (perfilClienteId) {
        fetchClientePerfilCloud(perfilClienteId).then((res) => {
          if (res) setPerfilCloudData(res);
        });
      }
      setCreditoLimiteCliente(null);
      showToast(
        clLimOperacion === "add"
          ? `Crédito añadido: límite en ${monObj?.codigo || ""} ahora es ${fmt(nuevoLimite, monObj?.codigo)}`
          : `Crédito reducido: límite en ${monObj?.codigo || ""} ahora es ${fmt(nuevoLimite, monObj?.codigo)}`,
        "success"
      );
    } catch (e: any) {
      showToast(e?.message || "Error al actualizar el límite de crédito", "error");
    } finally {
      setSavingCreditoLimite(false);
    }
  };

  // ── Modal Pagar Deuda Global / Abono Global FIFO (clon exacto de PagarDeudaModal web) ──
  const openPagoDeudaGlobal = useCallback(
    (cli: LocalCliente, monedaInicialId?: string) => {
      setPagoDeudaCliente(cli);
      const baseM = monedas.find((m) => m.es_base === 1) || monedas[0];
      const mpMatch =
        (monedaInicialId
          ? metodosPago.find(
              (m) =>
                String(m.moneda_id) === String(monedaInicialId) ||
                m.moneda_codigo === monedaInicialId
            )
          : null) ||
        metodosPago.find((m) => {
          const mon = monedas.find(
            (x) => String(x.id) === String(m.moneda_id) || x.codigo === m.moneda_codigo
          );
          return mon?.es_base === 1;
        }) ||
        metodosPago[0];

      const mpId = mpMatch ? String(mpMatch.id) : "";
      setPdMetodoPagoId(mpId);
      setPdCajaId(mpMatch?.caja_id ? String(mpMatch.caja_id) : "");

      const monObj = mpMatch
        ? monedas.find(
            (m) => String(m.id) === String(mpMatch.moneda_id) || m.codigo === mpMatch.moneda_codigo
          )
        : baseM;

      setPdMonedaId(monObj?.id ? String(monObj.id) : baseM?.id || "");
      setPdMontoStr("");
      setPdObs("");
    },
    [monedas, metodosPago]
  );

  const handleSelectMetodoPagoDeuda = useCallback(
    (mpId: string) => {
      const mpNuevo = metodosPago.find((x) => String(x.id) === String(mpId));
      const mpAnterior = metodosPago.find((x) => String(x.id) === String(pdMetodoPagoId));

      const monAnterior =
        monedas.find(
          (m) =>
            String(m.id) === String(mpAnterior?.moneda_id) ||
            m.codigo === mpAnterior?.moneda_codigo ||
            String(m.id) === String(pdMonedaId)
        ) || baseMonedaSistema;

      const monNueva =
        monedas.find(
          (m) =>
            String(m.id) === String(mpNuevo?.moneda_id) ||
            m.codigo === mpNuevo?.moneda_codigo
        ) || baseMonedaSistema;

      setPdMetodoPagoId(mpId);
      setPdCajaId(mpNuevo?.caja_id ? String(mpNuevo.caja_id) : "");
      if (monNueva) {
        setPdMonedaId(String(monNueva.id));
      }

      const val = parseFloat(pdMontoStr.replace(",", "."));
      if (
        Number.isFinite(val) &&
        val > 0 &&
        monAnterior &&
        monNueva &&
        String(monAnterior.id) !== String(monNueva.id)
      ) {
        const dec = Number(monNueva.decimales ?? 2);
        const conv = convertirConRegla(val, monAnterior, monNueva, "ventas", dec);
        setPdMontoStr(String(conv));
      }
    },
    [pdMetodoPagoId, pdMonedaId, pdMontoStr, metodosPago, monedas, baseMonedaSistema, convertirConRegla]
  );

  // Facturas pendientes del cliente ordenadas desde la más antigua (FIFO, igual que el backend)
  const pagoDeudaPendientesFifo = useMemo(() => {
    if (!pagoDeudaCliente) return [];
    const all = [...creditosData.creditos, ...perfilCreditos];
    const map = new Map<string, LocalCredito>();
    for (const c of all) {
      if (!map.has(String(c.id))) map.set(String(c.id), c);
    }
    const list = Array.from(map.values()).filter(
      (cr) =>
        String(cr.cliente_id) === String(pagoDeudaCliente.id) &&
        cr.estado !== "Pagado" &&
        Number(cr.saldo) > 0.009
    );
    return list.sort((a, b) =>
      a.fecha === b.fecha ? String(b.id).localeCompare(String(a.id)) : a.fecha < b.fecha ? -1 : 1
    );
  }, [pagoDeudaCliente, creditosData.creditos, perfilCreditos]);

  const pagoDeudaMonedaObj = useMemo(() => {
    const mp = metodosPago.find((x) => String(x.id) === String(pdMetodoPagoId));
    if (mp) {
      const m = monedas.find(
        (x) => String(x.id) === String(mp.moneda_id) || x.codigo === mp.moneda_codigo
      );
      if (m) return m;
    }
    return monedas.find((m) => String(m.id) === String(pdMonedaId)) || baseMonedaSistema;
  }, [metodosPago, pdMetodoPagoId, monedas, pdMonedaId, baseMonedaSistema]);

  const pagoDeudaTotalBase = useMemo(() => {
    if (!baseMonedaSistema) return 0;
    return pagoDeudaPendientesFifo.reduce((sum, cr) => {
      const mCr =
        monedas.find((m) => String(m.id) === String(cr.moneda_id) || m.codigo === cr.moneda_codigo) ||
        baseMonedaSistema;
      return sum + convertirConRegla(Number(cr.saldo) || 0, mCr, baseMonedaSistema, "ventas", 6);
    }, 0);
  }, [pagoDeudaPendientesFifo, monedas, baseMonedaSistema, convertirConRegla]);

  // Vista previa en vivo de cómo se reparte el abono global entre cada factura pendiente
  const pagoDeudaPreview = useMemo(() => {
    const val = parseFloat(pdMontoStr.replace(",", ".")) || 0;
    if (
      !pagoDeudaMonedaObj ||
      !baseMonedaSistema ||
      val <= 0 ||
      pagoDeudaPendientesFifo.length === 0
    ) {
      return {
        lineas: pagoDeudaPendientesFifo.map((cr) => ({
          credito: cr,
          estado: "pendiente" as "completa" | "parcial" | "pendiente",
          monto: 0,
        })),
        restoBase: 0,
      };
    }

    let poolBase = convertirConRegla(val, pagoDeudaMonedaObj, baseMonedaSistema, "ventas", 6);
    const lineas: Array<{
      credito: LocalCredito;
      estado: "completa" | "parcial" | "pendiente";
      monto: number;
    }> = [];

    for (const cr of pagoDeudaPendientesFifo) {
      const mCr =
        monedas.find((m) => String(m.id) === String(cr.moneda_id) || m.codigo === cr.moneda_codigo) ||
        baseMonedaSistema;
      const saldo = Number(cr.saldo) || 0;
      const saldoBase = convertirConRegla(saldo, mCr, baseMonedaSistema, "ventas", 6);
      if (poolBase <= 0.0005) {
        lineas.push({ credito: cr, estado: "pendiente", monto: 0 });
        continue;
      }
      const takeBase = Math.min(poolBase, saldoBase);
      const isCompleta = takeBase >= saldoBase - 0.005 || poolBase >= saldoBase - 0.005;
      const takeEnMonedaCr = isCompleta ? saldo : (saldoBase > 0 ? (takeBase * saldo) / saldoBase : saldo);
      const takeFinal = Math.min(takeEnMonedaCr, saldo);
      poolBase = Math.max(0, poolBase - takeBase);
      lineas.push({
        credito: cr,
        estado: isCompleta ? "completa" : "parcial",
        monto: isCompleta ? saldo : takeFinal,
      });
    }

    return {
      lineas,
      restoBase: poolBase > 0.005 ? poolBase : 0,
    };
  }, [
    pdMontoStr,
    pagoDeudaMonedaObj,
    baseMonedaSistema,
    pagoDeudaPendientesFifo,
    monedas,
    convertirConRegla,
  ]);

  const rellenarTotalPagoDeuda = useCallback(() => {
    if (!pagoDeudaMonedaObj || !baseMonedaSistema || pagoDeudaTotalBase <= 0) return;
    const dec = Number(pagoDeudaMonedaObj.decimales ?? 2);
    const totalEnMoneda = convertirConRegla(
      pagoDeudaTotalBase,
      baseMonedaSistema,
      pagoDeudaMonedaObj,
      "ventas",
      dec
    );
    setPdMontoStr(String(totalEnMoneda));
  }, [pagoDeudaMonedaObj, baseMonedaSistema, pagoDeudaTotalBase, convertirConRegla]);

  const handleConfirmPagoDeudaGlobal = async () => {
    if (!pagoDeudaCliente || !pagoDeudaMonedaObj) return;
    const val = parseFloat(pdMontoStr.replace(",", ".")) || 0;
    if (val <= 0) {
      showToast("Ingresa un monto mayor a 0", "error");
      return;
    }
    setSavingPagoDeuda(true);
    try {
      const fechaHoy = new Date().toISOString().split("T")[0];
      const distOffline = pagoDeudaPreview.lineas
        .filter((l) => l.monto > 0.0005)
        .map((l) => ({
          credito_id: l.credito.id,
          moneda_id: l.credito.moneda_id || pagoDeudaMonedaObj.id,
          monto_aplicado: l.monto,
        }));

      const res = await pagarDeudaGlobalMobile({
        cliente_id: pagoDeudaCliente.id,
        monto: val,
        moneda_id: pagoDeudaMonedaObj.id,
        fecha: fechaHoy,
        metodo_pago_id: pdMetodoPagoId || null,
        caja_id: pdCajaId || null,
        observaciones: pdObs.trim() || null,
        distribucionOffline: distOffline,
      });

      setPagoDeudaCliente(null);
      await refreshLocalState(posSearch);
      if (perfilClienteId) {
        fetchClientePerfilCloud(perfilClienteId).then((cloud) => {
          if (cloud) setPerfilCloudData(cloud);
        });
      }
      runSilentSync();

      let msg = `Pago aplicado a ${res.aplicadas} factura(s)`;
      if (res.completadas > 0) msg += `, ${res.completadas} saldada(s)`;
      if ((res.sobrante_base ?? 0) > 0.005 && baseMonedaSistema) {
        msg += `. Sobrante: ${fmt(res.sobrante_base!, baseMonedaSistema.codigo)}`;
      }
      showToast(msg, "success");
    } catch (e: any) {
      showToast(e?.message || "Error al aplicar el pago de deuda", "error");
    } finally {
      setSavingPagoDeuda(false);
    }
  };

  // ── Filtros de Pantallas ──
  const posProductosFiltrados = useMemo(() => {
    if (!posCategoriaId) return productos;
    return productos.filter((p) => String(p.categoria_id) === String(posCategoriaId));
  }, [productos, posCategoriaId]);

  const cartQtyMap = useMemo(() => {
    const map = new Map<number, number>();
    for (let i = 0; i < cart.length; i++) {
      const c = cart[i];
      const pid = c.product.id;
      map.set(pid, (map.get(pid) || 0) + unidadesDeLinea(c));
    }
    return map;
  }, [cart]);

  const clientesFiltrados = useMemo(() => {
    const q = clientesSearch.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter(
      (c) =>
        c.nombre.toLowerCase().includes(q) ||
        (c.documento && c.documento.toLowerCase().includes(q)) ||
        (c.telefono && c.telefono.toLowerCase().includes(q))
    );
  }, [clientes, clientesSearch]);

  const creditosFiltrados = useMemo(() => {
    const q = creditosSearch.trim().toLowerCase();
    return creditosData.creditos.filter((cr) => {
      if (creditosEstadoFilter !== "Todos" && cr.estado !== creditosEstadoFilter) return false;
      if (!q) return true;
      return (
        (cr.cliente_nombre && cr.cliente_nombre.toLowerCase().includes(q)) ||
        (cr.numero && cr.numero.toLowerCase().includes(q)) ||
        (cr.cliente_documento && cr.cliente_documento.toLowerCase().includes(q)) ||
        (cr.venta_numero && cr.venta_numero.toLowerCase().includes(q))
      );
    });
  }, [creditosData.creditos, creditosEstadoFilter, creditosSearch]);

  const pendingSyncCount = useMemo(
    () => ventasLocales.filter((v) => v.sincronizado === 0).length + abonosPendCount,
    [ventasLocales, abonosPendCount]
  );

  // ── Loading Screen ──
  if (booting) {
    return (
      <View style={styles.centerScreen}>
        <StatusBar barStyle="dark-content" backgroundColor={THEME.background} />
        <ActivityIndicator size="large" color={THEME.primary} />
      </View>
    );
  }

  // ── Login Screen (Estética idéntica al Login de PosBit v2.6 "Con Alma") ──
  if (!session) {
    return (
      <KeyboardAvoidingView
        style={styles.loginContainer}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <StatusBar barStyle="dark-content" backgroundColor={THEME.background} />
        <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.loginCard}>
            <View style={styles.loginAccentBar} />
            <View style={styles.loginBrandRow}>
              <Image
                source={require("./assets/logo.png")}
                style={styles.brandLogoImage}
                resizeMode="contain"
              />
              <View>
                <Text style={styles.loginTitle}>PosBit</Text>
                <Text style={styles.loginSubtitle}>Punto de Venta e Inventario</Text>
              </View>
            </View>

            <Text style={styles.fieldLabel}>CORREO ELECTRÓNICO</Text>
            <TextInput
              style={styles.input}
              placeholder="admin@admin.com"
              placeholderTextColor={THEME.mutedForeground}
              autoCapitalize="none"
              keyboardType="email-address"
              value={emailInput}
              onChangeText={setEmailInput}
            />

            <Text style={styles.fieldLabel}>CONTRASEÑA</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={THEME.mutedForeground}
              secureTextEntry
              value={passwordInput}
              onChangeText={setPasswordInput}
            />

            <TouchableOpacity
              style={styles.advancedToggle}
              onPress={() => setShowAdvancedServer((v) => !v)}
            >
              <Feather
                name={showAdvancedServer ? "chevron-up" : "chevron-down"}
                size={14}
                color={THEME.mutedForeground}
              />
              <Text style={styles.advancedToggleText}>
                {showAdvancedServer ? "Ocultar servidor" : "Servidor Nube: PosBit Cloud"}
              </Text>
            </TouchableOpacity>

            {showAdvancedServer && (
              <View style={{ marginTop: 4 }}>
                <Text style={styles.fieldLabel}>URL DEL SERVIDOR POSBIT</Text>
                <TextInput
                  style={styles.input}
                  placeholder="https://pos-bit-pi.vercel.app"
                  placeholderTextColor={THEME.mutedForeground}
                  autoCapitalize="none"
                  keyboardType="url"
                  value={serverUrlInput}
                  onChangeText={setServerUrlInput}
                />
              </View>
            )}

            {loginError ? (
              <View style={styles.errorAlert}>
                <Feather name="alert-circle" size={15} color={THEME.dangerStrong} />
                <Text style={styles.errorAlertText}>{loginError}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 18 }, loginLoading && { opacity: 0.7 }]}
              onPress={handleLogin}
              disabled={loginLoading}
            >
              {loginLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Iniciar Sesión</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Títulos de Ruta (idénticos a Topbar de la web) ──
  const routeTitle: Record<AppRoute, string> = {
    dashboard: "Panel de control",
    pos: "Punto de Venta",
    clientes:
      perfilClienteId && perfilClienteObj
        ? `Perfil: ${perfilClienteObj.nombre}`
        : "Clientes",
    creditos: "Créditos / Deudores",
    ventas: "Historial de Ventas",
    productos: "Productos",
    config: "Sincronización y Tasas",
  };

  return (
    <View style={styles.appContainer}>
      <StatusBar barStyle="dark-content" backgroundColor={THEME.card} />

      {/* ── Topbar idéntico a PosBit v2.6 Web ── */}
      <View style={styles.topbar}>
        <View style={styles.topbarOrangeLine} />
        <TouchableOpacity
          style={styles.menuIconBtn}
          onPress={() => setDrawerOpen(true)}
          accessibilityLabel="Abrir menú"
        >
          <Feather name="menu" size={20} color={THEME.foreground} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.topbarBrand}
          onPress={() => setRoute(route === "pos" ? "dashboard" : "pos")}
        >
          <Image
            source={require("./assets/logo.png")}
            style={{ width: 28, height: 28, borderRadius: 7 }}
            resizeMode="contain"
          />
          <View>
            <Text style={styles.topbarTitle} numberOfLines={1}>
              {routeTitle[route]}
            </Text>
            <Text style={styles.topbarSubtitle} numberOfLines={1}>
              PosBit · {monedaSeleccionada}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        {/* CloudSyncBadge idéntico a la web */}
        <TouchableOpacity
          style={[
            styles.cloudBadge,
            syncing
              ? styles.cloudBadgeSyncing
              : !syncOnline
              ? styles.cloudBadgeOffline
              : pendingSyncCount > 0
              ? styles.cloudBadgePending
              : styles.cloudBadgeOk,
          ]}
          onPress={runSilentSync}
        >
          <View
            style={[
              styles.cloudDot,
              {
                backgroundColor: syncing
                  ? THEME.primary
                  : !syncOnline
                  ? THEME.danger
                  : pendingSyncCount > 0
                  ? THEME.warning
                  : THEME.success,
              },
            ]}
          />
          <Text
            style={[
              styles.cloudBadgeText,
              {
                color: syncing
                  ? THEME.primary600
                  : !syncOnline
                  ? THEME.dangerStrong
                  : pendingSyncCount > 0
                  ? THEME.warningStrong
                  : THEME.successStrong,
              },
            ]}
          >
            {syncing
              ? "Sinc..."
              : !syncOnline
              ? "Offline"
              : pendingSyncCount > 0
              ? `${pendingSyncCount} pend.`
              : "En línea"}
          </Text>
        </TouchableOpacity>

        {route !== "pos" && (
          <TouchableOpacity
            style={styles.topbarPosShortBtn}
            onPress={() => setRoute("pos")}
          >
            <Feather name="shopping-cart" size={14} color="#fff" />
            <Text style={styles.topbarPosShortBtnText}>POS</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Toast flotante absoluto (en Modal transparente para flotar por encima de cualquier otro Modal nativo) */}
      <Modal
        visible={Boolean(toastMsg)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setToastMsg(null)}
      >
        <View style={styles.toastModalContainer} pointerEvents="box-none">
          {toastMsg && (
            <View
              style={[
                styles.toastBanner,
                toastMsg.type === "error"
                  ? { backgroundColor: THEME.dangerSoft, borderColor: THEME.dangerBorder }
                  : toastMsg.type === "info"
                  ? { backgroundColor: THEME.infoSoft, borderColor: THEME.infoBorder }
                  : { backgroundColor: THEME.successSoft, borderColor: THEME.successBorder },
              ]}
            >
              <Feather
                name={
                  toastMsg.type === "error"
                    ? "alert-circle"
                    : toastMsg.type === "info"
                    ? "info"
                    : "check-circle"
                }
                size={18}
                color={
                  toastMsg.type === "error"
                    ? THEME.dangerStrong
                    : toastMsg.type === "info"
                    ? THEME.infoStrong
                    : THEME.successStrong
                }
              />
              <Text
                style={[
                  styles.toastBannerText,
                  {
                    color:
                      toastMsg.type === "error"
                        ? THEME.dangerStrong
                        : toastMsg.type === "info"
                        ? THEME.infoStrong
                        : THEME.successStrong,
                  },
                ]}
              >
                {toastMsg.text}
              </Text>
              <TouchableOpacity
                onPress={() => setToastMsg(null)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Feather
                  name="x"
                  size={16}
                  color={
                    toastMsg.type === "error"
                      ? THEME.dangerStrong
                      : toastMsg.type === "info"
                      ? THEME.infoStrong
                      : THEME.successStrong
                  }
                />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      {/* ── CONTENIDO PRINCIPAL SEGÚN RUTA ── */}

      {/* ==================== 1. PUNTO DE VENTA (/pos) ==================== */}
      {route === "pos" && (
        <View style={{ flex: 1 }}>
          {/* Barra superior de controles del POS (Buscador + Método de Pago + Moneda + Sub-tabs Catálogo/Carrito) */}
          <View style={styles.posControlHeader}>
            <View style={styles.posSearchRow}>
              <View style={styles.searchBox}>
                <Feather name="search" size={16} color={THEME.mutedForeground} />
                <TextInput
                  style={styles.searchBoxInput}
                  placeholder="Buscar por nombre o código..."
                  placeholderTextColor={THEME.mutedForeground}
                  value={posSearch}
                  onChangeText={setPosSearch}
                />
                {posSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setPosSearch("")}>
                    <Feather name="x-circle" size={16} color={THEME.mutedForeground} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Métodos de Pago horizontales (idénticos al selector del POS web: cambian la moneda automáticamente) */}
            {metodosPago.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.posMetodosRow}
              >
                {metodosPago.map((mp) => {
                  const isSel = String(mp.id) === String(metodoPagoSeleccionado);
                  return (
                    <TouchableOpacity
                      key={mp.id}
                      style={[styles.metodoChip, isSel && styles.metodoChipActive]}
                      onPress={() => handleSelectMetodoPago(String(mp.id))}
                    >
                      <Text style={{ fontSize: 12 }}>{getMetodoEmoji(mp.tipo, mp.nombre)}</Text>
                      <Text
                        style={[styles.metodoChipText, isSel && styles.metodoChipTextActive]}
                        numberOfLines={1}
                      >
                        {mp.nombre}
                      </Text>
                      {mp.moneda_codigo ? (
                        <View
                          style={[
                            styles.metodoChipBadge,
                            isSel && { backgroundColor: "rgba(255,255,255,0.22)" },
                          ]}
                        >
                          <Text
                            style={[
                              styles.metodoChipBadgeText,
                              isSel && { color: "#fff" },
                            ]}
                          >
                            {mp.moneda_codigo}
                          </Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {/* Conmutador Responsive: Catálogo vs Carrito + En espera */}
            <View style={styles.posModeSwitchRow}>
              <TouchableOpacity
                style={[
                  styles.posModeTab,
                  posSubView === "catalogo" && styles.posModeTabActive,
                ]}
                onPress={() => setPosSubView("catalogo")}
              >
                <Feather
                  name="grid"
                  size={14}
                  color={posSubView === "catalogo" ? "#fff" : THEME.foreground}
                />
                <Text
                  style={[
                    styles.posModeTabText,
                    posSubView === "catalogo" && styles.posModeTabTextActive,
                  ]}
                >
                  Catálogo ({posProductosFiltrados.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.posModeTab,
                  posSubView === "carrito" && styles.posModeTabActive,
                ]}
                onPress={() => setPosSubView("carrito")}
              >
                <Feather
                  name="shopping-cart"
                  size={14}
                  color={posSubView === "carrito" ? "#fff" : THEME.foreground}
                />
                <Text
                  style={[
                    styles.posModeTabText,
                    posSubView === "carrito" && styles.posModeTabTextActive,
                  ]}
                >
                  Carrito ({cart.reduce((s, c) => s + c.qty, 0)})
                </Text>
              </TouchableOpacity>

              {cart.length > 0 && (
                <TouchableOpacity
                  style={styles.posClearCartPill}
                  onPress={() => {
                    Alert.alert(
                      "Vaciar Carrito",
                      "¿Estás seguro de que deseas vaciar todos los productos del carrito?",
                      [
                        { text: "Cancelar", style: "cancel" },
                        {
                          text: "Vaciar",
                          style: "destructive",
                          onPress: () => {
                            setCart([]);
                            showToast("Carrito vaciado", "info");
                          },
                        },
                      ]
                    );
                  }}
                >
                  <Feather name="trash-2" size={13} color={THEME.dangerStrong} />
                  <Text style={styles.posClearCartPillText}>Vaciar</Text>
                </TouchableOpacity>
              )}

              {heldCarts.length > 0 && (
                <TouchableOpacity
                  style={styles.heldCartPill}
                  onPress={() => setShowHeldModal(true)}
                >
                  <Feather name="pause-circle" size={14} color={THEME.warningStrong} />
                  <Text style={styles.heldCartPillText}>En espera ({heldCarts.length})</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* SUB-VISTA A: CATÁLOGO DE PRODUCTOS */}
          {posSubView === "catalogo" ? (
            <View style={{ flex: 1 }}>
              {/* Filtro de Categorías */}
              {categorias.length > 0 && (
                <View style={styles.catFilterContainer}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 6, paddingHorizontal: 12 }}
                  >
                    <TouchableOpacity
                      style={[
                        styles.catChip,
                        posCategoriaId === null && styles.catChipActive,
                      ]}
                      onPress={() => setPosCategoriaId(null)}
                    >
                      <Text
                        style={[
                          styles.catChipText,
                          posCategoriaId === null && styles.catChipTextActive,
                        ]}
                      >
                        Todas
                      </Text>
                    </TouchableOpacity>
                    {categorias.map((cat) => {
                      const active = posCategoriaId === cat.id;
                      return (
                        <TouchableOpacity
                          key={cat.id}
                          style={[styles.catChip, active && styles.catChipActive]}
                          onPress={() => setPosCategoriaId(active ? null : cat.id)}
                        >
                          <Text
                            style={[
                              styles.catChipText,
                              active && styles.catChipTextActive,
                            ]}
                          >
                            {cat.nombre}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              <FlatList
                data={posProductosFiltrados}
                keyExtractor={(item) => String(item.id)}
                extraData={cartQtyMap}
                numColumns={2}
                columnWrapperStyle={{ gap: 10, paddingHorizontal: 12 }}
                contentContainerStyle={{ paddingTop: 10, paddingBottom: 110, gap: 10 }}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                removeClippedSubviews={Platform.OS === "android"}
                renderItem={({ item }) => {
                  const inCartQty = cartQtyMap.get(item.id) || 0;
                  const sinStock = item.stock <= 0;
                  const bajoStock = item.stock > 0 && item.stock <= (item.stock_minimo || 5);
                  const precioMostrado = precioUnitarioEnMoneda(item, monedaSeleccionada);

                  return (
                    <TouchableOpacity
                      style={[
                        styles.posProdCard,
                        inCartQty > 0 && styles.posProdCardInCart,
                        sinStock && { opacity: 0.55 },
                      ]}
                      onPress={() => addToCart(item, null)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.posProdTopRow}>
                        <View style={styles.posProdIconWrap}>
                          <Feather name="package" size={16} color={THEME.primary} />
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          {item.iva_incluido === 0 && (
                            <View style={styles.ivaBadge}>
                              <Text style={styles.ivaBadgeText}>+IVA</Text>
                            </View>
                          )}
                          <View
                            style={[
                              styles.stockBadge,
                              sinStock
                                ? styles.stockBadgeDanger
                                : bajoStock
                                ? styles.stockBadgeWarning
                                : styles.stockBadgeSuccess,
                            ]}
                          >
                            <Text
                              style={[
                                styles.stockBadgeText,
                                sinStock
                                  ? { color: THEME.dangerStrong }
                                  : bajoStock
                                  ? { color: THEME.warningStrong }
                                  : { color: THEME.successStrong },
                              ]}
                            >
                              {sinStock ? "Agotado" : `Stock: ${item.stock}`}
                            </Text>
                          </View>
                          {inCartQty > 0 && (
                            <View style={styles.inCartControlGroup}>
                              <TouchableOpacity
                                style={styles.inCartMinusBtn}
                                onPress={() => decreaseOrRemoveFromCart(item.id)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              >
                                <Feather name="minus" size={11} color="#fff" />
                              </TouchableOpacity>
                              <View style={styles.inCartCountBadge}>
                                <Text style={styles.inCartCountBadgeText}>{inCartQty}</Text>
                              </View>
                            </View>
                          )}
                        </View>
                      </View>

                      <Text style={styles.posProdName} numberOfLines={2}>
                        {item.nombre}
                      </Text>
                      <Text style={styles.posProdCode} numberOfLines={1}>
                        {item.codigo}
                      </Text>

                      {/* Presentaciones rápidas (ej. Caja x12) si el producto las tiene */}
                      {item.presentaciones && item.presentaciones.length > 0 && (
                        <View style={styles.posPresPillsRow}>
                          {item.presentaciones.map((pr) => (
                            <TouchableOpacity
                              key={pr.id}
                              style={styles.posPresMiniBtn}
                              onPress={() => addToCart(item, pr)}
                            >
                              <Feather name="box" size={10} color={THEME.primary600} />
                              <Text style={styles.posPresMiniBtnText}>
                                {pr.nombre} x{pr.unidades}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}

                      {/* Footer con el precio completo sin recortar */}
                      <View style={styles.posProdFooter}>
                        <View style={{ width: "100%" }}>
                          <Text style={styles.posProdPrice} numberOfLines={1}>
                            {fmt(precioMostrado, monedaSeleccionada)}
                          </Text>
                          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                            {monedas
                              .filter((m) => m.codigo !== monedaSeleccionada)
                              .map((m) => {
                                const pAlt = precioUnitarioEnMoneda(item, m.codigo);
                                return (
                                  <Text
                                    key={m.codigo}
                                    style={{ fontSize: 9.5, color: THEME.mutedForeground, fontWeight: "600" }}
                                  >
                                    {fmt(pAlt, m.codigo)}
                                  </Text>
                                );
                              })}
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.emptyBox}>
                    <Feather name="package" size={36} color={THEME.mutedForeground} />
                    <Text style={styles.emptyBoxTitle}>No se encontraron productos</Text>
                    <Text style={styles.emptyBoxSub}>
                      Prueba con otra búsqueda o sincroniza el catálogo.
                    </Text>
                  </View>
                }
              />

              {/* Barra Flotante de Carrito / Cobro Rápido en parte inferior */}
              {cart.length > 0 && (
                <View style={styles.floatingCartBar}>
                  <TouchableOpacity
                    style={styles.floatingCartInfo}
                    onPress={() => setPosSubView("carrito")}
                  >
                    <View style={styles.floatingCartBadge}>
                      <Text style={styles.floatingCartBadgeText}>
                        {cart.reduce((s, c) => s + c.qty, 0)}
                      </Text>
                    </View>
                    <View>
                      <Text style={styles.floatingCartLabel}>TOTAL CARRITO</Text>
                      <Text style={styles.floatingCartTotal}>
                        {fmt(total, monedaSeleccionada)}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity
                      style={styles.floatingViewCartBtn}
                      onPress={() => setPosSubView("carrito")}
                    >
                      <Text style={styles.floatingViewCartBtnText}>Editar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.floatingCheckoutBtn}
                      onPress={handleOpenCheckout}
                    >
                      <Text style={styles.floatingCheckoutBtnText}>Cobrar</Text>
                      <Feather name="arrow-right" size={16} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ) : (
            /* SUB-VISTA B: PANEL COMPLETO DEL CARRITO (idéntico al panel derecho del POS Web) */
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 12 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Cabecera del Carrito + Pausar + Limpiar */}
              <View style={styles.card}>
                <View style={styles.cartHeaderRow}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Feather name="shopping-cart" size={16} color={THEME.primary} />
                    <Text style={styles.cardSectionTitle}>
                      Carrito ({cart.reduce((s, c) => s + c.qty, 0)} ítems)
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {cart.length > 0 && (
                      <>
                        <TouchableOpacity style={styles.outlineSmallBtn} onPress={handlePauseCart}>
                          <Feather name="pause" size={12} color={THEME.foreground} />
                          <Text style={styles.outlineSmallBtnText}>Pausar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.outlineSmallBtn, { borderColor: THEME.dangerBorder }]}
                          onPress={() => setCart([])}
                        >
                          <Feather name="trash-2" size={12} color={THEME.dangerStrong} />
                          <Text style={[styles.outlineSmallBtnText, { color: THEME.dangerStrong }]}>
                            Limpiar
                          </Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>

                {/* Selector Interactivo de Cliente en Carrito */}
                <View style={styles.clienteSelectorBox}>
                  <View style={styles.clienteSelectorHeader}>
                    <Text style={styles.fieldLabelSmall}>CLIENTE</Text>
                    <TouchableOpacity
                      style={styles.newClientInlineBtn}
                      onPress={() => {
                        setCartClientDropdownOpen(false);
                        openCreateClienteModal(null, cartClientSearch);
                      }}
                    >
                      <Feather name="user-plus" size={12} color={THEME.primary} />
                      <Text style={styles.newClientInlineBtnText}>+ Nuevo Cliente</Text>
                    </TouchableOpacity>
                  </View>

                  {clienteSeleccionadoObj ? (
                    <View style={styles.clienteSelectedCard}>
                      <View style={styles.clienteAvatarIcon}>
                        <Feather name="user-check" size={18} color={THEME.primary} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.clienteSelectedName} numberOfLines={1}>
                          {clienteSeleccionadoObj.nombre}
                        </Text>
                        <Text style={styles.clienteSelectedMeta} numberOfLines={1}>
                          {clienteSeleccionadoObj.documento
                            ? `Doc: ${clienteSeleccionadoObj.documento}`
                            : "Sin doc"}
                          {clienteSeleccionadoObj.telefono
                            ? ` · Tel: ${clienteSeleccionadoObj.telefono}`
                            : ""}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.clienteChangeBtn}
                        onPress={() => {
                          setClienteId(null);
                          setCartClientSearch("");
                          setCartClientDropdownOpen(true);
                        }}
                      >
                        <Feather name="edit-2" size={12} color={THEME.mutedForeground} />
                        <Text style={styles.clienteChangeBtnText}>Cambiar</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={{ position: "relative", zIndex: 100 }}>
                      <View
                        style={[
                          styles.searchBox,
                          {
                            height: 44,
                            paddingHorizontal: 12,
                            backgroundColor: THEME.inputBg,
                            borderWidth: 1.5,
                            borderColor: cartClientDropdownOpen ? THEME.primary : THEME.border,
                          },
                        ]}
                      >
                        <Feather
                          name="search"
                          size={16}
                          color={cartClientDropdownOpen ? THEME.primary : THEME.mutedForeground}
                        />
                        <TextInput
                          style={[styles.searchBoxInput, { fontSize: 13.5 }]}
                          placeholder="Buscar cliente por nombre, doc o tel..."
                          placeholderTextColor={THEME.mutedForeground}
                          value={cartClientSearch}
                          onChangeText={(t) => {
                            setCartClientSearch(t);
                            setCartClientDropdownOpen(true);
                          }}
                          onFocus={() => setCartClientDropdownOpen(true)}
                        />
                        {cartClientSearch.length > 0 ? (
                          <TouchableOpacity
                            onPress={() => setCartClientSearch("")}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Feather name="x-circle" size={16} color={THEME.mutedForeground} />
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            onPress={() => setCartClientDropdownOpen(!cartClientDropdownOpen)}
                          >
                            <Feather
                              name={cartClientDropdownOpen ? "chevron-up" : "chevron-down"}
                              size={16}
                              color={THEME.mutedForeground}
                            />
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Dropdown de Clientes en Carrito */}
                      {cartClientDropdownOpen && (
                        <View style={styles.checkoutClientDropdownList}>
                          <ScrollView
                            style={{ maxHeight: 220 }}
                            nestedScrollEnabled={true}
                            keyboardShouldPersistTaps="handled"
                          >
                            {/* Opción rápida Consumidor Final */}
                            <TouchableOpacity
                              style={[
                                styles.checkoutClientDropdownRow,
                                !clienteId && { backgroundColor: THEME.secondary },
                              ]}
                              onPress={() => {
                                setClienteId(null);
                                setCartClientDropdownOpen(false);
                                setCartClientSearch("");
                              }}
                            >
                              <Feather name="user" size={15} color={THEME.mutedForeground} />
                              <View style={{ flex: 1 }}>
                                <Text
                                  style={{
                                    fontSize: 13,
                                    fontWeight: "700",
                                    color: THEME.foreground,
                                  }}
                                >
                                  Consumidor Final
                                </Text>
                                <Text style={{ fontSize: 11, color: THEME.mutedForeground }}>
                                  Venta rápida sin registrar cliente
                                </Text>
                              </View>
                              {!clienteId && (
                                <Feather name="check" size={16} color={THEME.primary} />
                              )}
                            </TouchableOpacity>

                            {/* Resultados filtrados */}
                            {filteredCartClientes.map((c) => {
                              const tieneD =
                                c.deuda_total && c.deuda_total.some((d) => Number(d.monto) > 0);
                              return (
                                <TouchableOpacity
                                  key={c.id}
                                  style={[
                                    styles.checkoutClientDropdownRow,
                                    clienteId === c.id && { backgroundColor: THEME.secondary },
                                  ]}
                                  onPress={() => {
                                    setClienteId(c.id);
                                    setCartClientDropdownOpen(false);
                                    setCartClientSearch("");
                                  }}
                                >
                                  <Feather name="user-check" size={15} color={THEME.primary} />
                                  <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text
                                      style={{
                                        fontSize: 13,
                                        fontWeight: "700",
                                        color: THEME.foreground,
                                      }}
                                      numberOfLines={1}
                                    >
                                      {c.nombre}
                                    </Text>
                                    <Text
                                      style={{ fontSize: 11, color: THEME.mutedForeground }}
                                      numberOfLines={1}
                                    >
                                      {c.documento ? `Doc: ${c.documento}` : "Sin doc"}
                                      {c.telefono ? ` · Tel: ${c.telefono}` : ""}
                                    </Text>
                                  </View>
                                  {tieneD && (
                                    <View style={styles.deudaChipMini}>
                                      <Text style={styles.deudaChipMiniText}>Con deuda</Text>
                                    </View>
                                  )}
                                  {clienteId === c.id && (
                                    <Feather name="check" size={16} color={THEME.primary} />
                                  )}
                                </TouchableOpacity>
                              );
                            })}

                            {filteredCartClientes.length === 0 &&
                              cartClientSearch.trim().length > 0 && (
                                <View style={{ padding: 14, alignItems: "center", gap: 8 }}>
                                  <Text style={{ fontSize: 12.5, color: THEME.mutedForeground }}>
                                    No se encontró "{cartClientSearch}"
                                  </Text>
                                  <TouchableOpacity
                                    style={[
                                      styles.primarySmallBtn,
                                      { paddingHorizontal: 14, paddingVertical: 7 },
                                    ]}
                                    onPress={() => {
                                      setCartClientDropdownOpen(false);
                                      openCreateClienteModal(null, cartClientSearch);
                                    }}
                                  >
                                    <Feather name="user-plus" size={13} color="#fff" />
                                    <Text
                                      style={{
                                        color: "#fff",
                                        fontWeight: "700",
                                        fontSize: 12,
                                      }}
                                    >
                                      + Crear cliente "{cartClientSearch}"
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              )}
                          </ScrollView>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Alerta de Deuda Registrada (idéntica a la web en ámbar/rojo) */}
                  {clienteSeleccionadoObj &&
                    clienteSeleccionadoObj.deuda_total &&
                    clienteSeleccionadoObj.deuda_total.length > 0 && (
                      <View style={styles.deudaAlertBox}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Feather name="alert-triangle" size={14} color={THEME.warningStrong} />
                          <Text style={styles.deudaAlertTitle}>
                            Este cliente presenta deuda pendiente:
                          </Text>
                        </View>
                        <View style={styles.deudaAlertAmountsRow}>
                          {clienteSeleccionadoObj.deuda_total.map((d) => (
                            <View key={d.codigo} style={styles.deudaChip}>
                              <Text style={styles.deudaChipText}>
                                {fmt(d.monto, d.codigo)}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}
                </View>
              </View>

              {/* Lista de Líneas del Carrito */}
              {cart.length === 0 ? (
                <View style={styles.card}>
                  <View style={styles.emptyBox}>
                    <Feather name="shopping-bag" size={34} color={THEME.mutedForeground} />
                    <Text style={styles.emptyBoxTitle}>El carrito está vacío</Text>
                    <Text style={styles.emptyBoxSub}>
                      Toca cualquier producto en el Catálogo para agregarlo.
                    </Text>
                    <TouchableOpacity
                      style={[styles.primaryBtn, { marginTop: 12, paddingHorizontal: 20 }]}
                      onPress={() => setPosSubView("catalogo")}
                    >
                      <Text style={styles.primaryBtnText}>Ir al Catálogo</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                cart.map((item) => {
                  const key = claveDe(item);
                  const unitPrice = precioDeLineaEnMoneda(item, monedaSeleccionada);
                  const lineBruto = totalLineaEnMoneda(item, monedaSeleccionada);
                  const lineDesc = descuentoDeLinea(item, monedaSeleccionada);
                  const lineNeto = Math.max(0, lineBruto - lineDesc);
                  const presentaciones = item.product.presentaciones || [];

                  return (
                    <View key={key} style={styles.cartItemCard}>
                      <View style={styles.cartItemTopRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.cartItemName}>{item.product.nombre}</Text>
                          <Text style={styles.cartItemSub}>
                            {fmt(unitPrice, monedaSeleccionada)} c/u · Stock: {item.product.stock}
                          </Text>
                        </View>
                        <Text style={styles.cartItemNeto}>
                          {fmt(lineNeto, monedaSeleccionada)}
                        </Text>
                      </View>

                      {/* Selector de Presentación en la línea (si tiene cajas/paquetes) */}
                      {presentaciones.length > 0 && (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={{ gap: 6, marginVertical: 6 }}
                        >
                          <TouchableOpacity
                            style={[
                              styles.presSelectChip,
                              !item.presentacion && styles.presSelectChipActive,
                            ]}
                            onPress={() => cambiarPresentacionLinea(key, null)}
                          >
                            <Text
                              style={[
                                styles.presSelectChipText,
                                !item.presentacion && styles.presSelectChipTextActive,
                              ]}
                            >
                              Unidad (x1)
                            </Text>
                          </TouchableOpacity>
                          {presentaciones.map((pr) => {
                            const active = item.presentacion?.id === pr.id;
                            return (
                              <TouchableOpacity
                                key={pr.id}
                                style={[
                                  styles.presSelectChip,
                                  active && styles.presSelectChipActive,
                                ]}
                                onPress={() => cambiarPresentacionLinea(key, pr)}
                              >
                                <Text
                                  style={[
                                    styles.presSelectChipText,
                                    active && styles.presSelectChipTextActive,
                                  ]}
                                >
                                  {pr.nombre} (x{pr.unidades})
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      )}

                      <View style={styles.cartItemControlsRow}>
                        {/* Cantidad - / + */}
                        <View style={styles.qtyStepper}>
                          <TouchableOpacity
                            style={styles.qtyStepBtn}
                            onPress={() => updateCartQty(key, -1)}
                          >
                            <Feather name="minus" size={14} color={THEME.foreground} />
                          </TouchableOpacity>
                          <Text style={styles.qtyStepValue}>{item.qty}</Text>
                          <TouchableOpacity
                            style={styles.qtyStepBtn}
                            onPress={() => updateCartQty(key, 1)}
                          >
                            <Feather name="plus" size={14} color={THEME.foreground} />
                          </TouchableOpacity>
                        </View>

                        {/* Descuento por línea ("10" o "10%") */}
                        <View style={styles.lineDiscountBox}>
                          <Text style={styles.lineDiscountLabel}>Desc:</Text>
                          <TextInput
                            style={styles.lineDiscountInput}
                            placeholder="0 o %"
                            placeholderTextColor={THEME.mutedForeground}
                            value={item.descuentoStr || ""}
                            onChangeText={(v) => setDescuentoLinea(key, v)}
                          />
                        </View>

                        <TouchableOpacity
                          style={styles.removeLineBtn}
                          onPress={() => updateCartQty(key, -item.qty)}
                        >
                          <Feather name="trash-2" size={15} color={THEME.dangerStrong} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}

              {/* Resumen de Totales y Botón Proceder al Pago */}
              {cart.length > 0 && (
                <View style={styles.card}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Subtotal</Text>
                    <Text style={styles.summaryVal}>{fmt(subtotal, monedaSeleccionada)}</Text>
                  </View>
                  {descuentoTotal > 0 && (
                    <View style={styles.summaryRow}>
                      <Text style={[styles.summaryLabel, { color: THEME.successStrong }]}>
                        Descuento
                      </Text>
                      <Text style={[styles.summaryVal, { color: THEME.successStrong }]}>
                        - {fmt(descuentoTotal, monedaSeleccionada)}
                      </Text>
                    </View>
                  )}
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>IVA (16%)</Text>
                    <Text style={styles.summaryVal}>{fmt(tax, monedaSeleccionada)}</Text>
                  </View>
                  {totalCobrosExtraEnMoneda(monedaSeleccionada) > 0 && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Cobros extra</Text>
                      <Text style={styles.summaryVal}>
                        + {fmt(totalCobrosExtraEnMoneda(monedaSeleccionada), monedaSeleccionada)}
                      </Text>
                    </View>
                  )}
                  <View style={styles.summaryTotalRow}>
                    <Text style={styles.summaryTotalLabel}>Total ({monedaSeleccionada})</Text>
                    <Text style={styles.summaryTotalValue}>
                      {fmt(total, monedaSeleccionada)}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[styles.primaryBtn, { marginTop: 12 }]}
                    onPress={handleOpenCheckout}
                  >
                    <Feather name="check-circle" size={17} color="#fff" />
                    <Text style={styles.primaryBtnText}>Proceder al Pago</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      )}

      {/* ==================== 2. CLIENTES & PERFIL DEL CLIENTE (/clientes y /clientes/[id]) ==================== */}
      {route === "clientes" && (
        <View style={{ flex: 1 }}>
          {perfilClienteId && perfilClienteObj ? (
            /* ── VISTA COMPLETA DE PERFIL DEL CLIENTE (clon exacto de src/app/(app)/clientes/[id]/page.tsx) ── */
            <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 95, gap: 12 }}>
              {/* Encabezado del Perfil */}
              <View style={styles.card}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <TouchableOpacity
                    style={styles.outlineSmallBtn}
                    onPress={() => setPerfilClienteId(null)}
                  >
                    <Feather name="arrow-left" size={16} color={THEME.foreground} />
                  </TouchableOpacity>

                  <View style={{ flex: 1 }}>
                    <Text style={[styles.clientCardName, { fontSize: 17 }]} numberOfLines={1}>
                      {perfilClienteObj.nombre}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 5,
                        marginTop: 4,
                      }}
                    >
                      <View
                        style={[
                          styles.statusBadge,
                          perfilClienteObj.tipo === "Empresa"
                            ? { backgroundColor: THEME.infoSoft, borderColor: THEME.infoBorder }
                            : { backgroundColor: THEME.muted, borderColor: THEME.border },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            {
                              color:
                                perfilClienteObj.tipo === "Empresa"
                                  ? THEME.infoStrong
                                  : THEME.mutedForeground,
                            },
                          ]}
                        >
                          {perfilClienteObj.tipo}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.statusBadge,
                          { backgroundColor: THEME.successSoft, borderColor: THEME.successBorder },
                        ]}
                      >
                        <Text style={[styles.statusBadgeText, { color: THEME.successStrong }]}>
                          {perfilClienteObj.activo ? "Activo" : "Inactivo"}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.statusBadge,
                          perfilClienteObj.recibe_credito === 1
                            ? { backgroundColor: THEME.infoSoft, borderColor: THEME.infoBorder }
                            : { backgroundColor: THEME.muted, borderColor: THEME.border },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            {
                              color:
                                perfilClienteObj.recibe_credito === 1
                                  ? THEME.infoStrong
                                  : THEME.mutedForeground,
                            },
                          ]}
                        >
                          {perfilClienteObj.recibe_credito === 1 ? "💳 Recibe crédito" : "Sin crédito"}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.outlineSmallBtn}
                    onPress={() => openCreateClienteModal(perfilClienteObj)}
                  >
                    <Feather name="edit-2" size={13} color={THEME.foreground} />
                    <Text style={styles.outlineSmallBtnText}>Editar</Text>
                  </TouchableOpacity>
                </View>

                {/* Banner de Avatar + 3 KPIs rápidos (Ventas, Retornos, Ticket Promedio) */}
                <View
                  style={{
                    marginTop: 12,
                    borderTopWidth: 1,
                    borderTopColor: THEME.border,
                    paddingTop: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View
                    style={[
                      styles.avatarCircle,
                      { width: 48, height: 48, borderRadius: 14, backgroundColor: THEME.primary },
                    ]}
                  >
                    <Text style={[styles.avatarCircleText, { color: "#fff", fontSize: 16 }]}>
                      {userInitials(perfilClienteObj.nombre)}
                    </Text>
                  </View>
                  <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-around" }}>
                    <View style={{ alignItems: "center" }}>
                      <Text style={{ fontSize: 16, fontWeight: "800", color: THEME.foreground }}>
                        {perfilStats.ventas_count}
                      </Text>
                      <Text style={styles.fieldLabelSmall}>VENTAS</Text>
                    </View>
                    <View
                      style={{
                        width: 1,
                        backgroundColor: THEME.border,
                        alignSelf: "stretch",
                      }}
                    />
                    <View style={{ alignItems: "center" }}>
                      <Text style={{ fontSize: 16, fontWeight: "800", color: THEME.foreground }}>
                        {perfilStats.retornos_count}
                      </Text>
                      <Text style={styles.fieldLabelSmall}>RETORNOS</Text>
                    </View>
                    <View
                      style={{
                        width: 1,
                        backgroundColor: THEME.border,
                        alignSelf: "stretch",
                      }}
                    />
                    <View style={{ alignItems: "center" }}>
                      <Text style={{ fontSize: 15, fontWeight: "800", color: THEME.primary600 }}>
                        {fmt(perfilStats.ticket_promedio_base, baseMonedaSistema?.codigo || "USD")}
                      </Text>
                      <Text style={styles.fieldLabelSmall}>TICKET PROM.</Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Tarjeta 2: Datos del Cliente */}
              <View style={styles.card}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Feather name="user" size={14} color={THEME.mutedForeground} />
                  <Text style={styles.fieldLabelSmall}>DATOS DEL CLIENTE</Text>
                  {perfilLoadingCloud && (
                    <ActivityIndicator size="small" color={THEME.primary} style={{ marginLeft: "auto" }} />
                  )}
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 10 }}>
                  <View style={{ width: "50%" }}>
                    <Text style={styles.fieldLabelSmall}>DOCUMENTO</Text>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: THEME.foreground }}>
                      {perfilClienteObj.documento || "—"}
                    </Text>
                  </View>
                  <View style={{ width: "50%" }}>
                    <Text style={styles.fieldLabelSmall}>TELÉFONO</Text>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: THEME.foreground }}>
                      {perfilClienteObj.telefono || "—"}
                    </Text>
                  </View>
                  <View style={{ width: "50%" }}>
                    <Text style={styles.fieldLabelSmall}>EMAIL</Text>
                    <Text
                      style={{ fontSize: 13, fontWeight: "600", color: THEME.foreground }}
                      numberOfLines={1}
                    >
                      {perfilClienteObj.email || "—"}
                    </Text>
                  </View>
                  <View style={{ width: "50%" }}>
                    <Text style={styles.fieldLabelSmall}>CIUDAD</Text>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: THEME.foreground }}>
                      {perfilClienteObj.ciudad || "—"}
                    </Text>
                  </View>
                  <View style={{ width: "50%" }}>
                    <Text style={styles.fieldLabelSmall}>ÚLTIMA COMPRA</Text>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: THEME.foreground }}>
                      {perfilStats.ultima_compra
                        ? String(perfilStats.ultima_compra).slice(0, 10)
                        : "Sin compras"}
                    </Text>
                  </View>
                  <View style={{ width: "50%" }}>
                    <Text style={styles.fieldLabelSmall}>TOTAL COMPRADO</Text>
                    <Text style={{ fontSize: 13, fontWeight: "800", color: THEME.successStrong }}>
                      {fmt(perfilStats.total_comprado_base, baseMonedaSistema?.codigo || "USD")}
                    </Text>
                  </View>
                </View>

                <View
                  style={{
                    marginTop: 10,
                    paddingTop: 8,
                    borderTopWidth: 1,
                    borderTopColor: THEME.border,
                  }}
                >
                  <Text style={styles.fieldLabelSmall}>DIRECCIÓN</Text>
                  <Text style={{ fontSize: 13, fontWeight: "500", color: THEME.foreground }}>
                    {perfilClienteObj.direccion || "—"}
                  </Text>
                </View>
              </View>

              {/* Tarjeta 3: Deuda y Crédito por Moneda + Botones "+ Crédito" y "Pagar deuda" (Abono Global) */}
              <View style={styles.card}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Feather name="credit-card" size={14} color={THEME.mutedForeground} />
                    <Text style={styles.fieldLabelSmall}>DEUDA Y CRÉDITO</Text>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <TouchableOpacity
                      style={styles.outlineSmallBtn}
                      onPress={() => openAjustarCreditoModal(perfilClienteObj)}
                    >
                      <Feather name="plus" size={13} color={THEME.foreground} />
                      <Text style={styles.outlineSmallBtnText}>Crédito</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.primarySmallBtn,
                        {
                          backgroundColor: THEME.danger,
                          opacity: perfilMonedas.some((m) => m.deuda > 0.005) ? 1 : 0.4,
                        },
                      ]}
                      disabled={!perfilMonedas.some((m) => m.deuda > 0.005)}
                      onPress={() => openPagoDeudaGlobal(perfilClienteObj)}
                    >
                      <Feather name="dollar-sign" size={13} color="#fff" />
                      <Text style={styles.primarySmallBtnText}>Pagar deuda</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Cabecera de Tabla Moneda / Crédito / Deuda */}
                <View
                  style={{
                    flexDirection: "row",
                    paddingVertical: 6,
                    borderBottomWidth: 1,
                    borderBottomColor: THEME.border,
                  }}
                >
                  <Text style={[styles.fieldLabelSmall, { flex: 1.1 }]}>MONEDA</Text>
                  <Text style={[styles.fieldLabelSmall, { flex: 1, textAlign: "right" }]}>
                    CRÉDITO
                  </Text>
                  <Text style={[styles.fieldLabelSmall, { flex: 1, textAlign: "right" }]}>
                    DEUDA
                  </Text>
                </View>

                {perfilMonedas.map((m) => {
                  const excedido = m.limite > 0 && m.deuda > m.limite;
                  return (
                    <View
                      key={m.moneda_id}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingVertical: 8,
                        borderBottomWidth: 1,
                        borderBottomColor: THEME.inputBg,
                      }}
                    >
                      <View
                        style={{
                          flex: 1.1,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <Text style={{ fontWeight: "800", fontSize: 13, color: THEME.foreground }}>
                          {m.codigo}
                        </Text>
                        {m.es_base && (
                          <View
                            style={{
                              backgroundColor: THEME.muted,
                              paddingHorizontal: 5,
                              paddingVertical: 1,
                              borderRadius: 4,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 9,
                                fontWeight: "700",
                                color: THEME.mutedForeground,
                              }}
                            >
                              BASE
                            </Text>
                          </View>
                        )}
                        {excedido && (
                          <Feather name="alert-triangle" size={13} color={THEME.danger} />
                        )}
                      </View>

                      <TouchableOpacity
                        style={{ flex: 1, alignItems: "flex-end" }}
                        onPress={() => openAjustarCreditoModal(perfilClienteObj, m.moneda_id, "add")}
                      >
                        <Text style={{ fontWeight: "700", fontSize: 13, color: THEME.foreground }}>
                          {fmt(m.limite, m.codigo)}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={{ flex: 1, alignItems: "flex-end" }}
                        disabled={m.deuda <= 0.005}
                        onPress={() => openPagoDeudaGlobal(perfilClienteObj, m.moneda_id)}
                      >
                        <Text
                          style={{
                            fontWeight: "800",
                            fontSize: 13,
                            color: m.deuda > 0.005 ? THEME.dangerStrong : THEME.mutedForeground,
                          }}
                        >
                          {fmt(m.deuda, m.codigo)}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>

              {/* 4 Pestañas del Perfil: Ventas, Créditos y abonos, Retornos, Productos más comprados (Top) */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6 }}
              >
                {(
                  [
                    { id: "ventas", label: `Ventas (${perfilVentas.length})`, icon: "shopping-cart" },
                    {
                      id: "creditos",
                      label: `Créditos y abonos (${perfilCreditos.length})`,
                      icon: "credit-card",
                    },
                    { id: "retornos", label: `Retornos (${perfilRetornos.length})`, icon: "rotate-ccw" },
                    {
                      id: "productos",
                      label: `Top Productos (${perfilTopProductos.length})`,
                      icon: "award",
                    },
                  ] as const
                ).map((t) => {
                  const active = perfilTab === t.id;
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.catChip, active && styles.catChipActive]}
                      onPress={() => setPerfilTab(t.id)}
                    >
                      <Text style={[styles.catChipText, active && styles.catChipTextActive]}>
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Contenido de Pestaña 1: VENTAS DEL CLIENTE */}
              {perfilTab === "ventas" && (
                <View style={{ gap: 8 }}>
                  {perfilVentas.length === 0 ? (
                    <View style={styles.emptyBox}>
                      <Feather name="shopping-cart" size={28} color={THEME.mutedForeground} />
                      <Text style={styles.emptyBoxTitle}>Sin ventas registradas</Text>
                      <Text style={styles.emptyBoxSub}>
                        Este cliente aún no tiene facturas en el sistema.
                      </Text>
                    </View>
                  ) : (
                    perfilVentas.map((v: any) => {
                      const saldoCred = Number(v.credito_saldo ?? 0);
                      const tieneSaldo = v.tipo_pago === "Credito" && saldoCred > 0.009;
                      const crAsociado = perfilCreditos.find(
                        (c) =>
                          (v.credito_id && String(c.id) === String(v.credito_id)) ||
                          String(c.venta_id) === String(v.id)
                      );
                      return (
                        <View key={v.id} style={styles.card}>
                          <View style={styles.creditoCardHeader}>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                <Text style={styles.creditoNumero}>{v.numero}</Text>
                                <View
                                  style={[
                                    styles.statusBadge,
                                    v.tipo_pago === "Credito"
                                      ? {
                                          backgroundColor: THEME.warningSoft,
                                          borderColor: THEME.warningBorder,
                                        }
                                      : {
                                          backgroundColor: THEME.infoSoft,
                                          borderColor: THEME.infoBorder,
                                        },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.statusBadgeText,
                                      {
                                        color:
                                          v.tipo_pago === "Credito"
                                            ? THEME.warningStrong
                                            : THEME.infoStrong,
                                      },
                                    ]}
                                  >
                                    {v.tipo_pago === "Credito" ? "Crédito" : "Contado"}
                                  </Text>
                                </View>
                              </View>
                              <Text style={styles.clientCardMeta}>
                                {String(v.fecha || "").slice(0, 10)} · {v.items_count ?? "—"} ítems
                                {v.metodo_pago_nombre ? ` · ${v.metodo_pago_nombre}` : ""}
                              </Text>
                            </View>

                            <View style={{ alignItems: "flex-end", gap: 4 }}>
                              <Text style={styles.posProdPrice}>
                                {fmt(Number(v.total) || 0, v.moneda_codigo || "USD")}
                              </Text>
                              {tieneSaldo && crAsociado ? (
                                <TouchableOpacity
                                  style={[
                                    styles.primarySmallBtn,
                                    {
                                      backgroundColor: THEME.danger,
                                      paddingVertical: 4,
                                      paddingHorizontal: 10,
                                    },
                                  ]}
                                  onPress={() => openAbonoModal(crAsociado)}
                                >
                                  <Feather name="dollar-sign" size={12} color="#fff" />
                                  <Text style={styles.primarySmallBtnText}>
                                    Pagar ({fmt(saldoCred, v.moneda_codigo || "USD")})
                                  </Text>
                                </TouchableOpacity>
                              ) : (
                                <View
                                  style={[
                                    styles.statusBadge,
                                    {
                                      backgroundColor: THEME.successSoft,
                                      borderColor: THEME.successBorder,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.statusBadgeText,
                                      { color: THEME.successStrong },
                                    ]}
                                  >
                                    ✓ {v.estado || "Pagada"}
                                  </Text>
                                </View>
                              )}
                            </View>
                          </View>

                          <View
                            style={{
                              flexDirection: "row",
                              justifyContent: "flex-end",
                              marginTop: 8,
                              paddingTop: 8,
                              borderTopWidth: 1,
                              borderTopColor: THEME.inputBg,
                            }}
                          >
                            <TouchableOpacity
                              style={styles.outlineSmallBtn}
                              onPress={() => handleOpenVentaDetail(v)}
                            >
                              <Feather name="eye" size={13} color={THEME.foreground} />
                              <Text style={styles.outlineSmallBtnText}>Ver Factura / Ítems</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>
              )}

              {/* Contenido de Pestaña 2: CRÉDITOS Y ABONOS DEL CLIENTE */}
              {perfilTab === "creditos" && (
                <View style={{ gap: 8 }}>
                  {perfilCreditos.length === 0 ? (
                    <View style={styles.emptyBox}>
                      <Feather name="credit-card" size={28} color={THEME.mutedForeground} />
                      <Text style={styles.emptyBoxTitle}>Sin créditos</Text>
                      <Text style={styles.emptyBoxSub}>
                        Este cliente no tiene créditos registrados.
                      </Text>
                    </View>
                  ) : (
                    perfilCreditos.map((cr) => {
                      const isPagado = cr.estado === "Pagado" || cr.saldo <= 0.009;
                      return (
                        <View key={cr.id} style={styles.card}>
                          <View style={styles.creditoCardHeader}>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                <Text style={styles.creditoNumero}>{cr.numero}</Text>
                                {cr.venta_numero && (
                                  <Text style={styles.creditoVentaTag}>Venta {cr.venta_numero}</Text>
                                )}
                              </View>
                              <Text style={styles.clientCardMeta}>{cr.fecha}</Text>
                            </View>
                            <View
                              style={[
                                styles.statusBadge,
                                isPagado
                                  ? {
                                      backgroundColor: THEME.successSoft,
                                      borderColor: THEME.successBorder,
                                    }
                                  : {
                                      backgroundColor: THEME.dangerSoft,
                                      borderColor: THEME.dangerBorder,
                                    },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.statusBadgeText,
                                  {
                                    color: isPagado ? THEME.successStrong : THEME.dangerStrong,
                                  },
                                ]}
                              >
                                {cr.estado}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.creditoAmountsContainer}>
                            <View style={styles.creditoAmountsTopRow}>
                              <View style={styles.creditoAmountCol}>
                                <Text style={styles.fieldLabelSmall}>TOTAL ORIGINAL</Text>
                                <Text
                                  style={styles.creditoAmountTotal}
                                  numberOfLines={1}
                                  adjustsFontSizeToFit
                                  minimumFontScale={0.75}
                                >
                                  {fmt(cr.monto_total, cr.moneda_codigo)}{" "}
                                  <Text style={styles.creditoAmountCurrency}>{cr.moneda_codigo}</Text>
                                </Text>
                              </View>
                              <View style={[styles.creditoAmountCol, { alignItems: "flex-end" }]}>
                                <Text style={styles.fieldLabelSmall}>ABONADO</Text>
                                <Text
                                  style={styles.creditoAmountAbonado}
                                  numberOfLines={1}
                                  adjustsFontSizeToFit
                                  minimumFontScale={0.75}
                                >
                                  {fmt(cr.abonado, cr.moneda_codigo)}{" "}
                                  <Text style={[styles.creditoAmountCurrency, { color: THEME.successStrong }]}>
                                    {cr.moneda_codigo}
                                  </Text>
                                </Text>
                              </View>
                            </View>

                            <View
                              style={[
                                styles.creditoSaldoHighlightRow,
                                isPagado
                                  ? { backgroundColor: THEME.successSoft, borderColor: THEME.successBorder }
                                  : { backgroundColor: THEME.dangerSoft, borderColor: THEME.dangerBorder },
                              ]}
                            >
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                                <Feather
                                  name={isPagado ? "check-circle" : "alert-circle"}
                                  size={13}
                                  color={isPagado ? THEME.successStrong : THEME.dangerStrong}
                                />
                                <Text
                                  style={[
                                    styles.creditoSaldoLabel,
                                    { color: isPagado ? THEME.successStrong : THEME.dangerStrong },
                                  ]}
                                >
                                  SALDO PENDIENTE
                                </Text>
                              </View>
                              <Text
                                style={[
                                  styles.creditoAmountSaldo,
                                  { color: isPagado ? THEME.successStrong : THEME.dangerStrong },
                                ]}
                                numberOfLines={1}
                                adjustsFontSizeToFit
                                minimumFontScale={0.75}
                              >
                                {fmt(cr.saldo, cr.moneda_codigo)}{" "}
                                <Text
                                  style={[
                                    styles.creditoAmountCurrency,
                                    {
                                      color: isPagado ? THEME.successStrong : THEME.dangerStrong,
                                      fontWeight: "800",
                                    },
                                  ]}
                                >
                                  {cr.moneda_codigo}
                                </Text>
                              </Text>
                            </View>
                          </View>

                          <View style={styles.creditoActionsRow}>
                            <TouchableOpacity
                              style={styles.outlineSmallBtn}
                              onPress={() => openHistorialAbonos(cr)}
                            >
                              <Feather name="list" size={13} color={THEME.foreground} />
                              <Text style={styles.outlineSmallBtnText}>
                                Abonos ({cr.abonos_count || 0})
                              </Text>
                            </TouchableOpacity>
                            {!isPagado && (
                              <TouchableOpacity
                                style={styles.primarySmallBtn}
                                onPress={() => openAbonoModal(cr)}
                              >
                                <Feather name="dollar-sign" size={13} color="#fff" />
                                <Text style={styles.primarySmallBtnText}>Registrar Abono</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>
              )}

              {/* Contenido de Pestaña 3: RETORNOS DEL CLIENTE */}
              {perfilTab === "retornos" && (
                <View style={{ gap: 8 }}>
                  {perfilRetornos.length === 0 ? (
                    <View style={styles.emptyBox}>
                      <Feather name="rotate-ccw" size={28} color={THEME.mutedForeground} />
                      <Text style={styles.emptyBoxTitle}>Sin retornos</Text>
                      <Text style={styles.emptyBoxSub}>
                        Este cliente no ha devuelto productos.
                      </Text>
                    </View>
                  ) : (
                    perfilRetornos.map((r: any) => (
                      <View key={r.id} style={styles.card}>
                        <View style={styles.creditoCardHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.creditoNumero}>{r.numero}</Text>
                            <Text style={styles.clientCardMeta}>
                              {String(r.fecha || "").slice(0, 10)} · Ref:{" "}
                              {r.venta_numero || "—"} · {r.items_count || 0} ítems
                            </Text>
                          </View>
                          <Text style={styles.posProdPrice}>
                            {fmt(
                              Number(r.total_moneda ?? r.total_base) || 0,
                              r.moneda_codigo || "USD"
                            )}
                          </Text>
                        </View>
                      </View>
                    ))
                  )}
                </View>
              )}

              {/* Contenido de Pestaña 4: TOP PRODUCTOS MÁS COMPRADOS */}
              {perfilTab === "productos" && (
                <View style={{ gap: 8 }}>
                  {perfilTopProductos.length === 0 ? (
                    <View style={styles.emptyBox}>
                      <Feather name="package" size={28} color={THEME.mutedForeground} />
                      <Text style={styles.emptyBoxTitle}>Sin datos de productos</Text>
                      <Text style={styles.emptyBoxSub}>
                        Cuando el cliente compre, aquí verás el ranking de lo que más lleva.
                      </Text>
                    </View>
                  ) : (
                    perfilTopProductos.map((p: any, idx: number) => {
                      const baseCod = baseMonedaSistema?.codigo || "USD";
                      const montoEnActiva = convertirMonto(
                        Number(p.monto_base) || 0,
                        baseCod,
                        monedaSeleccionada
                      );
                      return (
                        <View key={p.producto_id || idx} style={styles.card}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                            <View
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 16,
                                backgroundColor: idx < 3 ? THEME.accent : THEME.inputBg,
                                borderWidth: 1,
                                borderColor: idx < 3 ? THEME.primary : THEME.border,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Text
                                style={{
                                  fontWeight: "900",
                                  fontSize: 12,
                                  color: idx < 3 ? THEME.primary600 : THEME.mutedForeground,
                                }}
                              >
                                #{idx + 1}
                              </Text>
                            </View>

                            <View style={{ flex: 1 }}>
                              <Text style={styles.posProdCode}>{p.codigo}</Text>
                              <Text style={styles.posProdName}>{p.nombre}</Text>
                              <Text style={styles.clientCardMeta}>
                                {p.cantidad_total} unid. · {p.veces} compra
                                {Number(p.veces) === 1 ? "" : "s"}
                              </Text>
                            </View>

                            <View style={{ alignItems: "flex-end" }}>
                              <Text style={styles.posProdPrice}>
                                {fmt(Number(p.monto_base) || 0, baseCod)}
                              </Text>
                              {monedaSeleccionada !== baseCod && (
                                <Text style={styles.clientCardMeta}>
                                  {fmt(montoEnActiva, monedaSeleccionada)}
                                </Text>
                              )}
                            </View>
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>
              )}
            </ScrollView>
          ) : perfilClienteId ? (
            <View style={[styles.emptyBox, { marginTop: 40 }]}>
              {perfilLoadingCloud ? (
                <>
                  <ActivityIndicator size="large" color={THEME.primary} />
                  <Text style={[styles.emptyBoxTitle, { marginTop: 12 }]}>Cargando perfil...</Text>
                </>
              ) : (
                <>
                  <Feather name="alert-circle" size={32} color={THEME.danger} />
                  <Text style={styles.emptyBoxTitle}>Cliente no encontrado</Text>
                  <TouchableOpacity
                    style={[styles.primarySmallBtn, { marginTop: 12 }]}
                    onPress={() => setPerfilClienteId(null)}
                  >
                    <Text style={styles.primarySmallBtnText}>Volver a clientes</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : (
            /* ── DIRECTORIO DE CLIENTES ── */
            <>
              <View style={styles.moduleHeaderBar}>
                <View style={[styles.searchBox, { flex: 1 }]}>
                  <Feather name="search" size={16} color={THEME.mutedForeground} />
                  <TextInput
                    style={styles.searchBoxInput}
                    placeholder="Buscar cliente, documento o teléfono..."
                    placeholderTextColor={THEME.mutedForeground}
                    value={clientesSearch}
                    onChangeText={setClientesSearch}
                  />
                </View>
                <TouchableOpacity
                  style={styles.primarySmallBtn}
                  onPress={() => openCreateClienteModal(null)}
                >
                  <Feather name="plus" size={15} color="#fff" />
                  <Text style={styles.primarySmallBtnText}>Nuevo Cliente</Text>
                </TouchableOpacity>
              </View>

              <FlatList
                data={clientesFiltrados}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 10 }}
                renderItem={({ item }) => {
                  const tieneDeuda = item.deuda_total && item.deuda_total.some((d) => d.monto > 0.005);
                  return (
                    <TouchableOpacity
                      style={styles.card}
                      onPress={() => openPerfilCliente(item.id)}
                      activeOpacity={0.85}
                    >
                      <View style={styles.clientCardTop}>
                        <View style={styles.avatarCircle}>
                          <Text style={styles.avatarCircleText}>{userInitials(item.nombre)}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={styles.clientCardName}>{item.nombre}</Text>
                            <View
                              style={[
                                styles.statusBadge,
                                item.tipo === "Empresa"
                                  ? { backgroundColor: THEME.infoSoft, borderColor: THEME.infoBorder }
                                  : { backgroundColor: THEME.muted, borderColor: THEME.border },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.statusBadgeText,
                                  {
                                    color:
                                      item.tipo === "Empresa"
                                        ? THEME.infoStrong
                                        : THEME.mutedForeground,
                                  },
                                ]}
                              >
                                {item.tipo}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.clientCardMeta}>
                            {item.documento || "Sin documento"}
                            {item.telefono ? ` · 📞 ${item.telefono}` : ""}
                            {item.ciudad ? ` · 📍 ${item.ciudad}` : ""}
                          </Text>
                        </View>
                        <Feather name="chevron-right" size={18} color={THEME.mutedForeground} />
                      </View>

                      <View style={styles.clientCardFooter}>
                        {/* Límites de crédito configurados */}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.fieldLabelSmall}>CRÉDITO HABILITADO</Text>
                          {item.recibe_credito === 1 ? (
                            <View
                              style={{
                                flexDirection: "row",
                                flexWrap: "wrap",
                                gap: 4,
                                marginTop: 2,
                              }}
                            >
                              {item.limites_credito
                                .filter((l) => l.limite > 0)
                                .map((l) => (
                                  <View key={l.codigo} style={styles.creditLimitTag}>
                                    <Text style={styles.creditLimitTagText}>
                                      Lím {l.codigo}: {l.simbolo} {l.limite.toFixed(0)}
                                    </Text>
                                  </View>
                                ))}
                              {item.limites_credito.every((l) => l.limite <= 0) && (
                                <Text style={styles.mutedSmallText}>Sin límite asignado</Text>
                              )}
                            </View>
                          ) : (
                            <Text style={styles.mutedSmallText}>Solo contado</Text>
                          )}
                        </View>

                        {/* Deuda Total por moneda */}
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={styles.fieldLabelSmall}>DEUDA TOTAL</Text>
                          {tieneDeuda ? (
                            item.deuda_total.map((d) => (
                              <Text key={d.codigo} style={styles.clientDebtAmount}>
                                {fmt(d.monto, d.codigo)}
                              </Text>
                            ))
                          ) : (
                            <Text style={[styles.mutedSmallText, { color: THEME.successStrong }]}>
                              Solvente
                            </Text>
                          )}
                        </View>
                      </View>

                      {/* Barra de Acciones Rápidas: Ver Perfil, Pagar Deuda Global, Editar */}
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          gap: 6,
                          marginTop: 10,
                          paddingTop: 8,
                          borderTopWidth: 1,
                          borderTopColor: THEME.inputBg,
                        }}
                      >
                        <TouchableOpacity
                          style={styles.outlineSmallBtn}
                          onPress={() => openPerfilCliente(item.id)}
                        >
                          <Feather name="user" size={13} color={THEME.foreground} />
                          <Text style={styles.outlineSmallBtnText}>Ver Perfil</Text>
                        </TouchableOpacity>

                        {tieneDeuda && (
                          <TouchableOpacity
                            style={[styles.primarySmallBtn, { backgroundColor: THEME.danger }]}
                            onPress={() => openPagoDeudaGlobal(item)}
                          >
                            <Feather name="dollar-sign" size={13} color="#fff" />
                            <Text style={styles.primarySmallBtnText}>Pagar deuda</Text>
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity
                          style={styles.outlineSmallBtn}
                          onPress={() => openCreateClienteModal(item)}
                        >
                          <Feather name="edit-2" size={13} color={THEME.foreground} />
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.emptyBox}>
                    <Feather name="users" size={34} color={THEME.mutedForeground} />
                    <Text style={styles.emptyBoxTitle}>Sin clientes registrados</Text>
                    <Text style={styles.emptyBoxSub}>
                      Crea tu primer cliente con el botón "+ Nuevo Cliente".
                    </Text>
                  </View>
                }
              />
            </>
          )}
        </View>
      )}

      {/* ==================== 3. CRÉDITOS / DEUDORES (/creditos) ==================== */}
      {route === "creditos" && (
        <View style={{ flex: 1 }}>
          {/* 3 KPI Cards idénticas a src/app/(app)/creditos/page.tsx */}
          <View style={styles.creditosKpiRow}>
            <View style={[styles.kpiCard, { flex: 1.3 }]}>
              <Text style={styles.kpiLabel}>POR COBRAR</Text>
              {creditosData.por_cobrar.length === 0 ? (
                <Text style={[styles.kpiValue, { color: THEME.successStrong }]}>$ 0,00</Text>
              ) : (
                creditosData.por_cobrar.map((r) => (
                  <Text key={r.codigo} style={[styles.kpiValueSmall, { color: THEME.dangerStrong }]}>
                    {fmt(r.monto, r.codigo)} <Text style={{ fontSize: 10, fontWeight: "600" }}>{r.codigo}</Text>
                  </Text>
                ))
              )}
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>PENDIENTES</Text>
              <Text style={[styles.kpiValue, { color: THEME.warningStrong }]}>
                {creditosData.pendientes}
              </Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>PAGADOS</Text>
              <Text style={[styles.kpiValue, { color: THEME.successStrong }]}>
                {creditosData.pagados}
              </Text>
            </View>
          </View>

          {/* Filtros de Estado + Buscador */}
          <View style={styles.creditosFilterBar}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6 }}
            >
              {(["Todos", "Pendiente", "Parcial", "Pagado"] as const).map((est) => {
                const active = creditosEstadoFilter === est;
                return (
                  <TouchableOpacity
                    key={est}
                    style={[styles.catChip, active && styles.catChipActive]}
                    onPress={() => setCreditosEstadoFilter(est)}
                  >
                    <Text style={[styles.catChipText, active && styles.catChipTextActive]}>
                      {est}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View
              style={[
                styles.searchBox,
                { marginTop: 8, width: "100%", flex: undefined, height: 42, paddingHorizontal: 12 },
              ]}
            >
              <Feather name="search" size={16} color={THEME.mutedForeground} />
              <TextInput
                style={[styles.searchBoxInput, { fontSize: 13.5 }]}
                placeholder="Buscar deudor, documento o N° de crédito..."
                placeholderTextColor={THEME.mutedForeground}
                value={creditosSearch}
                onChangeText={setCreditosSearch}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {creditosSearch.length > 0 && (
                <TouchableOpacity
                  onPress={() => setCreditosSearch("")}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Feather name="x-circle" size={16} color={THEME.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <FlatList
            data={creditosFiltrados}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 10 }}
            renderItem={({ item }) => {
              const isPagado = item.estado === "Pagado" || item.saldo <= 0.009;
              const isParcial = item.estado === "Parcial";
              return (
                <View style={styles.card}>
                  <View style={styles.creditoCardHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={styles.creditoNumero}>{item.numero}</Text>
                        {item.venta_numero && (
                          <Text style={styles.creditoVentaTag}>Venta {item.venta_numero}</Text>
                        )}
                      </View>
                      <TouchableOpacity
                        onPress={() => openPerfilCliente(item.cliente_id)}
                        style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 }}
                      >
                        <Text style={[styles.creditoClienteName, { color: THEME.primary600 }]}>
                          {item.cliente_nombre}
                        </Text>
                        <Feather name="external-link" size={12} color={THEME.primary600} />
                      </TouchableOpacity>
                      <Text style={styles.clientCardMeta}>
                        {item.fecha}
                        {item.cliente_documento ? ` · ${item.cliente_documento}` : ""}
                        {item.cliente_telefono ? ` · 📞 ${item.cliente_telefono}` : ""}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.statusBadge,
                        isPagado
                          ? {
                              backgroundColor: THEME.successSoft,
                              borderColor: THEME.successBorder,
                            }
                          : isParcial
                          ? {
                              backgroundColor: THEME.warningSoft,
                              borderColor: THEME.warningBorder,
                            }
                          : {
                              backgroundColor: THEME.dangerSoft,
                              borderColor: THEME.dangerBorder,
                            },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusBadgeText,
                          {
                            color: isPagado
                              ? THEME.successStrong
                              : isParcial
                              ? THEME.warningStrong
                              : THEME.dangerStrong,
                          },
                        ]}
                      >
                        {item.estado}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.creditoAmountsContainer}>
                    <View style={styles.creditoAmountsTopRow}>
                      <View style={styles.creditoAmountCol}>
                        <Text style={styles.fieldLabelSmall}>TOTAL ORIGINAL</Text>
                        <Text
                          style={styles.creditoAmountTotal}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.75}
                        >
                          {fmt(item.monto_total, item.moneda_codigo)}{" "}
                          <Text style={styles.creditoAmountCurrency}>{item.moneda_codigo}</Text>
                        </Text>
                      </View>
                      <View style={[styles.creditoAmountCol, { alignItems: "flex-end" }]}>
                        <Text style={styles.fieldLabelSmall}>ABONADO</Text>
                        <Text
                          style={styles.creditoAmountAbonado}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.75}
                        >
                          {fmt(item.abonado, item.moneda_codigo)}{" "}
                          <Text style={[styles.creditoAmountCurrency, { color: THEME.successStrong }]}>
                            {item.moneda_codigo}
                          </Text>
                        </Text>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.creditoSaldoHighlightRow,
                        isPagado
                          ? { backgroundColor: THEME.successSoft, borderColor: THEME.successBorder }
                          : { backgroundColor: THEME.dangerSoft, borderColor: THEME.dangerBorder },
                      ]}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <Feather
                          name={isPagado ? "check-circle" : "alert-circle"}
                          size={13}
                          color={isPagado ? THEME.successStrong : THEME.dangerStrong}
                        />
                        <Text
                          style={[
                            styles.creditoSaldoLabel,
                            { color: isPagado ? THEME.successStrong : THEME.dangerStrong },
                          ]}
                        >
                          SALDO PENDIENTE
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.creditoAmountSaldo,
                          { color: isPagado ? THEME.successStrong : THEME.dangerStrong },
                        ]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                      >
                        {fmt(item.saldo, item.moneda_codigo)}{" "}
                        <Text
                          style={[
                            styles.creditoAmountCurrency,
                            {
                              color: isPagado ? THEME.successStrong : THEME.dangerStrong,
                              fontWeight: "800",
                            },
                          ]}
                        >
                          {item.moneda_codigo}
                        </Text>
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.creditoActionsRow, { flexWrap: "wrap" }]}>
                    <TouchableOpacity
                      style={styles.outlineSmallBtn}
                      onPress={() => openHistorialAbonos(item)}
                    >
                      <Feather name="list" size={13} color={THEME.foreground} />
                      <Text style={styles.outlineSmallBtnText}>
                        Abonos ({item.abonos_count || 0})
                      </Text>
                    </TouchableOpacity>

                    {!isPagado && (
                      <>
                        <TouchableOpacity
                          style={[styles.primarySmallBtn, { backgroundColor: THEME.danger }]}
                          onPress={() => {
                            const cli = clientes.find((c) => String(c.id) === String(item.cliente_id));
                            if (cli) {
                              openPagoDeudaGlobal(cli, item.moneda_id);
                            } else {
                              openAbonoModal(item);
                            }
                          }}
                        >
                          <Feather name="layers" size={13} color="#fff" />
                          <Text style={styles.primarySmallBtnText}>Abono Global</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.primarySmallBtn}
                          onPress={() => openAbonoModal(item)}
                        >
                          <Feather name="dollar-sign" size={13} color="#fff" />
                          <Text style={styles.primarySmallBtnText}>Abonar Factura</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Feather name="credit-card" size={34} color={THEME.mutedForeground} />
                <Text style={styles.emptyBoxTitle}>No hay créditos en este filtro</Text>
                <Text style={styles.emptyBoxSub}>
                  Las ventas a crédito o con pago parcial aparecerán aquí automáticamente.
                </Text>
              </View>
            }
          />
        </View>
      )}

      {/* ==================== 4. HISTORIAL DE VENTAS (/ventas) ==================== */}
      {route === "ventas" && (
        <View style={{ flex: 1 }}>
          <View style={styles.moduleHeaderBar}>
            <View style={[styles.searchBox, { flex: 1 }]}>
              <Feather name="search" size={16} color={THEME.mutedForeground} />
              <TextInput
                style={styles.searchBoxInput}
                placeholder="Buscar por número o cliente..."
                placeholderTextColor={THEME.mutedForeground}
                value={ventasSearch}
                onChangeText={setVentasSearch}
              />
            </View>
          </View>

          <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 10 }}>
            {/* Ventas creadas en este dispositivo móvil */}
            {ventasLocales.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={styles.sectionGroupHeader}>VENTAS DESDE ESTE MÓVIL</Text>
                {ventasLocales
                  .filter(
                    (v) =>
                      !ventasSearch.trim() ||
                      v.numero.toLowerCase().includes(ventasSearch.toLowerCase()) ||
                      v.cliente_nombre.toLowerCase().includes(ventasSearch.toLowerCase())
                  )
                  .map((v) => {
                    const mon = monedas.find((m) => String(m.id) === String(v.moneda_id));
                    return (
                      <View key={v.id} style={styles.card}>
                        <View style={styles.creditoCardHeader}>
                          <View>
                            <Text style={styles.creditoNumero}>{v.numero}</Text>
                            <Text style={styles.creditoClienteName}>{v.cliente_nombre}</Text>
                            <Text style={styles.clientCardMeta}>
                              {v.fecha} · {v.tipo_pago || "Contado"}
                            </Text>
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={styles.posProdPrice}>
                              {fmt(Number(v.total) || 0, mon?.codigo)}
                            </Text>
                            <View
                              style={[
                                styles.statusBadge,
                                v.sincronizado === 1
                                  ? {
                                      backgroundColor: THEME.successSoft,
                                      borderColor: THEME.successBorder,
                                    }
                                  : {
                                      backgroundColor: THEME.warningSoft,
                                      borderColor: THEME.warningBorder,
                                    },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.statusBadgeText,
                                  {
                                    color:
                                      v.sincronizado === 1
                                        ? THEME.successStrong
                                        : THEME.warningStrong,
                                  },
                                ]}
                              >
                                {v.sincronizado === 1 ? "Sincronizada" : "En cola"}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    );
                  })}
              </View>
            )}

            {/* Ventas generales sincronizadas del sistema */}
            <Text style={styles.sectionGroupHeader}>HISTORIAL GENERAL DE VENTAS</Text>
            {ventasRemotas
              .filter(
                (v) =>
                  !ventasSearch.trim() ||
                  v.numero.toLowerCase().includes(ventasSearch.toLowerCase()) ||
                  (v.cliente && v.cliente.toLowerCase().includes(ventasSearch.toLowerCase()))
              )
              .map((v) => (
                <View key={v.id} style={styles.card}>
                  <View style={styles.creditoCardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.creditoNumero}>{v.numero}</Text>
                      <Text style={styles.creditoClienteName}>
                        {v.cliente || "Consumidor Final"}
                      </Text>
                      <Text style={styles.clientCardMeta}>
                        {v.fecha} · {v.tipo_pago}
                        {v.metodo_pago_nombre ? ` (${v.metodo_pago_nombre})` : ""}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <Text style={styles.posProdPrice}>
                        {fmt(Number(v.total) || 0, v.moneda_codigo)}
                      </Text>
                      <View
                        style={[
                          styles.statusBadge,
                          v.estado === "Pagada"
                            ? {
                                backgroundColor: THEME.successSoft,
                                borderColor: THEME.successBorder,
                              }
                            : {
                                backgroundColor: THEME.warningSoft,
                                borderColor: THEME.warningBorder,
                              },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            {
                              color:
                                v.estado === "Pagada"
                                  ? THEME.successStrong
                                  : THEME.warningStrong,
                            },
                          ]}
                        >
                          {v.estado}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              ))}
          </ScrollView>
        </View>
      )}

      {/* ==================== 5. PRODUCTOS (/productos) ==================== */}
      {route === "productos" && (
        <View style={{ flex: 1 }}>
          <View style={styles.moduleHeaderBar}>
            <View style={[styles.searchBox, { flex: 1 }]}>
              <Feather name="search" size={16} color={THEME.mutedForeground} />
              <TextInput
                style={styles.searchBoxInput}
                placeholder="Buscar producto por nombre o código..."
                placeholderTextColor={THEME.mutedForeground}
                value={productosSearch}
                onChangeText={setProductosSearch}
              />
              {productosSearch.length > 0 && (
                <TouchableOpacity onPress={() => setProductosSearch("")}>
                  <Feather name="x-circle" size={16} color={THEME.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <FlatList
            data={productos.filter(
              (p) =>
                !productosSearch.trim() ||
                p.nombre.toLowerCase().includes(productosSearch.toLowerCase()) ||
                p.codigo.toLowerCase().includes(productosSearch.toLowerCase())
            )}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 10 }}
            renderItem={({ item }) => {
              const preciosTres = preciosProductoTresMonedas(item);
              const sinStock = item.stock <= 0;
              const bajoStock = item.stock > 0 && item.stock <= (item.stock_minimo || 5);
              const pBase = Number(item.precio_base) || 0;
              const cBase = Number(item.costo_base) || 0;
              const margen =
                pBase > 0 && cBase > 0 ? redondear(((pBase - cBase) / cBase) * 100, 2) : null;

              return (
                <View style={styles.card}>
                  <View style={styles.creditoCardHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <Text style={styles.clientCardName}>{item.nombre}</Text>
                        <View
                          style={[
                            styles.ivaBadge,
                            item.iva_incluido !== 0 && {
                              backgroundColor: THEME.secondary,
                              borderColor: THEME.primary,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.ivaBadgeText,
                              item.iva_incluido !== 0 && { color: THEME.primary600 },
                            ]}
                          >
                            {item.iva_incluido !== 0 ? "IVA Incl." : "+IVA"}
                          </Text>
                        </View>
                        {margen !== null && (
                          <View
                            style={[
                              styles.ivaBadge,
                              {
                                backgroundColor: THEME.warningSoft,
                                borderColor: THEME.warningBorder,
                              },
                            ]}
                          >
                            <Text style={styles.ivaBadgeText}>Margen {margen}%</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.clientCardMeta}>
                        Código: {item.codigo}
                        {item.categoria_nombre ? ` · ${item.categoria_nombre}` : ""}
                        {item.marca_nombre ? ` · ${item.marca_nombre}` : ""}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.stockBadge,
                        sinStock
                          ? styles.stockBadgeDanger
                          : bajoStock
                          ? styles.stockBadgeWarning
                          : styles.stockBadgeSuccess,
                      ]}
                    >
                      <Text
                        style={[
                          styles.stockBadgeText,
                          sinStock
                            ? { color: THEME.dangerStrong }
                            : bajoStock
                            ? { color: THEME.warningStrong }
                            : { color: THEME.successStrong },
                        ]}
                      >
                        Stock: {item.stock}
                      </Text>
                    </View>
                  </View>

                  {/* Precios de Venta y Costos en las 3 Monedas (USD, VES, COP) */}
                  <View
                    style={{
                      marginTop: 10,
                      backgroundColor: THEME.inputBg,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: THEME.border,
                      padding: 9,
                      gap: 6,
                    }}
                  >
                    <Text style={styles.fieldLabelSmall}>
                      PRECIO DE VENTA POR MONEDA ({cfgGlobal.metodo_conversion_ventas.toUpperCase()})
                    </Text>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 6 }}>
                      {preciosTres.map((pm) => (
                        <View
                          key={`pv-${pm.codigo}`}
                          style={{
                            flex: 1,
                            backgroundColor: pm.codigo === monedaSeleccionada ? THEME.accent : THEME.card,
                            borderWidth: 1,
                            borderColor: pm.codigo === monedaSeleccionada ? THEME.primary : THEME.border,
                            borderRadius: 6,
                            paddingHorizontal: 7,
                            paddingVertical: 5,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 9,
                              fontWeight: "800",
                              color:
                                pm.codigo === monedaSeleccionada
                                  ? THEME.primary600
                                  : THEME.mutedForeground,
                            }}
                          >
                            {pm.codigo} {pm.es_base_prod ? "★" : ""}
                          </Text>
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: "800",
                              color: THEME.foreground,
                              marginTop: 1,
                            }}
                            numberOfLines={1}
                          >
                            {fmt(pm.precio, pm.codigo)}
                          </Text>
                          <Text
                            style={{
                              fontSize: 9,
                              color: THEME.mutedForeground,
                              marginTop: 1,
                            }}
                            numberOfLines={1}
                          >
                            Costo: {fmt(pm.costo, pm.codigo)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              );
            }}
          />
        </View>
      )}

      {/* ==================== 6. PANEL DE CONTROL (/dashboard) & CONFIG ==================== */}
      {(route === "dashboard" || route === "config") && (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 12 }}>
          <View style={styles.creditosKpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>PRODUCTOS</Text>
              <Text style={styles.kpiValue}>{productos.length}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>CLIENTES</Text>
              <Text style={styles.kpiValue}>{clientes.length}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>DEUDORES</Text>
              <Text style={[styles.kpiValue, { color: THEME.warningStrong }]}>
                {creditosData.pendientes}
              </Text>
            </View>
          </View>

          {/* Accesos Directos idénticos al sistema */}
          <View style={styles.card}>
            <Text style={styles.cardSectionTitle}>Módulos Principales</Text>
            <View style={styles.quickGrid}>
              <TouchableOpacity style={styles.quickTile} onPress={() => setRoute("pos")}>
                <View style={[styles.quickTileIcon, { backgroundColor: THEME.accent }]}>
                  <Feather name="shopping-cart" size={20} color={THEME.primary} />
                </View>
                <Text style={styles.quickTileTitle}>Punto de Venta</Text>
                <Text style={styles.quickTileSub}>Contado, Crédito y Mixto</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickTile} onPress={() => setRoute("clientes")}>
                <View style={[styles.quickTileIcon, { backgroundColor: THEME.infoSoft }]}>
                  <Feather name="users" size={20} color={THEME.infoStrong} />
                </View>
                <Text style={styles.quickTileTitle}>Clientes</Text>
                <Text style={styles.quickTileSub}>Perfiles y Límites</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickTile} onPress={() => setRoute("creditos")}>
                <View style={[styles.quickTileIcon, { backgroundColor: THEME.dangerSoft }]}>
                  <Feather name="credit-card" size={20} color={THEME.dangerStrong} />
                </View>
                <Text style={styles.quickTileTitle}>Deudores</Text>
                <Text style={styles.quickTileSub}>Cuentas por Cobrar y Abonos</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickTile} onPress={() => setRoute("ventas")}>
                <View style={[styles.quickTileIcon, { backgroundColor: THEME.successSoft }]}>
                  <Feather name="trending-up" size={20} color={THEME.successStrong} />
                </View>
                <Text style={styles.quickTileTitle}>Ventas</Text>
                <Text style={styles.quickTileSub}>Historial y Recibos</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Tasas de Cambio Activas (con detalle de Directo USD y Referencia) */}
          <View style={styles.card}>
            <Text style={styles.cardSectionTitle}>Monedas y Tasas Sincronizadas</Text>
            <View style={{ gap: 8, marginTop: 8 }}>
              {monedas.map((m) => {
                const refMon = m.tasa_ref_moneda_id
                  ? monedas.find((x) => String(x.id) === String(m.tasa_ref_moneda_id))
                  : baseMonedaSistema;
                const directa = tasaDirectaUsd(m);

                return (
                  <View
                    key={m.id}
                    style={{
                      backgroundColor: THEME.inputBg,
                      borderWidth: 1,
                      borderColor: THEME.border,
                      borderRadius: 8,
                      padding: 10,
                      gap: 4,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: THEME.foreground }}>
                        {m.nombre} ({m.codigo})
                      </Text>
                      {m.es_base === 1 && (
                        <View
                          style={[
                            styles.statusBadge,
                            { backgroundColor: THEME.secondary, borderColor: THEME.primary },
                          ]}
                        >
                          <Text style={[styles.statusBadgeText, { color: THEME.primary600 }]}>
                            Moneda Base
                          </Text>
                        </View>
                      )}
                      {directa !== null && (
                        <View
                          style={[
                            styles.statusBadge,
                            { backgroundColor: THEME.successSoft, borderColor: THEME.successBorder },
                          ]}
                        >
                          <Text style={[styles.statusBadgeText, { color: THEME.successStrong }]}>
                            USD ↔ {m.codigo} Directo
                          </Text>
                        </View>
                      )}
                    </View>

                    {m.es_base !== 1 && (
                      <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                        <Text style={styles.clientCardMeta}>
                          Tasa Ref ({refMon?.codigo || "USD"}): 1 {refMon?.codigo || "USD"} = {m.simbolo}{" "}
                          {Number(m.tasa).toLocaleString("es-VE", { maximumFractionDigits: 4 })} {m.codigo}
                        </Text>
                        {directa !== null && (
                          <Text style={[styles.clientCardMeta, { color: THEME.successStrong, fontWeight: "700" }]}>
                            Tasa Directa USD: {m.simbolo} {Number(directa).toLocaleString("es-VE", { maximumFractionDigits: 4 })} / USD
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>

          {/* Motor de Conversión (CPP) sincronizado con la principal */}
          <View style={styles.card}>
            <Text style={styles.cardSectionTitle}>Reglas del Motor de Conversión (CPP)</Text>
            <View style={{ marginTop: 6, gap: 4 }}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Conversión en Ventas:</Text>
                <Text style={[styles.summaryVal, { color: THEME.primary600 }]}>
                  {cfgGlobal.metodo_conversion_ventas === "triangulacion"
                    ? `Triangulación (vía ${
                        monedas.find((x) => String(x.id) === String(cfgGlobal.moneda_transito_ventas_id))
                          ?.codigo || "Base"
                      })`
                    : "Directa"}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Conversión en Compras:</Text>
                <Text style={styles.summaryVal}>
                  {cfgGlobal.metodo_conversion_compras === "triangulacion"
                    ? `Triangulación (vía ${
                        monedas.find((x) => String(x.id) === String(cfgGlobal.moneda_transito_compras_id))
                          ?.codigo || "Base"
                      })`
                    : "Directa"}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Redondeo de Precios:</Text>
                <Text style={styles.summaryVal}>
                  {cfgGlobal.redondeo_activo
                    ? `Activo (Múltiplo ${cfgGlobal.redondeo_multiplo || 0})`
                    : "Inactivo"}
                </Text>
              </View>
            </View>
          </View>

          {/* Estado de Sincronización Automática */}
          <View style={styles.card}>
            <Text style={styles.cardSectionTitle}>Sincronización en Tiempo Real</Text>
            <Text style={styles.clientCardMeta}>Servidor: {session.serverUrl}</Text>
            <Text style={styles.clientCardMeta}>
              Última actualización:{" "}
              {lastSyncIso ? new Date(lastSyncIso).toLocaleTimeString() : "Recién conectado"}
            </Text>
            <Text style={[styles.clientCardMeta, { color: THEME.successStrong, marginTop: 4 }]}>
              ✓ Sincronización automática activa en segundo plano (cada 10s y al registrar operaciones).
            </Text>
          </View>
        </ScrollView>
      )}

      {/* ── BARRA DE NAVEGACIÓN INFERIOR RÁPIDA (Responsive) ── */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.bottomNavItem} onPress={() => setRoute("pos")}>
          <Feather
            name="shopping-cart"
            size={18}
            color={route === "pos" ? THEME.primary : THEME.mutedForeground}
          />
          <Text
            style={[
              styles.bottomNavText,
              route === "pos" && styles.bottomNavTextActive,
            ]}
          >
            POS
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.bottomNavItem}
          onPress={() => {
            setPerfilClienteId(null);
            setRoute("clientes");
          }}
        >
          <Feather
            name="users"
            size={18}
            color={route === "clientes" ? THEME.primary : THEME.mutedForeground}
          />
          <Text
            style={[
              styles.bottomNavText,
              route === "clientes" && styles.bottomNavTextActive,
            ]}
          >
            Clientes
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.bottomNavItem} onPress={() => setRoute("creditos")}>
          <Feather
            name="credit-card"
            size={18}
            color={route === "creditos" ? THEME.primary : THEME.mutedForeground}
          />
          <Text
            style={[
              styles.bottomNavText,
              route === "creditos" && styles.bottomNavTextActive,
            ]}
          >
            Deudores
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.bottomNavItem} onPress={() => setRoute("ventas")}>
          <Feather
            name="trending-up"
            size={18}
            color={route === "ventas" ? THEME.primary : THEME.mutedForeground}
          />
          <Text
            style={[
              styles.bottomNavText,
              route === "ventas" && styles.bottomNavTextActive,
            ]}
          >
            Ventas
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.bottomNavItem} onPress={() => setDrawerOpen(true)}>
          <Feather name="grid" size={18} color={THEME.mutedForeground} />
          <Text style={styles.bottomNavText}>Menú</Text>
        </TouchableOpacity>
      </View>

      {/* ==================== SIDEBAR DRAWER OSCURO (#1c1917 idéntico a Desktop) ==================== */}
      <Modal
        visible={drawerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDrawerOpen(false)}
      >
        <View style={styles.drawerOverlay}>
          <View style={styles.sidebarDrawer}>
            <View style={styles.sidebarHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Image
                  source={require("./assets/logo.png")}
                  style={{ width: 34, height: 34, borderRadius: 8 }}
                  resizeMode="contain"
                />
                <View>
                  <Text style={styles.sidebarBrandTitle}>PosBit</Text>
                  <Text style={styles.sidebarBrandSub}>Inventario & POS v2.6</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setDrawerOpen(false)}>
                <Feather name="x" size={20} color={THEME.sidebarForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 14 }}>
              {[
                {
                  group: "PRINCIPAL",
                  items: [{ id: "dashboard" as AppRoute, label: "Panel de control", icon: "grid" }],
                },
                {
                  group: "CLIENTES",
                  items: [
                    { id: "clientes" as AppRoute, label: "Clientes", icon: "users" },
                    {
                      id: "creditos" as AppRoute,
                      label: "Créditos / Deudores",
                      icon: "credit-card",
                    },
                  ],
                },
                {
                  group: "CATÁLOGO",
                  items: [{ id: "productos" as AppRoute, label: "Productos", icon: "package" }],
                },
                {
                  group: "OPERACIONES",
                  items: [
                    { id: "pos" as AppRoute, label: "Punto de Venta", icon: "shopping-cart" },
                    { id: "ventas" as AppRoute, label: "Ventas", icon: "trending-up" },
                  ],
                },
                {
                  group: "SISTEMA",
                  items: [
                    { id: "config" as AppRoute, label: "Sincronización y Tasas", icon: "settings" },
                  ],
                },
              ].map((section) => (
                <View key={section.group} style={{ marginBottom: 18 }}>
                  <View style={styles.sidebarGroupLabelRow}>
                    <View style={styles.sidebarGroupDivider} />
                    <Text style={styles.sidebarGroupLabel}>{section.group}</Text>
                    <View style={styles.sidebarGroupDivider} />
                  </View>
                  {section.items.map((it) => {
                    const active = route === it.id;
                    return (
                      <TouchableOpacity
                        key={it.id}
                        style={[styles.sidebarItem, active && styles.sidebarItemActive]}
                        onPress={() => {
                          if (it.id === "clientes") setPerfilClienteId(null);
                          setRoute(it.id);
                          setDrawerOpen(false);
                        }}
                      >
                        {active && <View style={styles.sidebarActiveBar} />}
                        <Feather
                          name={it.icon as any}
                          size={16}
                          color={active ? "#fff" : THEME.sidebarForeground}
                        />
                        <Text
                          style={[
                            styles.sidebarItemText,
                            active && styles.sidebarItemTextActive,
                          ]}
                        >
                          {it.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </ScrollView>

            <View style={styles.sidebarFooter}>
              <View style={styles.sidebarUserRow}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarCircleText}>
                    {userInitials(session.user.name)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sidebarUserName} numberOfLines={1}>
                    {session.user.name}
                  </Text>
                  <Text style={styles.sidebarUserRole}>{session.user.role}</Text>
                </View>
                <TouchableOpacity onPress={handleLogout} style={{ padding: 6 }}>
                  <Feather name="log-out" size={16} color={THEME.sidebarForeground} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setDrawerOpen(false)}
          />
        </View>
      </Modal>

      {/* ==================== MODAL FINALIZAR VENTA (CHECKOUT IDÉNTICO A LA WEB) ==================== */}
      <Modal
        visible={showCheckoutModal}
        transparent
        animationType="slide"
        onRequestClose={handleCloseCheckout}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={handleCloseCheckout}
          />
          <Animated.View
            style={[
              styles.modalSheet,
              {
                transform: [{ translateY: checkoutSheetTranslateY }],
              },
            ]}
          >
            {/* Tirador táctil visual para arrastrar hacia abajo */}
            <View {...checkoutPanResponder.panHandlers} style={styles.dragHandleTouchArea}>
              <View style={styles.dragHandleBar} />
            </View>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Finalizar Venta</Text>
              <TouchableOpacity
                onPress={handleCloseCheckout}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>

            {(() => {
              const mpActualSimple =
                metodosPago.find(
                  (m) => String(m.id) === String(lineasPago[0]?.metodoId || metodoPagoSeleccionado)
                ) || metodosPago[0];
              const codMetodoActual = mpActualSimple?.moneda_codigo || monedaSeleccionada;
              const totalCobrarMetodo = calcularTotalEnMoneda(codMetodoActual);
              const dec = decMoneda(codMetodoActual);
              const strVal = (lineasPago[0]?.montoStr ?? "").trim();
              const vacioSimple = strVal === "";
              const mRecibido = vacioSimple
                ? totalCobrarMetodo
                : parseFloat(strVal.replace(",", ".")) || 0;
              const vueltoSimple = vacioSimple
                ? 0
                : Math.max(0, Math.round((mRecibido - totalCobrarMetodo) * 100) / 100);
              const faltaSimple = vacioSimple
                ? 0
                : Math.max(0, Math.round((totalCobrarMetodo - mRecibido) * 100) / 100);

              return (
                <ScrollView
                  ref={checkoutScrollRef}
                  style={{ maxHeight: 540 }}
                  contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
                  keyboardShouldPersistTaps="handled"
                >
                  {/* Selector Interactivo de Cliente con Buscador Integrado */}
                  <View style={styles.clienteSelectorBox}>
                    <View style={styles.clienteSelectorHeader}>
                      <Text style={styles.fieldLabelSmall}>CLIENTE DE LA VENTA</Text>
                      <TouchableOpacity
                        style={styles.newClientInlineBtn}
                        onPress={() => {
                          setCheckoutClientDropdownOpen(false);
                          openCreateClienteModal(null, checkoutClientSearch);
                        }}
                      >
                        <Feather name="user-plus" size={12} color={THEME.primary} />
                        <Text style={styles.newClientInlineBtnText}>+ Nuevo</Text>
                      </TouchableOpacity>
                    </View>

                    {clienteSeleccionadoObj ? (
                      <View style={styles.clienteSelectedCard}>
                        <View style={styles.clienteAvatarIcon}>
                          <Feather name="user-check" size={18} color={THEME.primary} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.clienteSelectedName} numberOfLines={1}>
                            {clienteSeleccionadoObj.nombre}
                          </Text>
                          <Text style={styles.clienteSelectedMeta} numberOfLines={1}>
                            {clienteSeleccionadoObj.documento
                              ? `Doc: ${clienteSeleccionadoObj.documento}`
                              : "Sin doc"}
                            {clienteSeleccionadoObj.telefono
                              ? ` · Tel: ${clienteSeleccionadoObj.telefono}`
                              : ""}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.clienteChangeBtn}
                          onPress={() => {
                            setClienteId(null);
                            setCheckoutClientSearch("");
                            setCheckoutClientDropdownOpen(true);
                          }}
                        >
                          <Feather name="edit-2" size={12} color={THEME.mutedForeground} />
                          <Text style={styles.clienteChangeBtnText}>Cambiar</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={{ position: "relative", zIndex: 100 }}>
                        <View
                          style={[
                            styles.searchBox,
                            {
                              height: 44,
                              paddingHorizontal: 12,
                              backgroundColor: THEME.inputBg,
                              borderWidth: 1.5,
                              borderColor: checkoutClientDropdownOpen ? THEME.primary : THEME.border,
                            },
                          ]}
                        >
                          <Feather
                            name="search"
                            size={16}
                            color={checkoutClientDropdownOpen ? THEME.primary : THEME.mutedForeground}
                          />
                          <TextInput
                            ref={checkoutClientSearchRef}
                            style={[styles.searchBoxInput, { fontSize: 13.5 }]}
                            placeholder="Buscar cliente por nombre, doc o tel..."
                            placeholderTextColor={THEME.mutedForeground}
                            value={checkoutClientSearch}
                            onChangeText={(t) => {
                              setCheckoutClientSearch(t);
                              setCheckoutClientDropdownOpen(true);
                            }}
                            onFocus={() => setCheckoutClientDropdownOpen(true)}
                          />
                          {checkoutClientSearch.length > 0 ? (
                            <TouchableOpacity
                              onPress={() => setCheckoutClientSearch("")}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Feather name="x-circle" size={16} color={THEME.mutedForeground} />
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity
                              onPress={() => setCheckoutClientDropdownOpen(!checkoutClientDropdownOpen)}
                            >
                              <Feather
                                name={checkoutClientDropdownOpen ? "chevron-up" : "chevron-down"}
                                size={16}
                                color={THEME.mutedForeground}
                              />
                            </TouchableOpacity>
                          )}
                        </View>

                        {/* Dropdown de Clientes en Vivo */}
                        {checkoutClientDropdownOpen && (
                          <View style={styles.checkoutClientDropdownList}>
                            <ScrollView
                              style={{ maxHeight: 220 }}
                              nestedScrollEnabled={true}
                              keyboardShouldPersistTaps="handled"
                            >
                              {/* Opción rápida Consumidor Final */}
                              <TouchableOpacity
                                style={[
                                  styles.checkoutClientDropdownRow,
                                  !clienteId && { backgroundColor: THEME.secondary },
                                ]}
                                onPress={() => {
                                  setClienteId(null);
                                  setCheckoutClientDropdownOpen(false);
                                  setCheckoutClientSearch("");
                                }}
                              >
                                <Feather name="user" size={15} color={THEME.mutedForeground} />
                                <View style={{ flex: 1 }}>
                                  <Text
                                    style={{
                                      fontSize: 13,
                                      fontWeight: "700",
                                      color: THEME.foreground,
                                    }}
                                  >
                                    Consumidor Final
                                  </Text>
                                  <Text style={{ fontSize: 11, color: THEME.mutedForeground }}>
                                    Venta rápida sin registrar cliente
                                  </Text>
                                </View>
                                {!clienteId && (
                                  <Feather name="check" size={16} color={THEME.primary} />
                                )}
                              </TouchableOpacity>

                              {/* Clientes filtrados */}
                              {filteredCheckoutClientes.map((c) => {
                                const tieneD =
                                  c.deuda_total && c.deuda_total.some((d) => Number(d.monto) > 0);
                                return (
                                  <TouchableOpacity
                                    key={c.id}
                                    style={[
                                      styles.checkoutClientDropdownRow,
                                      clienteId === c.id && { backgroundColor: THEME.secondary },
                                    ]}
                                    onPress={() => {
                                      setClienteId(c.id);
                                      setCheckoutClientDropdownOpen(false);
                                      setCheckoutClientSearch("");
                                    }}
                                  >
                                    <Feather name="user-check" size={15} color={THEME.primary} />
                                    <View style={{ flex: 1, minWidth: 0 }}>
                                      <Text
                                        style={{
                                          fontSize: 13,
                                          fontWeight: "700",
                                          color: THEME.foreground,
                                        }}
                                        numberOfLines={1}
                                      >
                                        {c.nombre}
                                      </Text>
                                      <Text
                                        style={{ fontSize: 11, color: THEME.mutedForeground }}
                                        numberOfLines={1}
                                      >
                                        {c.documento ? `Doc: ${c.documento}` : "Sin doc"}
                                        {c.telefono ? ` · Tel: ${c.telefono}` : ""}
                                      </Text>
                                    </View>
                                    {tieneD && (
                                      <View style={styles.deudaChipMini}>
                                        <Text style={styles.deudaChipMiniText}>Con deuda</Text>
                                      </View>
                                    )}
                                    {clienteId === c.id && (
                                      <Feather name="check" size={16} color={THEME.primary} />
                                    )}
                                  </TouchableOpacity>
                                );
                              })}

                              {filteredCheckoutClientes.length === 0 &&
                                checkoutClientSearch.trim().length > 0 && (
                                  <View style={{ padding: 14, alignItems: "center", gap: 8 }}>
                                    <Text style={{ fontSize: 12.5, color: THEME.mutedForeground }}>
                                      No se encontró "{checkoutClientSearch}"
                                    </Text>
                                    <TouchableOpacity
                                      style={[
                                        styles.primarySmallBtn,
                                        { paddingHorizontal: 14, paddingVertical: 7 },
                                      ]}
                                      onPress={() => {
                                        setCheckoutClientDropdownOpen(false);
                                        openCreateClienteModal(null, checkoutClientSearch);
                                      }}
                                    >
                                      <Feather name="user-plus" size={13} color="#fff" />
                                      <Text
                                        style={{
                                          color: "#fff",
                                          fontWeight: "700",
                                          fontSize: 12,
                                        }}
                                      >
                                        + Crear cliente "{checkoutClientSearch}"
                                      </Text>
                                    </TouchableOpacity>
                                  </View>
                                )}
                            </ScrollView>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Alerta de Deuda Pendiente del Cliente si tiene */}
                    {clienteSeleccionadoObj &&
                      clienteSeleccionadoObj.deuda_total &&
                      clienteSeleccionadoObj.deuda_total.some((d) => Number(d.monto) > 0) && (
                        <View style={styles.deudaAlertBox}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Feather name="alert-triangle" size={14} color={THEME.warningStrong} />
                            <Text style={styles.deudaAlertTitle}>
                              Deuda pendiente de {clienteSeleccionadoObj.nombre}:
                            </Text>
                          </View>
                          <View style={styles.deudaAlertAmountsRow}>
                            {clienteSeleccionadoObj.deuda_total
                              .filter((d) => Number(d.monto) > 0)
                              .map((d) => (
                                <View key={d.codigo} style={styles.deudaChip}>
                                  <Text style={styles.deudaChipText}>
                                    {fmt(d.monto, d.codigo)}
                                  </Text>
                                </View>
                              ))}
                          </View>
                        </View>
                      )}
                  </View>

                  {/* Cabecera Forma de Pago + Switch Pago Mixto */}
                  <View style={styles.checkoutSectionHeader}>
                    <Text style={styles.fieldLabelSmall}>
                      {modoMixto ? "LÍNEAS DE PAGO MIXTO" : "FORMA DE PAGO"}
                    </Text>
                    <TouchableOpacity
                      style={[styles.mixtoToggleBtn, modoMixto && styles.mixtoToggleBtnActive]}
                      onPress={() => {
                        const next = !modoMixto;
                        setModoMixto(next);
                        if (!next && lineasPago.length > 1) {
                          setLineasPago([lineasPago[0]]);
                        }
                      }}
                    >
                      <Text
                        style={[
                          styles.mixtoToggleBtnText,
                          modoMixto && { color: "#fff" },
                        ]}
                      >
                        {modoMixto ? "Modo simple" : "🔀 Pago Mixto"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {!modoMixto ? (
                    /* Modo Simple: Selector compacto de Método de Pago + Monto Recibido */
                    <View style={{ gap: 10 }}>
                      <TouchableOpacity
                        style={[
                          styles.metodoSelectTrigger,
                          checkoutMetodoDropdownOpen && { borderColor: THEME.primary },
                        ]}
                        activeOpacity={0.7}
                        onPress={() => setCheckoutMetodoDropdownOpen((v) => !v)}
                      >
                        <View style={styles.metodoSelectIconWrap}>
                          <Text style={{ fontSize: 16 }}>
                            {getMetodoEmoji(mpActualSimple?.tipo, mpActualSimple?.nombre)}
                          </Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0, marginRight: 6 }}>
                          <Text style={styles.metodoSelectName} numberOfLines={1} ellipsizeMode="tail">
                            {mpActualSimple?.nombre || "Seleccionar método de pago"}
                          </Text>
                          <Text style={styles.metodoSelectSub} numberOfLines={1} ellipsizeMode="tail">
                            Moneda de cobro: {codMetodoActual}
                          </Text>
                        </View>
                        <View style={styles.metodoChipBadge}>
                          <Text style={styles.metodoChipBadgeText}>{codMetodoActual}</Text>
                        </View>
                        <Feather
                          name={checkoutMetodoDropdownOpen ? "chevron-up" : "chevron-down"}
                          size={18}
                          color={THEME.mutedForeground}
                          style={{ marginLeft: 4, flexShrink: 0 }}
                        />
                      </TouchableOpacity>

                      {/* Dropdown Inline de Formas de Pago */}
                      {checkoutMetodoDropdownOpen && (
                        <View style={styles.checkoutMetodoDropdownList}>
                          {metodosPago.map((mp) => {
                            const isSel =
                              String(lineasPago[0]?.metodoId || metodoPagoSeleccionado) === String(mp.id);
                            return (
                              <TouchableOpacity
                                key={mp.id}
                                style={[
                                  styles.checkoutMetodoRow,
                                  isSel && styles.checkoutMetodoRowActive,
                                ]}
                                activeOpacity={0.7}
                                onPress={() => {
                                  handleSelectMetodoCheckout(String(mp.id));
                                  setCheckoutMetodoDropdownOpen(false);
                                }}
                              >
                                <Text style={{ fontSize: 18, flexShrink: 0 }}>
                                  {getMetodoEmoji(mp.tipo, mp.nombre)}
                                </Text>
                                <View style={{ flex: 1, minWidth: 0, marginHorizontal: 8 }}>
                                  <Text
                                    style={[
                                      styles.checkoutMetodoName,
                                      isSel && { color: THEME.primary600, fontWeight: "700" },
                                    ]}
                                    numberOfLines={1}
                                    ellipsizeMode="tail"
                                  >
                                    {mp.nombre}
                                  </Text>
                                  {mp.moneda_codigo && (
                                    <Text style={styles.clientCardMeta} numberOfLines={1} ellipsizeMode="tail">
                                      Moneda: {mp.moneda_codigo}
                                    </Text>
                                  )}
                                </View>
                                {mp.moneda_codigo && (
                                  <View style={styles.metodoChipBadge}>
                                    <Text style={styles.metodoChipBadgeText}>{mp.moneda_codigo}</Text>
                                  </View>
                                )}
                                {isSel && (
                                  <Feather
                                    name="check"
                                    size={16}
                                    color={THEME.primary}
                                    style={{ marginLeft: 6, flexShrink: 0 }}
                                  />
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}

                      {/* Monto Recibido */}
                      <View>
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 4,
                          }}
                        >
                          <Text style={styles.fieldLabelSmall}>
                            MONTO INGRESADO ({codMetodoActual})
                          </Text>
                          <TouchableOpacity
                            onPress={() => {
                              setLineasPago([
                                {
                                  key: 1,
                                  metodoId: lineasPago[0]?.metodoId || metodoPagoSeleccionado,
                                  montoStr: totalCobrarMetodo.toFixed(dec),
                                },
                              ]);
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 12,
                                fontWeight: "800",
                                color: THEME.primary600,
                              }}
                            >
                              Pagar exacto
                            </Text>
                          </TouchableOpacity>
                        </View>
                        <TextInput
                          style={[styles.input, styles.montoIngresadoInput]}
                          keyboardType="decimal-pad"
                          placeholder={`Vacío = total (${fmt(totalCobrarMetodo, codMetodoActual)})`}
                          placeholderTextColor={THEME.mutedForeground}
                          value={lineasPago[0]?.montoStr ?? ""}
                          onChangeText={(v) =>
                            setLineasPago([
                              {
                                key: 1,
                                metodoId: lineasPago[0]?.metodoId || metodoPagoSeleccionado,
                                montoStr: v,
                              },
                            ])
                          }
                        />
                      </View>
                    </View>
                  ) : (
                /* Modo Mixto: Múltiples Líneas de Pago en distintas monedas */
                <View style={{ gap: 8 }}>
                  {lineasPago.map((lp, idx) => {
                    const mpActual = metodosPago.find((m) => String(m.id) === String(lp.metodoId));
                    return (
                      <View key={lp.key} style={styles.mixtoLineCard}>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={{ gap: 6, marginBottom: 6 }}
                        >
                          {metodosPago.map((mp) => {
                            const sel = String(mp.id) === String(lp.metodoId);
                            return (
                              <TouchableOpacity
                                key={mp.id}
                                style={[styles.metodoChip, sel && styles.metodoChipActive]}
                                onPress={() =>
                                  setLineasPago((prev) =>
                                    prev.map((x) => {
                                      if (x.key !== lp.key) return x;
                                      const oldMp = metodosPago.find((m) => String(m.id) === String(x.metodoId));
                                      const oldCod = oldMp?.moneda_codigo || monedaSeleccionada;
                                      const newCod = mp.moneda_codigo || monedaSeleccionada;
                                      const curVal = parseFloat(x.montoStr.replace(",", "."));
                                      let newMontoStr = x.montoStr;
                                      if (Number.isFinite(curVal) && curVal > 0 && oldCod !== newCod) {
                                        const converted = convertirMonto(curVal, oldCod, newCod, "ventas");
                                        newMontoStr = converted.toFixed(decMoneda(newCod));
                                      }
                                      return { ...x, metodoId: String(mp.id), montoStr: newMontoStr };
                                    })
                                  )
                                }
                              >
                                <Text
                                  style={[
                                    styles.metodoChipText,
                                    sel && styles.metodoChipTextActive,
                                  ]}
                                >
                                  {mp.nombre} ({mp.moneda_codigo || monedaSeleccionada})
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>

                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <TextInput
                            style={[styles.input, { flex: 1, marginTop: 0 }]}
                            keyboardType="decimal-pad"
                            placeholder={`Monto en ${mpActual?.moneda_codigo || monedaSeleccionada}`}
                            value={lp.montoStr}
                            onChangeText={(v) =>
                              setLineasPago((prev) =>
                                prev.map((x) => (x.key === lp.key ? { ...x, montoStr: v } : x))
                              )
                            }
                          />
                          {lineasPago.length > 1 && (
                            <TouchableOpacity
                              style={styles.removeLineBtn}
                              onPress={() =>
                                setLineasPago((prev) => prev.filter((x) => x.key !== lp.key))
                              }
                            >
                              <Feather name="trash-2" size={16} color={THEME.dangerStrong} />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    );
                  })}

                  <TouchableOpacity
                    style={styles.outlineSmallBtn}
                    onPress={() =>
                      setLineasPago((prev) => [
                        ...prev,
                        {
                          key: Date.now(),
                          metodoId: metodoPagoSeleccionado || String(metodosPago[0]?.id || ""),
                          montoStr: "",
                        },
                      ])
                    }
                  >
                    <Feather name="plus" size={13} color={THEME.primary} />
                    <Text style={[styles.outlineSmallBtnText, { color: THEME.primary }]}>
                      + Agregar otra línea de pago
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Resumen de Total Venta / Total Recibido / Falta (Crédito) / Vuelto */}
              <View style={styles.checkoutBalanceBanner}>
                <View style={[styles.summaryRow, { alignItems: "baseline", marginBottom: 4 }]}>
                  <Text style={[styles.summaryLabel, { fontSize: 15, fontWeight: "900", color: THEME.foreground }]}>
                    Total Venta:
                  </Text>
                  <Text style={[styles.summaryVal, { fontSize: 24, fontWeight: "900", color: THEME.primary }]}>
                    {fmt(totalCobrarMetodo, codMetodoActual)}
                  </Text>
                </View>
                <View style={[styles.summaryRow, { alignItems: "center", marginTop: 2 }]}>
                  <Text style={[styles.summaryLabel, { fontSize: 12.5, fontWeight: "700", color: THEME.mutedForeground }]}>
                    Total Recibido:
                  </Text>
                  <Text style={[styles.summaryVal, { fontSize: 15, fontWeight: "800", color: THEME.successStrong }]}>
                    {fmt(
                      !modoMixto ? mRecibido : totalPagadoEnMonedaVenta,
                      !modoMixto ? codMetodoActual : monedaSeleccionada
                    )}
                  </Text>
                </View>
                {(!modoMixto ? faltaSimple > 0.009 : faltaPorPagar > 0.009) && (
                  <View style={[styles.summaryRow, { marginTop: 3 }]}>
                    <Text style={[styles.summaryLabel, { fontSize: 13, fontWeight: "800", color: THEME.dangerStrong }]}>
                      Saldo pendiente (a Crédito):
                    </Text>
                    <Text style={[styles.summaryVal, { fontSize: 15, fontWeight: "900", color: THEME.dangerStrong }]}>
                      {fmt(
                        !modoMixto ? faltaSimple : faltaPorPagar,
                        !modoMixto ? codMetodoActual : monedaSeleccionada
                      )}
                    </Text>
                  </View>
                )}
                {(!modoMixto ? vueltoSimple > 0.009 : vueltoEnMonedaVenta > 0.009) && (
                  <View style={[styles.summaryRow, { marginTop: 3 }]}>
                    <Text style={[styles.summaryLabel, { fontSize: 13, fontWeight: "800", color: THEME.infoStrong }]}>
                      Vuelto a entregar:
                    </Text>
                    <Text style={[styles.summaryVal, { fontSize: 15, fontWeight: "900", color: THEME.infoStrong }]}>
                      {fmt(
                        !modoMixto ? vueltoSimple : vueltoEnMonedaVenta,
                        !modoMixto ? codMetodoActual : monedaSeleccionada
                      )}
                    </Text>
                  </View>
                )}
              </View>

              {/* Alerta de Crédito Insuficiente / Otorgar Crédito Rápido idéntico a PC */}
              {((!modoMixto ? faltaSimple > 0.009 : faltaPorPagar > 0.009) || creditoSolicitado) &&
                clienteSeleccionadoObj && (
                  <View style={{ gap: 8 }}>
                    {clienteSinCreditoSuficiente ? (
                      <View style={styles.creditoAlertaContainer}>
                        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                          <Feather
                            name="alert-triangle"
                            size={18}
                            color={THEME.warningStrong}
                            style={{ marginTop: 2 }}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.creditoAlertaTitle}>
                              {!clienteSeleccionadoObj.recibe_credito
                                ? "Crédito no habilitado"
                                : `Crédito insuficiente en ${monedaSeleccionada}`}
                            </Text>
                            <Text style={styles.creditoAlertaSub}>
                              {!clienteSeleccionadoObj.recibe_credito
                                ? `${clienteSeleccionadoObj.nombre} no tiene permiso para comprar a crédito. Puedes otorgárselo con un toque.`
                                : `Necesita un límite de ${fmt((infoCreditoCliente?.deuda || 0) + total, monedaSeleccionada)} para esta compra.`}
                            </Text>
                          </View>
                        </View>

                        {/* 3 Columnas: LÍMITE | DEUDA | DISPONIBLE */}
                        <View style={styles.creditoStatsGrid}>
                          <View style={styles.creditoStatCol}>
                            <Text style={styles.creditoStatLabel}>Límite</Text>
                            <Text style={styles.creditoStatVal} numberOfLines={1} adjustsFontSizeToFit>
                              {fmt(infoCreditoCliente?.limite || 0, monedaSeleccionada)}
                            </Text>
                          </View>
                          <View style={styles.creditoStatCol}>
                            <Text style={styles.creditoStatLabel}>Deuda</Text>
                            <Text style={styles.creditoStatVal} numberOfLines={1} adjustsFontSizeToFit>
                              {fmt(infoCreditoCliente?.deuda || 0, monedaSeleccionada)}
                            </Text>
                          </View>
                          <View style={styles.creditoStatCol}>
                            <Text style={styles.creditoStatLabel}>Disponible</Text>
                            <Text
                              style={[
                                styles.creditoStatVal,
                                {
                                  color:
                                    (infoCreditoCliente?.disponible || 0) < total
                                      ? THEME.dangerStrong
                                      : THEME.foreground,
                                },
                              ]}
                              numberOfLines={1}
                              adjustsFontSizeToFit
                            >
                              {fmt(infoCreditoCliente?.disponible || 0, monedaSeleccionada)}
                            </Text>
                          </View>
                        </View>

                        <TouchableOpacity
                          style={styles.creditoOtorgarRapidoBtn}
                          disabled={grantingCredit}
                          onPress={async () => {
                            if (!clienteSeleccionadoObj || !activeMonedaObj) return;
                            const deudaActual = infoCreditoCliente?.deuda || 0;
                            const necesario = Math.max(100, Math.ceil(deudaActual + total));
                            await handleAjustarLimiteCheckout(necesario);
                          }}
                        >
                          {grantingCredit ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <>
                              <Feather name="zap" size={15} color="#fff" />
                              <Text style={styles.creditoOtorgarRapidoBtnText}>
                                Otorgar Crédito Rápido a {clienteSeleccionadoObj.nombre}
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.creditoHabilitadoContainer}>
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <Text style={styles.creditoHabilitadoLabel}>Crédito del Cliente:</Text>
                          <Text style={styles.creditoHabilitadoOk}>✓ Habilitado</Text>
                        </View>
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <Text style={styles.creditoHabilitadoSub}>Deuda actual:</Text>
                          <Text style={styles.creditoHabilitadoVal}>
                            {fmt(infoCreditoCliente?.deuda || 0, monedaSeleccionada)}
                          </Text>
                        </View>
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <Text style={styles.creditoHabilitadoSub}>Crédito disponible:</Text>
                          <Text style={[styles.creditoHabilitadoVal, { color: THEME.successStrong }]}>
                            {fmt(infoCreditoCliente?.disponible || 0, monedaSeleccionada)}
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                )}

              {/* Cobros Extra Desplegable (+ Delivery, + Envío, + Bolsa, + Propina) */}
              <View style={styles.cobrosExtraContainer}>
                <TouchableOpacity
                  style={styles.cobrosExtraHeader}
                  onPress={() => setShowCobrosExtra((v) => !v)}
                >
                  <Text style={styles.fieldLabelSmall}>
                    COBROS EXTRA (DELIVERY, ENVÍO, PROPINA)
                  </Text>
                  <Feather
                    name={showCobrosExtra ? "chevron-up" : "chevron-down"}
                    size={15}
                    color={THEME.mutedForeground}
                  />
                </TouchableOpacity>

                {showCobrosExtra && (
                  <View style={{ marginTop: 8, gap: 8 }}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ gap: 6 }}
                    >
                      {PRESETS_COBRO_EXTRA.map((preset) => (
                        <TouchableOpacity
                          key={preset}
                          style={styles.presetExtraChip}
                          onPress={() =>
                            setCobrosExtra((prev) => [
                              ...prev,
                              {
                                key: Date.now() + Math.random(),
                                concepto: preset,
                                montoStr: "",
                                monedaCodigo: monedaSeleccionada,
                              },
                            ])
                          }
                        >
                          <Text style={styles.presetExtraChipText}>+ {preset}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>

                    {cobrosExtra.map((ce) => (
                      <View
                        key={ce.key}
                        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                      >
                        <TextInput
                          style={[styles.input, { flex: 1.2, marginTop: 0, height: 36 }]}
                          placeholder="Concepto"
                          value={ce.concepto}
                          onChangeText={(v) =>
                            setCobrosExtra((prev) =>
                              prev.map((x) => (x.key === ce.key ? { ...x, concepto: v } : x))
                            )
                          }
                        />
                        <TextInput
                          style={[styles.input, { flex: 1, marginTop: 0, height: 36 }]}
                          placeholder={`Monto (${ce.monedaCodigo})`}
                          keyboardType="decimal-pad"
                          value={ce.montoStr}
                          onChangeText={(v) =>
                            setCobrosExtra((prev) =>
                              prev.map((x) => (x.key === ce.key ? { ...x, montoStr: v } : x))
                            )
                          }
                        />
                        <TouchableOpacity
                          onPress={() =>
                            setCobrosExtra((prev) => prev.filter((x) => x.key !== ce.key))
                          }
                        >
                          <Feather name="x-circle" size={18} color={THEME.dangerStrong} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* Nota / Observación */}
              <View>
                <Text style={styles.fieldLabelSmall}>OBSERVACIÓN / NOTA (OPCIONAL)</Text>
                <TextInput
                  style={[styles.input, { height: 40 }]}
                  placeholder="Nota para el recibo o despacho..."
                  placeholderTextColor={THEME.mutedForeground}
                  value={observacionesVenta}
                  onChangeText={setObservacionesVenta}
                />
              </View>

              {/* 3 Botones de Acción idénticos al Modal de Checkout Web */}
              <View style={{ gap: 8, marginTop: 4 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.checkoutActionBtn, { backgroundColor: THEME.success, flex: 1 }]}
                    disabled={submittingSale}
                    onPress={() => {
                      setCreditoSolicitado(false);
                      handleConfirmSale("completo");
                    }}
                  >
                    <Feather name="check-circle" size={16} color="#fff" />
                    <Text style={styles.checkoutActionBtnText}>Pagar Completo</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.checkoutActionBtn,
                      {
                        backgroundColor: THEME.rose,
                        flex: 1,
                      },
                    ]}
                    disabled={submittingSale}
                    onPress={() => {
                      if (!clienteSeleccionadoObj) {
                        showToast("Selecciona un cliente para registrar la venta a crédito", "error");
                        setCheckoutClientDropdownOpen(true);
                        checkoutScrollRef.current?.scrollTo({ y: 0, animated: true });
                        setTimeout(() => {
                          checkoutClientSearchRef.current?.focus();
                        }, 100);
                        return;
                      }
                      setCreditoSolicitado(true);
                      if (clienteSinCreditoSuficiente) {
                        showToast(`Crédito insuficiente. Pulsa "Otorgar Crédito Rápido" arriba.`, "info");
                        return;
                      }
                      handleConfirmSale("credito");
                    }}
                  >
                    <Feather name="clock" size={16} color="#fff" />
                    <Text style={styles.checkoutActionBtnText}>Todo a Crédito</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[styles.checkoutActionBtn, { backgroundColor: THEME.sky }]}
                  disabled={submittingSale}
                  onPress={() => handleConfirmSale("personalizado")}
                >
                  {submittingSale ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Feather name="sliders" size={16} color="#fff" />
                      <Text style={styles.checkoutActionBtnText}>
                        {(!modoMixto ? faltaSimple > 0.009 : faltaPorPagar > 0.009)
                          ? `Registrar Pago Parcial (${fmt(!modoMixto ? faltaSimple : faltaPorPagar, !modoMixto ? codMetodoActual : monedaSeleccionada)} a crédito)`
                          : !modoMixto && vacioSimple
                          ? "Confirmar Venta Completa"
                          : "Confirmar con Monto Ingresado"}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
            );
          })()}
          </Animated.View>
        </View>
      </Modal>

      {/* ==================== MODAL SELECTOR DE CLIENTE EN POS ==================== */}
      <Modal
        visible={showClientePickerModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowClientePickerModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Buscar Cliente</Text>
                <Text style={styles.clientCardMeta}>
                  {clientes.length} cliente{clientes.length === 1 ? "" : "s"} registrados
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <TouchableOpacity
                  style={[styles.outlineSmallBtn, { paddingHorizontal: 10, paddingVertical: 5 }]}
                  onPress={() => {
                    setShowClientePickerModal(false);
                    openCreateClienteModal(null, clientePickerSearch);
                  }}
                >
                  <Feather name="user-plus" size={13} color={THEME.primary} />
                  <Text style={[styles.outlineSmallBtnText, { color: THEME.primary, fontWeight: "700" }]}>
                    + Nuevo
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowClientePickerModal(false)}>
                  <Feather name="x" size={20} color={THEME.mutedForeground} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Buscador interactivo de clientes */}
            <View style={[styles.searchBox, { marginBottom: 10, height: 44, paddingHorizontal: 12 }]}>
              <Feather name="search" size={16} color={THEME.primary} />
              <TextInput
                style={[styles.searchBoxInput, { fontSize: 14 }]}
                placeholder="Buscar por nombre, documento o teléfono..."
                placeholderTextColor={THEME.mutedForeground}
                value={clientePickerSearch}
                onChangeText={setClientePickerSearch}
                autoFocus={true}
              />
              {clientePickerSearch.length > 0 && (
                <TouchableOpacity
                  onPress={() => setClientePickerSearch("")}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="x-circle" size={16} color={THEME.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>

            {/* Opción Consumidor Final */}
            {!clientePickerSearch.trim() && (
              <TouchableOpacity
                style={[styles.pickerRow, !clienteId && { backgroundColor: THEME.secondary }]}
                onPress={() => {
                  setClienteId(null);
                  setShowClientePickerModal(false);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", color: THEME.foreground, fontSize: 13.5 }}>
                    Consumidor Final
                  </Text>
                  <Text style={styles.clientCardMeta}>Venta rápida sin registrar cliente</Text>
                </View>
                {!clienteId && <Feather name="check" size={18} color={THEME.primary} />}
              </TouchableOpacity>
            )}

            {/* Lista de clientes filtrados */}
            {(() => {
              const q = clientePickerSearch.trim().toLowerCase();
              const filtered = clientes.filter(
                (c) =>
                  !q ||
                  c.nombre.toLowerCase().includes(q) ||
                  (c.documento && c.documento.toLowerCase().includes(q)) ||
                  (c.telefono && c.telefono.toLowerCase().includes(q))
              );

              if (filtered.length === 0 && q) {
                return (
                  <View style={{ padding: 24, alignItems: "center", gap: 10 }}>
                    <Feather name="user-x" size={32} color={THEME.mutedForeground} />
                    <Text style={{ fontSize: 13, color: THEME.mutedForeground, textAlign: "center" }}>
                      No se encontró ningún cliente con "{clientePickerSearch}"
                    </Text>
                    <TouchableOpacity
                      style={[styles.primarySmallBtn, { paddingHorizontal: 16, paddingVertical: 9, marginTop: 4 }]}
                      onPress={() => {
                        setShowClientePickerModal(false);
                        openCreateClienteModal(null, clientePickerSearch);
                      }}
                    >
                      <Feather name="user-plus" size={14} color="#fff" />
                      <Text style={[styles.primarySmallBtnText, { color: "#fff", fontWeight: "700" }]}>
                        + Crear cliente "{clientePickerSearch}"
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              }

              return (
                <FlatList
                  data={filtered}
                  keyExtractor={(item) => String(item.id)}
                  style={{ maxHeight: 360 }}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => {
                    const isSelected = item.id === clienteId;
                    const tieneDeuda =
                      item.deuda_total && item.deuda_total.some((d) => Number(d.monto) > 0);
                    return (
                      <TouchableOpacity
                        style={[styles.pickerRow, isSelected && { backgroundColor: THEME.secondary }]}
                        onPress={() => {
                          setClienteId(item.id);
                          setShowClientePickerModal(false);
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.clientCardName,
                              isSelected && { color: THEME.primary, fontWeight: "800" },
                            ]}
                          >
                            {item.nombre}
                          </Text>
                          <Text style={styles.clientCardMeta}>
                            {item.documento || "Sin doc"}
                            {item.telefono ? ` · Tel: ${item.telefono}` : ""}
                          </Text>
                        </View>
                        {tieneDeuda && (
                          <View style={styles.deudaChip}>
                            <Text style={styles.deudaChipText}>
                              Deuda: {fmt(Number(item.deuda_total[0].monto) || 0, item.deuda_total[0].codigo)}
                            </Text>
                          </View>
                        )}
                        {isSelected && (
                          <Feather name="check" size={18} color={THEME.primary} style={{ marginLeft: 6 }} />
                        )}
                      </TouchableOpacity>
                    );
                  }}
                />
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL CREAR / EDITAR CLIENTE ==================== */}
      <Modal
        visible={clienteModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setClienteModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingCliente ? `Editar: ${editingCliente.nombre}` : "Nuevo Cliente"}
              </Text>
              <TouchableOpacity onPress={() => setClienteModalOpen(false)}>
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ maxHeight: 500 }}
              contentContainerStyle={{ gap: 10, paddingBottom: 16 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["Persona Natural", "Empresa"] as const).map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.catChip,
                      { flex: 1, alignItems: "center" },
                      clFormTipo === t && styles.catChipActive,
                    ]}
                    onPress={() => setClFormTipo(t)}
                  >
                    <Text
                      style={[
                        styles.catChipText,
                        clFormTipo === t && styles.catChipTextActive,
                      ]}
                    >
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View>
                <Text style={styles.fieldLabelSmall}>NOMBRE O RAZÓN SOCIAL *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ej. Juan Pérez"
                  value={clFormNombre}
                  onChangeText={setClFormNombre}
                />
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabelSmall}>DOCUMENTO / RIF / C.I.</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="V-12345678"
                    value={clFormDoc}
                    onChangeText={setClFormDoc}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabelSmall}>TELÉFONO</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="0414-0000000"
                    keyboardType="phone-pad"
                    value={clFormTel}
                    onChangeText={setClFormTel}
                  />
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabelSmall}>CIUDAD</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Ciudad"
                    value={clFormCiudad}
                    onChangeText={setClFormCiudad}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabelSmall}>CORREO</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="correo@ejemplo.com"
                    autoCapitalize="none"
                    value={clFormEmail}
                    onChangeText={setClFormEmail}
                  />
                </View>
              </View>

              {/* Configuración de Crédito por Moneda */}
              <TouchableOpacity
                style={styles.creditCheckRow}
                onPress={() => setClFormRecibeCredito((v) => !v)}
              >
                <Feather
                  name={clFormRecibeCredito ? "check-square" : "square"}
                  size={18}
                  color={clFormRecibeCredito ? THEME.primary : THEME.mutedForeground}
                />
                <Text style={{ fontWeight: "700", color: THEME.foreground }}>
                  Habilitar compras a crédito para este cliente
                </Text>
              </TouchableOpacity>

              {clFormRecibeCredito && (
                <View style={styles.checkoutCreditPanel}>
                  <Text style={styles.fieldLabelSmall}>LÍMITES DE CRÉDITO POR MONEDA</Text>
                  {monedas.map((m) => (
                    <View
                      key={m.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 6,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: "600", color: THEME.foreground }}>
                        {m.codigo} ({m.simbolo})
                      </Text>
                      <TextInput
                        style={[styles.input, { width: 140, marginTop: 0, height: 36 }]}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        value={clFormLimites[m.id] ?? "0"}
                        onChangeText={(v) =>
                          setClFormLimites((prev) => ({ ...prev, [m.id]: v }))
                        }
                      />
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={[styles.primaryBtn, { marginTop: 8 }]}
                disabled={savingCliente}
                onPress={handleSaveCliente}
              >
                {savingCliente ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {editingCliente ? "Guardar Cambios" : "Crear Cliente"}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL REGISTRAR ABONO A CRÉDITO ==================== */}
      <Modal
        visible={!!abonoModalCredito}
        transparent
        animationType="slide"
        onRequestClose={() => setAbonoModalCredito(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {abonoModalCredito && (
              <>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>Registrar Abono</Text>
                    <Text style={styles.clientCardMeta}>
                      {abonoModalCredito.numero} · {abonoModalCredito.cliente_nombre}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setAbonoModalCredito(null)}>
                    <Feather name="x" size={20} color={THEME.mutedForeground} />
                  </TouchableOpacity>
                </View>

                <View style={styles.checkoutTopSummary}>
                  <View>
                    <Text style={styles.fieldLabelSmall}>SALDO PENDIENTE</Text>
                    <Text style={[styles.checkoutBigTotal, { color: THEME.dangerStrong }]}>
                      {fmt(abonoModalCredito.saldo, abonoModalCredito.moneda_codigo)}{" "}
                      <Text style={{ fontSize: 14, fontWeight: "600" }}>
                        {abonoModalCredito.moneda_codigo}
                      </Text>
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.outlineSmallBtn}
                    onPress={() => {
                      const mp = metodosPago.find((x) => String(x.id) === String(abonoMetodoId));
                      const cod = mp?.moneda_codigo || abonoModalCredito.moneda_codigo;
                      const montoConvertido = convertirMonto(
                        abonoModalCredito.saldo,
                        abonoModalCredito.moneda_codigo,
                        cod
                      );
                      setAbonoMontoStr(montoConvertido.toFixed(decMoneda(cod)));
                    }}
                  >
                    <Text style={styles.outlineSmallBtnText}>Abonar Saldo Total</Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>MÉTODO DE PAGO</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 6, marginVertical: 8 }}
                >
                  {metodosPago.map((mp) => {
                    const active = String(mp.id) === String(abonoMetodoId);
                    return (
                      <TouchableOpacity
                        key={mp.id}
                        style={[styles.metodoChip, active && styles.metodoChipActive]}
                        onPress={() => handleSelectMetodoAbono(String(mp.id))}
                      >
                        <Text style={{ fontSize: 12 }}>{getMetodoEmoji(mp.tipo, mp.nombre)}</Text>
                        <Text
                          style={[
                            styles.metodoChipText,
                            active && styles.metodoChipTextActive,
                          ]}
                        >
                          {mp.nombre} ({mp.moneda_codigo || "USD"})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <Text style={styles.fieldLabelSmall}>MONTO A ABONAR</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  value={abonoMontoStr}
                  onChangeText={setAbonoMontoStr}
                />

                <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>
                  OBSERVACIONES (OPCIONAL)
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Referencia bancaria o nota..."
                  value={abonoObs}
                  onChangeText={setAbonoObs}
                />

                <TouchableOpacity
                  style={[styles.primaryBtn, { marginTop: 16 }]}
                  disabled={savingAbono}
                  onPress={handleConfirmAbono}
                >
                  {savingAbono ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Feather name="check-circle" size={16} color="#fff" />
                      <Text style={styles.primaryBtnText}>Confirmar Abono</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL HISTORIAL DE ABONOS ==================== */}
      <Modal
        visible={!!historialCredito}
        transparent
        animationType="slide"
        onRequestClose={() => setHistorialCredito(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {historialCredito && (
              <>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>
                      Abonos de {historialCredito.numero}
                    </Text>
                    <Text style={styles.clientCardMeta}>
                      {historialCredito.cliente_nombre}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setHistorialCredito(null)}>
                    <Feather name="x" size={20} color={THEME.mutedForeground} />
                  </TouchableOpacity>
                </View>

                <FlatList
                  data={historialAbonos}
                  keyExtractor={(item, idx) => String(item.id || idx)}
                  style={{ maxHeight: 340 }}
                  renderItem={({ item }) => (
                    <View style={styles.pickerRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.clientCardName}>
                          {fmt(Number(item.monto) || 0, item.moneda_codigo)}{" "}
                          <Text style={{ fontSize: 11, fontWeight: "600", color: THEME.mutedForeground }}>
                            {item.moneda_codigo || ""}
                          </Text>
                        </Text>
                        <Text style={styles.clientCardMeta}>
                          {item.fecha}
                          {item.metodo_pago_nombre ? ` · ${item.metodo_pago_nombre}` : ""}
                          {item.observaciones ? ` · ${item.observaciones}` : ""}
                        </Text>
                      </View>
                    </View>
                  )}
                  ListEmptyComponent={
                    <Text style={[styles.clientCardMeta, { padding: 16, textAlign: "center" }]}>
                      Sin abonos registrados aún.
                    </Text>
                  }
                />
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL AJUSTAR LÍMITE DE CRÉDITO (clon de CreditoLimiteModal web) ==================== */}
      <Modal
        visible={!!creditoLimiteCliente}
        transparent
        animationType="slide"
        onRequestClose={() => setCreditoLimiteCliente(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {creditoLimiteCliente &&
              (() => {
                const monSel =
                  monedas.find((m) => String(m.id) === String(clLimMonedaId)) || monedas[0];
                const limRow = creditoLimiteCliente.limites_credito.find(
                  (l) => String(l.moneda_id) === String(monSel?.id) || l.codigo === monSel?.codigo
                );
                const deudaRow = creditoLimiteCliente.deuda_total.find(
                  (d) => d.codigo === monSel?.codigo
                );
                const limiteActual = Number(limRow?.limite ?? 0);
                const deudaActual = Number(deudaRow?.monto ?? 0);
                const disponibleActual = limiteActual - deudaActual;
                const val = parseFloat(clLimMontoStr.replace(",", ".")) || 0;
                const nuevoLimite =
                  clLimOperacion === "add"
                    ? limiteActual + val
                    : Math.max(0, limiteActual - val);

                return (
                  <>
                    <View style={styles.modalHeader}>
                      <View>
                        <Text style={styles.modalTitle}>Ajustar crédito</Text>
                        <Text style={styles.clientCardMeta}>
                          Cliente: {creditoLimiteCliente.nombre}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => setCreditoLimiteCliente(null)}>
                        <Feather name="x" size={20} color={THEME.mutedForeground} />
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.fieldLabelSmall}>MONEDA</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 8 }}>
                      {monedas.map((m) => {
                        const active = String(m.id) === String(monSel?.id);
                        return (
                          <TouchableOpacity
                            key={m.id}
                            style={[styles.catChip, active && styles.catChipActive]}
                            onPress={() => handleCambioMonedaAjustarCredito(m.id)}
                          >
                            <Text style={[styles.catChipText, active && styles.catChipTextActive]}>
                              {m.codigo}
                              {m.es_base ? " (base)" : ""}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {monSel && (
                      <View style={styles.checkoutBalanceBanner}>
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>Límite actual</Text>
                          <Text style={styles.summaryVal}>
                            {fmt(limiteActual, monSel.codigo)}
                          </Text>
                        </View>
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>Deuda</Text>
                          <Text style={[styles.summaryVal, { color: THEME.dangerStrong }]}>
                            {fmt(deudaActual, monSel.codigo)}
                          </Text>
                        </View>
                        <View style={styles.summaryTotalRow}>
                          <Text style={styles.summaryTotalLabel}>Disponible</Text>
                          <Text
                            style={[
                              styles.summaryTotalValue,
                              {
                                color:
                                  disponibleActual > 0
                                    ? THEME.successStrong
                                    : THEME.mutedForeground,
                              },
                            ]}
                          >
                            {fmt(disponibleActual, monSel.codigo)}
                          </Text>
                        </View>
                      </View>
                    )}

                    {/* Toggle Añadir / Quitar */}
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 6,
                        marginTop: 10,
                        backgroundColor: THEME.inputBg,
                        padding: 4,
                        borderRadius: 10,
                      }}
                    >
                      {(["add", "remove"] as const).map((op) => {
                        const active = clLimOperacion === op;
                        return (
                          <TouchableOpacity
                            key={op}
                            style={[
                              {
                                flex: 1,
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 5,
                                paddingVertical: 8,
                                borderRadius: 8,
                              },
                              active && { backgroundColor: THEME.card },
                            ]}
                            onPress={() => setClLimOperacion(op)}
                          >
                            <Feather
                              name={op === "add" ? "plus" : "minus"}
                              size={14}
                              color={
                                active
                                  ? op === "add"
                                    ? THEME.successStrong
                                    : THEME.dangerStrong
                                  : THEME.mutedForeground
                              }
                            />
                            <Text
                              style={{
                                fontWeight: "700",
                                fontSize: 13,
                                color: active
                                  ? op === "add"
                                    ? THEME.successStrong
                                    : THEME.dangerStrong
                                  : THEME.mutedForeground,
                              }}
                            >
                              {op === "add" ? "Añadir" : "Quitar"}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>
                      MONTO A {clLimOperacion === "add" ? "AÑADIR" : "QUITAR"} (
                      {monSel?.codigo || ""})
                    </Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      value={clLimMontoStr}
                      onChangeText={setClLimMontoStr}
                    />

                    {monSel && val > 0 && (
                      <View
                        style={[
                          styles.checkoutBalanceBanner,
                          {
                            marginTop: 10,
                            backgroundColor:
                              clLimOperacion === "add" ? THEME.successSoft : THEME.dangerSoft,
                            borderColor:
                              clLimOperacion === "add" ? THEME.successBorder : THEME.dangerBorder,
                          },
                        ]}
                      >
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>Nuevo límite</Text>
                          <Text
                            style={[
                              styles.summaryVal,
                              {
                                fontWeight: "800",
                                color:
                                  clLimOperacion === "add"
                                    ? THEME.successStrong
                                    : THEME.dangerStrong,
                              },
                            ]}
                          >
                            {fmt(nuevoLimite, monSel.codigo)}
                          </Text>
                        </View>
                      </View>
                    )}

                    <TouchableOpacity
                      style={[styles.primaryBtn, { marginTop: 14 }]}
                      disabled={savingCreditoLimite || val <= 0}
                      onPress={handleConfirmAjustarCredito}
                    >
                      {savingCreditoLimite ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <>
                          <Feather name="check" size={16} color="#fff" />
                          <Text style={styles.primaryBtnText}>
                            {clLimOperacion === "add" ? "Añadir crédito" : "Quitar crédito"}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </>
                );
              })()}
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL PAGAR DEUDA GLOBAL / ABONO GLOBAL FIFO (clon de PagarDeudaModal web) ==================== */}
      <Modal
        visible={!!pagoDeudaCliente}
        transparent
        animationType="slide"
        onRequestClose={() => setPagoDeudaCliente(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {pagoDeudaCliente &&
              (() => {
                const val = parseFloat(pdMontoStr.replace(",", ".")) || 0;
                const baseCod = baseMonedaSistema?.codigo || "USD";
                const comoBase =
                  pagoDeudaMonedaObj &&
                  baseMonedaSistema &&
                  val > 0 &&
                  String(pagoDeudaMonedaObj.id) !== String(baseMonedaSistema.id)
                    ? convertirConRegla(
                        val,
                        pagoDeudaMonedaObj,
                        baseMonedaSistema,
                        "ventas",
                        2
                      )
                    : null;

                return (
                  <>
                    <View style={styles.modalHeader}>
                      <View>
                        <Text style={styles.modalTitle}>Pagar deuda (Abono Global)</Text>
                        <Text style={styles.clientCardMeta}>{pagoDeudaCliente.nombre}</Text>
                      </View>
                      <TouchableOpacity onPress={() => setPagoDeudaCliente(null)}>
                        <Feather name="x" size={20} color={THEME.mutedForeground} />
                      </TouchableOpacity>
                    </View>

                    <ScrollView
                      style={{ maxHeight: 520 }}
                      contentContainerStyle={{ gap: 10, paddingBottom: 14 }}
                      keyboardShouldPersistTaps="handled"
                    >
                      {/* Resumen de Deuda Total del Cliente */}
                      <View style={styles.checkoutTopSummary}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.fieldLabelSmall}>DEUDA TOTAL ACUMULADA</Text>
                          <Text style={[styles.checkoutBigTotal, { color: THEME.dangerStrong }]}>
                            {fmt(pagoDeudaTotalBase, baseCod)}
                          </Text>
                          <Text style={styles.clientCardMeta}>
                            {pagoDeudaPendientesFifo.length} factura
                            {pagoDeudaPendientesFifo.length === 1 ? "" : "s"} pendiente
                            {pagoDeudaPendientesFifo.length === 1 ? "" : "s"}
                          </Text>
                        </View>

                        <View style={{ alignItems: "flex-end", gap: 4 }}>
                          {pagoDeudaCliente.deuda_total.map((d) => (
                            <View key={d.codigo} style={styles.deudaChip}>
                              <Text style={styles.deudaChipText}>
                                {fmt(d.monto, d.codigo)}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>

                      {/* Método de pago */}
                      <View>
                        <Text style={styles.fieldLabelSmall}>MÉTODO DE PAGO</Text>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={{ gap: 6, marginTop: 6 }}
                        >
                          {metodosPago.map((mp) => {
                            const active = String(mp.id) === String(pdMetodoPagoId);
                            return (
                              <TouchableOpacity
                                key={mp.id}
                                style={[styles.metodoChip, active && styles.metodoChipActive]}
                                onPress={() => handleSelectMetodoPagoDeuda(String(mp.id))}
                              >
                                <Text style={{ fontSize: 12 }}>
                                  {getMetodoEmoji(mp.tipo, mp.nombre)}
                                </Text>
                                <Text
                                  style={[
                                    styles.metodoChipText,
                                    active && styles.metodoChipTextActive,
                                  ]}
                                >
                                  {mp.nombre} ({mp.moneda_codigo || "USD"})
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>

                      {/* Monto a pagar + Botón "Pagar todo" */}
                      <View>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <Text style={styles.fieldLabelSmall}>
                            MONTO A PAGAR ({pagoDeudaMonedaObj?.codigo || ""})
                          </Text>
                          <TouchableOpacity
                            onPress={rellenarTotalPagoDeuda}
                            disabled={pagoDeudaTotalBase <= 0}
                          >
                            <Text
                              style={{
                                fontSize: 12,
                                fontWeight: "800",
                                color: THEME.primary600,
                              }}
                            >
                              Pagar todo
                            </Text>
                          </TouchableOpacity>
                        </View>

                        <TextInput
                          style={styles.input}
                          keyboardType="decimal-pad"
                          placeholder="0.00"
                          value={pdMontoStr}
                          onChangeText={setPdMontoStr}
                        />

                        <Text style={[styles.clientCardMeta, { marginTop: 4 }]}>
                          {comoBase !== null
                            ? `Equivale a ${fmt(comoBase, baseCod)} · se reparte entre las facturas automáticamente`
                            : "Se reparte automáticamente entre las facturas más antiguas."}
                        </Text>
                      </View>

                      {/* Observaciones */}
                      <View>
                        <Text style={styles.fieldLabelSmall}>OBSERVACIONES (OPCIONAL)</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="Notas del pago global..."
                          value={pdObs}
                          onChangeText={setPdObs}
                        />
                      </View>

                      {/* Vista previa en vivo: Facturas pendientes (Más antigua primero) */}
                      {pagoDeudaPendientesFifo.length > 0 && (
                        <View
                          style={{
                            borderWidth: 1,
                            borderColor: THEME.border,
                            borderRadius: 12,
                            overflow: "hidden",
                            backgroundColor: THEME.card,
                          }}
                        >
                          <View
                            style={{
                              flexDirection: "row",
                              justifyContent: "space-between",
                              alignItems: "center",
                              backgroundColor: THEME.inputBg,
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderBottomWidth: 1,
                              borderBottomColor: THEME.border,
                            }}
                          >
                            <Text style={styles.fieldLabelSmall}>FACTURAS PENDIENTES</Text>
                            <Text style={{ fontSize: 11, color: THEME.mutedForeground }}>
                              Más antigua primero
                            </Text>
                          </View>

                          {pagoDeudaPreview.lineas.map(
                            ({ credito, estado, monto: montoAplicado }) => (
                              <View
                                key={credito.id}
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  paddingHorizontal: 12,
                                  paddingVertical: 9,
                                  borderBottomWidth: 1,
                                  borderBottomColor: THEME.inputBg,
                                  gap: 8,
                                }}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text
                                    style={{
                                      fontWeight: "800",
                                      fontSize: 13,
                                      color: THEME.foreground,
                                    }}
                                  >
                                    {credito.numero}
                                  </Text>
                                  <Text style={styles.clientCardMeta}>{credito.fecha}</Text>
                                </View>

                                <Text
                                  style={{
                                    fontWeight: "700",
                                    fontSize: 13,
                                    color: THEME.foreground,
                                  }}
                                >
                                  {fmt(credito.saldo, credito.moneda_codigo)}
                                </Text>

                                <View
                                  style={[
                                    styles.statusBadge,
                                    estado === "completa"
                                      ? {
                                          backgroundColor: THEME.successSoft,
                                          borderColor: THEME.successBorder,
                                        }
                                      : estado === "parcial"
                                      ? {
                                          backgroundColor: THEME.warningSoft,
                                          borderColor: THEME.warningBorder,
                                        }
                                      : {
                                          backgroundColor: THEME.muted,
                                          borderColor: THEME.border,
                                        },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.statusBadgeText,
                                      {
                                        color:
                                          estado === "completa"
                                            ? THEME.successStrong
                                            : estado === "parcial"
                                            ? THEME.warningStrong
                                            : THEME.mutedForeground,
                                      },
                                    ]}
                                  >
                                    {estado === "completa"
                                      ? "Se paga"
                                      : estado === "parcial"
                                      ? `Abona ${fmt(montoAplicado, credito.moneda_codigo)}`
                                      : "Pendiente"}
                                  </Text>
                                </View>
                              </View>
                            )
                          )}

                          {pagoDeudaPreview.restoBase > 0 && (
                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                backgroundColor: THEME.inputBg,
                                paddingHorizontal: 12,
                                paddingVertical: 8,
                              }}
                            >
                              <Text style={{ fontSize: 12, color: THEME.mutedForeground }}>
                                Resto sin aplicar
                              </Text>
                              <Text
                                style={{
                                  fontSize: 12,
                                  fontWeight: "800",
                                  color: THEME.foreground,
                                }}
                              >
                                {fmt(pagoDeudaPreview.restoBase, baseCod)}
                              </Text>
                            </View>
                          )}
                        </View>
                      )}

                      <TouchableOpacity
                        style={[styles.primaryBtn, { marginTop: 6 }]}
                        disabled={savingPagoDeuda || val <= 0}
                        onPress={handleConfirmPagoDeudaGlobal}
                      >
                        {savingPagoDeuda ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Feather name="check-circle" size={16} color="#fff" />
                            <Text style={styles.primaryBtnText}>
                              Aplicar pago{" "}
                              {val > 0 && pagoDeudaMonedaObj
                                ? `(${fmt(val, pagoDeudaMonedaObj.codigo)})`
                                : ""}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </ScrollView>
                  </>
                );
              })()}
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL DETALLE DE FACTURA / VENTA ==================== */}
      <Modal
        visible={!!ventaDetailModal}
        transparent
        animationType="slide"
        onRequestClose={() => setVentaDetailModal(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {ventaDetailModal && (
              <>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>
                      Factura {ventaDetailModal.venta.numero}
                    </Text>
                    <Text style={styles.clientCardMeta}>
                      {String(ventaDetailModal.venta.fecha || "").slice(0, 10)} ·{" "}
                      {ventaDetailModal.venta.cliente_nombre ||
                        ventaDetailModal.venta.cliente ||
                        "Cliente"}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setVentaDetailModal(null)}>
                    <Feather name="x" size={20} color={THEME.mutedForeground} />
                  </TouchableOpacity>
                </View>

                <FlatList
                  data={ventaDetailModal.items}
                  keyExtractor={(it, idx) => String(it.id || idx)}
                  style={{ maxHeight: 340 }}
                  renderItem={({ item }) => (
                    <View style={styles.pickerRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.clientCardName}>
                          {item.producto_nombre || item.nombre || "Producto"}
                        </Text>
                        <Text style={styles.clientCardMeta}>
                          {item.cantidad} x{" "}
                          {fmt(
                            Number(item.precio_unit) || 0,
                            ventaDetailModal.venta.moneda_codigo || "USD"
                          )}
                          {item.presentacion_nombre
                            ? ` (${item.presentacion_nombre})`
                            : ""}
                        </Text>
                      </View>
                      <Text style={styles.posProdPrice}>
                        {fmt(
                          Number(item.subtotal) || 0,
                          ventaDetailModal.venta.moneda_codigo || "USD"
                        )}
                      </Text>
                    </View>
                  )}
                  ListEmptyComponent={
                    <Text style={[styles.clientCardMeta, { padding: 16, textAlign: "center" }]}>
                      Detalle de productos sincronizándose...
                    </Text>
                  }
                />

                <View style={[styles.checkoutBalanceBanner, { marginTop: 10 }]}>
                  <View style={styles.summaryTotalRow}>
                    <Text style={styles.summaryTotalLabel}>Total Factura</Text>
                    <Text style={styles.summaryTotalValue}>
                      {fmt(
                        Number(ventaDetailModal.venta.total) || 0,
                        ventaDetailModal.venta.moneda_codigo || "USD"
                      )}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL RECIBO DE VENTA ==================== */}
      <Modal
        visible={!!receiptModal}
        transparent
        animationType="fade"
        onRequestClose={() => setReceiptModal(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {receiptModal && (
              <>
                <View style={{ alignItems: "center", marginBottom: 12 }}>
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: THEME.successSoft,
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 6,
                    }}
                  >
                    <Feather name="check" size={24} color={THEME.successStrong} />
                  </View>
                  <Text style={styles.modalTitle}>¡Venta Registrada!</Text>
                  <Text style={styles.clientCardMeta}>
                    {receiptModal.numero} · {receiptModal.fecha}
                  </Text>
                </View>

                <View style={styles.checkoutBalanceBanner}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Cliente:</Text>
                    <Text style={styles.summaryVal}>{receiptModal.cliente}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Modalidad:</Text>
                    <Text style={styles.summaryVal}>{receiptModal.tipo_pago}</Text>
                  </View>
                  <View style={styles.summaryTotalRow}>
                    <Text style={styles.summaryTotalLabel}>Total:</Text>
                    <Text style={styles.summaryTotalValue}>
                      {fmt(receiptModal.total, receiptModal.moneda)}
                    </Text>
                  </View>
                  {receiptModal.saldoCredito > 0.009 && (
                    <View style={styles.summaryRow}>
                      <Text style={[styles.summaryLabel, { color: THEME.dangerStrong }]}>
                        Saldo a Crédito:
                      </Text>
                      <Text style={[styles.summaryVal, { color: THEME.dangerStrong }]}>
                        {fmt(receiptModal.saldoCredito, receiptModal.moneda)}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
                  <TouchableOpacity
                    style={[styles.outlineSmallBtn, { flex: 1, justifyContent: "center", height: 42 }]}
                    onPress={() => {
                      const lines = receiptModal.items
                        .map((i: any) => `• ${i.cantidad}x ${i.nombre}: ${fmt(i.subtotal, receiptModal.moneda)}`)
                        .join("\n");
                      Share.share({
                        message: `Recibo PosBit ${receiptModal.numero}\nCliente: ${receiptModal.cliente}\n${lines}\nTotal: ${fmt(receiptModal.total, receiptModal.moneda)}`,
                      });
                    }}
                  >
                    <Feather name="share-2" size={15} color={THEME.foreground} />
                    <Text style={styles.outlineSmallBtnText}>Compartir Recibo</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.primaryBtn, { flex: 1, height: 42 }]}
                    onPress={() => setReceiptModal(null)}
                  >
                    <Text style={styles.primaryBtnText}>Nueva Venta</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL CARRITOS EN ESPERA ==================== */}
      <Modal
        visible={showHeldModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowHeldModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Ventas en Espera ({heldCarts.length})</Text>
              <TouchableOpacity onPress={() => setShowHeldModal(false)}>
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>
            {heldCarts.map((h) => (
              <TouchableOpacity
                key={h.id}
                style={styles.pickerRow}
                onPress={() => handleResumeCart(h)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientCardName}>
                    Carrito de las {h.hora} ({h.items.length} productos)
                  </Text>
                </View>
                <Text style={{ color: THEME.primary, fontWeight: "700" }}>Recuperar</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: THEME.background,
  },
  centerScreen: {
    flex: 1,
    backgroundColor: THEME.background,
    alignItems: "center",
    justifyContent: "center",
  },
  loginContainer: {
    flex: 1,
    backgroundColor: THEME.background,
  },
  loginScroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },
  loginCard: {
    backgroundColor: THEME.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 22,
    overflow: "hidden",
  },
  loginAccentBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: THEME.primary,
  },
  loginBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 18,
  },
  brandLogoBox: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: THEME.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  brandLogoImage: {
    width: 48,
    height: 48,
    borderRadius: 12,
  },
  brandLogoLetter: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
  },
  loginTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: THEME.foreground,
  },
  loginSubtitle: {
    fontSize: 12,
    color: THEME.mutedForeground,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.mutedForeground,
    marginTop: 12,
    marginBottom: 4,
    letterSpacing: 0.6,
  },
  fieldLabelSmall: {
    fontSize: 10,
    fontWeight: "700",
    color: THEME.mutedForeground,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: THEME.foreground,
    fontSize: 14,
  },
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
  },
  advancedToggleText: {
    fontSize: 12,
    color: THEME.mutedForeground,
    fontWeight: "600",
  },
  errorAlert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    backgroundColor: THEME.dangerSoft,
    borderWidth: 1,
    borderColor: THEME.dangerBorder,
    borderRadius: 8,
    padding: 10,
  },
  errorAlertText: {
    color: THEME.dangerStrong,
    fontSize: 12,
    flex: 1,
  },
  primaryBtn: {
    backgroundColor: THEME.primary,
    borderRadius: 8,
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  primarySmallBtn: {
    backgroundColor: THEME.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  primarySmallBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  outlineSmallBtn: {
    backgroundColor: THEME.card,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  outlineSmallBtnText: {
    color: THEME.foreground,
    fontSize: 12,
    fontWeight: "600",
  },
  // Topbar
  topbar: {
    height: 56,
    backgroundColor: THEME.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 10,
  },
  topbarOrangeLine: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 64,
    height: 3,
    backgroundColor: THEME.primary,
  },
  menuIconBtn: {
    padding: 6,
    borderRadius: 8,
  },
  topbarBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  topbarLogoSmall: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: THEME.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  topbarLogoSmallText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 14,
  },
  topbarTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: THEME.foreground,
  },
  topbarSubtitle: {
    fontSize: 10,
    color: THEME.mutedForeground,
  },
  cloudBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  cloudBadgeOk: {
    backgroundColor: THEME.successSoft,
    borderColor: THEME.successBorder,
  },
  cloudBadgeSyncing: {
    backgroundColor: THEME.accent,
    borderColor: THEME.primary,
  },
  cloudBadgePending: {
    backgroundColor: THEME.warningSoft,
    borderColor: THEME.warningBorder,
  },
  cloudBadgeOffline: {
    backgroundColor: THEME.dangerSoft,
    borderColor: THEME.dangerBorder,
  },
  cloudDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  cloudBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  topbarPosShortBtn: {
    backgroundColor: THEME.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  topbarPosShortBtnText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  toastModalContainer: {
    flex: 1,
  },
  toastBanner: {
    position: "absolute",
    top: 64,
    left: 14,
    right: 14,
    zIndex: 9999,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1.5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 10,
  },
  toastBannerText: {
    fontSize: 12.5,
    fontWeight: "700",
    flex: 1,
  },
  // POS Controls
  posControlHeader: {
    backgroundColor: THEME.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  posSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 38,
    gap: 6,
  },
  searchBoxInput: {
    flex: 1,
    fontSize: 13,
    color: THEME.foreground,
    paddingVertical: 0,
  },
  currencyPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  currencyPillActive: {
    backgroundColor: THEME.primary,
    borderColor: THEME.primary600,
  },
  currencyPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.foreground,
  },
  currencyPillTextActive: {
    color: "#fff",
  },
  posMetodosRow: {
    gap: 6,
    paddingVertical: 2,
  },
  metodoChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  metodoChipActive: {
    backgroundColor: THEME.primary,
    borderColor: THEME.primary600,
  },
  metodoChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: THEME.foreground,
  },
  metodoChipTextActive: {
    color: "#fff",
  },
  metodoChipBadge: {
    backgroundColor: THEME.muted,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  metodoChipBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: THEME.mutedForeground,
  },
  posModeSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  posModeTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  posModeTabActive: {
    backgroundColor: THEME.foreground,
    borderColor: THEME.foreground,
  },
  posModeTabText: {
    fontSize: 12,
    fontWeight: "700",
    color: THEME.foreground,
  },
  posModeTabTextActive: {
    color: "#fff",
  },
  posClearCartPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: THEME.dangerSoft,
    borderWidth: 1,
    borderColor: THEME.dangerBorder,
  },
  posClearCartPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.dangerStrong,
  },
  heldCartPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: THEME.warningSoft,
    borderWidth: 1,
    borderColor: THEME.warningBorder,
  },
  heldCartPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.warningStrong,
  },
  catFilterContainer: {
    paddingTop: 8,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: THEME.card,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  catChipActive: {
    backgroundColor: THEME.primary,
    borderColor: THEME.primary600,
  },
  catChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: THEME.foreground,
  },
  catChipTextActive: {
    color: "#fff",
  },
  // Product Cards in POS
  posProdCard: {
    flex: 1,
    backgroundColor: THEME.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 11,
    justifyContent: "space-between",
  },
  posProdCardInCart: {
    borderColor: THEME.primary,
    borderWidth: 1.5,
    backgroundColor: THEME.accent,
  },
  posProdTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  posProdIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: THEME.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  ivaBadge: {
    backgroundColor: THEME.warningSoft,
    borderWidth: 1,
    borderColor: THEME.warningBorder,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  ivaBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: THEME.warningStrong,
  },
  inCartControlGroup: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.primary + "18",
    borderRadius: 14,
    padding: 2,
    gap: 3,
  },
  inCartMinusBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: THEME.dangerStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  inCartCountBadge: {
    backgroundColor: THEME.primary,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  inCartCountBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
  },
  posProdName: {
    fontSize: 13,
    fontWeight: "700",
    color: THEME.foreground,
    lineHeight: 17,
  },
  posProdCode: {
    fontSize: 10,
    color: THEME.mutedForeground,
    marginTop: 2,
  },
  posPresPillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 6,
  },
  posPresMiniBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: THEME.secondary,
    borderWidth: 1,
    borderColor: THEME.primary,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  posPresMiniBtnText: {
    fontSize: 10,
    fontWeight: "700",
    color: THEME.primary600,
  },
  posProdFooter: {
    marginTop: 8,
    flexDirection: "column",
    alignItems: "flex-start",
    width: "100%",
  },
  posProdPrice: {
    fontSize: 14.5,
    fontWeight: "800",
    color: THEME.primary,
    letterSpacing: -0.2,
  },
  stockBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
  stockBadgeSuccess: {
    backgroundColor: THEME.successSoft,
    borderColor: THEME.successBorder,
  },
  stockBadgeWarning: {
    backgroundColor: THEME.warningSoft,
    borderColor: THEME.warningBorder,
  },
  stockBadgeDanger: {
    backgroundColor: THEME.dangerSoft,
    borderColor: THEME.dangerBorder,
  },
  stockBadgeText: {
    fontSize: 9,
    fontWeight: "700",
  },
  // Floating Cart Bar
  floatingCartBar: {
    position: "absolute",
    bottom: 10,
    left: 12,
    right: 12,
    backgroundColor: THEME.sidebar,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    elevation: 6,
  },
  floatingCartInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  floatingCartBadge: {
    backgroundColor: THEME.primary,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  floatingCartBadgeText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 13,
  },
  floatingCartLabel: {
    color: THEME.sidebarForeground,
    fontSize: 9,
    fontWeight: "700",
  },
  floatingCartTotal: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
  floatingViewCartBtn: {
    backgroundColor: THEME.sidebarAccent,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
  },
  floatingViewCartBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  floatingCheckoutBtn: {
    backgroundColor: THEME.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  floatingCheckoutBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
  },
  // Cards & Cart View
  card: {
    backgroundColor: THEME.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 13,
  },
  cardSectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: THEME.foreground,
  },
  cartHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  clienteSelectorBox: {
    borderTopWidth: 1,
    borderTopColor: THEME.border,
    paddingTop: 10,
  },
  clienteSelectorHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  newClientInlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  newClientInlineBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.primary,
  },
  clienteDropdownBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  clienteSearchTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: THEME.inputBg,
    borderWidth: 1.5,
    borderColor: THEME.border,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  clienteSearchTriggerText: {
    flex: 1,
    fontSize: 13,
    color: THEME.mutedForeground,
  },
  clienteDropdownText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: THEME.foreground,
  },
  clienteSelectedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: THEME.secondary,
    borderWidth: 1.5,
    borderColor: THEME.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  clienteAvatarIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: THEME.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: THEME.primary,
  },
  clienteSelectedName: {
    fontSize: 13.5,
    fontWeight: "800",
    color: THEME.foreground,
  },
  clienteSelectedMeta: {
    fontSize: 11.5,
    color: THEME.mutedForeground,
    marginTop: 1,
  },
  clienteChangeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: THEME.card,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  clienteChangeBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.mutedForeground,
  },
  checkoutClientDropdownList: {
    marginTop: 4,
    backgroundColor: THEME.card,
    borderWidth: 1.5,
    borderColor: THEME.primary,
    borderRadius: 8,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  checkoutClientDropdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  deudaChipMini: {
    backgroundColor: THEME.dangerSoft,
    borderWidth: 1,
    borderColor: THEME.dangerBorder,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  deudaChipMiniText: {
    fontSize: 10,
    fontWeight: "700",
    color: THEME.dangerStrong,
  },
  deudaAlertBox: {
    marginTop: 8,
    backgroundColor: THEME.warningSoft,
    borderWidth: 1,
    borderColor: THEME.warningBorder,
    borderRadius: 8,
    padding: 9,
    gap: 5,
  },
  deudaAlertTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.warningStrong,
  },
  deudaAlertAmountsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  deudaChip: {
    backgroundColor: THEME.dangerSoft,
    borderWidth: 1,
    borderColor: THEME.dangerBorder,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  deudaChipText: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.dangerStrong,
  },
  cartItemCard: {
    backgroundColor: THEME.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 12,
  },
  cartItemTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cartItemName: {
    fontSize: 13,
    fontWeight: "700",
    color: THEME.foreground,
  },
  cartItemSub: {
    fontSize: 11,
    color: THEME.mutedForeground,
    marginTop: 2,
  },
  cartItemNeto: {
    fontSize: 14,
    fontWeight: "800",
    color: THEME.primary,
  },
  presSelectChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  presSelectChipActive: {
    backgroundColor: THEME.primary,
    borderColor: THEME.primary600,
  },
  presSelectChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: THEME.foreground,
  },
  presSelectChipTextActive: {
    color: "#fff",
  },
  cartItemControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    gap: 8,
  },
  qtyStepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
  },
  qtyStepBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  qtyStepValue: {
    fontSize: 13,
    fontWeight: "700",
    color: THEME.foreground,
    minWidth: 26,
    textAlign: "center",
  },
  lineDiscountBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    height: 32,
  },
  lineDiscountLabel: {
    fontSize: 11,
    color: THEME.mutedForeground,
  },
  lineDiscountInput: {
    fontSize: 12,
    color: THEME.foreground,
    minWidth: 48,
    paddingVertical: 0,
  },
  removeLineBtn: {
    padding: 6,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  summaryLabel: {
    fontSize: 12,
    color: THEME.mutedForeground,
  },
  summaryVal: {
    fontSize: 12,
    fontWeight: "700",
    color: THEME.foreground,
  },
  summaryTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: THEME.border,
    marginTop: 6,
    paddingTop: 8,
  },
  summaryTotalLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: THEME.foreground,
  },
  summaryTotalValue: {
    fontSize: 19,
    fontWeight: "900",
    color: THEME.primary,
  },
  // Clientes & Créditos Modules
  moduleHeaderBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    backgroundColor: THEME.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  clientCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: THEME.secondary,
    borderWidth: 1,
    borderColor: THEME.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarCircleText: {
    color: THEME.primary600,
    fontWeight: "800",
    fontSize: 13,
  },
  clientCardName: {
    fontSize: 14,
    fontWeight: "700",
    color: THEME.foreground,
  },
  clientCardMeta: {
    fontSize: 11,
    color: THEME.mutedForeground,
    marginTop: 2,
  },
  clientCardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: THEME.border,
    marginTop: 10,
    paddingTop: 8,
  },
  creditLimitTag: {
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  creditLimitTagText: {
    fontSize: 10,
    fontWeight: "600",
    color: THEME.foreground,
  },
  clientDebtAmount: {
    fontSize: 13,
    fontWeight: "800",
    color: THEME.dangerStrong,
  },
  mutedSmallText: {
    fontSize: 11,
    color: THEME.mutedForeground,
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  creditosKpiRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: THEME.card,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 10,
    padding: 10,
  },
  kpiLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: THEME.mutedForeground,
    letterSpacing: 0.5,
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: "900",
    color: THEME.foreground,
    marginTop: 3,
  },
  kpiValueSmall: {
    fontSize: 13,
    fontWeight: "800",
    marginTop: 2,
  },
  creditosFilterBar: {
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  creditoCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  creditoNumero: {
    fontSize: 12,
    fontWeight: "800",
    color: THEME.primary600,
  },
  creditoVentaTag: {
    fontSize: 10,
    color: THEME.mutedForeground,
    backgroundColor: THEME.inputBg,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  creditoClienteName: {
    fontSize: 14,
    fontWeight: "700",
    color: THEME.foreground,
    marginTop: 2,
  },
  creditoAmountsContainer: {
    backgroundColor: THEME.inputBg,
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
    gap: 8,
  },
  creditoAmountsTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  creditoAmountCol: {
    flex: 1,
  },
  creditoSaldoHighlightRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  creditoSaldoLabel: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  creditoAmountsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: THEME.inputBg,
    borderRadius: 8,
    padding: 9,
    marginTop: 10,
  },
  creditoAmountTotal: {
    fontSize: 13,
    fontWeight: "700",
    color: THEME.foreground,
  },
  creditoAmountAbonado: {
    fontSize: 13,
    fontWeight: "700",
    color: THEME.successStrong,
  },
  creditoAmountSaldo: {
    fontSize: 14,
    fontWeight: "800",
    color: THEME.dangerStrong,
  },
  creditoActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 10,
  },
  sectionGroupHeader: {
    fontSize: 11,
    fontWeight: "800",
    color: THEME.mutedForeground,
    letterSpacing: 0.6,
    marginTop: 4,
  },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 10,
  },
  quickTile: {
    width: "48%",
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  quickTileIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  quickTileTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: THEME.foreground,
  },
  quickTileSub: {
    fontSize: 11,
    color: THEME.mutedForeground,
  },
  // Bottom Nav
  bottomNav: {
    height: 58,
    backgroundColor: THEME.card,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  bottomNavItem: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    flex: 1,
  },
  bottomNavText: {
    fontSize: 10,
    fontWeight: "600",
    color: THEME.mutedForeground,
  },
  bottomNavTextActive: {
    color: THEME.primary,
    fontWeight: "800",
  },
  // Sidebar Drawer (#1c1917 idéntico a Desktop)
  drawerOverlay: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sidebarDrawer: {
    width: 265,
    backgroundColor: THEME.sidebar,
    height: "100%",
  },
  sidebarHeader: {
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: THEME.sidebarBorder,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sidebarBrandTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
  sidebarBrandSub: {
    color: THEME.sidebarForeground,
    fontSize: 11,
  },
  sidebarGroupLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
    paddingHorizontal: 6,
  },
  sidebarGroupDivider: {
    flex: 1,
    height: 1,
    backgroundColor: THEME.sidebarAccent,
  },
  sidebarGroupLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: THEME.sidebarForeground,
    letterSpacing: 1.2,
  },
  sidebarItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 6,
    position: "relative",
  },
  sidebarItemActive: {
    backgroundColor: THEME.sidebarAccent,
  },
  sidebarActiveBar: {
    position: "absolute",
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    backgroundColor: THEME.primary,
    borderRadius: 2,
  },
  sidebarItemText: {
    fontSize: 13,
    color: THEME.sidebarForeground,
    fontWeight: "500",
  },
  sidebarItemTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  sidebarFooter: {
    borderTopWidth: 1,
    borderTopColor: THEME.sidebarBorder,
    padding: 14,
  },
  sidebarUserRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sidebarUserName: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  sidebarUserRole: {
    color: THEME.sidebarForeground,
    fontSize: 10,
    textTransform: "capitalize",
  },
  // Modals & Checkout
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(28,25,23,0.55)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: THEME.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    maxHeight: "92%",
  },
  dragHandleTouchArea: {
    paddingTop: 6,
    paddingBottom: 12,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  dragHandleBar: {
    width: 50,
    height: 5,
    borderRadius: 3,
    backgroundColor: THEME.mutedForeground + "50",
    alignSelf: "center",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: THEME.foreground,
  },
  checkoutTopSummary: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 10,
    padding: 12,
  },
  checkoutClientText: {
    fontSize: 14,
    fontWeight: "700",
    color: THEME.foreground,
    marginTop: 2,
  },
  checkoutBigTotal: {
    fontSize: 26,
    fontWeight: "900",
    color: THEME.primary,
  },
  montoIngresadoInput: {
    height: 48,
    fontSize: 19,
    fontWeight: "800",
    color: THEME.foreground,
    backgroundColor: THEME.card,
    borderColor: THEME.primary,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  creditoAmountCurrency: {
    fontSize: 10.5,
    fontWeight: "700",
    color: THEME.mutedForeground,
  },
  creditoAlertaContainer: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.4)",
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    padding: 12,
    gap: 10,
  },
  creditoAlertaTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: THEME.warningStrong,
  },
  creditoAlertaSub: {
    fontSize: 12,
    color: THEME.foreground,
    opacity: 0.9,
    marginTop: 2,
    lineHeight: 16,
  },
  creditoStatsGrid: {
    flexDirection: "row",
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderRadius: 8,
    padding: 8,
  },
  creditoStatCol: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 4,
  },
  creditoStatLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: THEME.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  creditoStatVal: {
    fontSize: 13,
    fontWeight: "800",
    color: THEME.foreground,
    marginTop: 2,
  },
  creditoOtorgarRapidoBtn: {
    backgroundColor: THEME.success,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    paddingHorizontal: 12,
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  creditoOtorgarRapidoBtnText: {
    color: "#fff",
    fontSize: 13.5,
    fontWeight: "800",
  },
  creditoHabilitadoContainer: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    padding: 10,
    gap: 4,
  },
  creditoHabilitadoLabel: {
    fontSize: 10.5,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: THEME.mutedForeground,
  },
  creditoHabilitadoOk: {
    fontSize: 11.5,
    fontWeight: "800",
    color: THEME.successStrong,
  },
  creditoHabilitadoSub: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.mutedForeground,
  },
  creditoHabilitadoVal: {
    fontSize: 12,
    fontWeight: "800",
    color: THEME.foreground,
  },
  checkoutSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  mixtoToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: THEME.secondary,
    borderWidth: 1,
    borderColor: THEME.primary,
  },
  mixtoToggleBtnActive: {
    backgroundColor: THEME.primary,
  },
  mixtoToggleBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.primary600,
  },
  metodoSelectTrigger: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 52,
  },
  metodoSelectIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: THEME.secondary,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginRight: 10,
  },
  metodoSelectName: {
    fontSize: 14,
    fontWeight: "700",
    color: THEME.foreground,
  },
  metodoSelectSub: {
    fontSize: 11,
    color: THEME.mutedForeground,
    marginTop: 1,
  },
  checkoutMetodoDropdownList: {
    backgroundColor: THEME.card,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    padding: 6,
    gap: 4,
    marginTop: -2,
    marginBottom: 4,
  },
  checkoutMetodoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 6,
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  checkoutMetodoRowActive: {
    backgroundColor: THEME.accent,
    borderColor: THEME.primary,
    borderWidth: 1.5,
  },
  checkoutMetodoName: {
    fontSize: 13,
    fontWeight: "600",
    color: THEME.foreground,
  },
  mixtoLineCard: {
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    padding: 8,
  },
  checkoutBalanceBanner: {
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    padding: 10,
  },
  checkoutCreditPanel: {
    backgroundColor: THEME.accent,
    borderWidth: 1,
    borderColor: THEME.primary,
    borderRadius: 8,
    padding: 10,
  },
  cobrosExtraContainer: {
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    padding: 10,
  },
  cobrosExtraHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  presetExtraChip: {
    backgroundColor: THEME.card,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  presetExtraChipText: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.primary600,
  },
  checkoutActionBtn: {
    height: 44,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
  },
  checkoutActionBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  creditCheckRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 36,
    paddingHorizontal: 20,
    gap: 6,
  },
  emptyBoxTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: THEME.foreground,
  },
  emptyBoxSub: {
    fontSize: 12,
    color: THEME.mutedForeground,
    textAlign: "center",
  },
});
