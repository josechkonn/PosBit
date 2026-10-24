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
  Vibration,
  Dimensions,
  useWindowDimensions,
} from "react-native";
import {
  CameraView,
  useCameraPermissions,
  BarcodeScanningResult,
  BarcodeType,
} from "expo-camera";
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
  getLocalMarcas,
  getLocalProveedores,
  getLocalProductos,
  findLocalProductoByBarcode,
  getLocalClientes,
  getLocalCreditos,
  getLocalAbonosByCredito,
  getLocalVentasRemotas,
  getLocalVentaItemsRemotos,
  getLocalVentaItemsByVentaId,
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
  fetchKardexCloud,
  fetchCajasCloud,
  cerrarCajaCloud,
  abrirCajaCloud,
  fetchVentaDetalleCloud,
  registrarAjusteKardexCloud,
  fetchReportesCloud,
  saveProductoCloud,
  deleteProductoCloud,
  verificarCodigoProductoCloud,
  fetchProductoFullCloud,
  fetchCategoriasCloud,
  saveCategoriaCloud,
  deleteCategoriaCloud,
  fetchMarcasCloud,
  saveMarcaCloud,
  deleteMarcaCloud,
  fetchProveedoresCloud,
  saveProveedorCloud,
  deleteProveedorCloud,
  fetchComprasCloud,
  crearCompraCloud,
  eliminarCompraCloud,
  fetchRetornosCloud,
  crearRetornoCloud,
  eliminarVentaCloud,
  fetchTransaccionesCloud,
  crearTransaccionCloud,
  crearCajaCloud,
  saveMonedaCloud,
  fetchMetodosPagoCloud,
  saveMetodoPagoCloud,
  deleteMetodoPagoCloud,
  fetchConfiguracionEmpresaCloud,
  saveConfiguracionClaveCloud,
  saveConfiguracionGlobalCloud,
  recalcularPreciosGlobalCloud,
  fetchUsuariosAdminCloud,
  saveUsuarioAdminCloud,
  deleteUsuarioAdminCloud,
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

type AppRoute =
  | "dashboard"
  | "pos"
  | "clientes"
  | "creditos"
  | "ventas"
  | "productos"
  | "categorias"
  | "marcas"
  | "compras"
  | "retornos"
  | "kardex"
  | "cajas"
  | "transacciones"
  | "proveedores"
  | "metodos_pago"
  | "monedas"
  | "reportes"
  | "usuarios"
  | "config";

const ALL_BARCODE_TYPES: BarcodeType[] = [
  "ean13",
  "ean8",
  "upc_a",
  "upc_e",
  "code128",
  "code39",
  "code93",
  "itf14",
  "codabar",
  "qr",
  "datamatrix",
  "pdf417",
  "aztec",
];

type ScannerMode = "rafaga" | "unico" | "consulta";

interface ScannedEventItem {
  id: number;
  rawCode: string;
  barcodeType: string;
  timestamp: string;
  status: "added" | "inspected" | "out_of_stock" | "not_found";
  producto?: LocalProducto;
  presentacion?: LocalPresentacion | null;
}

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

function fmtDateTime(isoOrDate?: string | null): string {
  if (!isoOrDate) return "-";
  try {
    const d = new Date(isoOrDate);
    if (isNaN(d.getTime())) return String(isoOrDate);
    const day = d.getDate();
    const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${day} ${month} ${year}, ${hours.toString().padStart(2, "0")}:${minutes} ${ampm}`;
  } catch {
    return String(isoOrDate);
  }
}

export default function App() {
  const { height: windowHeight } = useWindowDimensions();
  const screenHeight = Math.max(windowHeight, Dimensions.get("screen").height);
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

  // ── Lector de Código de Barras en Tiempo Real (POS & Catálogo) ──
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [scannerMode, setScannerMode] = useState<ScannerMode>("rafaga");
  const [scannerTorch, setScannerTorch] = useState(false);
  const [scannerLowLightGlow, setScannerLowLightGlow] = useState(false);
  const [scannerAntiBlurMode, setScannerAntiBlurMode] = useState(true);
  const [scannerZoom, setScannerZoom] = useState<number>(0.12);
  const [scannerAutoFocus, setScannerAutoFocus] = useState<"on" | "off">("on");
  const [scannerFacing, setScannerFacing] = useState<"back" | "front">("back");
  const [scannerPaused, setScannerPaused] = useState(false);
  const [scannerManualInputOpen, setScannerManualInputOpen] = useState(false);
  const [scannerManualCode, setScannerManualCode] = useState("");
  const [lastScannedEvent, setLastScannedEvent] = useState<ScannedEventItem | null>(null);
  const [scanHistory, setScanHistory] = useState<ScannedEventItem[]>([]);
  const [scannerStatusRing, setScannerStatusRing] = useState<"idle" | "success" | "warning" | "error">("idle");
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number; key: number } | null>(null);

  const scannerLaserAnim = useRef(new Animated.Value(0)).current;
  const scannerFrameScaleAnim = useRef(new Animated.Value(1)).current;
  const scannerFocusAnim = useRef(new Animated.Value(1)).current;
  const lastScanLockRef = useRef<{ code: string; time: number }>({ code: "", time: 0 });
  const lastBarcodeSeenRef = useRef<{ code: string; seenAt: number }>({ code: "", seenAt: 0 });
  const scannerCallbackRef = useRef<((code: string) => void) | null>(null);
  const processingScanRef = useRef(false);
  const statusRingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Kardex Module State
  const [kardexItems, setKardexItems] = useState<any[]>([]);
  const [kardexLoading, setKardexLoading] = useState(false);
  const [kardexSearch, setKardexSearch] = useState("");
  const [kardexTipo, setKardexTipo] = useState<string>("todos");
  const [kardexStats, setKardexStats] = useState({ entradas: 0, salidas: 0, ajustes: 0 });

  // Cajas Module State
  const [cajasCloud, setCajasCloud] = useState<any[]>([]);
  const [cajasLoading, setCajasLoading] = useState(false);
  const [cajaParaCierre, setCajaParaCierre] = useState<any | null>(null);
  const [cierreObservaciones, setCierreObservaciones] = useState("");
  const [submittingCierre, setSubmittingCierre] = useState(false);
  const [cajaParaAbrir, setCajaParaAbrir] = useState<any | null>(null);
  const [saldoAperturaInput, setSaldoAperturaInput] = useState("0");
  const [submittingAbrir, setSubmittingAbrir] = useState(false);

  // Kardex Adjustment Modal State
  const [modalAjusteKardexVisible, setModalAjusteKardexVisible] = useState(false);
  const [ajusteProducto, setAjusteProducto] = useState<LocalProducto | null>(null);
  const [ajustePresentacionId, setAjustePresentacionId] = useState<string | null>(null);
  const [ajusteTipo, setAjusteTipo] = useState<"Entrada" | "Salida">("Entrada");
  const [ajusteCantidad, setAjusteCantidad] = useState("1");
  const [ajusteMotivo, setAjusteMotivo] = useState("Ajuste manual");
  const [ajusteSearchProd, setAjusteSearchProd] = useState("");
  const [ajusteSubmitting, setAjusteSubmitting] = useState(false);

  // Reportes Module State
  const [reportesData, setReportesData] = useState<any>(null);
  const [reportesLoading, setReportesLoading] = useState(false);
  const [reportesTab, setReportesTab] = useState<"ventas" | "finanzas" | "inventario">("ventas");
  const [reportesPreset, setReportesPreset] = useState<"hoy" | "mes" | "anio" | "todo">("hoy");
  const [reportesMonedaCod, setReportesMonedaCod] = useState<string>("");
  const [reportesStockPage, setReportesStockPage] = useState(1);

  // ── NUEVOS MÓDULOS COMPLETOS (Paridad 100% Web/Desktop) ──
  // 1. Productos CRUD + Presentaciones (Clon 1:1 de src/components/producto/producto-modal.tsx en PC)
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [prodModalMode, setProdModalMode] = useState<"create" | "edit" | "view">("create");
  const [prodFormStep, setProdFormStep] = useState<1 | 2 | 3>(1);
  const [prodFormError, setProdFormError] = useState("");
  const [editingProd, setEditingProd] = useState<LocalProducto | null>(null);
  const [prodFullCloud, setProdFullCloud] = useState<any | null>(null);
  const [prodFormCodigo, setProdFormCodigo] = useState("");
  const [prodVerifCodigo, setProdVerifCodigo] = useState<{
    estado: "vacio" | "verificando" | "libre" | "ocupado";
    mensaje: string;
  }>({ estado: "vacio", mensaje: "" });
  const [prodFormNombre, setProdFormNombre] = useState("");
  const [prodFormDesc, setProdFormDesc] = useState("");
  const [prodFormCatId, setProdFormCatId] = useState<string>("");
  const [prodFormMarcaId, setProdFormMarcaId] = useState<string>("");
  const [prodFormProvIds, setProdFormProvIds] = useState<string[]>([]);
  const [prodFormIvaIncluido, setProdFormIvaIncluido] = useState(true);
  const [prodFormActivo, setProdFormActivo] = useState(true);
  const [prodFormMonedaPrecioId, setProdFormMonedaPrecioId] = useState<string>("");
  const [prodFormMonedaCostoId, setProdFormMonedaCostoId] = useState<string>("");
  const [prodFormPreciosPorMoneda, setProdFormPreciosPorMoneda] = useState<
    Record<string, { precioCompra: string; precioVenta: string }>
  >({});
  const [prodFormGanancia, setProdFormGanancia] = useState("");
  const [prodNuevaPresNombre, setProdNuevaPresNombre] = useState("");
  const [prodNuevaPresUnidades, setProdNuevaPresUnidades] = useState("");
  const [prodNuevaPresCodigo, setProdNuevaPresCodigo] = useState("");
  const [prodVerifNuevaPres, setProdVerifNuevaPres] = useState<{
    estado: "vacio" | "verificando" | "libre" | "ocupado";
    mensaje: string;
  }>({ estado: "vacio", mensaje: "" });
  const [prodFormPresentaciones, setProdFormPresentaciones] = useState<
    Array<{
      key: string;
      id?: string;
      nombre: string;
      unidades: string;
      activo: boolean;
      codigoBarras: string;
      modo_venta: "derivado" | "fijo" | "margen";
      precio_override: string;
      margen_override: string;
    }>
  >([]);
  const [prodVerifCajas, setProdVerifCajas] = useState<
    Record<string, { estado: "vacio" | "verificando" | "libre" | "ocupado"; mensaje: string }>
  >({});
  const [prodFormStock, setProdFormStock] = useState<number>(0);
  const [prodFormStockTexto, setProdFormStockTexto] = useState("0");
  const [prodFormStockUnidadId, setProdFormStockUnidadId] = useState<string>("");
  const [prodFormStockMin, setProdFormStockMin] = useState("5");
  const [savingProd, setSavingProd] = useState(false);

  // 2. Categorías CRUD
  const [categoriasCloud, setCategoriasCloud] = useState<any[]>([]);
  const [catSearch, setCatSearch] = useState("");
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<any | null>(null);
  const [catFormNombre, setCatFormNombre] = useState("");
  const [catFormDesc, setCatFormDesc] = useState("");
  const [savingCat, setSavingCat] = useState(false);

  // 3. Marcas CRUD
  const [marcasCloud, setMarcasCloud] = useState<any[]>([]);
  const [marcaSearch, setMarcaSearch] = useState("");
  const [marcaModalOpen, setMarcaModalOpen] = useState(false);
  const [editingMarca, setEditingMarca] = useState<any | null>(null);
  const [marcaFormNombre, setMarcaFormNombre] = useState("");
  const [marcaFormDesc, setMarcaFormDesc] = useState("");
  const [savingMarca, setSavingMarca] = useState(false);

  // 4. Proveedores CRUD
  const [proveedoresList, setProveedoresList] = useState<any[]>([]);
  const [provSearch, setProvSearch] = useState("");
  const [provLoading, setProvLoading] = useState(false);
  const [provModalOpen, setProvModalOpen] = useState(false);
  const [editingProv, setEditingProv] = useState<any | null>(null);
  const [provFormNombre, setProvFormNombre] = useState("");
  const [provFormDoc, setProvFormDoc] = useState("");
  const [provFormContacto, setProvFormContacto] = useState("");
  const [provFormTel, setProvFormTel] = useState("");
  const [provFormEmail, setProvFormEmail] = useState("");
  const [provFormCiudad, setProvFormCiudad] = useState("");
  const [provFormDir, setProvFormDir] = useState("");
  const [provFormNotas, setProvFormNotas] = useState("");
  const [savingProv, setSavingProv] = useState(false);

  // 5. Compras (Listado + Detalle + Nueva Compra)
  const [comprasList, setComprasList] = useState<any[]>([]);
  const [compraItemsList, setCompraItemsList] = useState<any[]>([]);
  const [comprasLoading, setComprasLoading] = useState(false);
  const [comprasSearch, setComprasSearch] = useState("");
  const [compraDetailModal, setCompraDetailModal] = useState<{ compra: any; items: any[] } | null>(null);
  const [nuevaCompraModalOpen, setNuevaCompraModalOpen] = useState(false);
  const [ncProveedorId, setNcProveedorId] = useState<string>("");
  const [ncMonedaId, setNcMonedaId] = useState<string>("");
  const [ncTipoPago, setNcTipoPago] = useState<"contado" | "parcial" | "credito">("contado");
  const [ncMetodoPagoId, setNcMetodoPagoId] = useState<string>("");
  const [ncAbonoInicial, setNcAbonoInicial] = useState("");
  const [ncReferencia, setNcReferencia] = useState("");
  const [ncObs, setNcObs] = useState("");
  const [ncSearchProd, setNcSearchProd] = useState("");
  const [ncItems, setNcItems] = useState<
    Array<{
      producto: LocalProducto;
      cantidadStr: string;
      costoUnitStr: string;
    }>
  >([]);
  const [savingCompra, setSavingCompra] = useState(false);

  // 6. Retornos / Devoluciones
  const [retornosList, setRetornosList] = useState<any[]>([]);
  const [retornoItemsList, setRetornoItemsList] = useState<any[]>([]);
  const [retornosLoading, setRetornosLoading] = useState(false);
  const [retornosSearch, setRetornosSearch] = useState("");
  const [nuevoRetornoModalOpen, setNuevoRetornoModalOpen] = useState(false);
  const [nrTipo, setNrTipo] = useState<"Cliente" | "Proveedor">("Cliente");
  const [nrClienteId, setNrClienteId] = useState<string>("");
  const [nrProveedorId, setNrProveedorId] = useState<string>("");
  const [nrMetodoReembolso, setNrMetodoReembolso] = useState<"efectivo" | "credito" | "cambio">("efectivo");
  const [nrMetodoPagoId, setNrMetodoPagoId] = useState<string>("");
  const [nrMotivo, setNrMotivo] = useState("Devolución de mercancía");
  const [nrObs, setNrObs] = useState("");
  const [nrSearchProd, setNrSearchProd] = useState("");
  const [nrItems, setNrItems] = useState<
    Array<{
      producto: LocalProducto;
      cantidadStr: string;
      precioUnitStr: string;
    }>
  >([]);
  const [savingRetorno, setSavingRetorno] = useState(false);

  // Retorno Directo desde Factura de Venta o Compra (Clon 1:1 de RetornoDirectoModal de PC)
  const [retornoDirectoModal, setRetornoDirectoModal] = useState<{
    tipo: "Cliente" | "Proveedor";
    referenciaId: string;
    referenciaNumero: string;
    entidadId: string | null;
    entidadNombre: string;
    tipoPago?: string;
    tieneCreditoPendiente?: boolean;
    monedaCodigo: string;
    items: Array<{
      producto_id: number;
      producto_nombre: string;
      producto_codigo?: string;
      cantidad_original: number;
      precio_unit: number;
      presentacion_nombre?: string | null;
    }>;
  } | null>(null);
  const [rdItemsState, setRdItemsState] = useState<
    Array<{
      producto_id: number;
      cantidad: number;
      seleccionado: boolean;
    }>
  >([]);
  const [rdAbonarCredito, setRdAbonarCredito] = useState(true);
  const [rdMotivo, setRdMotivo] = useState("Devolución de mercancía");
  const [rdSubmitting, setRdSubmitting] = useState(false);

  // 7. Transacciones de Caja + Nueva Caja
  const [transaccionesList, setTransaccionesList] = useState<any[]>([]);
  const [transaccionesLoading, setTransaccionesLoading] = useState(false);
  const [transaccionesSearch, setTransaccionesSearch] = useState("");
  const [nuevaTransModalOpen, setNuevaTransModalOpen] = useState(false);
  const [ntCajaId, setNtCajaId] = useState<string>("");
  const [ntTipo, setNtTipo] = useState<"Entrada" | "Salida">("Entrada");
  const [ntMonto, setNtMonto] = useState("");
  const [ntDesc, setNtDesc] = useState("");
  const [savingTrans, setSavingTrans] = useState(false);
  const [nuevaCajaModalOpen, setNuevaCajaModalOpen] = useState(false);
  const [ncajaNombre, setNcajaNombre] = useState("");
  const [ncajaMonedaId, setNcajaMonedaId] = useState<string>("");
  const [savingNuevaCaja, setSavingNuevaCaja] = useState(false);

  // 8. Monedas y Tasas CRUD
  const [monedaModalOpen, setMonedaModalOpen] = useState(false);
  const [editingMoneda, setEditingMoneda] = useState<LocalMoneda | null>(null);
  const [monFormNombre, setMonFormNombre] = useState("");
  const [monFormCodigo, setMonFormCodigo] = useState("");
  const [monFormSimbolo, setMonFormSimbolo] = useState("$");
  const [monFormTasa, setMonFormTasa] = useState("1");
  const [monFormDecimales, setMonFormDecimales] = useState("2");
  const [monFormUsaDirecta, setMonFormUsaDirecta] = useState(false);
  const [monFormTasaDirecta, setMonFormTasaDirecta] = useState("");
  const [savingMoneda, setSavingMoneda] = useState(false);

  // 9. Métodos de Pago CRUD
  const [mpModalOpen, setMpModalOpen] = useState(false);
  const [editingMp, setEditingMp] = useState<LocalMetodoPago | null>(null);
  const [mpFormNombre, setMpFormNombre] = useState("");
  const [mpFormTipo, setMpFormTipo] = useState("Efectivo");
  const [mpFormCajaId, setMpFormCajaId] = useState<string>("");
  const [mpFormActivo, setMpFormActivo] = useState(true);
  const [savingMp, setSavingMp] = useState(false);

  // 10. Configuración Global & Empresa + Usuarios Admin
  const [configSubTab, setConfigSubTab] = useState<"motor" | "empresa" | "sync">("motor");
  const [empresaConfig, setEmpresaConfig] = useState<Record<string, string>>({
    empresa_nombre: "PosBit",
    empresa_rif: "",
    empresa_telefono: "",
    empresa_direccion: "",
    empresa_email: "",
    iva_porcentaje: "16",
  });
  const [cfgModoVentas, setCfgModoVentas] = useState<"directa" | "triangulacion">("directa");
  const [cfgModoCompras, setCfgModoCompras] = useState<"directa" | "triangulacion">("directa");
  const [cfgRedondearVentas, setCfgRedondearVentas] = useState(false);
  const [cfgActualizarEnCompra, setCfgActualizarEnCompra] = useState(true);
  const [cfgGananciaDefecto, setCfgGananciaDefecto] = useState("30");
  const [savingConfigGlobal, setSavingConfigGlobal] = useState(false);
  const [recalculandoPrecios, setRecalculandoPrecios] = useState(false);

  const [usuariosList, setUsuariosList] = useState<any[]>([]);
  const [usuariosLoading, setUsuariosLoading] = useState(false);
  const [usuarioModalOpen, setUsuarioModalOpen] = useState(false);
  const [editingUsuario, setEditingUsuario] = useState<any | null>(null);
  const [usrFormName, setUsrFormName] = useState("");
  const [usrFormEmail, setUsrFormEmail] = useState("");
  const [usrFormRole, setUsrFormRole] = useState<"admin" | "cajero" | "usuario">("cajero");
  const [usrFormPassword, setUsrFormPassword] = useState("");
  const [savingUsuario, setSavingUsuario] = useState(false);

  const showToast = useCallback((text: string, type: "success" | "error" | "info" = "success") => {
    setToastMsg({ text, type });
    setTimeout(() => {
      setToastMsg((prev) => (prev?.text === text ? null : prev));
    }, 3200);
  }, []);

  const refreshLocalState = useCallback(async (search = "") => {
    const [m, cfg, c, mp, cats, mrcs, provs, p, cls, creds, vl, vr, vir, abPend, lastIso] = await Promise.all([
      getLocalMonedas(),
      getLocalConfiguracionGlobal(),
      getLocalCajas(),
      getLocalMetodosPago(),
      getLocalCategorias(),
      getLocalMarcas(),
      getLocalProveedores(),
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
    if (cats.length > 0) setCategoriasCloud(cats);
    if (mrcs.length > 0) setMarcasCloud(mrcs);
    if (provs.length > 0) setProveedoresList(provs);
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
      const res = await syncMobileWithCloud();
      setSyncOnline(true);
      if (res?.fecha) setLastSyncIso(res.fecha);
      await refreshLocalState(posSearchRef.current);
    } catch (err: any) {
      console.warn("Silent sync warning:", err?.message || err);
      setSyncOnline(false);
    } finally {
      syncInFlightRef.current = false;
      setSyncing(false);
    }
  }, [session, refreshLocalState]);

  useEffect(() => {
    if (!session) return;
    runSilentSync();
    // Auto-recuperación moderada para evitar congelar el hilo de UI
    const interval = setInterval(runSilentSync, syncOnline ? 60_000 : 30_000);
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") runSilentSync();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [session, runSilentSync, syncOnline]);

  useEffect(() => {
    if (!session) return;
    const delay = posSearch.trim() === "" ? 0 : 250;
    const t = setTimeout(() => {
      getLocalProductos(posSearch).then(setProductos);
    }, delay);
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

  // ── Motor de Escaneo de Código de Barras en Tiempo Real (Baja Luz + Antidesenfoque) ──
  useEffect(() => {
    if (!showScannerModal || scannerPaused) {
      scannerLaserAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scannerLaserAnim, {
          toValue: 1,
          duration: 1550,
          useNativeDriver: true,
        }),
        Animated.timing(scannerLaserAnim, {
          toValue: 0,
          duration: 1550,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [showScannerModal, scannerPaused, scannerLaserAnim]);

  // Re-enfoque automático periódico cuando Modo Antidesenfoque está activo
  useEffect(() => {
    if (!showScannerModal || !scannerAntiBlurMode || scannerPaused) return;
    const interval = setInterval(() => {
      setScannerAutoFocus("off");
      setTimeout(() => setScannerAutoFocus("on"), 75);
    }, 3600);
    return () => clearInterval(interval);
  }, [showScannerModal, scannerAntiBlurMode, scannerPaused]);

  const flashScannerRing = useCallback(
    (ringStatus: "success" | "warning" | "error") => {
      if (statusRingTimeoutRef.current) {
        clearTimeout(statusRingTimeoutRef.current);
      }
      setScannerStatusRing(ringStatus);
      scannerFrameScaleAnim.setValue(0.94);
      Animated.spring(scannerFrameScaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 120,
        useNativeDriver: true,
      }).start();
      statusRingTimeoutRef.current = setTimeout(() => {
        setScannerStatusRing("idle");
      }, 950);
    },
    [scannerFrameScaleAnim]
  );

  const triggerScannerFocus = useCallback(
    (tapX?: number, tapY?: number) => {
      setScannerAutoFocus("off");
      setTimeout(() => setScannerAutoFocus("on"), 65);
      if (typeof tapX === "number" && typeof tapY === "number") {
        setFocusPoint({ x: tapX, y: tapY, key: Date.now() });
        scannerFocusAnim.setValue(1.35);
        Animated.spring(scannerFocusAnim, {
          toValue: 1,
          friction: 5,
          tension: 110,
          useNativeDriver: true,
        }).start();
        setTimeout(() => {
          setFocusPoint((prev) => (prev && Date.now() - prev.key >= 900 ? null : prev));
        }, 950);
      }
    },
    [scannerFocusAnim]
  );

  const openBarcodeScanner = useCallback(
    (initialMode: ScannerMode = "rafaga", onCaptureCode?: (code: string) => void) => {
      scannerCallbackRef.current = onCaptureCode || null;
      setScannerMode(onCaptureCode ? "unico" : initialMode);
      setScannerPaused(false);
      setScannerManualInputOpen(false);
      setScannerManualCode("");
      setScannerStatusRing("idle");
      lastScanLockRef.current = { code: "", time: 0 };
      lastBarcodeSeenRef.current = { code: "", seenAt: 0 };
      setShowScannerModal(true);
    },
    []
  );

  const processScannedBarcode = useCallback(
    async (rawCodeInput: string, barcodeType = "ean13") => {
      const cleanCode = (rawCodeInput || "").trim();
      if (!cleanCode) return;

      // Si el escáner fue invocado desde un formulario (ej. Crear Producto, Presentación o Compra),
      // devolver el código directamente al callback del formulario y cerrar el escáner.
      if (scannerCallbackRef.current) {
        const cb = scannerCallbackRef.current;
        scannerCallbackRef.current = null;
        try {
          Vibration.vibrate(40);
        } catch {}
        flashScannerRing("success");
        setShowScannerModal(false);
        cb(cleanCode);
        return;
      }

      const nowStr = new Date().toTimeString().slice(0, 8);
      const normNoZero = cleanCode.replace(/^0+/, "");
      const padded13 =
        cleanCode.length === 12 && /^\d+$/.test(cleanCode) ? `0${cleanCode}` : cleanCode;

      // 1. Búsqueda instantánea 0ms en memoria (catálogo cargado)
      let matchedProd: LocalProducto | undefined;
      let matchedPres: LocalPresentacion | null = null;

      for (const p of productos) {
        if (p.presentaciones && p.presentaciones.length > 0) {
          const prHit = p.presentaciones.find((pr) => {
            if (!pr.codigo) return false;
            const c = pr.codigo.trim();
            return (
              c.toLowerCase() === cleanCode.toLowerCase() ||
              c.toLowerCase() === padded13.toLowerCase() ||
              (normNoZero.length >= 6 && c.replace(/^0+/, "") === normNoZero)
            );
          });
          if (prHit) {
            matchedProd = p;
            matchedPres = prHit;
            break;
          }
        }
        const pCode = (p.codigo || "").trim();
        if (
          pCode.toLowerCase() === cleanCode.toLowerCase() ||
          pCode.toLowerCase() === padded13.toLowerCase() ||
          (normNoZero.length >= 6 && pCode.replace(/^0+/, "") === normNoZero)
        ) {
          matchedProd = p;
          matchedPres = null;
          break;
        }
      }

      // 2. Fallback a SQLite completo (si hay >300 productos o código fuera del slice en memoria)
      if (!matchedProd) {
        try {
          const dbMatch = await findLocalProductoByBarcode(cleanCode);
          if (dbMatch) {
            matchedProd = dbMatch.producto;
            matchedPres = dbMatch.presentacion;
          }
        } catch (err) {
          console.warn("Error buscando código en SQLite:", err);
        }
      }

      // Caso A: Producto NO encontrado
      if (!matchedProd) {
        try {
          Vibration.vibrate([0, 45, 55, 65]);
        } catch {}
        flashScannerRing("error");
        const notFoundEvt: ScannedEventItem = {
          id: Date.now(),
          rawCode: cleanCode,
          barcodeType,
          timestamp: nowStr,
          status: "not_found",
        };
        setLastScannedEvent(notFoundEvt);
        setScanHistory((prev) => [notFoundEvt, ...prev].slice(0, 12));
        return;
      }

      // Caso B: Modo Consulta / Verificador de Precios
      if (scannerMode === "consulta") {
        try {
          Vibration.vibrate(35);
        } catch {}
        flashScannerRing("success");
        const inspectEvt: ScannedEventItem = {
          id: Date.now(),
          rawCode: cleanCode,
          barcodeType,
          timestamp: nowStr,
          status: "inspected",
          producto: matchedProd,
          presentacion: matchedPres,
        };
        setLastScannedEvent(inspectEvt);
        setScanHistory((prev) => [inspectEvt, ...prev].slice(0, 12));
        return;
      }

      // Caso C: Producto sin stock disponible
      if (matchedProd.stock <= 0) {
        try {
          Vibration.vibrate([0, 40, 50, 50]);
        } catch {}
        flashScannerRing("warning");
        const noStockEvt: ScannedEventItem = {
          id: Date.now(),
          rawCode: cleanCode,
          barcodeType,
          timestamp: nowStr,
          status: "out_of_stock",
          producto: matchedProd,
          presentacion: matchedPres,
        };
        setLastScannedEvent(noStockEvt);
        setScanHistory((prev) => [noStockEvt, ...prev].slice(0, 12));
        showToast(`Sin existencias de ${matchedProd.nombre}`, "error");
        return;
      }

      // Caso D: Agregar al Carrito POS en tiempo real
      addToCart(matchedProd, matchedPres);
      try {
        Vibration.vibrate(40);
      } catch {}
      flashScannerRing("success");

      const addedEvt: ScannedEventItem = {
        id: Date.now(),
        rawCode: cleanCode,
        barcodeType,
        timestamp: nowStr,
        status: "added",
        producto: matchedProd,
        presentacion: matchedPres,
      };
      setLastScannedEvent(addedEvt);
      setScanHistory((prev) => [addedEvt, ...prev].slice(0, 12));

      if (scannerMode === "unico") {
        setTimeout(() => {
          setShowScannerModal(false);
        }, 380);
      }
    },
    [productos, scannerMode, addToCart, flashScannerRing, showToast]
  );

  const handleCameraBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (scannerPaused || processingScanRef.current) return;
      const code = (result?.data || "").trim();
      if (!code) return;

      const now = Date.now();
      const prevLock = lastScanLockRef.current;
      const prevSeen = lastBarcodeSeenRef.current;

      // 1. Bloqueo Anti-Doble-Escaneo (Hold Lock):
      // Si es el MISMO código que acabamos de escanear y el usuario dejó el producto un momento
      // frente a la cámara, actualizamos `seenAt` en cada fotograma y bloqueamos el re-escaneo
      // hasta que el código haya salido del encuadre por >= 1150ms Y hayan pasado >= 2700ms desde el escaneo.
      if (prevLock.code === code) {
        const gapSinceLastSeen = prevSeen.code === code ? now - prevSeen.seenAt : 999999;
        lastBarcodeSeenRef.current = { code, seenAt: now };
        if (gapSinceLastSeen < 1150 || now - prevLock.time < 2700) {
          return;
        }
      } else {
        // 2. Pausa ergonómica entre escaneos rápidos de DISTINTOS productos (750ms)
        // para dar tiempo cómodo al cambiar de producto sin lecturas accidentales.
        if (now - prevLock.time < 750) {
          return;
        }
        lastBarcodeSeenRef.current = { code, seenAt: now };
      }

      lastScanLockRef.current = { code, time: now };
      processingScanRef.current = true;
      processScannedBarcode(code, result.type || "ean13").finally(() => {
        processingScanRef.current = false;
      });
    },
    [scannerPaused, processScannedBarcode]
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

  // Ver ítems de una factura en el perfil o ventas
  const handleOpenVentaDetail = useCallback(
    async (v: any) => {
      // 1. Si ya tiene local_items
      if (Array.isArray(v.local_items) && v.local_items.length > 0) {
        setVentaDetailModal({ venta: v, items: v.local_items });
        return;
      }
      // 2. Si tiene items_json guardado en offline
      if (v.items_json) {
        try {
          const parsed = typeof v.items_json === "string" ? JSON.parse(v.items_json) : v.items_json;
          if (Array.isArray(parsed) && parsed.length > 0) {
            setVentaDetailModal({ venta: v, items: parsed });
            return;
          }
        } catch {}
      }
      // 3. Del perfil si está cargado
      const cloudProfileItems = Array.isArray(perfilCloudData?.ventaItems)
        ? perfilCloudData.ventaItems.filter((i: any) => String(i.venta_id) === String(v.id))
        : [];
      if (cloudProfileItems.length > 0) {
        setVentaDetailModal({ venta: v, items: cloudProfileItems });
        return;
      }
      // 4. De la base SQLite local
      const dbItems = await getLocalVentaItemsByVentaId(String(v.id));
      if (dbItems && dbItems.length > 0) {
        setVentaDetailModal({ venta: v, items: dbItems });
        return;
      }
      // 5. De memoria
      const localItems = ventaItemsRemotos.filter((i) => String(i.venta_id) === String(v.id));
      setVentaDetailModal({ venta: v, items: localItems });

      // 6. Si está en línea, consultar el detalle enriquecido en la nube
      fetchVentaDetalleCloud(String(v.id)).then((cloudV) => {
        if (cloudV && Array.isArray(cloudV.items) && cloudV.items.length > 0) {
          setVentaDetailModal((prev) => (prev?.venta?.id === v.id ? { venta: cloudV, items: cloudV.items } : prev));
        }
      });
    },
    [perfilCloudData, ventaItemsRemotos]
  );

  // Lista unificada de ventas ordenadas estrictamente por fecha y hora (más reciente primero)
  const todasLasVentas = useMemo(() => {
    const list: Array<{
      id: string | number;
      numero: string;
      cliente_id?: string | null;
      cliente: string;
      fecha: string;
      creado_en?: string | null;
      timestamp: number;
      total: number;
      subtotal?: number;
      descuento?: number;
      impuesto?: number;
      moneda_id: string;
      moneda_codigo?: string;
      moneda_simbolo?: string;
      tipo_pago: string;
      metodo_pago_nombre?: string | null;
      estado: string;
      observaciones?: string | null;
      isLocal?: boolean;
      sincronizado?: number;
      items_json?: string;
    }> = [];

    // Ventas locales móviles
    for (const vl of ventasLocales) {
      const mon = monedas.find((m) => String(m.id) === String(vl.moneda_id));
      const iso = vl.creado_en || (vl.fecha ? `${vl.fecha}T00:00:00.000Z` : new Date().toISOString());
      const ts = new Date(iso).getTime() || Date.now();
      list.push({
        id: `local_${vl.id}`,
        numero: vl.numero,
        cliente_id: vl.cliente_id || null,
        cliente: vl.cliente_nombre || "Consumidor Final",
        fecha: vl.fecha,
        creado_en: vl.creado_en || vl.fecha,
        timestamp: ts,
        total: Number(vl.total) || 0,
        subtotal: Number(vl.subtotal) || 0,
        descuento: Number(vl.descuento) || 0,
        impuesto: Number(vl.impuesto) || 0,
        moneda_id: String(vl.moneda_id),
        moneda_codigo: mon?.codigo || "COP",
        moneda_simbolo: mon?.simbolo || "$",
        tipo_pago: vl.tipo_pago || "Contado",
        metodo_pago_nombre: "Móvil Local",
        estado: "Pagada",
        observaciones: vl.observaciones,
        isLocal: true,
        sincronizado: vl.sincronizado,
        items_json: vl.items_json,
      });
    }

    // Ventas remotas sincronizadas
    for (const vr of ventasRemotas) {
      const iso = vr.creado_en || (vr.fecha ? (vr.fecha.includes("T") ? vr.fecha : `${vr.fecha}T00:00:00.000Z`) : new Date().toISOString());
      const ts = new Date(iso).getTime() || 0;
      list.push({
        id: vr.id,
        numero: vr.numero,
        cliente_id: vr.cliente_id || null,
        cliente: vr.cliente || "Consumidor Final",
        fecha: vr.fecha,
        creado_en: vr.creado_en || vr.fecha,
        timestamp: ts,
        total: Number(vr.total) || 0,
        subtotal: Number(vr.subtotal) || 0,
        descuento: Number(vr.descuento) || 0,
        impuesto: Number(vr.impuesto) || 0,
        moneda_id: String(vr.moneda_id),
        moneda_codigo: vr.moneda_codigo || "USD",
        moneda_simbolo: vr.moneda_simbolo || "$",
        tipo_pago: vr.tipo_pago || "Contado",
        metodo_pago_nombre: vr.metodo_pago_nombre,
        estado: vr.estado || "Pagada",
        observaciones: vr.observaciones,
        isLocal: false,
      });
    }

    return list.sort((a, b) => b.timestamp - a.timestamp);
  }, [ventasLocales, ventasRemotas, monedas]);

  const ventasFiltradas = useMemo(() => {
    const q = ventasSearch.trim().toLowerCase();
    const seenNumeros = new Set<string>();
    const deduplicated: typeof todasLasVentas = [];
    for (const v of todasLasVentas) {
      if (seenNumeros.has(v.numero)) continue;
      seenNumeros.add(v.numero);
      if (!q || v.numero.toLowerCase().includes(q) || v.cliente.toLowerCase().includes(q)) {
        deduplicated.push(v);
      }
    }
    return deduplicated;
  }, [todasLasVentas, ventasSearch]);

  // Carga del Kardex
  const loadKardex = useCallback(async () => {
    setKardexLoading(true);
    try {
      const res = await fetchKardexCloud({
        search: kardexSearch,
        tipo: kardexTipo,
        page: 1,
        limit: 50,
      });
      if (res) {
        const list = Array.isArray((res as any).movimientos)
          ? (res as any).movimientos
          : (Array.isArray((res as any).data) ? (res as any).data : (Array.isArray(res) ? res : []));
        setKardexItems(list);
        if ((res as any).stats) {
          setKardexStats((res as any).stats);
        } else if (Array.isArray(list)) {
          let ent = 0, sal = 0, aj = 0;
          for (const m of list) {
            if (m.tipo === "Entrada") ent++;
            else if (m.tipo === "Salida") sal++;
            else if (m.tipo === "Ajuste") aj++;
          }
          setKardexStats({ entradas: ent, salidas: sal, ajustes: aj });
        }
      }
    } catch (e: any) {
      console.warn("Error cargando kardex:", e);
    } finally {
      setKardexLoading(false);
    }
  }, [kardexSearch, kardexTipo]);

  useEffect(() => {
    if (route === "kardex") {
      loadKardex();
    }
  }, [route, loadKardex]);

  // Carga de Cajas
  const loadCajas = useCallback(async () => {
    setCajasLoading(true);
    try {
      const res = await fetchCajasCloud();
      if (Array.isArray(res)) {
        setCajasCloud(res);
      }
    } catch (e: any) {
      console.warn("Error cargando cajas:", e);
    } finally {
      setCajasLoading(false);
    }
  }, []);

  useEffect(() => {
    if (route === "cajas") {
      loadCajas();
    }
  }, [route, loadCajas]);

  // Cierre de Caja
  const handleCerrarCaja = useCallback(async () => {
    if (!cajaParaCierre) return;
    setSubmittingCierre(true);
    try {
      const res = await cerrarCajaCloud(cajaParaCierre.id, cierreObservaciones);
      if (res.success) {
        showToast("Caja cerrada exitosamente", "success");
        setCajaParaCierre(null);
        setCierreObservaciones("");
        loadCajas();
      } else {
        showToast(res.error || "Error al cerrar caja", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Error al cerrar caja", "error");
    } finally {
      setSubmittingCierre(false);
    }
  }, [cajaParaCierre, cierreObservaciones, showToast, loadCajas]);

  // Apertura de Caja
  const handleAbrirCaja = useCallback(async () => {
    if (!cajaParaAbrir) return;
    const saldo = parseFloat(saldoAperturaInput) || 0;
    setSubmittingAbrir(true);
    try {
      const res = await abrirCajaCloud(cajaParaAbrir.id, saldo);
      if (res.success) {
        showToast("Turno de caja abierto", "success");
        setCajaParaAbrir(null);
        setSaldoAperturaInput("0");
        loadCajas();
      } else {
        showToast(res.error || "Error al abrir caja", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Error al abrir caja", "error");
    } finally {
      setSubmittingAbrir(false);
    }
  }, [cajaParaAbrir, saldoAperturaInput, showToast, loadCajas]);

  // Registro de Ajuste de Inventario (Kardex)
  const handleRegistrarAjuste = useCallback(async () => {
    if (!ajusteProducto) {
      Alert.alert("Atención", "Selecciona un producto para ajustar");
      return;
    }
    const qty = parseFloat(ajusteCantidad);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert("Atención", "La cantidad debe ser mayor a 0");
      return;
    }

    // Calcular factor de presentación si aplica
    let factor = 1;
    if (ajustePresentacionId && ajusteProducto.presentaciones) {
      const pres = ajusteProducto.presentaciones.find((p) => p.id === ajustePresentacionId);
      if (pres && pres.unidades > 1) {
        factor = pres.unidades;
      }
    }
    const unidadesTotales = Math.round(qty * factor);

    if (ajusteTipo === "Salida" && unidadesTotales > ajusteProducto.stock) {
      Alert.alert(
        "Stock Insuficiente",
        `No puedes registrar una salida de ${unidadesTotales} unidades porque el stock actual es de ${ajusteProducto.stock}.`
      );
      return;
    }

    setAjusteSubmitting(true);
    try {
      const res = await registrarAjusteKardexCloud([
        {
          producto_id: ajusteProducto.id,
          tipo: ajusteTipo,
          cantidad: qty,
          motivo: ajusteMotivo.trim() || "Ajuste manual",
          presentacion_id: ajustePresentacionId || null,
        },
      ]);

      if (res.success) {
        showToast("Ajuste de inventario registrado con éxito", "success");
        setModalAjusteKardexVisible(false);
        setAjusteProducto(null);
        setAjustePresentacionId(null);
        setAjusteCantidad("1");
        setAjusteMotivo("Ajuste manual");
        setAjusteSearchProd("");
        loadKardex();
        refreshLocalState();
      } else {
        Alert.alert("Error al registrar ajuste", res.error || "Ocurrió un error");
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Error al conectar con el servidor");
    } finally {
      setAjusteSubmitting(false);
    }
  }, [ajusteProducto, ajusteCantidad, ajustePresentacionId, ajusteTipo, ajusteMotivo, showToast, loadKardex, refreshLocalState]);

  // Carga de Reportes
  const loadReportes = useCallback(async () => {
    setReportesLoading(true);
    try {
      let fechaInicio = "";
      let fechaFin = "";
      const now = new Date();
      const toIsoDate = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };

      if (reportesPreset === "hoy") {
        fechaInicio = toIsoDate(now);
        fechaFin = toIsoDate(now);
      } else if (reportesPreset === "mes") {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        fechaInicio = toIsoDate(firstDay);
        fechaFin = toIsoDate(now);
      } else if (reportesPreset === "anio") {
        const firstDay = new Date(now.getFullYear(), 0, 1);
        fechaInicio = toIsoDate(firstDay);
        fechaFin = toIsoDate(now);
      }

      const res = await fetchReportesCloud({
        tipo: reportesTab,
        fecha_inicio: fechaInicio || undefined,
        fecha_fin: fechaFin || undefined,
      });

      if (res) {
        setReportesData(res);
        if (!reportesMonedaCod) {
          const keys = Object.keys(res).filter((k) => !k.startsWith("__"));
          if (keys.length > 0) {
            setReportesMonedaCod(keys[0]);
          }
        }
      }
    } catch (e: any) {
      console.warn("Error cargando reportes:", e);
    } finally {
      setReportesLoading(false);
    }
  }, [reportesTab, reportesPreset, reportesMonedaCod]);

  useEffect(() => {
    if (route === "reportes") {
      loadReportes();
    }
  }, [route, loadReportes]);

  // ── CARGADORES Y CONTROLADORES DE TODOS LOS MÓDULOS WEB/ESCRITORIO ──
  const catalogExtrasLoadedRef = useRef(false);
  const loadCatalogExtras = useCallback(async (force = false) => {
    if (catalogExtrasLoadedRef.current && !force) {
      return;
    }
    catalogExtrasLoadedRef.current = true;
    try {
      const [locCats, locMrcs, locProvs] = await Promise.all([
        getLocalCategorias(),
        getLocalMarcas(),
        getLocalProveedores(),
      ]);
      if (locCats.length > 0) setCategoriasCloud(locCats);
      if (locMrcs.length > 0) setMarcasCloud(locMrcs);
      if (locProvs.length > 0) setProveedoresList(locProvs);

      // Carga remota en segundo plano sin congelar la UI ni re-consultar todo el estado local
      fetchCategoriasCloud()
        .then((cats) => {
          if (cats && cats.length > 0) setCategoriasCloud(cats);
        })
        .catch(() => {});
      fetchMarcasCloud()
        .then((mrcs) => {
          if (mrcs && mrcs.length > 0) setMarcasCloud(mrcs);
        })
        .catch(() => {});
      fetchProveedoresCloud()
        .then((provs) => {
          if (provs && provs.length > 0) setProveedoresList(provs);
        })
        .catch(() => {});
    } catch (e) {
      console.warn("loadCatalogExtras error:", e);
    }
  }, []);

  const loadCompras = useCallback(async () => {
    setComprasLoading(true);
    try {
      const [res, provs] = await Promise.all([fetchComprasCloud(), fetchProveedoresCloud()]);
      setComprasList(res.compras);
      setCompraItemsList(res.items);
      if (provs.length > 0) setProveedoresList(provs);
    } finally {
      setComprasLoading(false);
    }
  }, []);

  const loadRetornos = useCallback(async () => {
    setRetornosLoading(true);
    try {
      const [res, provs] = await Promise.all([fetchRetornosCloud(), fetchProveedoresCloud()]);
      setRetornosList(res.retornos);
      setRetornoItemsList(res.items);
      if (provs.length > 0) setProveedoresList(provs);
    } finally {
      setRetornosLoading(false);
    }
  }, []);

  const loadTransacciones = useCallback(async () => {
    setTransaccionesLoading(true);
    try {
      const [list, cjs] = await Promise.all([fetchTransaccionesCloud(), fetchCajasCloud()]);
      setTransaccionesList(list);
      if (Array.isArray(cjs)) setCajasCloud(cjs);
    } finally {
      setTransaccionesLoading(false);
    }
  }, []);

  const loadProveedores = useCallback(async () => {
    setProvLoading(true);
    try {
      const localProvs = await getLocalProveedores();
      if (localProvs.length > 0 && !provSearch.trim()) {
        setProveedoresList(localProvs);
      }
      const list = await fetchProveedoresCloud(provSearch);
      if (list.length > 0 || provSearch.trim()) {
        setProveedoresList(list);
      }
    } finally {
      setProvLoading(false);
    }
  }, [provSearch]);

  const loadConfigAndEmpresa = useCallback(async () => {
    try {
      const rows = await fetchConfiguracionEmpresaCloud();
      if (Array.isArray(rows) && rows.length > 0) {
        const map: Record<string, string> = {};
        for (const r of rows) {
          if (r?.clave) map[String(r.clave)] = String(r.valor ?? "");
        }
        setEmpresaConfig((prev) => ({ ...prev, ...map }));
      }
      setCfgModoVentas(
        cfgGlobal.metodo_conversion_ventas === "triangulacion" ? "triangulacion" : "directa"
      );
      setCfgModoCompras(
        cfgGlobal.metodo_conversion_compras === "triangulacion" ? "triangulacion" : "directa"
      );
      setCfgRedondearVentas(Boolean(cfgGlobal.redondeo_activo));
    } catch {}
  }, [cfgGlobal]);

  const loadUsuariosAdmin = useCallback(async () => {
    setUsuariosLoading(true);
    try {
      const res = await fetchUsuariosAdminCloud();
      setUsuariosList(res.users);
    } finally {
      setUsuariosLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    if (route === "productos" || route === "categorias" || route === "marcas") {
      loadCatalogExtras();
    } else if (route === "compras") {
      loadCompras();
    } else if (route === "retornos") {
      loadRetornos();
    } else if (route === "transacciones") {
      loadTransacciones();
    } else if (route === "proveedores") {
      loadProveedores();
    } else if (route === "metodos_pago") {
      fetchMetodosPagoCloud()
        .then((mps) => {
          if (mps && mps.length > 0) setMetodosPago(mps);
          else getLocalMetodosPago().then(setMetodosPago);
        })
        .catch(() => {
          getLocalMetodosPago().then(setMetodosPago);
        });
      loadCajas();
    } else if (route === "config" || route === "monedas") {
      loadConfigAndEmpresa();
    } else if (route === "usuarios") {
      loadUsuariosAdmin();
    }
  }, [
    route,
    session,
    loadCatalogExtras,
    loadCompras,
    loadRetornos,
    loadTransacciones,
    loadProveedores,
    loadConfigAndEmpresa,
    loadUsuariosAdmin,
    loadCajas,
  ]);

  // 1. PRODUCTOS CRUD (Clon 1:1 de src/components/producto/producto-modal.tsx en PC/Web)
  const PRESENTACIONES_SUGERIDAS = useMemo(
    () => [
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
    ],
    []
  );

  const prodCostoMoneda = useMemo(
    () =>
      monedas.find((m) => String(m.id) === String(prodFormMonedaCostoId)) ||
      baseMonedaSistema ||
      monedas[0] ||
      null,
    [monedas, prodFormMonedaCostoId, baseMonedaSistema]
  );

  const prodVentaMoneda = useMemo(
    () =>
      monedas.find((m) => String(m.id) === String(prodFormMonedaPrecioId)) ||
      baseMonedaSistema ||
      monedas[0] ||
      null,
    [monedas, prodFormMonedaPrecioId, baseMonedaSistema]
  );

  const prodDecVenta = Number(prodVentaMoneda?.decimales ?? 2);
  const prodDecCosto = Number(prodCostoMoneda?.decimales ?? 2);

  const costoEnMonedaVentaActual = useCallback(
    (
      preciosState: Record<string, { precioCompra: string; precioVenta: string }>,
      cMonId: string | null = prodFormMonedaCostoId,
      vMonId: string | null = prodFormMonedaPrecioId
    ): number => {
      if (!cMonId || !vMonId) return 0;
      const cMon = monedas.find((m) => String(m.id) === String(cMonId));
      const vMon = monedas.find((m) => String(m.id) === String(vMonId));
      if (!cMon || !vMon) return 0;
      const costoRaw = parseFloat(
        (preciosState[String(cMon.id)]?.precioCompra || "").replace(",", ".")
      );
      if (isNaN(costoRaw) || costoRaw <= 0) return 0;
      return convertirConRegla(costoRaw, cMon, vMon, "compras", Number(vMon.decimales ?? 2));
    },
    [monedas, prodFormMonedaCostoId, prodFormMonedaPrecioId, convertirConRegla]
  );

  const prodMargenReal = useMemo<number | null>(() => {
    if (!prodVentaMoneda) return null;
    const pv = parseFloat(
      (prodFormPreciosPorMoneda[String(prodVentaMoneda.id)]?.precioVenta || "").replace(",", ".")
    );
    const costoEnVenta = costoEnMonedaVentaActual(
      prodFormPreciosPorMoneda,
      prodFormMonedaCostoId,
      prodFormMonedaPrecioId
    );
    if (!Number.isFinite(pv) || pv <= 0 || !Number.isFinite(costoEnVenta) || costoEnVenta <= 0) {
      return null;
    }
    return redondear(((pv - costoEnVenta) / costoEnVenta) * 100, 2);
  }, [
    prodVentaMoneda,
    prodFormPreciosPorMoneda,
    costoEnMonedaVentaActual,
    prodFormMonedaCostoId,
    prodFormMonedaPrecioId,
    redondear,
  ]);

  const prodPrecioRedondeadoSugerido = useMemo<{ precio: number; multiplo: number } | null>(() => {
    if (!cfgGlobal.redondeo_activo || !prodVentaMoneda) return null;
    const mult = Number(cfgGlobal.redondeo_multiplo) || 0;
    if (mult <= 0) return null;
    const actual = parseFloat(
      (prodFormPreciosPorMoneda[String(prodVentaMoneda.id)]?.precioVenta || "").replace(",", ".")
    );
    if (isNaN(actual) || actual <= 0) return null;
    const cociente = actual / mult;
    let redondeado = Math.round(cociente) * mult;
    const costoEnVenta = costoEnMonedaVentaActual(
      prodFormPreciosPorMoneda,
      prodFormMonedaCostoId,
      prodFormMonedaPrecioId
    );
    if (cfgGlobal.redondeo_no_bajar_de_costo !== false && costoEnVenta > 0 && redondeado < costoEnVenta) {
      redondeado = Math.ceil(costoEnVenta / mult - 1e-9) * mult;
    }
    redondeado = redondear(redondeado, prodDecVenta);
    if (Math.abs(redondeado - actual) < 1e-9) return null;
    return { precio: redondeado, multiplo: mult };
  }, [
    cfgGlobal,
    prodVentaMoneda,
    prodFormPreciosPorMoneda,
    costoEnMonedaVentaActual,
    prodFormMonedaCostoId,
    prodFormMonedaPrecioId,
    redondear,
    prodDecVenta,
  ]);

  const handleProdPrecioVentaChange = useCallback(
    (monedaId: string, val: string) => {
      const changedMoneda = monedas.find((m) => String(m.id) === String(monedaId));
      if (!changedMoneda) return;
      const numVal = parseFloat(val.replace(",", "."));
      setProdFormPreciosPorMoneda((prev) => {
        const next = { ...prev };
        next[String(monedaId)] = {
          ...(next[String(monedaId)] || { precioCompra: "", precioVenta: "" }),
          precioVenta: val,
        };
        if (!isNaN(numVal) && numVal >= 0) {
          for (const m of monedas) {
            if (String(m.id) === String(monedaId)) continue;
            const dec = Number(m.decimales ?? 2);
            const conv = convertirConRegla(numVal, changedMoneda, m, "ventas", dec);
            next[String(m.id)] = {
              ...(next[String(m.id)] || { precioCompra: "", precioVenta: "" }),
              precioVenta: String(conv),
            };
          }
        } else if (val === "") {
          for (const m of monedas) {
            if (String(m.id) === String(monedaId)) continue;
            next[String(m.id)] = {
              ...(next[String(m.id)] || { precioCompra: "", precioVenta: "" }),
              precioVenta: "",
            };
          }
        }
        if (String(monedaId) === String(prodFormMonedaPrecioId)) {
          const costoEnVenta = costoEnMonedaVentaActual(
            next,
            prodFormMonedaCostoId,
            prodFormMonedaPrecioId
          );
          if (numVal > 0 && costoEnVenta > 0) {
            const mCalc = redondear(((numVal - costoEnVenta) / costoEnVenta) * 100, 2);
            setProdFormGanancia(String(Math.max(0, mCalc)));
          }
        }
        return next;
      });
    },
    [
      monedas,
      convertirConRegla,
      prodFormMonedaPrecioId,
      prodFormMonedaCostoId,
      costoEnMonedaVentaActual,
      redondear,
    ]
  );

  const handleProdPrecioCompraChange = useCallback(
    (monedaId: string, val: string) => {
      const changedMoneda = monedas.find((m) => String(m.id) === String(monedaId));
      if (!changedMoneda) return;
      const numVal = parseFloat(val.replace(",", "."));
      setProdFormPreciosPorMoneda((prev) => {
        const next = { ...prev };
        next[String(monedaId)] = {
          ...(next[String(monedaId)] || { precioCompra: "", precioVenta: "" }),
          precioCompra: val,
        };
        if (!isNaN(numVal) && numVal >= 0) {
          for (const m of monedas) {
            if (String(m.id) === String(monedaId)) continue;
            const dec = Number(m.decimales ?? 2);
            const conv = convertirConRegla(numVal, changedMoneda, m, "compras", dec);
            next[String(m.id)] = {
              ...(next[String(m.id)] || { precioCompra: "", precioVenta: "" }),
              precioCompra: String(conv),
            };
          }
        } else if (val === "") {
          for (const m of monedas) {
            if (String(m.id) === String(monedaId)) continue;
            next[String(m.id)] = {
              ...(next[String(m.id)] || { precioCompra: "", precioVenta: "" }),
              precioCompra: "",
            };
          }
        }

        // Si hay margen configurado, recalcular el precio de venta desde el nuevo costo
        const mNum = parseFloat(prodFormGanancia.replace(",", "."));
        if (
          String(monedaId) === String(prodFormMonedaCostoId) &&
          prodFormMonedaPrecioId &&
          prodFormGanancia.trim() !== "" &&
          !isNaN(mNum) &&
          mNum >= 0
        ) {
          const vMon = monedas.find((m) => String(m.id) === String(prodFormMonedaPrecioId));
          if (vMon && !isNaN(numVal) && numVal > 0) {
            const decV = Number(vMon.decimales ?? 2);
            const costoEnVenta = convertirConRegla(numVal, changedMoneda, vMon, "compras", decV);
            const nuevoPv = redondear(costoEnVenta * (1 + mNum / 100), decV);
            next[String(vMon.id)] = {
              ...(next[String(vMon.id)] || { precioCompra: "", precioVenta: "" }),
              precioVenta: String(nuevoPv),
            };
            for (const m of monedas) {
              if (String(m.id) === String(vMon.id)) continue;
              const dec = Number(m.decimales ?? 2);
              const convV = convertirConRegla(nuevoPv, vMon, m, "ventas", dec);
              next[String(m.id)] = {
                ...(next[String(m.id)] || { precioCompra: "", precioVenta: "" }),
                precioVenta: String(convV),
              };
            }
          }
        }
        return next;
      });
    },
    [
      monedas,
      convertirConRegla,
      prodFormGanancia,
      prodFormMonedaCostoId,
      prodFormMonedaPrecioId,
      redondear,
    ]
  );

  const handleProdMargenChange = useCallback(
    (val: string) => {
      setProdFormGanancia(val);
      const m = parseFloat(val.replace(",", "."));
      if (isNaN(m) || m < 0 || !prodFormMonedaPrecioId) return;
      const vMon = monedas.find((x) => String(x.id) === String(prodFormMonedaPrecioId));
      if (!vMon) return;
      const costoEnVenta = costoEnMonedaVentaActual(
        prodFormPreciosPorMoneda,
        prodFormMonedaCostoId,
        prodFormMonedaPrecioId
      );
      if (costoEnVenta <= 0) return;
      const decV = Number(vMon.decimales ?? 2);
      const nuevoPrecio = redondear(costoEnVenta * (1 + m / 100), decV);
      setProdFormPreciosPorMoneda((prev) => {
        const next = { ...prev };
        next[String(vMon.id)] = {
          ...(next[String(vMon.id)] || { precioCompra: "", precioVenta: "" }),
          precioVenta: String(nuevoPrecio),
        };
        for (const mon of monedas) {
          if (String(mon.id) === String(vMon.id)) continue;
          const dec = Number(mon.decimales ?? 2);
          const conv = convertirConRegla(nuevoPrecio, vMon, mon, "ventas", dec);
          next[String(mon.id)] = {
            ...(next[String(mon.id)] || { precioCompra: "", precioVenta: "" }),
            precioVenta: String(conv),
          };
        }
        return next;
      });
    },
    [
      prodFormMonedaPrecioId,
      prodFormMonedaCostoId,
      monedas,
      costoEnMonedaVentaActual,
      prodFormPreciosPorMoneda,
      redondear,
      convertirConRegla,
    ]
  );

  const handleSelectProdCostoMoneda = useCallback(
    (monedaId: string) => {
      setProdFormMonedaCostoId(monedaId);
      const currentVal = prodFormPreciosPorMoneda[monedaId]?.precioCompra;
      if (currentVal && parseFloat(currentVal.replace(",", ".")) > 0) {
        handleProdPrecioCompraChange(monedaId, currentVal);
      }
    },
    [prodFormPreciosPorMoneda, handleProdPrecioCompraChange]
  );

  const handleSelectProdVentaMoneda = useCallback(
    (monedaId: string) => {
      setProdFormMonedaPrecioId(monedaId);
      const currentVal = prodFormPreciosPorMoneda[monedaId]?.precioVenta;
      if (currentVal && parseFloat(currentVal.replace(",", ".")) > 0) {
        handleProdPrecioVentaChange(monedaId, currentVal);
      }
    },
    [prodFormPreciosPorMoneda, handleProdPrecioVentaChange]
  );

  // Funciones de Presentaciones (Cajas, Bolsas, Paquetes...) idénticas a PC
  const prodPrecioUnidadVenta = useCallback((): number => {
    if (!prodVentaMoneda) return 0;
    const raw = prodFormPreciosPorMoneda[String(prodVentaMoneda.id)]?.precioVenta ?? "";
    const n = parseFloat(raw.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [prodVentaMoneda, prodFormPreciosPorMoneda]);

  const prodPrecioUnidadCosto = useCallback((): number => {
    if (!prodCostoMoneda) return 0;
    const raw = prodFormPreciosPorMoneda[String(prodCostoMoneda.id)]?.precioCompra ?? "";
    const n = parseFloat(raw.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [prodCostoMoneda, prodFormPreciosPorMoneda]);

  const prodCostoCppUnidadEnMonedaVenta = useCallback((): number => {
    if (!prodVentaMoneda) return 0;
    const cppBase = Number(prodFullCloud?.costo_promedio_base);
    if (Number.isFinite(cppBase) && cppBase > 0 && baseMonedaSistema) {
      return convertirConRegla(cppBase, baseMonedaSistema, prodVentaMoneda, "compras", 6);
    }
    return costoEnMonedaVentaActual(
      prodFormPreciosPorMoneda,
      prodFormMonedaCostoId,
      prodFormMonedaPrecioId
    );
  }, [
    prodVentaMoneda,
    prodFullCloud,
    baseMonedaSistema,
    convertirConRegla,
    costoEnMonedaVentaActual,
    prodFormPreciosPorMoneda,
    prodFormMonedaCostoId,
    prodFormMonedaPrecioId,
  ]);

  const precioSegunModoProd = useCallback(
    (
      p: {
        modo_venta: "derivado" | "fijo" | "margen";
        precio_override: string;
        margen_override: string;
      },
      unidades: number
    ) => {
      const u = prodPrecioUnidadVenta();
      const derivado = redondear(u * unidades, prodDecVenta);
      const costoCaja = redondear(prodCostoCppUnidadEnMonedaVenta() * unidades, prodDecVenta);
      let precio = derivado;

      if (p.modo_venta === "fijo") {
        const f = parseFloat((p.precio_override || "").replace(",", "."));
        precio = Number.isFinite(f) && f >= 0 ? redondear(f, prodDecVenta) : 0;
      } else if (p.modo_venta === "margen") {
        const m = parseFloat((p.margen_override || "").replace(",", "."));
        precio =
          Number.isFinite(m) && m >= 0 && costoCaja > 0
            ? redondear(costoCaja * (1 + m / 100), prodDecVenta)
            : 0;
      }

      const precioUnitario = unidades > 0 ? redondear(precio / unidades, prodDecVenta) : 0;
      const margen =
        precio > 0 && costoCaja > 0
          ? redondear(((precio - costoCaja) / costoCaja) * 100, 2)
          : null;
      const bajoCosto = costoCaja > 0 && precio > 0 && precio < costoCaja;
      return { precio, precioUnitario, costo: costoCaja, margen, bajoCosto };
    },
    [prodPrecioUnidadVenta, prodCostoCppUnidadEnMonedaVenta, redondear, prodDecVenta]
  );

  const cambiarPrecioPresentacionVenta = useCallback(
    (valor: string, unidades: number) => {
      if (!prodVentaMoneda || !(Number.isInteger(unidades) && unidades > 1)) return;
      const n = parseFloat(valor.replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) {
        handleProdPrecioVentaChange(String(prodVentaMoneda.id), "");
        return;
      }
      const unitario = redondear(n / unidades, prodDecVenta);
      handleProdPrecioVentaChange(String(prodVentaMoneda.id), String(unitario));
    },
    [prodVentaMoneda, handleProdPrecioVentaChange, redondear, prodDecVenta]
  );

  const cambiarPrecioPresentacionCosto = useCallback(
    (valor: string, unidades: number) => {
      if (!prodCostoMoneda || !(Number.isInteger(unidades) && unidades > 1)) return;
      const n = parseFloat(valor.replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) {
        handleProdPrecioCompraChange(String(prodCostoMoneda.id), "");
        return;
      }
      const unitario = redondear(n / unidades, prodDecCosto);
      handleProdPrecioCompraChange(String(prodCostoMoneda.id), String(unitario));
    },
    [prodCostoMoneda, handleProdPrecioCompraChange, redondear, prodDecCosto]
  );

  const agregarPresentacionDesdePicker = useCallback(() => {
    const n = prodNuevaPresNombre.trim();
    const u = parseInt(prodNuevaPresUnidades, 10);
    if (!n) {
      setProdFormError("Elige o escribe el nombre de la presentación (ej: Caja, Bolsa)");
      return;
    }
    if (!Number.isInteger(u) || u <= 1) {
      setProdFormError(`Indica cuántas unidades trae "${n}" (entero mayor a 1)`);
      return;
    }
    if (prodFormPresentaciones.some((p) => p.nombre.trim().toLowerCase() === n.toLowerCase())) {
      setProdFormError(`La presentación "${n}" ya está en la lista`);
      return;
    }
    const cod = prodNuevaPresCodigo.trim();
    if (cod && prodVerifNuevaPres.estado === "ocupado") {
      setProdFormError(
        prodVerifNuevaPres.mensaje || "Ese código de barras ya está en uso en el catálogo"
      );
      return;
    }
    setProdFormError("");
    setProdFormPresentaciones((prev) => [
      ...prev,
      {
        key: `pres-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        nombre: n,
        unidades: String(u),
        activo: true,
        codigoBarras: cod,
        modo_venta: "derivado",
        precio_override: "",
        margen_override: "",
      },
    ]);
    setProdNuevaPresNombre("");
    setProdNuevaPresUnidades("");
    setProdNuevaPresCodigo("");
  }, [
    prodNuevaPresNombre,
    prodNuevaPresUnidades,
    prodNuevaPresCodigo,
    prodFormPresentaciones,
    prodVerifNuevaPres,
  ]);

  const actualizarPresentacionProd = useCallback(
    (
      key: string,
      patch: Partial<{
        nombre: string;
        unidades: string;
        activo: boolean;
        codigoBarras: string;
        modo_venta: "derivado" | "fijo" | "margen";
        precio_override: string;
        margen_override: string;
      }>
    ) => {
      setProdFormPresentaciones((prev) => {
        const next = prev.map((p) => (p.key === key ? { ...p, ...patch } : p));
        if (patch.unidades !== undefined && key === prodFormStockUnidadId) {
          const f = parseInt(patch.unidades, 10);
          const factor = Number.isInteger(f) && f > 1 ? f : 1;
          const cant = parseFloat(prodFormStockTexto.replace(",", "."));
          setProdFormStock(
            Number.isFinite(cant) && cant >= 0 ? Math.round(cant * factor) : 0
          );
        }
        return next;
      });
    },
    [prodFormStockUnidadId, prodFormStockTexto]
  );

  const eliminarPresentacionProd = useCallback(
    (key: string) => {
      setProdFormPresentaciones((prev) => prev.filter((p) => p.key !== key));
      if (prodFormStockUnidadId === key) {
        setProdFormStockUnidadId("");
        setProdFormStockTexto(String(prodFormStock));
      }
    },
    [prodFormStockUnidadId, prodFormStock]
  );

  // Stock con Presentaciones (Unidades vs Cajas/Paquetes) idéntico a PC
  const factorDeStockProd = useCallback(
    (unidadId: string): number => {
      if (!unidadId) return 1;
      const p = prodFormPresentaciones.find((x) => x.key === unidadId);
      const u = p ? parseInt(p.unidades, 10) : NaN;
      return Number.isInteger(u) && u > 1 ? u : 1;
    },
    [prodFormPresentaciones]
  );

  const teclearStockProd = useCallback(
    (txt: string) => {
      setProdFormStockTexto(txt);
      const factor = factorDeStockProd(prodFormStockUnidadId);
      const n = parseFloat(txt.replace(",", "."));
      setProdFormStock(Number.isFinite(n) && n >= 0 ? Math.round(n * factor) : 0);
    },
    [factorDeStockProd, prodFormStockUnidadId]
  );

  const cambiarUnidadStockProd = useCallback(
    (nuevoId: string) => {
      const nuevoFactor = factorDeStockProd(nuevoId);
      setProdFormStockUnidadId(nuevoId);
      if (prodFormStock <= 0) {
        setProdFormStockTexto("0");
        return;
      }
      const convertido = prodFormStock / nuevoFactor;
      setProdFormStockTexto(
        Number.isInteger(convertido) ? String(convertido) : String(redondear(convertido, 2))
      );
    },
    [factorDeStockProd, prodFormStock, redondear]
  );

  // Verificación en vivo de códigos de barras (Producto + Cajas) igual que en PC
  useEffect(() => {
    if (!prodModalOpen || prodModalMode === "view") return;
    const limpio = prodFormCodigo.trim();
    if (!limpio) {
      setProdVerifCodigo({ estado: "vacio", mensaje: "" });
      return;
    }
    setProdVerifCodigo({ estado: "verificando", mensaje: "" });
    const t = setTimeout(async () => {
      const res = await verificarCodigoProductoCloud({
        tipo: "producto",
        codigos: [limpio],
        excluirProductoId: editingProd?.id ?? null,
      });
      const r = res[limpio];
      if (!r) {
        setProdVerifCodigo({ estado: "vacio", mensaje: "" });
      } else if (r.disponible) {
        setProdVerifCodigo({ estado: "libre", mensaje: "Código disponible" });
      } else {
        setProdVerifCodigo({
          estado: "ocupado",
          mensaje: r.mensaje || "Este código ya está en uso",
        });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [prodFormCodigo, prodModalOpen, prodModalMode, editingProd?.id]);

  useEffect(() => {
    if (!prodModalOpen || prodModalMode === "view") return;
    const limpio = prodNuevaPresCodigo.trim();
    if (!limpio) {
      setProdVerifNuevaPres({ estado: "vacio", mensaje: "" });
      return;
    }
    if (
      prodFormCodigo.trim() &&
      limpio.toLowerCase() === prodFormCodigo.trim().toLowerCase()
    ) {
      setProdVerifNuevaPres({
        estado: "ocupado",
        mensaje: "Es el mismo código del producto",
      });
      return;
    }
    const repetida = prodFormPresentaciones.find(
      (p) => p.codigoBarras.trim().toLowerCase() === limpio.toLowerCase()
    );
    if (repetida) {
      setProdVerifNuevaPres({
        estado: "ocupado",
        mensaje: `Ya lo pusiste en "${repetida.nombre || "otra presentación"}"`,
      });
      return;
    }
    setProdVerifNuevaPres({ estado: "verificando", mensaje: "" });
    const t = setTimeout(async () => {
      const res = await verificarCodigoProductoCloud({
        tipo: "caja",
        codigos: [limpio],
        excluirProductoId: editingProd?.id ?? null,
      });
      const r = res[limpio];
      if (!r) {
        setProdVerifNuevaPres({ estado: "vacio", mensaje: "" });
      } else if (r.disponible) {
        setProdVerifNuevaPres({ estado: "libre", mensaje: "Código disponible" });
      } else {
        setProdVerifNuevaPres({
          estado: "ocupado",
          mensaje: r.mensaje || "Este código ya está en uso",
        });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [
    prodNuevaPresCodigo,
    prodFormCodigo,
    prodFormPresentaciones,
    prodModalOpen,
    prodModalMode,
    editingProd?.id,
  ]);

  const applyProductoDataToForm = useCallback(
    (prodObj: any, baseM: LocalMoneda | undefined) => {
      const defMonId = String(baseM?.id || monedas[0]?.id || "1");
      const vId = prodObj.moneda_base_id ? String(prodObj.moneda_base_id) : defMonId;
      const cId = prodObj.moneda_costo_id
        ? String(prodObj.moneda_costo_id)
        : vId;
      setProdFormCodigo(prodObj.codigo || "");
      setProdFormNombre(prodObj.nombre || "");
      setProdFormDesc(prodObj.descripcion || "");
      setProdFormCatId(prodObj.categoria_id ? String(prodObj.categoria_id) : "");
      setProdFormMarcaId(prodObj.marca_id ? String(prodObj.marca_id) : "");

      const provIdsArr: string[] =
        Array.isArray(prodObj.proveedores) && prodObj.proveedores.length > 0
          ? prodObj.proveedores.map((pv: any) => String(pv.id))
          : prodObj.proveedor_id
          ? [String(prodObj.proveedor_id)]
          : [];
      setProdFormProvIds(provIdsArr);

      const st = Number(prodObj.stock ?? 0);
      setProdFormStock(st);
      setProdFormStockTexto(String(st));
      setProdFormStockUnidadId("");
      setProdFormStockMin(String(prodObj.stock_minimo ?? 5));
      setProdFormActivo(prodObj.activo !== false && prodObj.activo !== 0);
      setProdFormIvaIncluido(prodObj.iva_incluido !== false && prodObj.iva_incluido !== 0);
      setProdFormMonedaPrecioId(vId);
      setProdFormMonedaCostoId(cId);

      // Construir diccionario preciosPorMoneda
      const mapPrecios: Record<string, { precioCompra: string; precioVenta: string }> = {};
      const vMonObj = monedas.find((m) => String(m.id) === vId) || baseM || monedas[0];
      const cMonObj = monedas.find((m) => String(m.id) === cId) || vMonObj;
      const pvBase = Number(prodObj.precio_base) || 0;
      const pcBase = Number(prodObj.costo_base) || 0;

      for (const m of monedas) {
        const fromServer = Array.isArray(prodObj.precios)
          ? prodObj.precios.find((pr: any) => String(pr.moneda_id) === String(m.id))
          : null;
        if (fromServer) {
          mapPrecios[String(m.id)] = {
            precioCompra: String(fromServer.costo ?? 0),
            precioVenta: String(fromServer.precio ?? 0),
          };
        } else {
          const dec = Number(m.decimales ?? 2);
          const pvConv = vMonObj
            ? convertirConRegla(pvBase, vMonObj, m, "ventas", dec)
            : pvBase;
          const pcConv = cMonObj
            ? convertirConRegla(pcBase, cMonObj, m, "compras", dec)
            : pcBase;
          mapPrecios[String(m.id)] = {
            precioCompra: String(pcConv),
            precioVenta: String(pvConv),
          };
        }
      }
      setProdFormPreciosPorMoneda(mapPrecios);

      const margenGuardado = Number(prodObj.margen_ganancia);
      if (Number.isFinite(margenGuardado) && margenGuardado > 0) {
        setProdFormGanancia(String(margenGuardado));
      } else {
        const costoEnV =
          vMonObj && cMonObj
            ? convertirConRegla(pcBase, cMonObj, vMonObj, "compras", Number(vMonObj.decimales ?? 2))
            : pcBase;
        const mCalc =
          pvBase > 0 && costoEnV > 0
            ? redondear(((pvBase - costoEnV) / costoEnV) * 100, 2)
            : null;
        setProdFormGanancia(mCalc !== null && mCalc > 0 ? String(mCalc) : "");
      }

      setProdFormPresentaciones(
        (prodObj.presentaciones || []).map((pr: any, idx: number) => ({
          key: pr.id ? String(pr.id) : `pres-${idx}-${Date.now()}`,
          id: pr.id ? String(pr.id) : undefined,
          nombre: pr.nombre || "Caja",
          unidades: String(pr.unidades ?? pr.unidades_por_venta ?? 2),
          activo: pr.activo !== false,
          codigoBarras: pr.codigo ?? "",
          modo_venta:
            pr.modo_venta === "fijo" || pr.modo_venta === "margen"
              ? pr.modo_venta
              : "derivado",
          precio_override: pr.precio_override != null ? String(pr.precio_override) : "",
          margen_override: pr.margen_override != null ? String(pr.margen_override) : "",
        }))
      );
    },
    [monedas, convertirConRegla, redondear]
  );

  const openProductoModal = useCallback(
    (
      prod: LocalProducto | null = null,
      codigoInicial = "",
      modeOverride?: "create" | "edit" | "view"
    ) => {
      const targetMode = modeOverride || (prod ? "edit" : "create");
      setProdModalMode(targetMode);
      setProdFormStep(1);
      setProdFormError("");
      setEditingProd(prod);
      setProdFullCloud(prod || null);
      setProdNuevaPresNombre("");
      setProdNuevaPresUnidades("");
      setProdNuevaPresCodigo("");
      setProdVerifCodigo({ estado: "vacio", mensaje: "" });
      setProdVerifNuevaPres({ estado: "vacio", mensaje: "" });
      setProdVerifCajas({});

      // Asegurar que categorías, marcas y proveedores estén cargados (solo si no se han cargado antes)
      if (!catalogExtrasLoadedRef.current) {
        loadCatalogExtras();
      }

      const baseM = monedas.find((m) => m.es_base === 1) || monedas[0];
      const defMonId = String(baseM?.id || "1");

      if (prod) {
        applyProductoDataToForm(prod, baseM);
        // En segundo plano consultar el detalle enriquecido del servidor (descripción, marca_id, proveedores N:M, margen_ganancia, presentaciones completas)
        fetchProductoFullCloud({ id: prod.id, codigo: prod.codigo }).then((full) => {
          if (full) {
            const merged = {
              ...prod,
              ...full,
              descripcion: full.descripcion ?? prod.descripcion ?? null,
              categoria_id: full.categoria_id ?? prod.categoria_id ?? null,
              categoria_nombre: full.categoria_nombre || prod.categoria_nombre || null,
              marca_id: full.marca_id ?? prod.marca_id ?? null,
              marca_nombre: full.marca_nombre || prod.marca_nombre || null,
              proveedor_id: full.proveedor_id ?? prod.proveedor_id ?? null,
              proveedor_nombre: full.proveedor_nombre || prod.proveedor_nombre || null,
              proveedores:
                Array.isArray(full.proveedores) && full.proveedores.length > 0
                  ? full.proveedores
                  : prod.proveedores || [],
            };
            setProdFullCloud(merged);
            applyProductoDataToForm(merged, baseM);
          }
        });
      } else {
        setProdFormCodigo(codigoInicial || "");
        setProdFormNombre("");
        setProdFormDesc("");
        setProdFormCatId("");
        setProdFormMarcaId("");
        setProdFormProvIds([]);
        setProdFormStock(0);
        setProdFormStockTexto("0");
        setProdFormStockUnidadId("");
        setProdFormStockMin("5");
        setProdFormActivo(true);
        setProdFormIvaIncluido(true);
        setProdFormMonedaPrecioId(defMonId);
        setProdFormMonedaCostoId(defMonId);
        setProdFormGanancia("");
        const emptyMap: Record<string, { precioCompra: string; precioVenta: string }> = {};
        for (const m of monedas) {
          emptyMap[String(m.id)] = { precioCompra: "", precioVenta: "" };
        }
        setProdFormPreciosPorMoneda(emptyMap);
        setProdFormPresentaciones([]);
      }
      setProdModalOpen(true);
    },
    [
      monedas,
      loadCatalogExtras,
      applyProductoDataToForm,
    ]
  );

  const validateStep1Prod = useCallback((): boolean => {
    if (!prodFormCodigo.trim()) {
      setProdFormError("El código es requerido");
      return false;
    }
    if (prodVerifCodigo.estado === "ocupado") {
      setProdFormError(prodVerifCodigo.mensaje || "Ese código ya está en uso");
      return false;
    }
    if (!prodFormNombre.trim()) {
      setProdFormError("El nombre es requerido");
      return false;
    }
    setProdFormError("");
    return true;
  }, [prodFormCodigo, prodVerifCodigo, prodFormNombre]);

  const validateStep2Prod = useCallback((): boolean => {
    if (!prodFormMonedaCostoId) {
      setProdFormError("Debes elegir una moneda de compra");
      return false;
    }
    if (!prodFormMonedaPrecioId) {
      setProdFormError("Debes elegir una moneda de venta");
      return false;
    }
    const pcVal = parseFloat(
      (prodFormPreciosPorMoneda[prodFormMonedaCostoId]?.precioCompra || "").replace(",", ".")
    );
    if (isNaN(pcVal) || pcVal < 0) {
      setProdFormError("Ingresa un precio de compra válido en la moneda de compra");
      return false;
    }
    const pvVal = parseFloat(
      (prodFormPreciosPorMoneda[prodFormMonedaPrecioId]?.precioVenta || "").replace(",", ".")
    );
    const mVal = parseFloat((prodFormGanancia || "").replace(",", "."));
    const tienePrecioManual = !isNaN(pvVal) && pvVal > 0;
    const puedeAutoCalcular = !isNaN(mVal) && mVal >= 0 && pcVal > 0;
    if (!tienePrecioManual && !puedeAutoCalcular) {
      setProdFormError("Ingresa un precio de venta mayor a 0 o un margen de ganancia (%)");
      return false;
    }
    const vistos = new Set<string>();
    const codigosVistos = new Set<string>();
    const codProd = prodFormCodigo.trim().toLowerCase();
    for (const p of prodFormPresentaciones) {
      const n = p.nombre.trim();
      if (!n) continue;
      const clave = n.toLowerCase();
      if (vistos.has(clave)) {
        setProdFormError(`La presentación "${n}" está repetida`);
        return false;
      }
      vistos.add(clave);
      const u = parseInt(p.unidades, 10);
      if (!Number.isInteger(u) || u <= 1) {
        setProdFormError(`Presentación "${n}": las unidades deben ser un número entero mayor a 1`);
        return false;
      }
      const cod = p.codigoBarras.trim();
      if (cod) {
        const codClave = cod.toLowerCase();
        if (codProd && codClave === codProd) {
          setProdFormError(
            `La presentación "${n}" no puede tener el mismo código de barras que el producto`
          );
          return false;
        }
        if (codigosVistos.has(codClave)) {
          setProdFormError(
            `El código de barras "${cod}" está repetido en las presentaciones de este producto`
          );
          return false;
        }
        codigosVistos.add(codClave);
      }
      if (p.modo_venta === "fijo") {
        const f = parseFloat((p.precio_override || "").replace(",", "."));
        if (!Number.isFinite(f) || f <= 0) {
          setProdFormError(`Presentación "${n}": en modo "precio fijo" indica un precio mayor a 0`);
          return false;
        }
      }
      if (p.modo_venta === "margen") {
        const m = parseFloat((p.margen_override || "").replace(",", "."));
        if (!Number.isFinite(m) || m < 0) {
          setProdFormError(`Presentación "${n}": en modo "por margen" indica un porcentaje ≥ 0`);
          return false;
        }
      }
    }
    setProdFormError("");
    return true;
  }, [
    prodFormMonedaCostoId,
    prodFormMonedaPrecioId,
    prodFormPreciosPorMoneda,
    prodFormGanancia,
    prodFormCodigo,
    prodFormPresentaciones,
  ]);

  const nextStepProd = useCallback(() => {
    if (prodFormStep === 1 && !validateStep1Prod()) return;
    if (prodFormStep === 2 && !validateStep2Prod()) return;
    setProdFormStep((s) => (Math.min(s + 1, 3) as 1 | 2 | 3));
  }, [prodFormStep, validateStep1Prod, validateStep2Prod]);

  const prevStepProd = useCallback(() => {
    setProdFormError("");
    setProdFormStep((s) => (Math.max(s - 1, 1) as 1 | 2 | 3));
  }, []);

  const handleSaveProducto = useCallback(async () => {
    if (!validateStep1Prod()) {
      setProdFormStep(1);
      return;
    }
    if (!validateStep2Prod()) {
      setProdFormStep(2);
      return;
    }

    const preciosClean: Record<string, { precio: number; costo: number }> = {};
    for (const m of monedas) {
      const p = prodFormPreciosPorMoneda[String(m.id)];
      preciosClean[String(m.id)] = {
        precio: parseFloat((p?.precioVenta || "0").replace(",", ".")) || 0,
        costo: parseFloat((p?.precioCompra || "0").replace(",", ".")) || 0,
      };
    }

    const costoBaseVal = prodFormMonedaCostoId
      ? preciosClean[prodFormMonedaCostoId]?.costo || 0
      : 0;
    const margenVal = Math.max(0, parseFloat((prodFormGanancia || "0").replace(",", ".")) || 0);
    let precioBaseVal = prodFormMonedaPrecioId
      ? preciosClean[prodFormMonedaPrecioId]?.precio || 0
      : 0;

    if (precioBaseVal <= 0 && margenVal >= 0 && costoBaseVal > 0 && prodVentaMoneda) {
      const costoEnV = costoEnMonedaVentaActual(
        prodFormPreciosPorMoneda,
        prodFormMonedaCostoId,
        prodFormMonedaPrecioId
      );
      precioBaseVal = redondear(costoEnV * (1 + margenVal / 100), prodDecVenta);
      if (prodFormMonedaPrecioId && preciosClean[prodFormMonedaPrecioId]) {
        preciosClean[prodFormMonedaPrecioId].precio = precioBaseVal;
      }
    }

    const provIdsClean = prodFormProvIds
      .map((id) => String(id).trim())
      .filter((id) => id.length > 0);

    const presentacionesClean = prodFormPresentaciones
      .filter((p) => p.nombre.trim().length > 0)
      .map((p) => {
        const modo = p.modo_venta ?? "derivado";
        const po = parseFloat((p.precio_override || "").replace(",", "."));
        const mo = parseFloat((p.margen_override || "").replace(",", "."));
        const cod = p.codigoBarras.trim();
        return {
          ...(p.id ? { id: String(p.id) } : {}),
          nombre: p.nombre.trim(),
          unidades: parseInt(p.unidades, 10),
          activo: p.activo,
          codigo: cod.length > 0 ? cod : null,
          modo_venta: modo,
          precio_override: modo === "fijo" && Number.isFinite(po) ? po : null,
          margen_override: modo === "margen" && Number.isFinite(mo) ? mo : null,
        };
      });

    setSavingProd(true);
    try {
      await saveProductoCloud({
        id: prodModalMode === "edit" && editingProd?.id ? editingProd.id : undefined,
        codigo: prodFormCodigo.trim(),
        nombre: prodFormNombre.trim(),
        descripcion: prodFormDesc.trim() || null,
        categoria_id: prodFormCatId || null,
        marca_id: prodFormMarcaId || null,
        proveedor_ids: provIdsClean,
        proveedor_id: provIdsClean[0] ?? null,
        stock: Math.max(0, Math.round(prodFormStock || 0)),
        stock_minimo: Math.max(0, parseInt(prodFormStockMin, 10) || 0),
        activo: prodFormActivo,
        iva_incluido: prodFormIvaIncluido,
        moneda_base_id: prodFormMonedaPrecioId || null,
        moneda_costo_id: prodFormMonedaCostoId || prodFormMonedaPrecioId || null,
        precio_base: precioBaseVal,
        costo_base: costoBaseVal,
        margen_ganancia: margenVal,
        precios: preciosClean,
        presentaciones: presentacionesClean,
      });
      setProdModalOpen(false);
      getLocalProductos(posSearchRef.current).then(setProductos);
      runSilentSync();
      showToast(
        prodModalMode === "edit"
          ? "Producto actualizado exitosamente"
          : "Producto creado exitosamente",
        "success"
      );
    } catch (e: any) {
      const msg = e?.message || "Error al guardar producto";
      setProdFormError(msg);
      showToast(msg, "error");
    } finally {
      setSavingProd(false);
    }
  }, [
    validateStep1Prod,
    validateStep2Prod,
    monedas,
    prodFormPreciosPorMoneda,
    prodFormMonedaCostoId,
    prodFormMonedaPrecioId,
    prodFormGanancia,
    prodVentaMoneda,
    costoEnMonedaVentaActual,
    redondear,
    prodDecVenta,
    prodFormProvIds,
    prodFormPresentaciones,
    prodModalMode,
    editingProd,
    prodFormCodigo,
    prodFormNombre,
    prodFormDesc,
    prodFormCatId,
    prodFormMarcaId,
    prodFormStock,
    prodFormStockMin,
    prodFormActivo,
    prodFormIvaIncluido,
    runSilentSync,
    showToast,
  ]);

  const handleDeleteProducto = useCallback(
    (prod: LocalProducto) => {
      Alert.alert(
        "Eliminar Producto",
        `¿Estás seguro de que deseas eliminar el producto "${prod.nombre}" (${prod.codigo})?\n\nSi ya tiene transacciones asociadas, se moverá de forma segura al Basurero.`,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Eliminar",
            style: "destructive",
            onPress: async () => {
              // Actualización optimista inmediata en la UI
              setProductos((prev) => prev.filter((p) => String(p.id) !== String(prod.id)));
              showToast("Producto eliminado", "info");
              try {
                await deleteProductoCloud(prod.id);
                runSilentSync();
              } catch (e: any) {
                getLocalProductos(posSearchRef.current).then(setProductos);
                showToast(e?.message || "No se pudo eliminar el producto", "error");
              }
            },
          },
        ]
      );
    },
    [runSilentSync, showToast]
  );

  // 2. CATEGORÍAS CRUD (con autoselección cuando se crea desde el modal de Producto)
  const openCategoriaModal = useCallback((cat: any | null = null) => {
    setEditingCat(cat);
    setCatFormNombre(cat?.nombre || "");
    setCatFormDesc(cat?.descripcion || "");
    setCatModalOpen(true);
  }, []);

  const handleSaveCategoria = useCallback(async () => {
    if (!catFormNombre.trim()) {
      showToast("El nombre de la categoría es obligatorio", "error");
      return;
    }
    setSavingCat(true);
    try {
      const saved = await saveCategoriaCloud({
        id: editingCat?.id || undefined,
        nombre: catFormNombre.trim(),
        descripcion: catFormDesc.trim() || null,
        activa: true,
      });
      setCatModalOpen(false);
      await loadCatalogExtras(true);
      if (!editingCat && saved?.id) {
        setProdFormCatId(String(saved.id));
      }
      showToast(editingCat ? "Categoría actualizada" : "Categoría creada", "success");
    } catch (e: any) {
      showToast(e?.message || "Error al guardar categoría", "error");
    } finally {
      setSavingCat(false);
    }
  }, [editingCat, catFormNombre, catFormDesc, loadCatalogExtras, showToast]);

  const handleDeleteCategoria = useCallback(
    (cat: any) => {
      Alert.alert("Eliminar Categoría", `¿Eliminar la categoría "${cat.nombre}"?`, [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            // Actualización optimista inmediata en la UI
            setCategoriasCloud((prev) => prev.filter((c) => String(c.id) !== String(cat.id)));
            setCategorias((prev) => prev.filter((c) => String(c.id) !== String(cat.id)));
            showToast("Categoría eliminada", "info");
            try {
              await deleteCategoriaCloud(cat.id);
            } catch (e: any) {
              loadCatalogExtras(true);
              showToast(e?.message || "No se pudo eliminar", "error");
            }
          },
        },
      ]);
    },
    [loadCatalogExtras, showToast]
  );

  // 3. MARCAS CRUD (con autoselección cuando se crea desde el modal de Producto)
  const openMarcaModal = useCallback((marca: any | null = null) => {
    setEditingMarca(marca);
    setMarcaFormNombre(marca?.nombre || "");
    setMarcaFormDesc(marca?.pais || marca?.descripcion || "");
    setMarcaModalOpen(true);
  }, []);

  const handleSaveMarca = useCallback(async () => {
    if (!marcaFormNombre.trim()) {
      showToast("El nombre de la marca es obligatorio", "error");
      return;
    }
    setSavingMarca(true);
    try {
      const saved = await saveMarcaCloud({
        id: editingMarca?.id || undefined,
        nombre: marcaFormNombre.trim(),
        descripcion: marcaFormDesc.trim() || null,
        activo: true,
      });
      setMarcaModalOpen(false);
      await loadCatalogExtras(true);
      if (!editingMarca && saved?.id) {
        setProdFormMarcaId(String(saved.id));
      }
      showToast(editingMarca ? "Marca actualizada" : "Marca creada", "success");
    } catch (e: any) {
      showToast(e?.message || "Error al guardar marca", "error");
    } finally {
      setSavingMarca(false);
    }
  }, [editingMarca, marcaFormNombre, marcaFormDesc, loadCatalogExtras, showToast]);

  const handleDeleteMarca = useCallback(
    (marca: any) => {
      Alert.alert("Eliminar Marca", `¿Eliminar la marca "${marca.nombre}"?`, [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            // Actualización optimista inmediata en la UI
            setMarcasCloud((prev) => prev.filter((m) => String(m.id) !== String(marca.id)));
            showToast("Marca eliminada", "info");
            try {
              await deleteMarcaCloud(marca.id);
            } catch (e: any) {
              loadCatalogExtras(true);
              showToast(e?.message || "No se pudo eliminar la marca", "error");
            }
          },
        },
      ]);
    },
    [loadCatalogExtras, showToast]
  );

  // 4. PROVEEDORES CRUD (con autoselección N:M cuando se crea desde el modal de Producto)
  const openProveedorModal = useCallback((prov: any | null = null) => {
    setEditingProv(prov);
    setProvFormNombre(prov?.nombre || "");
    setProvFormDoc(prov?.rif || prov?.documento || "");
    setProvFormContacto(prov?.contacto || "");
    setProvFormTel(prov?.telefono || "");
    setProvFormEmail(prov?.email || "");
    setProvFormCiudad(prov?.ciudad || "");
    setProvFormDir(prov?.direccion || "");
    setProvFormNotas(prov?.notas || "");
    setProvModalOpen(true);
  }, []);

  const handleSaveProveedor = useCallback(async () => {
    if (!provFormNombre.trim()) {
      showToast("El nombre del proveedor es obligatorio", "error");
      return;
    }
    setSavingProv(true);
    try {
      const saved = await saveProveedorCloud({
        id: editingProv?.id || undefined,
        nombre: provFormNombre.trim(),
        documento: provFormDoc.trim() || null,
        contacto: provFormContacto.trim() || null,
        telefono: provFormTel.trim() || null,
        email: provFormEmail.trim() || null,
        ciudad: provFormCiudad.trim() || null,
        direccion: provFormDir.trim() || null,
        notas: provFormNotas.trim() || null,
        activo: true,
      });
      setProvModalOpen(false);
      await loadProveedores();
      if (!editingProv && saved?.id) {
        const sid = String(saved.id);
        setProdFormProvIds((prev) => (prev.includes(sid) ? prev : [...prev, sid]));
      }
      showToast(editingProv ? "Proveedor actualizado" : "Proveedor registrado", "success");
    } catch (e: any) {
      showToast(e?.message || "Error al guardar proveedor", "error");
    } finally {
      setSavingProv(false);
    }
  }, [
    editingProv,
    provFormNombre,
    provFormDoc,
    provFormContacto,
    provFormTel,
    provFormEmail,
    provFormCiudad,
    provFormDir,
    provFormNotas,
    loadProveedores,
    showToast,
  ]);

  const handleDeleteProveedor = useCallback(
    (prov: any) => {
      Alert.alert("Eliminar Proveedor", `¿Eliminar a "${prov.nombre}"?`, [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            // Actualización optimista inmediata en la UI
            setProveedoresList((prev) => prev.filter((p) => String(p.id) !== String(prov.id)));
            showToast("Proveedor eliminado", "info");
            try {
              await deleteProveedorCloud(prov.id);
            } catch (e: any) {
              await loadProveedores();
              showToast(e?.message || "No se pudo eliminar el proveedor", "error");
            }
          },
        },
      ]);
    },
    [loadProveedores, showToast]
  );

  // 5. COMPRAS
  const openNuevaCompraModal = useCallback(() => {
    const baseM = monedas.find((m) => m.es_base === 1) || monedas[0];
    setNcProveedorId(proveedoresList[0]?.id ? String(proveedoresList[0].id) : "");
    setNcMonedaId(String(baseM?.id || "1"));
    setNcTipoPago("contado");
    setNcMetodoPagoId(metodosPago[0]?.id ? String(metodosPago[0].id) : "");
    setNcAbonoInicial("");
    setNcReferencia("");
    setNcObs("");
    setNcSearchProd("");
    setNcItems([]);
    setNuevaCompraModalOpen(true);
  }, [monedas, proveedoresList, metodosPago]);

  const addProductoToCompra = useCallback((prod: LocalProducto) => {
    setNcItems((prev) => {
      const idx = prev.findIndex((x) => x.producto.id === prod.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = {
          ...copy[idx],
          cantidadStr: String((parseFloat(copy[idx].cantidadStr) || 1) + 1),
        };
        return copy;
      }
      return [
        ...prev,
        {
          producto: prod,
          cantidadStr: "1",
          costoUnitStr: String(Number(prod.costo_base || prod.precio_base || 1)),
        },
      ];
    });
  }, []);

  const handleSaveCompra = useCallback(async () => {
    if (ncItems.length === 0) {
      showToast("Agrega al menos un producto a la compra", "error");
      return;
    }
    const itemsValidos = ncItems
      .map((it) => ({
        producto_id: it.producto.id,
        cantidad: Math.max(1, Math.round(parseFloat(it.cantidadStr) || 1)),
        costo_unit: Math.max(0.01, parseFloat(it.costoUnitStr.replace(",", ".")) || 0),
      }))
      .filter((x) => x.cantidad > 0 && x.costo_unit > 0);

    if (itemsValidos.length === 0) {
      showToast("Verifica las cantidades y costos unitarios", "error");
      return;
    }
    const mpObj = metodosPago.find((m) => String(m.id) === String(ncMetodoPagoId));
    setSavingCompra(true);
    try {
      await crearCompraCloud({
        proveedor_id: ncProveedorId || null,
        moneda_id: ncMonedaId || String(baseMonedaSistema?.id || "1"),
        tipo_pago: ncTipoPago,
        metodo_pago_id: ncTipoPago !== "credito" ? ncMetodoPagoId || null : null,
        caja_id: ncTipoPago !== "credito" ? mpObj?.caja_id || cajaSeleccionada || null : null,
        abono_inicial:
          ncTipoPago === "parcial" ? parseFloat(ncAbonoInicial.replace(",", ".")) || 0 : undefined,
        referencia: ncReferencia.trim() || null,
        observaciones: ncObs.trim() || "Compra registrada desde App Móvil",
        items: itemsValidos,
      });
      setNuevaCompraModalOpen(false);
      await loadCompras();
      await runSilentSync();
      showToast("Compra registrada y stock actualizado", "success");
    } catch (e: any) {
      showToast(e?.message || "Error al registrar compra", "error");
    } finally {
      setSavingCompra(false);
    }
  }, [
    ncItems,
    ncProveedorId,
    ncMonedaId,
    ncTipoPago,
    ncMetodoPagoId,
    ncAbonoInicial,
    ncReferencia,
    ncObs,
    metodosPago,
    baseMonedaSistema,
    cajaSeleccionada,
    loadCompras,
    runSilentSync,
    showToast,
  ]);

  // 6. RETORNOS
  const openNuevoRetornoModal = useCallback(() => {
    setNrTipo("Cliente");
    setNrClienteId(clientes[0]?.id ? String(clientes[0].id) : "");
    setNrProveedorId(proveedoresList[0]?.id ? String(proveedoresList[0].id) : "");
    setNrMetodoReembolso("efectivo");
    setNrMetodoPagoId(metodosPago[0]?.id ? String(metodosPago[0].id) : "");
    setNrMotivo("Devolución de mercancía");
    setNrObs("");
    setNrSearchProd("");
    setNrItems([]);
    setNuevoRetornoModalOpen(true);
  }, [clientes, proveedoresList, metodosPago]);

  const addProductoToRetorno = useCallback((prod: LocalProducto) => {
    setNrItems((prev) => {
      const idx = prev.findIndex((x) => x.producto.id === prod.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = {
          ...copy[idx],
          cantidadStr: String((parseFloat(copy[idx].cantidadStr) || 1) + 1),
        };
        return copy;
      }
      return [
        ...prev,
        {
          producto: prod,
          cantidadStr: "1",
          precioUnitStr: String(Number(prod.precio_base || 1)),
        },
      ];
    });
  }, []);

  const handleSaveRetorno = useCallback(async () => {
    if (nrItems.length === 0) {
      showToast("Agrega al menos un producto al retorno", "error");
      return;
    }
    const mpObj = metodosPago.find((m) => String(m.id) === String(nrMetodoPagoId));
    setSavingRetorno(true);
    try {
      await crearRetornoCloud({
        tipo: nrTipo,
        cliente_id: nrTipo === "Cliente" ? nrClienteId || null : null,
        proveedor_id: nrTipo === "Proveedor" ? nrProveedorId || null : null,
        motivo: nrMotivo.trim() || "Devolución",
        observaciones: nrObs.trim() || null,
        metodo_reembolso: nrMetodoReembolso,
        metodo_pago_id: nrMetodoReembolso === "efectivo" ? nrMetodoPagoId || null : null,
        caja_id: nrMetodoReembolso === "efectivo" ? mpObj?.caja_id || cajaSeleccionada || null : null,
        items: nrItems.map((it) => ({
          producto_id: it.producto.id,
          cantidad: Math.max(1, Math.round(parseFloat(it.cantidadStr) || 1)),
          precio_unit: Math.max(0, parseFloat(it.precioUnitStr.replace(",", ".")) || 0),
        })),
      });
      setNuevoRetornoModalOpen(false);
      await loadRetornos();
      await runSilentSync();
      showToast("Retorno registrado exitosamente", "success");
    } catch (e: any) {
      showToast(e?.message || "Error al registrar retorno", "error");
    } finally {
      setSavingRetorno(false);
    }
  }, [
    nrItems,
    nrTipo,
    nrClienteId,
    nrProveedorId,
    nrMotivo,
    nrObs,
    nrMetodoReembolso,
    nrMetodoPagoId,
    metodosPago,
    cajaSeleccionada,
    loadRetornos,
    runSilentSync,
    showToast,
  ]);

  // ── RETORNO DIRECTO DESDE VENTA O COMPRA + ELIMINAR VENTA/COMPRA + PAGAR CRÉDITO ──
  const openRetornoDirectoFromVenta = useCallback(
    async (v: any, preloadedItems?: any[]) => {
      if (String(v.id).startsWith("local_") && v.sincronizado !== 1) {
        showToast("Sincroniza primero esta venta local con el servidor para retornar productos", "info");
        return;
      }

      let rawItems: any[] = Array.isArray(preloadedItems) && preloadedItems.length > 0 ? preloadedItems : [];
      if (rawItems.length === 0 && Array.isArray(v.local_items) && v.local_items.length > 0) {
        rawItems = v.local_items;
      }
      if (rawItems.length === 0 && v.items_json) {
        try {
          const parsed = typeof v.items_json === "string" ? JSON.parse(v.items_json) : v.items_json;
          if (Array.isArray(parsed) && parsed.length > 0) rawItems = parsed;
        } catch {}
      }
      if (rawItems.length === 0) {
        const dbItems = await getLocalVentaItemsByVentaId(String(v.id));
        if (dbItems && dbItems.length > 0) rawItems = dbItems;
      }
      if (rawItems.length === 0) {
        rawItems = ventaItemsRemotos.filter((i) => String(i.venta_id) === String(v.id));
      }
      if (rawItems.length === 0) {
        const cloudV = await fetchVentaDetalleCloud(String(v.id));
        if (cloudV && Array.isArray(cloudV.items)) {
          rawItems = cloudV.items;
        }
      }

      if (rawItems.length === 0) {
        showToast("No se encontraron productos en esta factura para retornar", "error");
        return;
      }

      const normalized = rawItems.map((it: any) => ({
        producto_id: Number(it.producto_id),
        producto_nombre: String(it.producto_nombre || it.nombre || `Producto #${it.producto_id}`),
        producto_codigo: it.producto_codigo || it.codigo || "",
        cantidad_original: Math.max(1, Number(it.cantidad) || 1),
        precio_unit: Number(it.precio_unit ?? it.precio ?? 0) || 0,
        presentacion_nombre: it.presentacion_nombre || null,
      }));

      const creditoMatch = (creditosData.creditos || []).find(
        (c) =>
          (c.venta_id && String(c.venta_id) === String(v.id)) ||
          (c.venta_numero && c.venta_numero === v.numero)
      );
      const tieneCredito =
        v.tipo_pago === "Credito" ||
        v.estado !== "Pagada" ||
        Boolean(creditoMatch && creditoMatch.saldo > 0.01);

      setRdItemsState(
        normalized.map((it) => ({
          producto_id: it.producto_id,
          cantidad: it.cantidad_original,
          seleccionado: true,
        }))
      );
      setRdAbonarCredito(tieneCredito);
      setRdMotivo("Devolución de mercancía");
      setVentaDetailModal(null);
      setRetornoDirectoModal({
        tipo: "Cliente",
        referenciaId: String(v.id),
        referenciaNumero: String(v.numero || ""),
        entidadId: v.cliente_id ? String(v.cliente_id) : creditoMatch?.cliente_id || null,
        entidadNombre: String(v.cliente_nombre || v.cliente || "Consumidor Final"),
        tipoPago: v.tipo_pago || "Contado",
        tieneCreditoPendiente: tieneCredito,
        monedaCodigo: v.moneda_codigo || monedaSeleccionada || "USD",
        items: normalized,
      });
    },
    [creditosData, monedaSeleccionada, showToast, ventaItemsRemotos]
  );

  const openRetornoDirectoFromCompra = useCallback(
    (c: any, preloadedItems?: any[]) => {
      const rawItems =
        Array.isArray(preloadedItems) && preloadedItems.length > 0
          ? preloadedItems
          : compraItemsList.filter((i: any) => String(i.compra_id) === String(c.id));

      if (rawItems.length === 0) {
        showToast("No hay productos cargados en esta compra para devolver", "error");
        return;
      }

      const normalized = rawItems.map((it: any) => ({
        producto_id: Number(it.producto_id),
        producto_nombre: String(it.producto_nombre || it.nombre || `Producto #${it.producto_id}`),
        producto_codigo: it.producto_codigo || it.codigo || "",
        cantidad_original: Math.max(1, Number(it.cantidad) || 1),
        precio_unit: Number(it.costo_unit ?? it.precio_unit ?? 0) || 0,
        presentacion_nombre: it.presentacion_nombre || null,
      }));

      const tieneCredito =
        c.tipo_pago === "Credito" ||
        c.tipo_pago === "credito" ||
        c.estado !== "Pagada" ||
        Number(c.saldo_pendiente) > 0.01;

      setRdItemsState(
        normalized.map((it) => ({
          producto_id: it.producto_id,
          cantidad: it.cantidad_original,
          seleccionado: true,
        }))
      );
      setRdAbonarCredito(tieneCredito);
      setRdMotivo("Devolución a proveedor");
      setCompraDetailModal(null);
      setRetornoDirectoModal({
        tipo: "Proveedor",
        referenciaId: String(c.id),
        referenciaNumero: String(c.numero || ""),
        entidadId: c.proveedor_id ? String(c.proveedor_id) : null,
        entidadNombre: String(c.proveedor_nombre || c.proveedor || "Sin proveedor"),
        tipoPago: c.tipo_pago || "Contado",
        tieneCreditoPendiente: tieneCredito,
        monedaCodigo: c.moneda_codigo || monedaSeleccionada || "USD",
        items: normalized,
      });
    },
    [compraItemsList, monedaSeleccionada, showToast]
  );

  const handleSubmitRetornoDirecto = useCallback(async () => {
    if (!retornoDirectoModal) return;
    const seleccionados = rdItemsState.filter((it) => it.seleccionado && it.cantidad > 0);
    if (seleccionados.length === 0) {
      showToast("Selecciona al menos un producto con cantidad mayor a 0", "error");
      return;
    }

    setRdSubmitting(true);
    try {
      const itemsPayload = seleccionados.map((sel) => {
        const orig = retornoDirectoModal.items.find((x) => x.producto_id === sel.producto_id);
        return {
          producto_id: sel.producto_id,
          cantidad: sel.cantidad,
          precio_unit: orig?.precio_unit || 0,
        };
      });

      await crearRetornoCloud({
        tipo: retornoDirectoModal.tipo,
        motivo: rdMotivo.trim() || `Retorno de ${retornoDirectoModal.referenciaNumero}`,
        ...(retornoDirectoModal.tipo === "Cliente"
          ? {
              venta_id: retornoDirectoModal.referenciaId,
              cliente_id: retornoDirectoModal.entidadId,
            }
          : {
              compra_id: retornoDirectoModal.referenciaId,
              proveedor_id: retornoDirectoModal.entidadId,
            }),
        abonar_credito: retornoDirectoModal.tieneCreditoPendiente ? rdAbonarCredito : false,
        items: itemsPayload,
      });

      setRetornoDirectoModal(null);
      await runSilentSync();
      await refreshLocalState(posSearch);
      if (route === "compras") await loadCompras();
      if (route === "retornos") await loadRetornos();
      showToast(
        `Retorno registrado exitosamente (${retornoDirectoModal.referenciaNumero})`,
        "success"
      );
    } catch (e: any) {
      showToast(e?.message || "No se pudo registrar el retorno", "error");
    } finally {
      setRdSubmitting(false);
    }
  }, [
    retornoDirectoModal,
    rdItemsState,
    rdMotivo,
    rdAbonarCredito,
    runSilentSync,
    refreshLocalState,
    posSearch,
    route,
    loadCompras,
    loadRetornos,
    showToast,
  ]);

  const handleDeleteVenta = useCallback(
    (v: any) => {
      if (String(v.id).startsWith("local_") && v.sincronizado !== 1) {
        showToast("Sincroniza primero esta venta local antes de anularla", "info");
        return;
      }
      Alert.alert(
        "Eliminar / Anular Venta",
        `¿Estás seguro de eliminar la factura ${v.numero}?\n\nSe revertirá el stock de los productos, el movimiento de caja y el crédito asociado.`,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Eliminar Venta",
            style: "destructive",
            onPress: async () => {
              // Actualización optimista inmediata en la UI
              setVentasLocales((prev) => prev.filter((item) => String(item.id) !== String(v.id)));
              setVentasRemotas((prev) => prev.filter((item) => String(item.id) !== String(v.id)));
              setVentaDetailModal(null);
              showToast(`Venta ${v.numero} eliminada y stock revertido`, "info");
              try {
                await eliminarVentaCloud(v.id);
                runSilentSync();
              } catch (e: any) {
                runSilentSync();
                showToast(e?.message || "No se pudo eliminar la venta", "error");
              }
            },
          },
        ]
      );
    },
    [runSilentSync, showToast]
  );

  const handleDeleteCompra = useCallback(
    (c: any) => {
      Alert.alert(
        "Eliminar Compra",
        `¿Estás seguro de eliminar la compra ${c.numero}?\n\nSe descontará el stock ingresado y se revertirá el movimiento de caja.`,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Eliminar Compra",
            style: "destructive",
            onPress: async () => {
              // Actualización optimista inmediata en la UI
              setComprasList((prev) => prev.filter((item) => String(item.id) !== String(c.id)));
              setCompraDetailModal(null);
              showToast(`Compra ${c.numero} eliminada`, "info");
              try {
                await eliminarCompraCloud(c.id);
                loadCompras();
                runSilentSync();
              } catch (e: any) {
                loadCompras();
                showToast(e?.message || "No se pudo eliminar la compra", "error");
              }
            },
          },
        ]
      );
    },
    [loadCompras, runSilentSync, showToast]
  );

  // 7. TRANSACCIONES DE CAJA Y NUEVA CAJA
  const openNuevaTransModal = useCallback(() => {
    const firstCaja =
      cajasCloud.find((c) => c.estado === "Abierta") || cajasCloud[0] || cajas[0];
    setNtCajaId(firstCaja ? String(firstCaja.id) : "");
    setNtTipo("Entrada");
    setNtMonto("");
    setNtDesc("");
    setNuevaTransModalOpen(true);
  }, [cajasCloud, cajas]);

  const handleSaveTransaccion = useCallback(async () => {
    const montoVal = parseFloat(ntMonto.replace(",", ".")) || 0;
    if (!ntCajaId || montoVal <= 0 || !ntDesc.trim()) {
      showToast("Selecciona caja, monto > 0 y descripción", "error");
      return;
    }
    setSavingTrans(true);
    try {
      await crearTransaccionCloud({
        caja_id: ntCajaId,
        tipo: ntTipo,
        monto: montoVal,
        descripcion: ntDesc.trim(),
      });
      setNuevaTransModalOpen(false);
      await loadTransacciones();
      showToast(`${ntTipo} de caja registrada`, "success");
    } catch (e: any) {
      showToast(e?.message || "Error al registrar transacción", "error");
    } finally {
      setSavingTrans(false);
    }
  }, [ntCajaId, ntTipo, ntMonto, ntDesc, loadTransacciones, showToast]);

  const handleCreateNuevaCaja = useCallback(async () => {
    if (!ncajaNombre.trim() || !ncajaMonedaId) {
      showToast("Ingresa el nombre y la moneda de la caja", "error");
      return;
    }
    setSavingNuevaCaja(true);
    try {
      await crearCajaCloud({
        nombre: ncajaNombre.trim(),
        moneda_id: ncajaMonedaId,
      });
      setNuevaCajaModalOpen(false);
      setNcajaNombre("");
      await loadCajas();
      await runSilentSync();
      showToast("Caja creada y abierta exitosamente", "success");
    } catch (e: any) {
      showToast(e?.message || "Error al crear caja", "error");
    } finally {
      setSavingNuevaCaja(false);
    }
  }, [ncajaNombre, ncajaMonedaId, loadCajas, runSilentSync, showToast]);

  // 8. MONEDAS Y TASAS
  const openMonedaModal = useCallback((mon: LocalMoneda | null = null) => {
    setEditingMoneda(mon);
    if (mon) {
      setMonFormNombre(mon.nombre);
      setMonFormCodigo(mon.codigo);
      setMonFormSimbolo(mon.simbolo);
      setMonFormTasa(String(mon.tasa ?? 1));
      setMonFormDecimales(String(mon.decimales ?? 2));
      setMonFormUsaDirecta(Boolean(mon.usa_tasa_usd_directa));
      setMonFormTasaDirecta(mon.tasa_usd_directa ? String(mon.tasa_usd_directa) : String(mon.tasa ?? 1));
    } else {
      setMonFormNombre("");
      setMonFormCodigo("");
      setMonFormSimbolo("$");
      setMonFormTasa("1");
      setMonFormDecimales("2");
      setMonFormUsaDirecta(false);
      setMonFormTasaDirecta("");
    }
    setMonedaModalOpen(true);
  }, []);

  const handleSaveMoneda = useCallback(async () => {
    if (!monFormNombre.trim() || !monFormCodigo.trim() || !monFormSimbolo.trim()) {
      showToast("Nombre, código y símbolo son obligatorios", "error");
      return;
    }
    const tasaVal = parseFloat(monFormTasa.replace(",", ".")) || 1;
    const tasaDirVal = parseFloat(monFormTasaDirecta.replace(",", ".")) || null;
    setSavingMoneda(true);
    try {
      await saveMonedaCloud({
        id: editingMoneda?.id || undefined,
        nombre: monFormNombre.trim(),
        codigo: monFormCodigo.trim().toUpperCase(),
        simbolo: monFormSimbolo.trim(),
        tasa: tasaVal,
        decimales: Math.max(0, Math.min(4, parseInt(monFormDecimales, 10) || 2)),
        usa_tasa_usd_directa: monFormUsaDirecta,
        tasa_usd_directa: monFormUsaDirecta ? tasaDirVal : null,
      });
      setMonedaModalOpen(false);
      await refreshLocalState(posSearch);
      await runSilentSync();
      showToast("Moneda y tasa actualizadas", "success");
    } catch (e: any) {
      showToast(e?.message || "Error al guardar moneda", "error");
    } finally {
      setSavingMoneda(false);
    }
  }, [
    editingMoneda,
    monFormNombre,
    monFormCodigo,
    monFormSimbolo,
    monFormTasa,
    monFormDecimales,
    monFormUsaDirecta,
    monFormTasaDirecta,
    refreshLocalState,
    posSearch,
    runSilentSync,
    showToast,
  ]);

  // 9. MÉTODOS DE PAGO
  const openMetodoPagoModal = useCallback(
    (mp: LocalMetodoPago | null = null) => {
      setEditingMp(mp);
      const defCaja = cajas[0]?.id ? String(cajas[0].id) : "";
      if (mp) {
        setMpFormNombre(mp.nombre);
        setMpFormTipo(mp.tipo || "Efectivo");
        setMpFormCajaId(mp.caja_id ? String(mp.caja_id) : defCaja);
        setMpFormActivo(true);
      } else {
        setMpFormNombre("");
        setMpFormTipo("Efectivo");
        setMpFormCajaId(defCaja);
        setMpFormActivo(true);
      }
      setMpModalOpen(true);
    },
    [cajas]
  );

  const handleSaveMetodoPago = useCallback(async () => {
    if (!mpFormNombre.trim() || !mpFormCajaId) {
      showToast("Nombre y caja asociada son obligatorios", "error");
      return;
    }
    setSavingMp(true);
    try {
      await saveMetodoPagoCloud({
        id: editingMp?.id || undefined,
        nombre: mpFormNombre.trim(),
        tipo: mpFormTipo,
        caja_id: mpFormCajaId,
        activo: mpFormActivo,
      });
      setMpModalOpen(false);
      fetchMetodosPagoCloud()
        .then((mps) => {
          if (mps && mps.length > 0) setMetodosPago(mps);
          else getLocalMetodosPago().then(setMetodosPago);
        })
        .catch(() => {
          getLocalMetodosPago().then(setMetodosPago);
        });
      showToast(editingMp ? "Método de pago actualizado" : "Método de pago creado", "success");
    } catch (e: any) {
      showToast(e?.message || "Error al guardar método de pago", "error");
    } finally {
      setSavingMp(false);
    }
  }, [editingMp, mpFormNombre, mpFormTipo, mpFormCajaId, mpFormActivo, showToast]);

  const handleDeleteMetodoPago = useCallback(
    (mp: LocalMetodoPago) => {
      Alert.alert("Eliminar Método de Pago", `¿Eliminar "${mp.nombre}"?`, [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            // Actualización optimista inmediata en la UI
            setMetodosPago((prev) => prev.filter((m) => String(m.id) !== String(mp.id)));
            showToast("Método de pago eliminado", "info");
            try {
              await deleteMetodoPagoCloud(mp.id);
            } catch (e: any) {
              getLocalMetodosPago().then(setMetodosPago);
              showToast(e?.message || "No se pudo eliminar", "error");
            }
          },
        },
      ]);
    },
    [showToast]
  );

  // 10. CONFIGURACIÓN GLOBAL, EMPRESA Y USUARIOS
  const handleSaveConfigGlobal = useCallback(async () => {
    setSavingConfigGlobal(true);
    try {
      await saveConfiguracionGlobalCloud({
        modo_conversion_ventas: cfgModoVentas,
        modo_conversion_compras: cfgModoCompras,
        redondear_conversion_ventas: cfgRedondearVentas,
        actualizar_precio_en_compra: cfgActualizarEnCompra,
        porcentaje_ganancia_defecto: parseFloat(cfgGananciaDefecto) || 30,
        iva_porcentaje: parseFloat(empresaConfig.iva_porcentaje || "16") || 16,
      });
      await refreshLocalState(posSearch);
      showToast("Reglas del motor de conversión guardadas", "success");
    } catch (e: any) {
      showToast(e?.message || "Error al guardar configuración global", "error");
    } finally {
      setSavingConfigGlobal(false);
    }
  }, [
    cfgModoVentas,
    cfgModoCompras,
    cfgRedondearVentas,
    cfgActualizarEnCompra,
    cfgGananciaDefecto,
    empresaConfig.iva_porcentaje,
    refreshLocalState,
    posSearch,
    showToast,
  ]);

  const handleRecalcularPrecios = useCallback(async () => {
    setRecalculandoPrecios(true);
    try {
      const res = await recalcularPreciosGlobalCloud();
      await runSilentSync();
      showToast(
        `Precios recalculados (${res?.actualizados ?? productos.length} productos actualizados)`,
        "success"
      );
    } catch (e: any) {
      showToast(e?.message || "Error al recalcular precios", "error");
    } finally {
      setRecalculandoPrecios(false);
    }
  }, [runSilentSync, productos.length, showToast]);

  const handleSaveEmpresaConfig = useCallback(async () => {
    setSavingConfigGlobal(true);
    try {
      const entries = Object.entries(empresaConfig);
      for (const [k, v] of entries) {
        await saveConfiguracionClaveCloud(k, String(v ?? ""), "empresa", k);
      }
      showToast("Datos de la empresa guardados", "success");
    } catch (e: any) {
      showToast(e?.message || "Error al guardar datos de empresa", "error");
    } finally {
      setSavingConfigGlobal(false);
    }
  }, [empresaConfig, showToast]);

  const openUsuarioModal = useCallback((usr: any | null = null) => {
    setEditingUsuario(usr);
    setUsrFormName(usr?.name || "");
    setUsrFormEmail(usr?.email || "");
    setUsrFormRole(usr?.role || "cajero");
    setUsrFormPassword("");
    setUsuarioModalOpen(true);
  }, []);

  const handleSaveUsuario = useCallback(async () => {
    if (!usrFormName.trim() || !usrFormEmail.trim()) {
      showToast("Nombre y correo son obligatorios", "error");
      return;
    }
    if (!editingUsuario && usrFormPassword.length < 8) {
      showToast("La contraseña debe tener mínimo 8 caracteres", "error");
      return;
    }
    setSavingUsuario(true);
    try {
      await saveUsuarioAdminCloud({
        id: editingUsuario?.id || undefined,
        name: usrFormName.trim(),
        email: usrFormEmail.trim().toLowerCase(),
        role: usrFormRole,
        password: usrFormPassword.trim() ? usrFormPassword.trim() : undefined,
      });
      setUsuarioModalOpen(false);
      await loadUsuariosAdmin();
      showToast(editingUsuario ? "Usuario actualizado" : "Usuario creado", "success");
    } catch (e: any) {
      showToast(e?.message || "Error al guardar usuario", "error");
    } finally {
      setSavingUsuario(false);
    }
  }, [editingUsuario, usrFormName, usrFormEmail, usrFormRole, usrFormPassword, loadUsuariosAdmin, showToast]);

  const handleDeleteUsuario = useCallback(
    (usr: any) => {
      Alert.alert("Eliminar Usuario", `¿Eliminar la cuenta de "${usr.name}"?`, [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            // Actualización optimista inmediata en la UI
            setUsuariosList((prev) => prev.filter((u) => String(u.id) !== String(usr.id)));
            showToast("Usuario eliminado", "info");
            try {
              await deleteUsuarioAdminCloud(String(usr.id));
            } catch (e: any) {
              await loadUsuariosAdmin();
              showToast(e?.message || "No se pudo eliminar el usuario", "error");
            }
          },
        },
      ]);
    },
    [loadUsuariosAdmin, showToast]
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

  const handlePagarVentaCredito = useCallback(
    (v: any) => {
      const creditoMatch = (creditosData.creditos || []).find(
        (c) =>
          (c.venta_id && String(c.venta_id) === String(v.id)) ||
          (c.venta_numero && c.venta_numero === v.numero)
      );
      if (creditoMatch) {
        setVentaDetailModal(null);
        openAbonoModal(creditoMatch);
        return;
      }
      if (v.cliente_id) {
        const cli = clientes.find((c) => String(c.id) === String(v.cliente_id));
        if (cli) {
          setVentaDetailModal(null);
          openPagoDeudaGlobal(cli, v.moneda_id);
          return;
        }
      }
      setVentaDetailModal(null);
      setRoute("creditos");
      showToast("Selecciona el crédito pendiente para registrar el abono", "info");
    },
    [creditosData.creditos, clientes, openAbonoModal, openPagoDeudaGlobal, showToast]
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

  const pagoDeudaTotalEnMonedaPago = useMemo(() => {
    if (!pagoDeudaMonedaObj) return 0;
    const dec = Number(pagoDeudaMonedaObj.decimales ?? 2);
    let total = 0;
    for (const cr of pagoDeudaPendientesFifo) {
      const mCr =
        monedas.find((m) => String(m.id) === String(cr.moneda_id) || m.codigo === cr.moneda_codigo) ||
        pagoDeudaMonedaObj;
      const saldo = Number(cr.saldo) || 0;
      if (String(mCr.id) === String(pagoDeudaMonedaObj.id)) {
        total += saldo;
      } else {
        total += convertirConRegla(saldo, mCr, pagoDeudaMonedaObj, "ventas", 6);
      }
    }
    const factor = Math.pow(10, dec);
    return Math.round((total + Number.EPSILON) * factor) / factor;
  }, [pagoDeudaPendientesFifo, pagoDeudaMonedaObj, monedas, convertirConRegla]);

  // Vista previa en vivo de cómo se reparte el abono global entre cada factura pendiente
  const pagoDeudaPreview = useMemo(() => {
    const val = parseFloat(pdMontoStr.replace(",", ".")) || 0;
    if (
      !pagoDeudaMonedaObj ||
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

    let pool = val;
    const lineas: Array<{
      credito: LocalCredito;
      estado: "completa" | "parcial" | "pendiente";
      monto: number;
    }> = [];

    for (const cr of pagoDeudaPendientesFifo) {
      const mCr =
        monedas.find((m) => String(m.id) === String(cr.moneda_id) || m.codigo === cr.moneda_codigo) ||
        pagoDeudaMonedaObj;
      const saldo = Number(cr.saldo) || 0;
      const esMisma = String(mCr.id) === String(pagoDeudaMonedaObj.id);
      const decCr = Number(mCr.decimales ?? 2);
      const costoEnMonedaPago = esMisma
        ? saldo
        : convertirConRegla(saldo, mCr, pagoDeudaMonedaObj, "ventas", 6);

      if (pool <= 0.0005) {
        lineas.push({ credito: cr, estado: "pendiente", monto: 0 });
        continue;
      }

      const isCompleta = pool >= (costoEnMonedaPago - 0.05);
      let takeCr: number;

      if (isCompleta) {
        takeCr = saldo;
        pool = Math.max(0, pool - costoEnMonedaPago);
      } else {
        takeCr = esMisma
          ? pool
          : convertirConRegla(pool, pagoDeudaMonedaObj, mCr, "ventas", decCr);
        takeCr = Math.min(takeCr, saldo);
        pool = 0;
      }

      lineas.push({
        credito: cr,
        estado: isCompleta ? "completa" : "parcial",
        monto: isCompleta ? saldo : takeCr,
      });
    }

    const restoBase =
      pool > 0.005 && baseMonedaSistema
        ? convertirConRegla(pool, pagoDeudaMonedaObj, baseMonedaSistema, "ventas", 6)
        : 0;

    return {
      lineas,
      restoBase,
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
    if (!pagoDeudaMonedaObj || pagoDeudaTotalEnMonedaPago <= 0) return;
    setPdMontoStr(String(pagoDeudaTotalEnMonedaPago));
  }, [pagoDeudaMonedaObj, pagoDeudaTotalEnMonedaPago]);

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
    categorias: "Categorías",
    marcas: "Marcas",
    compras: "Compras",
    retornos: "Retornos y Devoluciones",
    kardex: "Kardex de Inventario",
    cajas: "Cajas y Turnos",
    transacciones: "Transacciones de Caja",
    proveedores: "Proveedores",
    metodos_pago: "Métodos de Pago",
    monedas: "Monedas y Tasas",
    reportes: "Reportes y Estadísticas",
    usuarios: "Usuarios y Permisos",
    config: "Configuración del Sistema",
  };

  return (
    <View style={styles.appContainer}>
      <StatusBar barStyle="dark-content" backgroundColor={THEME.card} />

      {/* ── Topbar idéntico a PosBit v2.6 Web con layout protegido anti-desborde ── */}
      <View style={styles.topbar}>
        <View style={styles.topbarOrangeLine} />

        {/* Lado Izquierdo: Menú Hamburguesa + Título de Pantalla con flexShrink */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <TouchableOpacity
            style={styles.menuIconBtn}
            onPress={() => setDrawerOpen(true)}
            accessibilityLabel="Abrir menú"
          >
            <Feather name="menu" size={20} color={THEME.foreground} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.topbarBrand, { flex: 1, minWidth: 0 }]}
            onPress={() => setRoute(route === "pos" ? "dashboard" : "pos")}
          >
            <Image
              source={require("./assets/logo.png")}
              style={{ width: 28, height: 28, borderRadius: 7 }}
              resizeMode="contain"
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.topbarTitle} numberOfLines={1} ellipsizeMode="tail">
                {routeTitle[route]}
              </Text>
              <Text style={styles.topbarSubtitle} numberOfLines={1} ellipsizeMode="tail">
                PosBit · {monedaSeleccionada}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Lado Derecho: CloudSyncBadge + Botón Rápido POS (Siempre visibles y nunca se salen del contenedor) */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
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
              <Feather name="shopping-cart" size={13} color="#fff" />
              <Text style={styles.topbarPosShortBtnText}>POS</Text>
            </TouchableOpacity>
          )}
        </View>
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

      {/* ── MODAL LECTOR DE CÓDIGO DE BARRAS EN TIEMPO REAL (POS & VERIFICADOR) ── */}
      <Modal
        visible={showScannerModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowScannerModal(false)}
      >
        <View
          style={[
            styles.scannerModalRoot,
            scannerLowLightGlow && styles.scannerModalRootLowLightGlow,
          ]}
        >
          <StatusBar barStyle="light-content" backgroundColor="#000000" />

          {/* Barra Superior del Escáner */}
          <View style={styles.scannerTopHeader}>
            <TouchableOpacity
              style={styles.scannerCloseBtn}
              onPress={() => setShowScannerModal(false)}
            >
              <Feather name="x" size={18} color="#ffffff" />
              <Text style={styles.scannerCloseBtnText}>Cerrar</Text>
            </TouchableOpacity>

            <View style={{ alignItems: "center", flex: 1 }}>
              <Text style={styles.scannerHeaderTitle}>Escáner POS en Vivo</Text>
              <Text style={styles.scannerHeaderSub}>
                {scannerAntiBlurMode
                  ? "Nitidez Activa · Enfoque Macro"
                  : "13 formatos 1D/2D activos"}
              </Text>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <TouchableOpacity
                style={[
                  styles.scannerIconPillBtn,
                  scannerTorch && styles.scannerIconPillBtnActive,
                ]}
                onPress={() => setScannerTorch((v) => !v)}
              >
                <Feather
                  name={scannerTorch ? "zap" : "zap-off"}
                  size={16}
                  color={scannerTorch ? "#1c1917" : "#ffffff"}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.scannerIconPillBtn}
                onPress={() =>
                  setScannerFacing((f) => (f === "back" ? "front" : "back"))
                }
              >
                <Feather name="refresh-cw" size={15} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Selector de Modo de Escaneo (Ráfaga POS / 1 Escaneo / Consultar Precio) */}
          <View style={styles.scannerModeTabsRow}>
            <TouchableOpacity
              style={[
                styles.scannerModeTab,
                scannerMode === "rafaga" && styles.scannerModeTabActive,
              ]}
              onPress={() => setScannerMode("rafaga")}
            >
              <Feather
                name="zap"
                size={13}
                color={scannerMode === "rafaga" ? "#ffffff" : "#d6d3ce"}
              />
              <Text
                style={[
                  styles.scannerModeTabText,
                  scannerMode === "rafaga" && styles.scannerModeTabTextActive,
                ]}
              >
                Ráfaga POS
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.scannerModeTab,
                scannerMode === "unico" && styles.scannerModeTabActive,
              ]}
              onPress={() => setScannerMode("unico")}
            >
              <Feather
                name="check-circle"
                size={13}
                color={scannerMode === "unico" ? "#ffffff" : "#d6d3ce"}
              />
              <Text
                style={[
                  styles.scannerModeTabText,
                  scannerMode === "unico" && styles.scannerModeTabTextActive,
                ]}
              >
                1 Escaneo
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.scannerModeTab,
                scannerMode === "consulta" && styles.scannerModeTabActive,
              ]}
              onPress={() => setScannerMode("consulta")}
            >
              <Feather
                name="tag"
                size={13}
                color={scannerMode === "consulta" ? "#ffffff" : "#d6d3ce"}
              />
              <Text
                style={[
                  styles.scannerModeTabText,
                  scannerMode === "consulta" && styles.scannerModeTabTextActive,
                ]}
              >
                Ver Precio
              </Text>
            </TouchableOpacity>
          </View>

          {/* Cuerpo Principal: Permiso o Cámara en Tiempo Real */}
          {!cameraPermission?.granted ? (
            <View style={styles.scannerPermissionBox}>
              <View style={styles.scannerPermissionIconCircle}>
                <Feather name="camera" size={34} color={THEME.primary} />
              </View>
              <Text style={styles.scannerPermissionTitle}>
                Activar Cámara para Lector de Código de Barras
              </Text>
              <Text style={styles.scannerPermissionSub}>
                Escanea productos en tiempo real con compensación de baja luz, zoom macro antidesenfoque y detección instantánea de presentaciones.
              </Text>
              <TouchableOpacity
                style={styles.scannerGrantBtn}
                onPress={requestCameraPermission}
              >
                <Feather name="check-circle" size={17} color="#ffffff" />
                <Text style={styles.scannerGrantBtnText}>Permitir Acceso a la Cámara</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.scannerManualInputPermissionBtn}
                onPress={() => setScannerManualInputOpen(true)}
              >
                <Feather name="edit-3" size={16} color="#ffffff" />
                <Text style={styles.scannerManualInputPermissionBtnText}>
                  Ingresar Código Manualmente
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.scannerViewportContainer}>
              <CameraView
                style={StyleSheet.absoluteFillObject}
                facing={scannerFacing}
                enableTorch={scannerTorch}
                zoom={scannerZoom}
                autofocus={scannerAutoFocus}
                barcodeScannerSettings={{
                  barcodeTypes: ALL_BARCODE_TYPES,
                }}
                onBarcodeScanned={scannerPaused ? undefined : handleCameraBarcodeScanned}
              />

              {/* Halo de Luz Suave de Pantalla (Softbox para oscuridad total o etiquetas brillantes) */}
              {scannerLowLightGlow && (
                <View pointerEvents="none" style={styles.scannerSoftboxGlowBorder} />
              )}

              {/* Capa Táctil para Tap-to-Focus y Visor Óptico */}
              <TouchableOpacity
                activeOpacity={1}
                style={styles.scannerInteractiveOverlay}
                onPress={(e) => {
                  const { locationX, locationY } = e.nativeEvent;
                  triggerScannerFocus(locationX, locationY);
                }}
              >
                {/* Indicador donde el usuario tocó para enfocar */}
                {focusPoint && (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.scannerTapFocusRing,
                      {
                        left: Math.max(20, focusPoint.x - 32),
                        top: Math.max(20, focusPoint.y - 32),
                        transform: [{ scale: scannerFocusAnim }],
                      },
                    ]}
                  />
                )}

                {/* Marco del Visor Óptico con Esquinas Dinámicas y Láser */}
                <Animated.View
                  style={[
                    styles.scannerReticleBox,
                    { transform: [{ scale: scannerFrameScaleAnim }] },
                    scannerStatusRing === "success" && styles.scannerReticleSuccess,
                    scannerStatusRing === "warning" && styles.scannerReticleWarning,
                    scannerStatusRing === "error" && styles.scannerReticleError,
                  ]}
                >
                  {/* 4 Esquinas de alta visibilidad */}
                  <View
                    style={[
                      styles.scannerCornerTL,
                      scannerStatusRing === "success" && { borderColor: THEME.success },
                      scannerStatusRing === "warning" && { borderColor: THEME.warning },
                      scannerStatusRing === "error" && { borderColor: THEME.danger },
                    ]}
                  />
                  <View
                    style={[
                      styles.scannerCornerTR,
                      scannerStatusRing === "success" && { borderColor: THEME.success },
                      scannerStatusRing === "warning" && { borderColor: THEME.warning },
                      scannerStatusRing === "error" && { borderColor: THEME.danger },
                    ]}
                  />
                  <View
                    style={[
                      styles.scannerCornerBL,
                      scannerStatusRing === "success" && { borderColor: THEME.success },
                      scannerStatusRing === "warning" && { borderColor: THEME.warning },
                      scannerStatusRing === "error" && { borderColor: THEME.danger },
                    ]}
                  />
                  <View
                    style={[
                      styles.scannerCornerBR,
                      scannerStatusRing === "success" && { borderColor: THEME.success },
                      scannerStatusRing === "warning" && { borderColor: THEME.warning },
                      scannerStatusRing === "error" && { borderColor: THEME.danger },
                    ]}
                  />

                  {/* Línea Láser Animada */}
                  {!scannerPaused && (
                    <Animated.View
                      style={[
                        styles.scannerLaserLine,
                        scannerStatusRing === "success" && {
                          backgroundColor: THEME.success,
                          shadowColor: THEME.success,
                        },
                        {
                          transform: [
                            {
                              translateY: scannerLaserAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [-68, 68],
                              }),
                            },
                          ],
                        },
                      ]}
                    />
                  )}

                  {/* Etiqueta de estado dentro del visor */}
                  <View style={styles.scannerReticleHintPill}>
                    <Text style={styles.scannerReticleHintText}>
                      {scannerPaused
                        ? "Escáner en pausa"
                        : scannerStatusRing === "success"
                        ? "✓ ¡Código detectado!"
                        : scannerStatusRing === "error"
                        ? "✕ Código no registrado"
                        : "Toca el cuadro para re-enfocar · Mantén a 18 cm"}
                    </Text>
                  </View>
                </Animated.View>

                {/* Controles Rápidos de Zoom Óptico/Digital (Clave para códigos borrosos o pequeños) */}
                <View style={styles.scannerZoomBar}>
                  {[
                    { label: "1x", val: 0 },
                    { label: "1.5x Nítido", val: 0.12 },
                    { label: "2x Macro", val: 0.25 },
                    { label: "3x Pequeño", val: 0.45 },
                  ].map((z) => {
                    const active = Math.abs(scannerZoom - z.val) < 0.03;
                    return (
                      <TouchableOpacity
                        key={z.label}
                        style={[
                          styles.scannerZoomChip,
                          active && styles.scannerZoomChipActive,
                        ]}
                        onPress={() => {
                          setScannerZoom(z.val);
                          triggerScannerFocus();
                        }}
                      >
                        <Text
                          style={[
                            styles.scannerZoomChipText,
                            active && styles.scannerZoomChipTextActive,
                          ]}
                        >
                          {z.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Barra de Asistencia para Baja Luz, Desenfoque y Entrada Manual */}
                <View style={styles.scannerAssistToolbar}>
                  <TouchableOpacity
                    style={[
                      styles.scannerAssistBtn,
                      (scannerTorch || scannerLowLightGlow) && styles.scannerAssistBtnActive,
                    ]}
                    onPress={() => {
                      const next = !scannerLowLightGlow;
                      setScannerLowLightGlow(next);
                      setScannerTorch(next);
                    }}
                  >
                    <Feather
                      name="sun"
                      size={13}
                      color={scannerTorch || scannerLowLightGlow ? "#1c1917" : "#ffffff"}
                    />
                    <Text
                      style={[
                        styles.scannerAssistBtnText,
                        (scannerTorch || scannerLowLightGlow) && { color: "#1c1917" },
                      ]}
                    >
                      Baja Luz / Brillo
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.scannerAssistBtn,
                      scannerAntiBlurMode && styles.scannerAssistBtnActive,
                    ]}
                    onPress={() => {
                      const next = !scannerAntiBlurMode;
                      setScannerAntiBlurMode(next);
                      if (next && scannerZoom < 0.1) {
                        setScannerZoom(0.12);
                      }
                      triggerScannerFocus();
                    }}
                  >
                    <Feather
                      name="crosshair"
                      size={13}
                      color={scannerAntiBlurMode ? "#1c1917" : "#ffffff"}
                    />
                    <Text
                      style={[
                        styles.scannerAssistBtnText,
                        scannerAntiBlurMode && { color: "#1c1917" },
                      ]}
                    >
                      Antidesenfoque
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.scannerAssistBtn}
                    onPress={() => triggerScannerFocus()}
                  >
                    <Feather name="target" size={13} color="#ffffff" />
                    <Text style={styles.scannerAssistBtnText}>Enfocar</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.scannerAssistBtn,
                      scannerManualInputOpen && styles.scannerAssistBtnActive,
                    ]}
                    onPress={() => setScannerManualInputOpen((v) => !v)}
                  >
                    <Feather
                      name="edit-3"
                      size={13}
                      color={scannerManualInputOpen ? "#1c1917" : "#ffffff"}
                    />
                    <Text
                      style={[
                        styles.scannerAssistBtnText,
                        scannerManualInputOpen && { color: "#1c1917" },
                      ]}
                    >
                      Digitar Código
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Botón flotante siempre visible: Ingresar código manualmente */}
                <TouchableOpacity
                  style={styles.scannerManualFloatingBtn}
                  onPress={() => setScannerManualInputOpen(true)}
                  activeOpacity={0.8}
                >
                  <Feather name="edit-3" size={13} color="#ffffff" />
                  <Text style={styles.scannerManualFloatingBtnText}>
                    Ingresar código manualmente
                  </Text>
                </TouchableOpacity>
              </TouchableOpacity>
            </View>
          )}

          {/* Cajón desplegable para digitar código manualmente (si la etiqueta está rota o borrosa) */}
          {scannerManualInputOpen && (
            <View style={styles.scannerManualInputBar}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Feather name="edit-3" size={14} color={THEME.primary} />
                  <Text style={styles.scannerManualInputHeaderTitle}>
                    Ingresar código manualmente
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setScannerManualInputOpen(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="x" size={17} color="#d6d3ce" />
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <TextInput
                  style={styles.scannerManualTextInput}
                  placeholder="Escribe o pega el código de barras..."
                  placeholderTextColor="#a8a29e"
                  value={scannerManualCode}
                  onChangeText={setScannerManualCode}
                  autoFocus
                  returnKeyType="search"
                  onSubmitEditing={() => {
                    if (scannerManualCode.trim()) {
                      processScannedBarcode(scannerManualCode.trim(), "manual");
                      setScannerManualCode("");
                    }
                  }}
                />
                <TouchableOpacity
                  style={styles.scannerManualSubmitBtn}
                  onPress={() => {
                    if (scannerManualCode.trim()) {
                      processScannedBarcode(scannerManualCode.trim(), "manual");
                      setScannerManualCode("");
                    }
                  }}
                >
                  <Text style={styles.scannerManualSubmitBtnText}>Buscar</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Panel Inferior en Vivo: Tarjeta del Producto Escaneado + Resumen del Carrito POS */}
          <View style={styles.scannerBottomDock}>
            {lastScannedEvent ? (
              <View
                style={[
                  styles.scannerResultCard,
                  lastScannedEvent.status === "not_found" && {
                    borderColor: THEME.danger,
                  },
                  lastScannedEvent.status === "out_of_stock" && {
                    borderColor: THEME.warning,
                  },
                ]}
              >
                {lastScannedEvent.producto ? (
                  (() => {
                    const p = lastScannedEvent.producto;
                    const pres = lastScannedEvent.presentacion || null;
                    const targetClave = claveLinea(p.id, pres?.id);
                    const itemEnCarrito = cart.find((c) => claveDe(c) === targetClave);
                    const qtyEnCarrito = itemEnCarrito?.qty || 0;
                    const precioUnit = pres
                      ? precioDeLineaEnMoneda(
                          { product: p, qty: 1, presentacion: pres },
                          monedaSeleccionada
                        )
                      : precioUnitarioEnMoneda(p, monedaSeleccionada);

                    return (
                      <View style={{ gap: 8 }}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: 10,
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 6,
                                flexWrap: "wrap",
                              }}
                            >
                              <View
                                style={[
                                  styles.scannerStatusPill,
                                  lastScannedEvent.status === "out_of_stock"
                                    ? { backgroundColor: THEME.dangerSoft }
                                    : lastScannedEvent.status === "inspected"
                                    ? { backgroundColor: THEME.infoSoft }
                                    : { backgroundColor: THEME.successSoft },
                                ]}
                              >
                                <Text
                                  style={{
                                    fontSize: 10,
                                    fontWeight: "800",
                                    color:
                                      lastScannedEvent.status === "out_of_stock"
                                        ? THEME.dangerStrong
                                        : lastScannedEvent.status === "inspected"
                                        ? THEME.infoStrong
                                        : THEME.successStrong,
                                  }}
                                >
                                  {lastScannedEvent.status === "out_of_stock"
                                    ? "SIN STOCK"
                                    : lastScannedEvent.status === "inspected"
                                    ? "PRECIO VERIFICADO"
                                    : "✓ AGREGADO AL CARRITO"}
                                </Text>
                              </View>
                              {pres && (
                                <View style={styles.posPresMiniBtn}>
                                  <Feather name="box" size={10} color={THEME.primary600} />
                                  <Text style={styles.posPresMiniBtnText}>
                                    {pres.nombre} x{pres.unidades}
                                  </Text>
                                </View>
                              )}
                              <Text style={{ fontSize: 10.5, color: THEME.mutedForeground }}>
                                #{lastScannedEvent.rawCode} · Stock: {p.stock}
                              </Text>
                            </View>

                            <Text
                              style={{
                                fontSize: 15,
                                fontWeight: "800",
                                color: THEME.foreground,
                                marginTop: 3,
                              }}
                              numberOfLines={1}
                            >
                              {p.nombre}
                            </Text>

                            {/* Precios en la moneda activa + secundarias */}
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "baseline",
                                gap: 8,
                                flexWrap: "wrap",
                                marginTop: 2,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 16,
                                  fontWeight: "900",
                                  color: THEME.primary600,
                                }}
                              >
                                {fmt(precioUnit, monedaSeleccionada)}
                              </Text>
                              {monedas
                                .filter((m) => m.codigo !== monedaSeleccionada)
                                .map((m) => {
                                  const altP = pres
                                    ? precioDeLineaEnMoneda(
                                        { product: p, qty: 1, presentacion: pres },
                                        m.codigo
                                      )
                                    : precioUnitarioEnMoneda(p, m.codigo);
                                  return (
                                    <Text
                                      key={m.codigo}
                                      style={{
                                        fontSize: 11,
                                        fontWeight: "700",
                                        color: THEME.mutedForeground,
                                      }}
                                    >
                                      {fmt(altP, m.codigo)}
                                    </Text>
                                  );
                                })}
                            </View>
                          </View>

                          {/* Controles rápidos de cantidad y botón para Quitar del Carrito */}
                          {qtyEnCarrito > 0 ? (
                            <View style={{ alignItems: "flex-end", gap: 6 }}>
                              <View style={styles.scannerQtyControlBox}>
                                <TouchableOpacity
                                  style={[
                                    styles.scannerQtyBtn,
                                    qtyEnCarrito === 1 && { backgroundColor: THEME.danger },
                                  ]}
                                  onPress={() => updateCartQty(targetClave, -1)}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                  <Feather
                                    name={qtyEnCarrito === 1 ? "trash-2" : "minus"}
                                    size={13}
                                    color="#ffffff"
                                  />
                                </TouchableOpacity>
                                <View style={{ paddingHorizontal: 10, alignItems: "center" }}>
                                  <Text
                                    style={{
                                      fontSize: 15,
                                      fontWeight: "900",
                                      color: THEME.foreground,
                                    }}
                                  >
                                    {qtyEnCarrito}
                                  </Text>
                                  <Text
                                    style={{
                                      fontSize: 9,
                                      fontWeight: "700",
                                      color: THEME.mutedForeground,
                                    }}
                                  >
                                    en carrito
                                  </Text>
                                </View>
                                <TouchableOpacity
                                  style={[
                                    styles.scannerQtyBtn,
                                    { backgroundColor: THEME.primary },
                                  ]}
                                  onPress={() => addToCart(p, pres)}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                  <Feather name="plus" size={13} color="#ffffff" />
                                </TouchableOpacity>
                              </View>

                              {/* Botón explícito para quitar del carrito con 1 toque */}
                              <TouchableOpacity
                                style={styles.scannerRemoveBtn}
                                onPress={() => {
                                  updateCartQty(targetClave, -qtyEnCarrito);
                                  showToast(`${p.nombre} quitado del carrito`, "info");
                                  try {
                                    Vibration.vibrate(30);
                                  } catch {}
                                }}
                                hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                              >
                                <Feather name="trash-2" size={12} color={THEME.dangerStrong} />
                                <Text style={styles.scannerRemoveBtnText}>Quitar del carrito</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            p.stock > 0 && (
                              <TouchableOpacity
                                style={styles.scannerQuickAddBtn}
                                onPress={() => addToCart(p, pres)}
                              >
                                <Feather name="plus" size={14} color="#ffffff" />
                                <Text style={styles.scannerQuickAddBtnText}>Sumar</Text>
                              </TouchableOpacity>
                            )
                          )}
                        </View>
                      </View>
                    );
                  })()
                ) : (
                  /* Código no encontrado en la base local */
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 13,
                          fontWeight: "800",
                          color: THEME.dangerStrong,
                        }}
                      >
                        Código no encontrado: {lastScannedEvent.rawCode}
                      </Text>
                      <Text style={{ fontSize: 11.5, color: THEME.mutedForeground }}>
                        No coincide con ningún producto del catálogo. ¿Deseas registrarlo?
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.primarySmallBtn}
                      onPress={() => {
                        const codeToCreate = lastScannedEvent.rawCode;
                        setShowScannerModal(false);
                        openProductoModal(null, codeToCreate);
                      }}
                    >
                      <Feather name="plus" size={13} color="#ffffff" />
                      <Text style={styles.primarySmallBtnText}>Crear</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.scannerEmptyPromptBox}>
                <Feather name="maximize" size={18} color={THEME.primary} />
                <Text style={styles.scannerEmptyPromptText}>
                  Apunta al código de barras. El modo{" "}
                  <Text style={{ fontWeight: "800", color: "#ffffff" }}>
                    Antidesenfoque (1.5x)
                  </Text>{" "}
                  y{" "}
                  <Text style={{ fontWeight: "800", color: "#ffffff" }}>Baja Luz</Text>{" "}
                  detectan códigos borrosos o con poca iluminación.
                </Text>
              </View>
            )}

            {/* Barra de Resumen del Carrito y Cobro Inmediato dentro del Escáner */}
            <View style={styles.scannerCartSummaryBar}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={styles.floatingCartBadge}>
                  <Text style={styles.floatingCartBadgeText}>
                    {cart.reduce((s, c) => s + c.qty, 0)}
                  </Text>
                </View>
                <View>
                  <Text style={{ fontSize: 10, color: "#a8a29e", fontWeight: "700" }}>
                    TOTAL EN CARRITO ({monedaSeleccionada})
                  </Text>
                  <Text style={{ fontSize: 17, color: "#ffffff", fontWeight: "900" }}>
                    {fmt(total, monedaSeleccionada)}
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {cart.length > 0 && (
                  <TouchableOpacity
                    style={styles.scannerViewCartBtn}
                    onPress={() => {
                      setShowScannerModal(false);
                      setRoute("pos");
                      setPosSubView("carrito");
                    }}
                  >
                    <Feather name="shopping-cart" size={14} color="#ffffff" />
                    <Text style={styles.scannerViewCartBtnText}>Carrito</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[
                    styles.scannerCheckoutBtn,
                    cart.length === 0 && { backgroundColor: "#44403c" },
                  ]}
                  onPress={() => {
                    setShowScannerModal(false);
                    if (cart.length > 0) {
                      setRoute("pos");
                      handleOpenCheckout();
                    }
                  }}
                >
                  <Text style={styles.scannerCheckoutBtnText}>
                    {cart.length > 0 ? "Cobrar" : "Listo"}
                  </Text>
                  <Feather
                    name={cart.length > 0 ? "arrow-right" : "check"}
                    size={15}
                    color="#ffffff"
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── CONTENIDO PRINCIPAL SEGÚN RUTA ── */}

      {/* ==================== 1. PUNTO DE VENTA (/pos) ==================== */}
      {route === "pos" && (
        <View style={{ flex: 1 }}>
          {/* Barra superior de controles del POS (Buscador + Escáner + Método de Pago + Moneda + Sub-tabs Catálogo/Carrito) */}
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

              {/* Botón Principal para Abrir Lector de Código de Barras en Tiempo Real */}
              <TouchableOpacity
                style={styles.posScanTriggerBtn}
                onPress={() => openBarcodeScanner("rafaga")}
                activeOpacity={0.8}
              >
                <Feather name="camera" size={15} color="#ffffff" />
                <Text style={styles.posScanTriggerBtnText}>Escanear</Text>
              </TouchableOpacity>

              {/* Botón rápido de Verificador de Precios por Cámara */}
              <TouchableOpacity
                style={styles.posPriceCheckTriggerBtn}
                onPress={() => openBarcodeScanner("consulta")}
                activeOpacity={0.8}
              >
                <Feather name="tag" size={15} color={THEME.primary600} />
              </TouchableOpacity>
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
                                style={[
                                  styles.inCartMinusBtn,
                                  inCartQty === 1 && { backgroundColor: THEME.danger },
                                ]}
                                onPress={() => decreaseOrRemoveFromCart(item.id)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              >
                                <Feather
                                  name={inCartQty === 1 ? "trash-2" : "minus"}
                                  size={11}
                                  color="#fff"
                                />
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
              {/* Cabecera del Carrito + Escanear + Pausar + Limpiar */}
              <View style={styles.card}>
                <View style={styles.cartHeaderContainer}>
                  <View style={styles.cartHeaderTopRow}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                      <Feather name="shopping-cart" size={16} color={THEME.primary} />
                      <Text style={styles.cardSectionTitle} numberOfLines={1}>
                        Carrito ({cart.reduce((s, c) => s + c.qty, 0)} ítems)
                      </Text>
                    </View>
                    {cart.length === 0 ? (
                      <TouchableOpacity
                        style={styles.cartScanHeaderBtn}
                        onPress={() => openBarcodeScanner("rafaga")}
                      >
                        <Feather name="camera" size={13} color="#ffffff" />
                        <Text style={styles.cartScanHeaderBtnText}>Escanear</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.cartHeaderTotalPill}>
                        <Text style={styles.cartHeaderTotalPillText}>
                          {fmt(total, monedaSeleccionada)}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Barra de 3 Botones Proporcionales (Escanear + Pausar + Limpiar) — 100% dentro del contenedor */}
                  {cart.length > 0 && (
                    <View style={styles.cartHeaderActionsRow}>
                      <TouchableOpacity
                        style={[
                          styles.cartHeaderActionBtn,
                          { backgroundColor: THEME.primary, borderColor: THEME.primary600 },
                        ]}
                        onPress={() => openBarcodeScanner("rafaga")}
                      >
                        <Feather name="camera" size={13} color="#ffffff" />
                        <Text style={[styles.cartHeaderActionBtnText, { color: "#ffffff" }]}>
                          Escanear
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.cartHeaderActionBtn}
                        onPress={handlePauseCart}
                      >
                        <Feather name="pause" size={12} color={THEME.foreground} />
                        <Text style={styles.cartHeaderActionBtnText}>Pausar</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.cartHeaderActionBtn,
                          { borderColor: THEME.dangerBorder, backgroundColor: THEME.dangerSoft },
                        ]}
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
                        <Feather name="trash-2" size={12} color={THEME.dangerStrong} />
                        <Text
                          style={[
                            styles.cartHeaderActionBtnText,
                            { color: THEME.dangerStrong },
                          ]}
                        >
                          Limpiar
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
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
              {ventasSearch.length > 0 && (
                <TouchableOpacity onPress={() => setVentasSearch("")}>
                  <Feather name="x-circle" size={16} color={THEME.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <FlatList
            data={ventasFiltradas}
            keyExtractor={(v) => String(v.id || v.numero)}
            contentContainerStyle={{ padding: 12, paddingBottom: 95, gap: 10 }}
            renderItem={({ item: v }) => {
              const esPagada = v.estado === "Pagada";
              const creditoDeVenta = (creditosData.creditos || []).find(
                (c) =>
                  (c.venta_id && String(c.venta_id) === String(v.id)) ||
                  (c.venta_numero && c.venta_numero === v.numero)
              );
              const tieneDeudaPendiente =
                !esPagada || Boolean(creditoDeVenta && creditoDeVenta.saldo > 0.01);

              return (
                <View key={v.id} style={styles.card}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => handleOpenVentaDetail(v)}
                  >
                    <View style={styles.creditoCardHeader}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <Text style={styles.creditoNumero}>{v.numero}</Text>
                          {v.isLocal && (
                            <View
                              style={[
                                styles.statusBadge,
                                v.sincronizado === 1
                                  ? { backgroundColor: THEME.successSoft, borderColor: THEME.successBorder }
                                  : { backgroundColor: THEME.warningSoft, borderColor: THEME.warningBorder },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.statusBadgeText,
                                  {
                                    color: v.sincronizado === 1 ? THEME.successStrong : THEME.warningStrong,
                                    fontSize: 10,
                                  },
                                ]}
                              >
                                {v.sincronizado === 1 ? "Sincronizada" : "Local"}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.creditoClienteName} numberOfLines={1}>
                          {v.cliente || "Consumidor Final"}
                        </Text>
                        <Text style={[styles.clientCardMeta, { marginTop: 3 }]}>
                          🕒 {fmtDateTime(v.creado_en || v.fecha)}
                        </Text>
                        <Text style={[styles.clientCardMeta, { color: THEME.foreground, fontWeight: "600" }]}>
                          {v.tipo_pago}{v.metodo_pago_nombre ? ` · ${v.metodo_pago_nombre}` : ""}
                        </Text>
                      </View>

                      <View style={{ alignItems: "flex-end", justifyContent: "space-between" }}>
                        <Text style={styles.posProdPrice}>
                          {fmt(Number(v.total) || 0, v.moneda_codigo)}
                        </Text>
                        <View
                          style={[
                            styles.statusBadge,
                            esPagada
                              ? { backgroundColor: THEME.successSoft, borderColor: THEME.successBorder }
                              : { backgroundColor: THEME.warningSoft, borderColor: THEME.warningBorder },
                            { marginTop: 4 },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusBadgeText,
                              { color: esPagada ? THEME.successStrong : THEME.warningStrong },
                            ]}
                          >
                            {v.estado}
                          </Text>
                        </View>
                        {creditoDeVenta && creditoDeVenta.saldo > 0.01 && (
                          <Text
                            style={{
                              fontSize: 11,
                              fontWeight: "700",
                              color: THEME.dangerStrong,
                              marginTop: 4,
                            }}
                          >
                            Debe: {fmt(creditoDeVenta.saldo, creditoDeVenta.moneda_codigo)}
                          </Text>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>

                  {/* Barra de Acciones idéntica a PC (/ventas): Ver · Pagar · Retornar · Eliminar */}
                  <View
                    style={[
                      styles.cartHeaderActionsRow,
                      {
                        marginTop: 10,
                        paddingTop: 8,
                        borderTopWidth: 1,
                        borderTopColor: THEME.border,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.cartHeaderActionBtn}
                      onPress={() => handleOpenVentaDetail(v)}
                    >
                      <Feather name="eye" size={13} color={THEME.foreground} />
                      <Text style={styles.cartHeaderActionBtnText}>Ver</Text>
                    </TouchableOpacity>

                    {tieneDeudaPendiente && (
                      <TouchableOpacity
                        style={[
                          styles.cartHeaderActionBtn,
                          {
                            backgroundColor: THEME.successSoft,
                            borderColor: THEME.successBorder,
                          },
                        ]}
                        onPress={() => handlePagarVentaCredito(v)}
                      >
                        <Feather name="dollar-sign" size={13} color={THEME.successStrong} />
                        <Text
                          style={[
                            styles.cartHeaderActionBtnText,
                            { color: THEME.successStrong },
                          ]}
                        >
                          Pagar
                        </Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={[
                        styles.cartHeaderActionBtn,
                        {
                          backgroundColor: THEME.warningSoft,
                          borderColor: THEME.warningBorder,
                        },
                      ]}
                      onPress={() => openRetornoDirectoFromVenta(v)}
                    >
                      <Feather name="rotate-ccw" size={13} color={THEME.warningStrong} />
                      <Text
                        style={[
                          styles.cartHeaderActionBtnText,
                          { color: THEME.warningStrong },
                        ]}
                      >
                        Retornar
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.cartHeaderActionBtn,
                        {
                          backgroundColor: THEME.dangerSoft,
                          borderColor: THEME.dangerBorder,
                        },
                      ]}
                      onPress={() => handleDeleteVenta(v)}
                    >
                      <Feather name="trash-2" size={13} color={THEME.dangerStrong} />
                      <Text
                        style={[
                          styles.cartHeaderActionBtnText,
                          { color: THEME.dangerStrong },
                        ]}
                      >
                        Eliminar
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Feather name="trending-up" size={34} color={THEME.mutedForeground} />
                <Text style={styles.emptyBoxTitle}>No se encontraron ventas</Text>
                <Text style={styles.emptyBoxSub}>
                  {ventasSearch.trim()
                    ? "Intenta con otro término de búsqueda"
                    : "Las ventas registradas aparecerán aquí ordenadas por fecha y hora"}
                </Text>
              </View>
            }
          />
        </View>
      )}

      {/* ==================== KARDEX (/kardex) ==================== */}
      {route === "kardex" && (
        <View style={{ flex: 1 }}>
          {/* Barra de Búsqueda y Botón Refrescar */}
          <View style={styles.moduleHeaderBar}>
            <View style={[styles.searchBox, { flex: 1 }]}>
              <Feather name="search" size={16} color={THEME.mutedForeground} />
              <TextInput
                style={styles.searchBoxInput}
                placeholder="Buscar por producto o motivo..."
                placeholderTextColor={THEME.mutedForeground}
                value={kardexSearch}
                onChangeText={setKardexSearch}
              />
              {kardexSearch.length > 0 && (
                <TouchableOpacity onPress={() => setKardexSearch("")}>
                  <Feather name="x-circle" size={16} color={THEME.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={[styles.primaryBtn, { height: 40, paddingHorizontal: 12 }]}
              onPress={() => {
                setAjusteProducto(null);
                setAjustePresentacionId(null);
                setAjusteCantidad("1");
                setAjusteMotivo("Ajuste manual");
                setAjusteTipo("Entrada");
                setAjusteSearchProd("");
                setModalAjusteKardexVisible(true);
              }}
            >
              <Feather name="plus" size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>Ajuste</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.outlineSmallBtn, { height: 40, paddingHorizontal: 12 }]}
              onPress={loadKardex}
              disabled={kardexLoading}
            >
              {kardexLoading ? (
                <ActivityIndicator size="small" color={THEME.primary} />
              ) : (
                <Feather name="refresh-cw" size={16} color={THEME.foreground} />
              )}
            </TouchableOpacity>
          </View>

          {/* Filtros Tipo: Todos, Entrada, Salida, Ajuste */}
          <View style={{ paddingHorizontal: 12, paddingBottom: 8, flexDirection: "row", gap: 8 }}>
            {[
              { id: "todos", label: "Todos" },
              { id: "Entrada", label: "Entradas" },
              { id: "Salida", label: "Salidas" },
              { id: "Ajuste", label: "Ajustes" },
            ].map((f) => {
              const active = kardexTipo === f.id;
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[
                    styles.pillFilter,
                    active && styles.pillFilterActive,
                  ]}
                  onPress={() => setKardexTipo(f.id)}
                >
                  <Text
                    style={[
                      styles.pillFilterText,
                      active && styles.pillFilterTextActive,
                    ]}
                  >
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 3 KPI Cards Kardex */}
          <View style={[styles.creditosKpiRow, { paddingHorizontal: 12, marginBottom: 8 }]}>
            <View style={[styles.kpiCard, { borderColor: THEME.successBorder, backgroundColor: THEME.successSoft }]}>
              <Text style={[styles.kpiLabel, { color: THEME.successStrong }]}>ENTRADAS</Text>
              <Text style={[styles.kpiValue, { color: THEME.successStrong }]}>{kardexStats.entradas}</Text>
            </View>
            <View style={[styles.kpiCard, { borderColor: THEME.dangerBorder, backgroundColor: THEME.dangerSoft }]}>
              <Text style={[styles.kpiLabel, { color: THEME.dangerStrong }]}>SALIDAS</Text>
              <Text style={[styles.kpiValue, { color: THEME.dangerStrong }]}>{kardexStats.salidas}</Text>
            </View>
            <View style={[styles.kpiCard, { borderColor: THEME.infoBorder, backgroundColor: THEME.infoSoft }]}>
              <Text style={[styles.kpiLabel, { color: THEME.infoStrong }]}>AJUSTES</Text>
              <Text style={[styles.kpiValue, { color: THEME.infoStrong }]}>{kardexStats.ajustes}</Text>
            </View>
          </View>

          {/* Lista de Movimientos */}
          <FlatList
            data={kardexItems}
            keyExtractor={(m, idx) => String(m.id || idx)}
            contentContainerStyle={{ padding: 12, paddingBottom: 95, gap: 10 }}
            renderItem={({ item: m }) => {
              const esEntrada = m.tipo === "Entrada";
              const esSalida = m.tipo === "Salida";
              const badgeBg = esEntrada ? THEME.successSoft : esSalida ? THEME.dangerSoft : THEME.infoSoft;
              const badgeBorder = esEntrada ? THEME.successBorder : esSalida ? THEME.dangerBorder : THEME.infoBorder;
              const badgeText = esEntrada ? THEME.successStrong : esSalida ? THEME.dangerStrong : THEME.infoStrong;
              const iconName = esEntrada ? "arrow-down" : esSalida ? "arrow-up" : "refresh-cw";

              return (
                <View key={m.id} style={styles.card}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.clientCardName}>{m.producto_nombre || "Producto"}</Text>
                      <Text style={styles.clientCardMeta}>
                        Cód: {m.producto_codigo || "-"} · 🕒 {fmtDateTime(m.fecha)}
                      </Text>
                      {m.motivo ? (
                        <Text style={[styles.clientCardMeta, { color: THEME.foreground, marginTop: 2 }]}>
                          Motivo: {m.motivo}
                        </Text>
                      ) : null}
                    </View>

                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: badgeBg, borderColor: badgeBorder, flexDirection: "row", alignItems: "center", gap: 3 },
                      ]}
                    >
                      <Feather name={iconName as any} size={11} color={badgeText} />
                      <Text style={[styles.statusBadgeText, { color: badgeText }]}>{m.tipo}</Text>
                    </View>
                  </View>

                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 10,
                      paddingTop: 8,
                      borderTopWidth: 1,
                      borderTopColor: THEME.border,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={[styles.posProdPrice, { color: badgeText }]}>
                        {esEntrada ? `+${m.cantidad}` : esSalida ? `-${m.cantidad}` : `${m.cantidad}`} unids
                      </Text>
                      {m.costo_unit ? (
                        <Text style={styles.clientCardMeta}>
                          ({fmt(Number(m.costo_unit) || 0, m.producto_moneda_codigo || "USD")})
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.clientCardMeta}>
                      Saldo: {m.saldo_anterior} → <Text style={{ fontWeight: "800", color: THEME.foreground }}>{m.saldo_actual}</Text>
                    </Text>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Feather name="activity" size={34} color={THEME.mutedForeground} />
                <Text style={styles.emptyBoxTitle}>
                  {kardexLoading ? "Cargando movimientos..." : "No hay movimientos registrados"}
                </Text>
                <Text style={styles.emptyBoxSub}>
                  {kardexLoading
                    ? "Obteniendo datos de inventario del servidor..."
                    : "Las entradas por compra, salidas por venta y ajustes manuales se reflejan aquí"}
                </Text>
              </View>
            }
          />
        </View>
      )}

      {/* ==================== CAJAS Y TURNOS (/cajas) ==================== */}
      {route === "cajas" && (
        <View style={{ flex: 1 }}>
          <View style={styles.moduleHeaderBar}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "800", color: THEME.foreground }}>
                Cajas y Turnos de Arqueo
              </Text>
              <Text style={{ fontSize: 11, color: THEME.mutedForeground }}>
                Saldos, aperturas, cierres y movimientos
              </Text>
            </View>
            <TouchableOpacity
              style={styles.outlineSmallBtn}
              onPress={() => setRoute("transacciones")}
            >
              <Feather name="repeat" size={13} color={THEME.primary600} />
              <Text style={[styles.outlineSmallBtnText, { color: THEME.primary600 }]}>
                Movimientos
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primarySmallBtn}
              onPress={() => {
                setNcajaNombre("");
                setNcajaMonedaId(String(monedas[0]?.id || "1"));
                setNuevaCajaModalOpen(true);
              }}
            >
              <Feather name="plus" size={14} color="#fff" />
              <Text style={styles.primarySmallBtnText}>Nueva Caja</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={cajasCloud.length > 0 ? cajasCloud : cajas}
            keyExtractor={(c) => String(c.id)}
            contentContainerStyle={{ padding: 12, paddingBottom: 95, gap: 12 }}
            renderItem={({ item: c }) => {
              const estaAbierta = c.estado === "Abierta";
              const mon = monedas.find((m) => String(m.id) === String(c.moneda_id)) || {
                codigo: c.moneda_codigo || "USD",
                simbolo: c.moneda_simbolo || "$",
              };
              return (
                <View key={c.id} style={styles.card}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={styles.clientCardName}>{c.nombre}</Text>
                        <View style={styles.monedaPill}>
                          <Text style={styles.monedaPillText}>{mon.codigo}</Text>
                        </View>
                      </View>
                      {c.fecha_apertura && (
                        <Text style={[styles.clientCardMeta, { marginTop: 3 }]}>
                          Apertura: {fmtDateTime(c.fecha_apertura)}
                        </Text>
                      )}
                    </View>

                    <View
                      style={[
                        styles.statusBadge,
                        estaAbierta
                          ? { backgroundColor: THEME.successSoft, borderColor: THEME.successBorder }
                          : { backgroundColor: THEME.muted, borderColor: THEME.border },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusBadgeText,
                          { color: estaAbierta ? THEME.successStrong : THEME.mutedForeground },
                        ]}
                      >
                        {estaAbierta ? "Abierta" : "Cerrada"}
                      </Text>
                    </View>
                  </View>

                  {/* Saldo actual */}
                  <View style={[styles.checkoutBalanceBanner, { marginVertical: 10 }]}>
                    <Text style={styles.summaryLabel}>Saldo actual en caja:</Text>
                    <Text style={[styles.checkoutBigTotal, { fontSize: 22, color: THEME.foreground }]}>
                      {fmt(Number(c.saldo_actual) || 0, mon.codigo)}
                    </Text>
                    {estaAbierta && (
                      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: THEME.border }}>
                        <Text style={[styles.clientCardMeta, { color: THEME.successStrong }]}>
                          Entradas: +{fmt(Number(c.total_entradas) || 0, mon.codigo)}
                        </Text>
                        <Text style={[styles.clientCardMeta, { color: THEME.dangerStrong }]}>
                          Salidas: -{fmt(Number(c.total_salidas) || 0, mon.codigo)}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Botones de acción Cierre / Apertura */}
                  <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
                    {estaAbierta ? (
                      <TouchableOpacity
                        style={[styles.primarySmallBtn, { backgroundColor: THEME.danger, height: 38, paddingHorizontal: 14 }]}
                        onPress={() => {
                          setCajaParaCierre(c);
                          setCierreObservaciones("");
                        }}
                      >
                        <Feather name="lock" size={14} color="#fff" />
                        <Text style={styles.primarySmallBtnText}>Cerrar Caja</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.primarySmallBtn, { backgroundColor: THEME.success, height: 38, paddingHorizontal: 14 }]}
                        onPress={() => {
                          setCajaParaAbrir(c);
                          setSaldoAperturaInput("0");
                        }}
                      >
                        <Feather name="unlock" size={14} color="#fff" />
                        <Text style={styles.primarySmallBtnText}>Abrir Turno</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Feather name="inbox" size={34} color={THEME.mutedForeground} />
                <Text style={styles.emptyBoxTitle}>
                  {cajasLoading ? "Cargando cajas..." : "No hay cajas configuradas"}
                </Text>
                <Text style={styles.emptyBoxSub}>
                  Las cajas registradoras configuradas en la nube se mostrarán aquí.
                </Text>
              </View>
            }
          />
        </View>
      )}

      {/* ==================== REPORTES (/reportes) ==================== */}
      {route === "reportes" && (
        <View style={{ flex: 1 }}>
          {/* Presets de Tiempo y Botón Refrescar */}
          <View style={styles.moduleHeaderBar}>
            <View style={{ flexDirection: "row", gap: 6, flex: 1 }}>
              {[
                { id: "hoy", label: "Hoy" },
                { id: "mes", label: "Mes" },
                { id: "anio", label: "Año" },
                { id: "todo", label: "Todo" },
              ].map((p) => {
                const active = reportesPreset === p.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.pillFilter,
                      active && styles.pillFilterActive,
                      { paddingHorizontal: 12, paddingVertical: 6 },
                    ]}
                    onPress={() => setReportesPreset(p.id as any)}
                  >
                    <Text
                      style={[
                        styles.pillFilterText,
                        active && styles.pillFilterTextActive,
                        { fontSize: 12 },
                      ]}
                    >
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              style={[styles.outlineSmallBtn, { height: 36, paddingHorizontal: 10 }]}
              onPress={loadReportes}
              disabled={reportesLoading}
            >
              {reportesLoading ? (
                <ActivityIndicator size="small" color={THEME.primary} />
              ) : (
                <Feather name="refresh-cw" size={16} color={THEME.foreground} />
              )}
            </TouchableOpacity>
          </View>

          {/* Subtabs de Reporte: Ventas y Cobros, Finanzas, Stock Crítico */}
          <View style={{ paddingHorizontal: 12, paddingBottom: 8, flexDirection: "row", gap: 8 }}>
            {[
              { id: "ventas", label: "Ventas y Cobros" },
              { id: "finanzas", label: "Finanzas" },
              { id: "inventario", label: "Stock Crítico" },
            ].map((t) => {
              const active = reportesTab === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[
                    styles.pillFilter,
                    active && styles.pillFilterActive,
                    { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
                  ]}
                  onPress={() => setReportesTab(t.id as any)}
                >
                  <Text
                    style={[
                      styles.pillFilterText,
                      active && styles.pillFilterTextActive,
                      { fontSize: 12, fontWeight: active ? "700" : "500" },
                    ]}
                  >
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Selector de Moneda (USD, COP, VES, etc.) - Contenedor con altura fija para evitar que se colapse o expanda */}
          {monedas.length > 1 && reportesTab !== "inventario" && (
            <View style={{ height: 42, flexGrow: 0, flexShrink: 0, marginBottom: 6 }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 12, alignItems: "center", gap: 8 }}
              >
                {monedas.map((m) => {
                  const active = reportesMonedaCod === m.codigo;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[
                        {
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          paddingHorizontal: 14,
                          height: 34,
                          borderRadius: 17,
                          borderWidth: 1.5,
                        },
                        active
                          ? { backgroundColor: THEME.primary, borderColor: THEME.primary }
                          : { backgroundColor: THEME.card, borderColor: THEME.border },
                      ]}
                      onPress={() => setReportesMonedaCod(m.codigo)}
                    >
                      <Text
                        style={[
                          { fontSize: 12, fontWeight: "700" },
                          active ? { color: "#fff" } : { color: THEME.foreground },
                        ]}
                      >
                        {m.codigo} ({m.simbolo})
                      </Text>
                      {active && (
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" }} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {reportesLoading && !reportesData ? (
            <View style={[styles.emptyBox, { flex: 1, justifyContent: "center" }]}>
              <ActivityIndicator size="large" color={THEME.primary} />
              <Text style={[styles.emptyBoxTitle, { marginTop: 12 }]}>Cargando reportes...</Text>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 110, gap: 14 }}>
              {/* Cobros Físicos por Moneda (Global) */}
              {reportesTab === "ventas" && reportesData?.__cobros_globales && (
                <View style={[styles.card, { borderColor: THEME.primary, borderWidth: 1.5, borderRadius: 14, padding: 14 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: THEME.secondary, alignItems: "center", justifyContent: "center" }}>
                      <Feather name="dollar-sign" size={16} color={THEME.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: THEME.foreground }}>
                        COBROS REALES RECIBIDOS (POR DIVISA)
                      </Text>
                      <Text style={{ fontSize: 11, color: THEME.mutedForeground, marginTop: 1 }}>
                        Dinero ingresado en caja en el período (ventas de contado + abonos cobrados):
                      </Text>
                    </View>
                  </View>

                  <View style={{ marginTop: 10, gap: 8 }}>
                    {reportesData.__cobros_globales.map((cg: any) => (
                      <View
                        key={cg.moneda_codigo}
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          backgroundColor: THEME.inputBg,
                          borderWidth: 1,
                          borderColor: THEME.border,
                        }}
                      >
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <View style={[styles.monedaPill, { backgroundColor: THEME.primary, borderColor: THEME.primary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }]}>
                              <Text style={[styles.monedaPillText, { color: "#fff", fontWeight: "800" }]}>{cg.moneda_codigo}</Text>
                            </View>
                            <Text style={{ fontSize: 12, fontWeight: "700", color: THEME.foreground }}>
                              Total Cobrado
                            </Text>
                          </View>
                          <Text style={{ fontSize: 16, fontWeight: "900", color: THEME.successStrong }}>
                            {fmt(Number(cg.total) || 0, cg.moneda_codigo)}
                          </Text>
                        </View>

                        <View style={{ gap: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: THEME.border }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <Text style={{ fontSize: 11, color: THEME.mutedForeground }}>
                              🛒 Ventas al contado:
                            </Text>
                            <Text style={{ fontSize: 12, fontWeight: "700", color: THEME.foreground }}>
                              {fmt(Number(cg.total_ventas) || 0, cg.moneda_codigo)}
                            </Text>
                          </View>

                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <Text style={{ fontSize: 11, color: THEME.infoStrong }}>
                              💳 Abonos a deudas:
                            </Text>
                            <Text style={{ fontSize: 12, fontWeight: "700", color: THEME.infoStrong }}>
                              +{fmt(Number(cg.total_abonos) || 0, cg.moneda_codigo)}
                            </Text>
                          </View>
                        </View>

                        {cg.metodos && cg.metodos.length > 0 && (
                          <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: THEME.border }}>
                            <Text style={{ fontSize: 10, fontWeight: "700", color: THEME.mutedForeground, marginBottom: 2 }}>
                              Desglose por método:
                            </Text>
                            {cg.metodos.map((met: any, idx: number) => (
                              <View key={idx} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
                                <Text style={{ fontSize: 11, color: THEME.mutedForeground }}>• {met.nombre}</Text>
                                <Text style={{ fontSize: 11, fontWeight: "600", color: THEME.foreground }}>
                                  {fmt(Number(met.total) || 0, cg.moneda_codigo)}
                                </Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* KPIs de la Moneda Seleccionada */}
              {(() => {
                const monData = reportesData?.[reportesMonedaCod] || (reportesData && reportesData[Object.keys(reportesData).find((k) => !k.startsWith("__")) || ""]);
                if (!monData) {
                  return (
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyBoxSub}>No hay datos para esta moneda en el período seleccionado.</Text>
                    </View>
                  );
                }

                if (reportesTab === "ventas") {
                  const res = monData.resumen || {};
                  return (
                    <>
                      {/* Tarjeta 1: Total Ventas Facturadas (Ancho completo) */}
                      <View style={[styles.card, { padding: 14, borderRadius: 14 }]}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ fontSize: 11, fontWeight: "800", color: THEME.mutedForeground, letterSpacing: 0.5 }}>
                            VENTAS TOTALES FACTURADAS
                          </Text>
                          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: THEME.secondary, alignItems: "center", justifyContent: "center" }}>
                            <Feather name="trending-up" size={15} color={THEME.primary} />
                          </View>
                        </View>
                        <Text style={{ fontSize: 24, fontWeight: "900", color: THEME.foreground, marginVertical: 4 }}>
                          {fmt(Number(res.total) || 0, reportesMonedaCod)}
                        </Text>
                        <Text style={{ fontSize: 11, color: THEME.mutedForeground }}>
                          {res.count || 0} ventas emitidas · <Text style={{ fontWeight: "700", color: THEME.primary }}>Contado + Crédito</Text>
                        </Text>
                      </View>

                      {/* Tarjeta 2: Cobrado Real (Ancho completo, destacado en verde) */}
                      <View style={[styles.card, { padding: 14, borderRadius: 14, backgroundColor: THEME.successSoft, borderColor: THEME.successBorder }]}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ fontSize: 11, fontWeight: "800", color: THEME.successStrong, letterSpacing: 0.5 }}>
                            TOTAL COBRADO REAL (EN CAJA)
                          </Text>
                          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
                            <Feather name="check-circle" size={15} color={THEME.successStrong} />
                          </View>
                        </View>
                        <Text style={{ fontSize: 24, fontWeight: "900", color: THEME.successStrong, marginVertical: 4 }}>
                          {fmt(Number(res.totalCobradoReal ?? res.ventaContado) || 0, reportesMonedaCod)}
                        </Text>
                        <Text style={{ fontSize: 11, color: THEME.successStrong, fontWeight: "600" }}>
                          {res.countContado || 0} ventas al contado + {res.countAbonos || 0} abonos recibidos
                        </Text>
                      </View>

                      {/* Fila de 2 tarjetas: Deuda y Ticket Promedio */}
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <View style={[styles.kpiCard, { flex: 1, backgroundColor: THEME.warningSoft, borderColor: THEME.warningBorder, padding: 12, borderRadius: 12 }]}>
                          <Text style={{ fontSize: 10, fontWeight: "800", color: THEME.warningStrong }}>
                            EN DEUDA (CRÉDITO)
                          </Text>
                          <Text style={{ fontSize: 17, fontWeight: "900", color: THEME.warningStrong, marginTop: 4 }}>
                            {fmt(Number(res.ventaCredito) || 0, reportesMonedaCod)}
                          </Text>
                          <Text style={{ fontSize: 10, color: THEME.warningStrong, marginTop: 2 }}>
                            {res.countCredito || 0} ventas a crédito
                          </Text>
                        </View>

                        <View style={[styles.kpiCard, { flex: 1, backgroundColor: THEME.card, borderColor: THEME.border, padding: 12, borderRadius: 12 }]}>
                          <Text style={{ fontSize: 10, fontWeight: "800", color: THEME.mutedForeground }}>
                            TICKET PROMEDIO
                          </Text>
                          <Text style={{ fontSize: 17, fontWeight: "900", color: THEME.foreground, marginTop: 4 }}>
                            {fmt(res.count > 0 ? (res.total / res.count) : 0, reportesMonedaCod)}
                          </Text>
                          <Text style={{ fontSize: 10, color: THEME.mutedForeground, marginTop: 2 }}>
                            {res.count || 0} transacciones
                          </Text>
                        </View>
                      </View>

                      {/* Ventas por Método de Pago */}
                      {Array.isArray(monData.ventasPorMetodo) && monData.ventasPorMetodo.length > 0 && (
                        <View style={[styles.card, { padding: 14, borderRadius: 14 }]}>
                          <Text style={{ fontSize: 13, fontWeight: "800", color: THEME.foreground, marginBottom: 8 }}>
                            Ventas por Método de Pago
                          </Text>
                          {monData.ventasPorMetodo.map((m: any, idx: number) => (
                            <View
                              key={idx}
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                alignItems: "center",
                                paddingVertical: 8,
                                borderBottomWidth: 1,
                                borderBottomColor: THEME.border,
                              }}
                            >
                              <Text style={{ fontSize: 13, color: THEME.foreground, fontWeight: "600" }}>{m.nombre}</Text>
                              <View style={{ alignItems: "flex-end" }}>
                                <Text style={{ fontSize: 13, fontWeight: "800", color: THEME.foreground }}>
                                  {fmt(Number(m.total) || 0, reportesMonedaCod)}
                                </Text>
                                <Text style={{ fontSize: 10, color: THEME.mutedForeground, marginTop: 1 }}>{m.count} ventas</Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </>
                  );
                }

                if (reportesTab === "finanzas") {
                  const fin = monData.finanzas || monData.resumen || {};
                  const ventasTot = Number(fin.totalVentas ?? fin.total) || 0;
                  const costoTot = Number(fin.totalCosto) || 0;
                  const ganancia = Number(fin.gananciaBruta ?? (ventasTot - costoTot)) || 0;
                  const margen = ventasTot > 0 ? (ganancia / ventasTot) * 100 : 0;
                  return (
                    <View style={[styles.card, { borderColor: THEME.successBorder, borderWidth: 1.5, borderRadius: 16, padding: 16 }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 }}>
                        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: THEME.successSoft, alignItems: "center", justifyContent: "center" }}>
                          <Feather name="pie-chart" size={16} color={THEME.successStrong} />
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: "800", color: THEME.foreground }}>
                          RESUMEN FINANCIERO Y UTILIDAD ({reportesMonedaCod})
                        </Text>
                      </View>
                      <View style={{ gap: 12 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ fontSize: 13, color: THEME.mutedForeground }}>Ventas Totales:</Text>
                          <Text style={{ fontSize: 15, fontWeight: "700", color: THEME.foreground }}>
                            {fmt(ventasTot, reportesMonedaCod)}
                          </Text>
                        </View>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ fontSize: 13, color: THEME.mutedForeground }}>Costo de Mercancía Vendida:</Text>
                          <Text style={{ fontSize: 15, fontWeight: "700", color: THEME.dangerStrong }}>
                            {fmt(costoTot, reportesMonedaCod)}
                          </Text>
                        </View>
                        <View style={{ height: 1, backgroundColor: THEME.border, marginVertical: 2 }} />
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ fontSize: 14, fontWeight: "800", color: THEME.foreground }}>Utilidad Bruta:</Text>
                          <Text style={{ fontSize: 20, fontWeight: "900", color: THEME.successStrong }}>
                            {fmt(ganancia, reportesMonedaCod)}
                          </Text>
                        </View>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ fontSize: 13, color: THEME.mutedForeground }}>Margen de Ganancia:</Text>
                          <View style={[styles.statusBadge, { backgroundColor: THEME.successSoft, borderColor: THEME.successBorder, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }]}>
                            <Text style={[styles.statusBadgeText, { color: THEME.successStrong, fontWeight: "800", fontSize: 12 }]}>
                              {margen.toFixed(1)}%
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                }

                if (reportesTab === "inventario") {
                  const stockList = Array.isArray(monData.stockBajo)
                    ? monData.stockBajo
                    : productos.filter((p) => p.stock <= (p.stock_minimo || 5));
                  const pageSize = 8;
                  const totalPages = Math.max(1, Math.ceil(stockList.length / pageSize));
                  const paginated = stockList.slice((reportesStockPage - 1) * pageSize, reportesStockPage * pageSize);

                  return (
                    <View style={[styles.card, { borderRadius: 16, padding: 14 }]}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <View>
                          <Text style={{ fontSize: 14, fontWeight: "800", color: THEME.foreground }}>
                            Productos con Bajo Inventario
                          </Text>
                          <Text style={{ fontSize: 11, color: THEME.mutedForeground, marginTop: 1 }}>
                            {stockList.length} productos críticos
                          </Text>
                        </View>
                        {totalPages > 1 && (
                          <View style={{ backgroundColor: THEME.inputBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: THEME.border }}>
                            <Text style={{ fontSize: 11, fontWeight: "700", color: THEME.mutedForeground }}>
                              Pág. {reportesStockPage} de {totalPages}
                            </Text>
                          </View>
                        )}
                      </View>

                      {paginated.length === 0 ? (
                        <View style={{ paddingVertical: 24, alignItems: "center" }}>
                          <Feather name="check-circle" size={28} color={THEME.success} />
                          <Text style={{ fontSize: 13, color: THEME.mutedForeground, marginTop: 8 }}>
                            No hay productos con alertas de stock
                          </Text>
                        </View>
                      ) : (
                        paginated.map((p: any) => {
                          const sinStock = p.stock <= 0;
                          return (
                            <View
                              key={p.id}
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                alignItems: "center",
                                paddingVertical: 10,
                                borderBottomWidth: 1,
                                borderBottomColor: THEME.border,
                              }}
                            >
                              <View style={{ flex: 1, paddingRight: 10 }}>
                                <Text style={{ fontSize: 13, fontWeight: "700", color: THEME.foreground }}>
                                  {p.nombre}
                                </Text>
                                <Text style={{ fontSize: 11, color: THEME.mutedForeground, fontFamily: "monospace", marginTop: 2 }}>
                                  Cód: {p.codigo}
                                </Text>
                              </View>
                              <View style={{ alignItems: "flex-end", gap: 4 }}>
                                <Text
                                  style={{
                                    fontSize: 14,
                                    fontWeight: "800",
                                    color: sinStock ? THEME.dangerStrong : THEME.warningStrong,
                                  }}
                                >
                                  {p.stock} uds.
                                </Text>
                                <View
                                  style={[
                                    styles.statusBadge,
                                    {
                                      backgroundColor: sinStock ? THEME.dangerSoft : THEME.warningSoft,
                                      borderColor: sinStock ? THEME.dangerBorder : THEME.warningBorder,
                                      paddingVertical: 2,
                                      paddingHorizontal: 8,
                                      borderRadius: 6,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.statusBadgeText,
                                      {
                                        fontSize: 10,
                                        fontWeight: "800",
                                        color: sinStock ? THEME.dangerStrong : THEME.warningStrong,
                                      },
                                    ]}
                                  >
                                    {sinStock ? "Sin Stock" : "Bajo Stock"}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          );
                        })
                      )}

                      {totalPages > 1 && (
                        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: THEME.border }}>
                          <TouchableOpacity
                            style={[
                              styles.outlineSmallBtn,
                              { height: 36, paddingHorizontal: 14 },
                              reportesStockPage <= 1 && { opacity: 0.4 },
                            ]}
                            disabled={reportesStockPage <= 1}
                            onPress={() => setReportesStockPage((prev) => Math.max(1, prev - 1))}
                          >
                            <Text style={[styles.outlineSmallBtnText, { fontSize: 12 }]}>Anterior</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              styles.outlineSmallBtn,
                              { height: 36, paddingHorizontal: 14 },
                              reportesStockPage >= totalPages && { opacity: 0.4 },
                            ]}
                            disabled={reportesStockPage >= totalPages}
                            onPress={() => setReportesStockPage((prev) => Math.min(totalPages, prev + 1))}
                          >
                            <Text style={[styles.outlineSmallBtnText, { fontSize: 12 }]}>Siguiente</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                }

                return null;
              })()}
            </ScrollView>
          )}
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
            <TouchableOpacity
              style={styles.posPriceCheckTriggerBtn}
              onPress={() => openBarcodeScanner("consulta")}
              activeOpacity={0.8}
            >
              <Feather name="camera" size={15} color={THEME.primary600} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primarySmallBtn}
              onPress={() => openProductoModal(null)}
            >
              <Feather name="plus" size={14} color="#fff" />
              <Text style={styles.primarySmallBtnText}>Nuevo</Text>
            </TouchableOpacity>
          </View>

          {/* Sub-barra rápida de Catálogo: Productos | Categorías | Marcas */}
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              paddingHorizontal: 12,
              paddingTop: 10,
              paddingBottom: 2,
            }}
          >
            <TouchableOpacity
              style={[styles.posModeTab, styles.posModeTabActive]}
              onPress={() => setRoute("productos")}
            >
              <Feather name="package" size={13} color="#fff" />
              <Text style={[styles.posModeTabText, styles.posModeTabTextActive]}>
                Productos ({productos.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.posModeTab}
              onPress={() => setRoute("categorias")}
            >
              <Feather name="folder" size={13} color={THEME.foreground} />
              <Text style={styles.posModeTabText}>Categorías</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.posModeTab}
              onPress={() => setRoute("marcas")}
            >
              <Feather name="tag" size={13} color={THEME.foreground} />
              <Text style={styles.posModeTabText}>Marcas</Text>
            </TouchableOpacity>
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
                        {item.proveedores && item.proveedores.length > 0
                          ? ` · Prov: ${item.proveedores.map((p) => p.nombre).join(", ")}`
                          : item.proveedor_nombre
                          ? ` · Prov: ${item.proveedor_nombre}`
                          : ""}
                      </Text>
                      {item.descripcion ? (
                        <Text
                          style={[styles.clientCardMeta, { fontStyle: "italic", marginTop: 2 }]}
                          numberOfLines={1}
                        >
                          {item.descripcion}
                        </Text>
                      ) : null}
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

                  {/* Presentaciones si tiene */}
                  {item.presentaciones && item.presentaciones.length > 0 && (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {item.presentaciones.map((pr) => (
                        <View key={pr.id} style={styles.posPresMiniBtn}>
                          <Feather name="box" size={11} color={THEME.primary600} />
                          <Text style={styles.posPresMiniBtnText}>
                            {pr.nombre} x{pr.unidades} ({fmt(precioDeLineaEnMoneda({ product: item, qty: 1, presentacion: pr }, monedaSeleccionada), monedaSeleccionada)})
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Acciones de Producto: Ver | Editar | Stock | Eliminar */}
                  <View style={styles.cartHeaderActionsRow}>
                    <TouchableOpacity
                      style={[styles.cartHeaderActionBtn, { marginTop: 10 }]}
                      onPress={() => openProductoModal(item, "", "view")}
                    >
                      <Feather name="eye" size={13} color={THEME.foreground} />
                      <Text style={styles.cartHeaderActionBtnText}>Ver</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.cartHeaderActionBtn, { marginTop: 10 }]}
                      onPress={() => openProductoModal(item, "", "edit")}
                    >
                      <Feather name="edit-2" size={13} color={THEME.primary600} />
                      <Text style={[styles.cartHeaderActionBtnText, { color: THEME.primary600 }]}>
                        Editar
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.cartHeaderActionBtn, { marginTop: 10 }]}
                      onPress={() => {
                        setAjusteProducto(item);
                        setAjustePresentacionId(null);
                        setAjusteTipo("Entrada");
                        setAjusteCantidad("1");
                        setModalAjusteKardexVisible(true);
                      }}
                    >
                      <Feather name="sliders" size={13} color={THEME.infoStrong} />
                      <Text style={[styles.cartHeaderActionBtnText, { color: THEME.infoStrong }]}>
                        Stock
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.cartHeaderActionBtn,
                        {
                          marginTop: 10,
                          backgroundColor: THEME.dangerSoft,
                          borderColor: THEME.dangerBorder,
                        },
                      ]}
                      onPress={() => handleDeleteProducto(item)}
                    >
                      <Feather name="trash-2" size={13} color={THEME.dangerStrong} />
                      <Text style={[styles.cartHeaderActionBtnText, { color: THEME.dangerStrong }]}>
                        Eliminar
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />
        </View>
      )}

      {/* ==================== 5B. CATEGORÍAS (/categorias) ==================== */}
      {route === "categorias" && (
        <View style={{ flex: 1 }}>
          <View style={styles.moduleHeaderBar}>
            <View style={[styles.searchBox, { flex: 1 }]}>
              <Feather name="search" size={16} color={THEME.mutedForeground} />
              <TextInput
                style={styles.searchBoxInput}
                placeholder="Buscar categoría..."
                placeholderTextColor={THEME.mutedForeground}
                value={catSearch}
                onChangeText={setCatSearch}
              />
            </View>
            <TouchableOpacity style={styles.primarySmallBtn} onPress={() => openCategoriaModal(null)}>
              <Feather name="plus" size={14} color="#fff" />
              <Text style={styles.primarySmallBtnText}>Nueva Categoría</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
            <TouchableOpacity style={styles.posModeTab} onPress={() => setRoute("productos")}>
              <Feather name="package" size={13} color={THEME.foreground} />
              <Text style={styles.posModeTabText}>Productos</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.posModeTab, styles.posModeTabActive]} onPress={() => setRoute("categorias")}>
              <Feather name="folder" size={13} color="#fff" />
              <Text style={[styles.posModeTabText, styles.posModeTabTextActive]}>Categorías</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.posModeTab} onPress={() => setRoute("marcas")}>
              <Feather name="tag" size={13} color={THEME.foreground} />
              <Text style={styles.posModeTabText}>Marcas</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={(categoriasCloud.length > 0 ? categoriasCloud : categorias).filter(
              (c: any) => !catSearch.trim() || c.nombre.toLowerCase().includes(catSearch.toLowerCase())
            )}
            keyExtractor={(item: any) => String(item.id)}
            contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 10 }}
            renderItem={({ item }: { item: any }) => (
              <View style={styles.card}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clientCardName}>{item.nombre}</Text>
                    {item.descripcion ? (
                      <Text style={styles.clientCardMeta}>{item.descripcion}</Text>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity style={styles.outlineSmallBtn} onPress={() => openCategoriaModal(item)}>
                      <Feather name="edit-2" size={13} color={THEME.primary600} />
                      <Text style={styles.outlineSmallBtnText}>Editar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.outlineSmallBtn, { borderColor: THEME.dangerBorder, backgroundColor: THEME.dangerSoft }]}
                      onPress={() => handleDeleteCategoria(item)}
                    >
                      <Feather name="trash-2" size={13} color={THEME.dangerStrong} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          />
        </View>
      )}

      {/* ==================== 5C. MARCAS (/marcas) ==================== */}
      {route === "marcas" && (
        <View style={{ flex: 1 }}>
          <View style={styles.moduleHeaderBar}>
            <View style={[styles.searchBox, { flex: 1 }]}>
              <Feather name="search" size={16} color={THEME.mutedForeground} />
              <TextInput
                style={styles.searchBoxInput}
                placeholder="Buscar marca..."
                placeholderTextColor={THEME.mutedForeground}
                value={marcaSearch}
                onChangeText={setMarcaSearch}
              />
            </View>
            <TouchableOpacity style={styles.primarySmallBtn} onPress={() => openMarcaModal(null)}>
              <Feather name="plus" size={14} color="#fff" />
              <Text style={styles.primarySmallBtnText}>Nueva Marca</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
            <TouchableOpacity style={styles.posModeTab} onPress={() => setRoute("productos")}>
              <Feather name="package" size={13} color={THEME.foreground} />
              <Text style={styles.posModeTabText}>Productos</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.posModeTab} onPress={() => setRoute("categorias")}>
              <Feather name="folder" size={13} color={THEME.foreground} />
              <Text style={styles.posModeTabText}>Categorías</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.posModeTab, styles.posModeTabActive]} onPress={() => setRoute("marcas")}>
              <Feather name="tag" size={13} color="#fff" />
              <Text style={[styles.posModeTabText, styles.posModeTabTextActive]}>Marcas</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={marcasCloud.filter(
              (m: any) => !marcaSearch.trim() || m.nombre.toLowerCase().includes(marcaSearch.toLowerCase())
            )}
            keyExtractor={(item: any) => String(item.id)}
            contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 10 }}
            ListEmptyComponent={
              <View style={[styles.card, { alignItems: "center", paddingVertical: 28 }]}>
                <Feather name="tag" size={26} color={THEME.mutedForeground} />
                <Text style={[styles.clientCardName, { marginTop: 8 }]}>Sin marcas registradas</Text>
                <Text style={styles.clientCardMeta}>Pulsa "Nueva Marca" para agregar una.</Text>
              </View>
            }
            renderItem={({ item }: { item: any }) => (
              <View style={styles.card}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clientCardName}>{item.nombre}</Text>
                    <Text style={styles.clientCardMeta}>
                      {item.pais || item.descripcion || "Marca de catálogo"}
                      {item.productos_count !== undefined ? ` · ${item.productos_count} prod.` : ""}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity style={styles.outlineSmallBtn} onPress={() => openMarcaModal(item)}>
                      <Feather name="edit-2" size={13} color={THEME.primary600} />
                      <Text style={styles.outlineSmallBtnText}>Editar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.outlineSmallBtn, { borderColor: THEME.dangerBorder, backgroundColor: THEME.dangerSoft }]}
                      onPress={() => handleDeleteMarca(item)}
                    >
                      <Feather name="trash-2" size={13} color={THEME.dangerStrong} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          />
        </View>
      )}

      {/* ==================== 5D. COMPRAS (/compras) ==================== */}
      {route === "compras" && (
        <View style={{ flex: 1 }}>
          <View style={styles.moduleHeaderBar}>
            <View style={[styles.searchBox, { flex: 1 }]}>
              <Feather name="search" size={16} color={THEME.mutedForeground} />
              <TextInput
                style={styles.searchBoxInput}
                placeholder="Buscar compra por número o proveedor..."
                placeholderTextColor={THEME.mutedForeground}
                value={comprasSearch}
                onChangeText={setComprasSearch}
              />
            </View>
            <TouchableOpacity style={styles.primarySmallBtn} onPress={openNuevaCompraModal}>
              <Feather name="plus" size={14} color="#fff" />
              <Text style={styles.primarySmallBtnText}>Nueva Compra</Text>
            </TouchableOpacity>
          </View>

          {comprasLoading ? (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
              <ActivityIndicator size="large" color={THEME.primary} />
            </View>
          ) : (
            <FlatList
              data={comprasList.filter(
                (c: any) =>
                  !comprasSearch.trim() ||
                  (c.numero && c.numero.toLowerCase().includes(comprasSearch.toLowerCase())) ||
                  (c.proveedor_nombre &&
                    c.proveedor_nombre.toLowerCase().includes(comprasSearch.toLowerCase()))
              )}
              keyExtractor={(item: any) => String(item.id)}
              contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 10 }}
              ListEmptyComponent={
                <View style={[styles.card, { alignItems: "center", paddingVertical: 30 }]}>
                  <Feather name="shopping-bag" size={28} color={THEME.mutedForeground} />
                  <Text style={[styles.clientCardName, { marginTop: 8 }]}>No hay compras registradas</Text>
                  <Text style={styles.clientCardMeta}>
                    Registra compras de mercancía para abastecer tu inventario.
                  </Text>
                </View>
              }
              renderItem={({ item }: { item: any }) => {
                const itemsDeCompra = compraItemsList.filter(
                  (i: any) => String(i.compra_id) === String(item.id)
                );
                return (
                  <View style={styles.card}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setCompraDetailModal({ compra: item, items: itemsDeCompra })}
                    >
                      <View style={styles.creditoCardHeader}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={styles.creditoNumero}>{item.numero}</Text>
                            <View
                              style={[
                                styles.statusBadge,
                                item.estado === "Pagada"
                                  ? { backgroundColor: THEME.successSoft, borderColor: THEME.successBorder }
                                  : { backgroundColor: THEME.warningSoft, borderColor: THEME.warningBorder },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.statusBadgeText,
                                  {
                                    color:
                                      item.estado === "Pagada" ? THEME.successStrong : THEME.warningStrong,
                                  },
                                ]}
                              >
                                {item.estado || "Pagada"}
                              </Text>
                            </View>
                          </View>
                          <Text style={[styles.clientCardName, { marginTop: 2 }]}>
                            {item.proveedor_nombre || item.proveedor || "Sin proveedor"}
                          </Text>
                          <Text style={styles.clientCardMeta}>
                            Fecha: {String(item.fecha || "").slice(0, 10)} · {itemsDeCompra.length} ítem(s)
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={[styles.posProdPrice, { fontSize: 16 }]}>
                            {fmt(Number(item.total) || 0, item.moneda_codigo || monedaSeleccionada)}
                          </Text>
                          {Number(item.saldo_pendiente) > 0.01 && (
                            <Text style={{ fontSize: 11, fontWeight: "700", color: THEME.dangerStrong }}>
                              Pend.: {fmt(Number(item.saldo_pendiente), item.moneda_codigo || monedaSeleccionada)}
                            </Text>
                          )}
                        </View>
                      </View>
                    </TouchableOpacity>

                    {/* Acciones de Compra idénticas a PC: Ver · Devolver · Eliminar */}
                    <View
                      style={[
                        styles.cartHeaderActionsRow,
                        {
                          marginTop: 10,
                          paddingTop: 8,
                          borderTopWidth: 1,
                          borderTopColor: THEME.border,
                        },
                      ]}
                    >
                      <TouchableOpacity
                        style={styles.cartHeaderActionBtn}
                        onPress={() => setCompraDetailModal({ compra: item, items: itemsDeCompra })}
                      >
                        <Feather name="eye" size={13} color={THEME.foreground} />
                        <Text style={styles.cartHeaderActionBtnText}>Ver</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.cartHeaderActionBtn,
                          {
                            backgroundColor: THEME.warningSoft,
                            borderColor: THEME.warningBorder,
                          },
                        ]}
                        onPress={() => openRetornoDirectoFromCompra(item, itemsDeCompra)}
                      >
                        <Feather name="rotate-ccw" size={13} color={THEME.warningStrong} />
                        <Text style={[styles.cartHeaderActionBtnText, { color: THEME.warningStrong }]}>
                          Devolver
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.cartHeaderActionBtn,
                          {
                            backgroundColor: THEME.dangerSoft,
                            borderColor: THEME.dangerBorder,
                          },
                        ]}
                        onPress={() => handleDeleteCompra(item)}
                      >
                        <Feather name="trash-2" size={13} color={THEME.dangerStrong} />
                        <Text style={[styles.cartHeaderActionBtnText, { color: THEME.dangerStrong }]}>
                          Eliminar
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      )}

      {/* ==================== 5E. RETORNOS Y DEVOLUCIONES (/retornos) ==================== */}
      {route === "retornos" && (
        <View style={{ flex: 1 }}>
          <View style={styles.moduleHeaderBar}>
            <View style={[styles.searchBox, { flex: 1 }]}>
              <Feather name="search" size={16} color={THEME.mutedForeground} />
              <TextInput
                style={styles.searchBoxInput}
                placeholder="Buscar retorno por número, cliente o motivo..."
                placeholderTextColor={THEME.mutedForeground}
                value={retornosSearch}
                onChangeText={setRetornosSearch}
              />
            </View>
            <TouchableOpacity style={styles.primarySmallBtn} onPress={openNuevoRetornoModal}>
              <Feather name="plus" size={14} color="#fff" />
              <Text style={styles.primarySmallBtnText}>Nuevo Retorno</Text>
            </TouchableOpacity>
          </View>

          {retornosLoading ? (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
              <ActivityIndicator size="large" color={THEME.primary} />
            </View>
          ) : (
            <FlatList
              data={retornosList.filter(
                (r: any) =>
                  !retornosSearch.trim() ||
                  (r.numero && r.numero.toLowerCase().includes(retornosSearch.toLowerCase())) ||
                  (r.cliente_nombre && r.cliente_nombre.toLowerCase().includes(retornosSearch.toLowerCase())) ||
                  (r.motivo && r.motivo.toLowerCase().includes(retornosSearch.toLowerCase()))
              )}
              keyExtractor={(item: any) => String(item.id)}
              contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 10 }}
              ListEmptyComponent={
                <View style={[styles.card, { alignItems: "center", paddingVertical: 30 }]}>
                  <Feather name="rotate-ccw" size={28} color={THEME.mutedForeground} />
                  <Text style={[styles.clientCardName, { marginTop: 8 }]}>Sin retornos registrados</Text>
                  <Text style={styles.clientCardMeta}>
                    Registra devoluciones de clientes o a proveedores desde aquí.
                  </Text>
                </View>
              }
              renderItem={({ item }: { item: any }) => {
                const rItems = retornoItemsList.filter(
                  (i: any) => String(i.retorno_id) === String(item.id)
                );
                return (
                  <View style={styles.card}>
                    <View style={styles.creditoCardHeader}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={styles.creditoNumero}>{item.numero}</Text>
                          <View
                            style={[
                              styles.statusBadge,
                              item.tipo === "Cliente"
                                ? { backgroundColor: THEME.infoSoft, borderColor: THEME.infoBorder }
                                : { backgroundColor: THEME.warningSoft, borderColor: THEME.warningBorder },
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusBadgeText,
                                {
                                  color:
                                    item.tipo === "Cliente" ? THEME.infoStrong : THEME.warningStrong,
                                },
                              ]}
                            >
                              {item.tipo}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.clientCardName, { marginTop: 2 }]}>
                          {item.cliente_nombre || item.proveedor_nombre || "General"}
                        </Text>
                        <Text style={styles.clientCardMeta}>
                          Motivo: {item.motivo} · {String(item.fecha || "").slice(0, 10)}
                        </Text>
                        {rItems.length > 0 && (
                          <Text style={[styles.clientCardMeta, { marginTop: 3 }]}>
                            {rItems.map((ri: any) => `${ri.cantidad}x ${ri.producto_nombre}`).join(", ")}
                          </Text>
                        )}
                      </View>
                      <Text style={[styles.posProdPrice, { fontSize: 15 }]}>
                        {fmt(Number(item.monto) || 0, item.moneda_codigo || monedaSeleccionada)}
                      </Text>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      )}

      {/* ==================== 5F. TRANSACCIONES DE CAJA (/transacciones) ==================== */}
      {route === "transacciones" && (
        <View style={{ flex: 1 }}>
          <View style={styles.moduleHeaderBar}>
            <View style={[styles.searchBox, { flex: 1 }]}>
              <Feather name="search" size={16} color={THEME.mutedForeground} />
              <TextInput
                style={styles.searchBoxInput}
                placeholder="Buscar movimiento de caja..."
                placeholderTextColor={THEME.mutedForeground}
                value={transaccionesSearch}
                onChangeText={setTransaccionesSearch}
              />
            </View>
            <TouchableOpacity style={styles.primarySmallBtn} onPress={openNuevaTransModal}>
              <Feather name="plus" size={14} color="#fff" />
              <Text style={styles.primarySmallBtnText}>Registrar</Text>
            </TouchableOpacity>
          </View>

          {transaccionesLoading ? (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
              <ActivityIndicator size="large" color={THEME.primary} />
            </View>
          ) : (
            <FlatList
              data={transaccionesList.filter(
                (t: any) =>
                  !transaccionesSearch.trim() ||
                  (t.descripcion &&
                    t.descripcion.toLowerCase().includes(transaccionesSearch.toLowerCase())) ||
                  (t.caja_nombre &&
                    t.caja_nombre.toLowerCase().includes(transaccionesSearch.toLowerCase()))
              )}
              keyExtractor={(item: any) => String(item.id)}
              contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 10 }}
              renderItem={({ item }: { item: any }) => {
                const isEntrada = item.tipo === "Entrada";
                return (
                  <View style={styles.card}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <View
                            style={[
                              styles.statusBadge,
                              isEntrada
                                ? { backgroundColor: THEME.successSoft, borderColor: THEME.successBorder }
                                : { backgroundColor: THEME.dangerSoft, borderColor: THEME.dangerBorder },
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusBadgeText,
                                { color: isEntrada ? THEME.successStrong : THEME.dangerStrong },
                              ]}
                            >
                              {isEntrada ? "↓ Entrada" : "↑ Salida"}
                            </Text>
                          </View>
                          <Text style={styles.clientCardMeta}>{item.caja_nombre}</Text>
                        </View>
                        <Text style={[styles.clientCardName, { marginTop: 4 }]}>{item.descripcion}</Text>
                        <Text style={styles.clientCardMeta}>
                          {item.fecha ? new Date(item.fecha).toLocaleString() : ""}
                        </Text>
                      </View>
                      <Text
                        style={{
                          fontSize: 15,
                          fontWeight: "900",
                          color: isEntrada ? THEME.successStrong : THEME.dangerStrong,
                        }}
                      >
                        {isEntrada ? "+" : "-"}
                        {fmt(Number(item.monto) || 0, item.moneda_codigo || monedaSeleccionada)}
                      </Text>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      )}

      {/* ==================== 5G. PROVEEDORES (/proveedores) ==================== */}
      {route === "proveedores" && (
        <View style={{ flex: 1 }}>
          <View style={styles.moduleHeaderBar}>
            <View style={[styles.searchBox, { flex: 1 }]}>
              <Feather name="search" size={16} color={THEME.mutedForeground} />
              <TextInput
                style={styles.searchBoxInput}
                placeholder="Buscar proveedor por nombre, RIF o tel..."
                placeholderTextColor={THEME.mutedForeground}
                value={provSearch}
                onChangeText={setProvSearch}
              />
            </View>
            <TouchableOpacity style={styles.primarySmallBtn} onPress={() => openProveedorModal(null)}>
              <Feather name="plus" size={14} color="#fff" />
              <Text style={styles.primarySmallBtnText}>Nuevo</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={proveedoresList.filter(
              (p: any) =>
                !provSearch.trim() ||
                p.nombre.toLowerCase().includes(provSearch.toLowerCase()) ||
                (p.documento && p.documento.toLowerCase().includes(provSearch.toLowerCase()))
            )}
            keyExtractor={(item: any) => String(item.id)}
            contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 10 }}
            ListEmptyComponent={
              <View style={[styles.card, { alignItems: "center", paddingVertical: 30 }]}>
                <Feather name="truck" size={28} color={THEME.mutedForeground} />
                <Text style={[styles.clientCardName, { marginTop: 8 }]}>Sin proveedores registrados</Text>
                <Text style={styles.clientCardMeta}>Pulsa "Nuevo" para registrar un proveedor.</Text>
              </View>
            }
            renderItem={({ item }: { item: any }) => (
              <View style={styles.card}>
                <View style={styles.creditoCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clientCardName}>{item.nombre}</Text>
                    <Text style={styles.clientCardMeta}>
                      {item.documento ? `RIF/Doc: ${item.documento}` : "Sin documento"}
                      {item.telefono ? ` · Tel: ${item.telefono}` : ""}
                    </Text>
                    {(item.contacto || item.ciudad) && (
                      <Text style={styles.clientCardMeta}>
                        {item.contacto ? `Contacto: ${item.contacto}` : ""}
                        {item.ciudad ? ` · ${item.ciudad}` : ""}
                      </Text>
                    )}
                  </View>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <TouchableOpacity style={styles.outlineSmallBtn} onPress={() => openProveedorModal(item)}>
                      <Feather name="edit-2" size={13} color={THEME.primary600} />
                      <Text style={styles.outlineSmallBtnText}>Editar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.outlineSmallBtn, { borderColor: THEME.dangerBorder, backgroundColor: THEME.dangerSoft }]}
                      onPress={() => handleDeleteProveedor(item)}
                    >
                      <Feather name="trash-2" size={13} color={THEME.dangerStrong} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          />
        </View>
      )}

      {/* ==================== 5H. MÉTODOS DE PAGO (/metodos_pago) ==================== */}
      {route === "metodos_pago" && (
        <View style={{ flex: 1 }}>
          <View style={styles.moduleHeaderBar}>
            <Text style={[styles.cardSectionTitle, { flex: 1 }]}>
              Métodos de Pago ({metodosPago.length})
            </Text>
            <TouchableOpacity style={styles.primarySmallBtn} onPress={() => openMetodoPagoModal(null)}>
              <Feather name="plus" size={14} color="#fff" />
              <Text style={styles.primarySmallBtnText}>Nuevo Método</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={metodosPago}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 10 }}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                    <View style={styles.posProdIconWrap}>
                      <Text style={{ fontSize: 16 }}>{getMetodoEmoji(item.tipo, item.nombre)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.clientCardName}>{item.nombre}</Text>
                      <Text style={styles.clientCardMeta}>
                        Tipo: {item.tipo} · Moneda: {item.moneda_codigo || monedaSeleccionada}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <TouchableOpacity style={styles.outlineSmallBtn} onPress={() => openMetodoPagoModal(item)}>
                      <Feather name="edit-2" size={13} color={THEME.primary600} />
                      <Text style={styles.outlineSmallBtnText}>Editar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.outlineSmallBtn, { borderColor: THEME.dangerBorder, backgroundColor: THEME.dangerSoft }]}
                      onPress={() => handleDeleteMetodoPago(item)}
                    >
                      <Feather name="trash-2" size={13} color={THEME.dangerStrong} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          />
        </View>
      )}

      {/* ==================== 5I. MONEDAS Y TASAS (/monedas) ==================== */}
      {route === "monedas" && (
        <View style={{ flex: 1 }}>
          <View style={styles.moduleHeaderBar}>
            <Text style={[styles.cardSectionTitle, { flex: 1 }]}>
              Monedas y Tasas de Cambio ({monedas.length})
            </Text>
            <TouchableOpacity style={styles.primarySmallBtn} onPress={() => openMonedaModal(null)}>
              <Feather name="plus" size={14} color="#fff" />
              <Text style={styles.primarySmallBtnText}>Nueva Moneda</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={monedas}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 10 }}
            renderItem={({ item }) => {
              const directa = tasaDirectaUsd(item);
              return (
                <View style={styles.card}>
                  <View style={styles.creditoCardHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={styles.clientCardName}>
                          {item.nombre} ({item.codigo}) · {item.simbolo}
                        </Text>
                        {item.es_base === 1 && (
                          <View style={[styles.statusBadge, { backgroundColor: THEME.secondary, borderColor: THEME.primary }]}>
                            <Text style={[styles.statusBadgeText, { color: THEME.primary600 }]}>Moneda Base</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.clientCardMeta, { marginTop: 4 }]}>
                        Tasa Oficial: 1 Base = {item.simbolo} {Number(item.tasa).toLocaleString("es-VE", { maximumFractionDigits: 4 })}
                      </Text>
                      {directa !== null && (
                        <Text style={[styles.clientCardMeta, { color: THEME.successStrong, fontWeight: "700" }]}>
                          Tasa Directa USD: {item.simbolo} {Number(directa).toLocaleString("es-VE", { maximumFractionDigits: 4 })} / USD
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity style={styles.primarySmallBtn} onPress={() => openMonedaModal(item)}>
                      <Feather name="edit-2" size={13} color="#fff" />
                      <Text style={styles.primarySmallBtnText}>Actualizar Tasa</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />
        </View>
      )}

      {/* ==================== 5J. USUARIOS Y PERMISOS (/usuarios) ==================== */}
      {route === "usuarios" && (
        <View style={{ flex: 1 }}>
          <View style={styles.moduleHeaderBar}>
            <Text style={[styles.cardSectionTitle, { flex: 1 }]}>
              Usuarios del Sistema ({usuariosList.length})
            </Text>
            <TouchableOpacity style={styles.primarySmallBtn} onPress={() => openUsuarioModal(null)}>
              <Feather name="user-plus" size={14} color="#fff" />
              <Text style={styles.primarySmallBtnText}>Nuevo Usuario</Text>
            </TouchableOpacity>
          </View>

          {usuariosLoading ? (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
              <ActivityIndicator size="large" color={THEME.primary} />
            </View>
          ) : (
            <FlatList
              data={usuariosList}
              keyExtractor={(item: any) => String(item.id)}
              contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 10 }}
              renderItem={({ item }: { item: any }) => (
                <View style={styles.card}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={styles.clientCardName}>{item.name}</Text>
                        <View
                          style={[
                            styles.statusBadge,
                            item.role === "admin"
                              ? { backgroundColor: THEME.secondary, borderColor: THEME.primary }
                              : { backgroundColor: THEME.infoSoft, borderColor: THEME.infoBorder },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusBadgeText,
                              { color: item.role === "admin" ? THEME.primary600 : THEME.infoStrong },
                            ]}
                          >
                            {String(item.role || "usuario").toUpperCase()}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.clientCardMeta}>{item.email}</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <TouchableOpacity style={styles.outlineSmallBtn} onPress={() => openUsuarioModal(item)}>
                        <Feather name="edit-2" size={13} color={THEME.primary600} />
                        <Text style={styles.outlineSmallBtnText}>Editar</Text>
                      </TouchableOpacity>
                      {item.id !== session?.user?.id && (
                        <TouchableOpacity
                          style={[styles.outlineSmallBtn, { borderColor: THEME.dangerBorder, backgroundColor: THEME.dangerSoft }]}
                          onPress={() => handleDeleteUsuario(item)}
                        >
                          <Feather name="trash-2" size={13} color={THEME.dangerStrong} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              )}
            />
          )}
        </View>
      )}

      {/* ==================== 6. PANEL DE CONTROL (/dashboard) ==================== */}
      {route === "dashboard" && (
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

          {/* Accesos Directos a todos los módulos */}
          <View style={styles.card}>
            <Text style={styles.cardSectionTitle}>Módulos del Sistema</Text>
            <View style={styles.quickGrid}>
              <TouchableOpacity style={styles.quickTile} onPress={() => setRoute("pos")}>
                <View style={[styles.quickTileIcon, { backgroundColor: THEME.accent }]}>
                  <Feather name="shopping-cart" size={20} color={THEME.primary} />
                </View>
                <Text style={styles.quickTileTitle}>Punto de Venta</Text>
                <Text style={styles.quickTileSub}>Ventas y Escáner</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickTile} onPress={() => setRoute("productos")}>
                <View style={[styles.quickTileIcon, { backgroundColor: THEME.secondary }]}>
                  <Feather name="package" size={20} color={THEME.primary600} />
                </View>
                <Text style={styles.quickTileTitle}>Productos</Text>
                <Text style={styles.quickTileSub}>Crear, Editar y Precios</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickTile} onPress={() => setRoute("compras")}>
                <View style={[styles.quickTileIcon, { backgroundColor: THEME.infoSoft }]}>
                  <Feather name="shopping-bag" size={20} color={THEME.infoStrong} />
                </View>
                <Text style={styles.quickTileTitle}>Compras</Text>
                <Text style={styles.quickTileSub}>Abastecer Inventario</Text>
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
                <Text style={styles.quickTileSub}>Cuentas por Cobrar</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickTile} onPress={() => setRoute("ventas")}>
                <View style={[styles.quickTileIcon, { backgroundColor: THEME.successSoft }]}>
                  <Feather name="trending-up" size={20} color={THEME.successStrong} />
                </View>
                <Text style={styles.quickTileTitle}>Ventas</Text>
                <Text style={styles.quickTileSub}>Historial y Recibos</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickTile} onPress={() => setRoute("cajas")}>
                <View style={[styles.quickTileIcon, { backgroundColor: THEME.warningSoft }]}>
                  <Feather name="inbox" size={20} color={THEME.warningStrong} />
                </View>
                <Text style={styles.quickTileTitle}>Cajas y Turnos</Text>
                <Text style={styles.quickTileSub}>Apertura y Cierre</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickTile} onPress={() => setRoute("config")}>
                <View style={[styles.quickTileIcon, { backgroundColor: THEME.inputBg }]}>
                  <Feather name="settings" size={20} color={THEME.foreground} />
                </View>
                <Text style={styles.quickTileTitle}>Configuración</Text>
                <Text style={styles.quickTileSub}>Tasas, Empresa y Motor</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      )}

      {/* ==================== 7. CONFIGURACIÓN COMPLETA (/config) ==================== */}
      {route === "config" && (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 90, gap: 12 }} keyboardShouldPersistTaps="handled">
          {/* Sub-pestañas de Configuración */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity
              style={[styles.posModeTab, configSubTab === "motor" && styles.posModeTabActive]}
              onPress={() => setConfigSubTab("motor")}
            >
              <Feather name="cpu" size={13} color={configSubTab === "motor" ? "#fff" : THEME.foreground} />
              <Text style={[styles.posModeTabText, configSubTab === "motor" && styles.posModeTabTextActive]}>
                Motor y Tasas
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.posModeTab, configSubTab === "empresa" && styles.posModeTabActive]}
              onPress={() => setConfigSubTab("empresa")}
            >
              <Feather name="briefcase" size={13} color={configSubTab === "empresa" ? "#fff" : THEME.foreground} />
              <Text style={[styles.posModeTabText, configSubTab === "empresa" && styles.posModeTabTextActive]}>
                Empresa
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.posModeTab, configSubTab === "sync" && styles.posModeTabActive]}
              onPress={() => setConfigSubTab("sync")}
            >
              <Feather name="refresh-cw" size={13} color={configSubTab === "sync" ? "#fff" : THEME.foreground} />
              <Text style={[styles.posModeTabText, configSubTab === "sync" && styles.posModeTabTextActive]}>
                Nube
              </Text>
            </TouchableOpacity>
          </View>

          {configSubTab === "motor" && (
            <>
              <View style={styles.card}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={styles.cardSectionTitle}>Monedas y Tasas Activas</Text>
                  <TouchableOpacity style={styles.outlineSmallBtn} onPress={() => setRoute("monedas")}>
                    <Feather name="edit-2" size={12} color={THEME.primary600} />
                    <Text style={[styles.outlineSmallBtnText, { color: THEME.primary600 }]}>Gestionar Monedas</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ gap: 8, marginTop: 8 }}>
                  {monedas.map((m) => {
                    const directa = tasaDirectaUsd(m);
                    return (
                      <TouchableOpacity
                        key={m.id}
                        style={{
                          backgroundColor: THEME.inputBg,
                          borderWidth: 1,
                          borderColor: THEME.border,
                          borderRadius: 8,
                          padding: 10,
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                        onPress={() => openMonedaModal(m)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: "800", color: THEME.foreground }}>
                            {m.nombre} ({m.codigo}) {m.es_base === 1 ? "· Base" : ""}
                          </Text>
                          {m.es_base !== 1 && (
                            <Text style={styles.clientCardMeta}>
                              Tasa: {m.simbolo} {Number(m.tasa).toLocaleString("es-VE", { maximumFractionDigits: 4 })}
                              {directa !== null ? ` · Directa USD: ${Number(directa).toLocaleString("es-VE", { maximumFractionDigits: 4 })}` : ""}
                            </Text>
                          )}
                        </View>
                        <Feather name="edit-2" size={14} color={THEME.primary600} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardSectionTitle}>Motor de Conversión Global (CPP)</Text>
                <Text style={styles.fieldLabel}>MODO DE CONVERSIÓN EN VENTAS</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(["directa", "triangulacion"] as const).map((modo) => (
                    <TouchableOpacity
                      key={`v-${modo}`}
                      style={[styles.posModeTab, cfgModoVentas === modo && styles.posModeTabActive]}
                      onPress={() => setCfgModoVentas(modo)}
                    >
                      <Text style={[styles.posModeTabText, cfgModoVentas === modo && styles.posModeTabTextActive]}>
                        {modo === "directa" ? "Directa" : "Triangulación"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>MODO DE CONVERSIÓN EN COMPRAS</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(["directa", "triangulacion"] as const).map((modo) => (
                    <TouchableOpacity
                      key={`c-${modo}`}
                      style={[styles.posModeTab, cfgModoCompras === modo && styles.posModeTabActive]}
                      onPress={() => setCfgModoCompras(modo)}
                    >
                      <Text style={[styles.posModeTabText, cfgModoCompras === modo && styles.posModeTabTextActive]}>
                        {modo === "directa" ? "Directa" : "Triangulación"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                  <TouchableOpacity
                    style={[styles.posModeTab, cfgRedondearVentas && styles.posModeTabActive]}
                    onPress={() => setCfgRedondearVentas((v) => !v)}
                  >
                    <Feather
                      name={cfgRedondearVentas ? "check-square" : "square"}
                      size={14}
                      color={cfgRedondearVentas ? "#fff" : THEME.foreground}
                    />
                    <Text style={[styles.posModeTabText, cfgRedondearVentas && styles.posModeTabTextActive]}>
                      Redondear Ventas
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.posModeTab, cfgActualizarEnCompra && styles.posModeTabActive]}
                    onPress={() => setCfgActualizarEnCompra((v) => !v)}
                  >
                    <Feather
                      name={cfgActualizarEnCompra ? "check-square" : "square"}
                      size={14}
                      color={cfgActualizarEnCompra ? "#fff" : THEME.foreground}
                    />
                    <Text style={[styles.posModeTabText, cfgActualizarEnCompra && styles.posModeTabTextActive]}>
                      Auto-Precio en Compra
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>% DE GANANCIA POR DEFECTO</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  value={cfgGananciaDefecto}
                  onChangeText={setCfgGananciaDefecto}
                />

                <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
                  <TouchableOpacity
                    style={[styles.primaryBtn, { flex: 1 }]}
                    onPress={handleSaveConfigGlobal}
                    disabled={savingConfigGlobal}
                  >
                    {savingConfigGlobal ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Feather name="save" size={15} color="#fff" />
                        <Text style={styles.primaryBtnText}>Guardar Reglas</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.outlineSmallBtn, { paddingHorizontal: 14 }]}
                    onPress={handleRecalcularPrecios}
                    disabled={recalculandoPrecios}
                  >
                    {recalculandoPrecios ? (
                      <ActivityIndicator color={THEME.primary} />
                    ) : (
                      <>
                        <Feather name="refresh-cw" size={14} color={THEME.primary600} />
                        <Text style={[styles.outlineSmallBtnText, { color: THEME.primary600 }]}>
                          Recalcular Precios
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}

          {configSubTab === "empresa" && (
            <View style={styles.card}>
              <Text style={styles.cardSectionTitle}>Datos del Negocio / Empresa</Text>
              <Text style={styles.fieldLabel}>NOMBRE DE LA EMPRESA</Text>
              <TextInput
                style={styles.input}
                value={empresaConfig.empresa_nombre || ""}
                onChangeText={(v) => setEmpresaConfig((p) => ({ ...p, empresa_nombre: v }))}
              />
              <Text style={styles.fieldLabel}>RIF / NIT / DOCUMENTO</Text>
              <TextInput
                style={styles.input}
                value={empresaConfig.empresa_rif || ""}
                onChangeText={(v) => setEmpresaConfig((p) => ({ ...p, empresa_rif: v }))}
              />
              <Text style={styles.fieldLabel}>TELÉFONO</Text>
              <TextInput
                style={styles.input}
                value={empresaConfig.empresa_telefono || ""}
                onChangeText={(v) => setEmpresaConfig((p) => ({ ...p, empresa_telefono: v }))}
              />
              <Text style={styles.fieldLabel}>DIRECCIÓN FISCAL</Text>
              <TextInput
                style={styles.input}
                value={empresaConfig.empresa_direccion || ""}
                onChangeText={(v) => setEmpresaConfig((p) => ({ ...p, empresa_direccion: v }))}
              />
              <Text style={styles.fieldLabel}>IVA PORCENTAJE (%)</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={empresaConfig.iva_porcentaje || "16"}
                onChangeText={(v) => setEmpresaConfig((p) => ({ ...p, iva_porcentaje: v }))}
              />
              <TouchableOpacity
                style={[styles.primaryBtn, { marginTop: 16 }]}
                onPress={handleSaveEmpresaConfig}
                disabled={savingConfigGlobal}
              >
                <Feather name="save" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Guardar Datos de Empresa</Text>
              </TouchableOpacity>
            </View>
          )}

          {configSubTab === "sync" && (
            <View style={styles.card}>
              <Text style={styles.cardSectionTitle}>Sincronización en Tiempo Real</Text>
              <Text style={styles.clientCardMeta}>Servidor: {session.serverUrl}</Text>
              <Text style={styles.clientCardMeta}>
                Última actualización:{" "}
                {lastSyncIso ? new Date(lastSyncIso).toLocaleTimeString() : "Recién conectado"}
              </Text>
              <Text style={[styles.clientCardMeta, { color: THEME.successStrong, marginTop: 4 }]}>
                ✓ Sincronización bidireccional activa en segundo plano.
              </Text>
              <TouchableOpacity
                style={[styles.primaryBtn, { marginTop: 14 }]}
                onPress={runSilentSync}
                disabled={syncing}
              >
                <Feather name="refresh-cw" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>
                  {syncing ? "Sincronizando..." : "Sincronizar Ahora"}
                </Text>
              </TouchableOpacity>
            </View>
          )}
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
        statusBarTranslucent={true}
        onRequestClose={() => setDrawerOpen(false)}
      >
        <View
          style={[
            styles.drawerOverlay,
            {
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              height: screenHeight,
              minHeight: screenHeight,
            },
          ]}
        >
          <View
            style={[
              styles.sidebarDrawer,
              {
                height: screenHeight,
                minHeight: screenHeight,
                paddingBottom: Platform.OS === "android" ? 32 : 24,
              },
            ]}
          >
            <View
              style={[
                styles.sidebarHeader,
                { paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 24) + 12 : 18 },
              ]}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                <Image
                  source={require("./assets/logo.png")}
                  style={{ width: 34, height: 34, borderRadius: 8 }}
                  resizeMode="contain"
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.sidebarBrandTitle}>PosBit</Text>
                  <Text style={styles.sidebarBrandSub} numberOfLines={1}>
                    Inventario & POS v2.7 (0.1.36)
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setDrawerOpen(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={{ padding: 4 }}
              >
                <Feather name="x" size={20} color={THEME.sidebarForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: 12,
                paddingTop: 12,
                paddingBottom: 32,
              }}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
              scrollEnabled={true}
              bounces={true}
              overScrollMode="always"
            >
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
                  items: [
                    { id: "productos" as AppRoute, label: "Productos", icon: "package" },
                    { id: "categorias" as AppRoute, label: "Categorías", icon: "folder" },
                    { id: "marcas" as AppRoute, label: "Marcas", icon: "tag" },
                  ],
                },
                {
                  group: "OPERACIONES",
                  items: [
                    { id: "pos" as AppRoute, label: "Punto de Venta", icon: "shopping-cart" },
                    { id: "compras" as AppRoute, label: "Compras", icon: "shopping-bag" },
                    { id: "ventas" as AppRoute, label: "Ventas", icon: "trending-up" },
                    { id: "retornos" as AppRoute, label: "Retornos", icon: "rotate-ccw" },
                    { id: "kardex" as AppRoute, label: "Kardex", icon: "activity" },
                  ],
                },
                {
                  group: "FINANZAS",
                  items: [
                    { id: "cajas" as AppRoute, label: "Cajas y Turnos", icon: "inbox" },
                    { id: "transacciones" as AppRoute, label: "Transacciones", icon: "repeat" },
                  ],
                },
                {
                  group: "MAESTROS",
                  items: [
                    { id: "proveedores" as AppRoute, label: "Proveedores", icon: "truck" },
                    { id: "metodos_pago" as AppRoute, label: "Métodos de Pago", icon: "credit-card" },
                    { id: "monedas" as AppRoute, label: "Monedas y Tasas", icon: "dollar-sign" },
                  ],
                },
                {
                  group: "ANÁLISIS",
                  items: [
                    { id: "reportes" as AppRoute, label: "Reportes", icon: "bar-chart-2" },
                  ],
                },
                {
                  group: "SISTEMA",
                  items: [
                    { id: "usuarios" as AppRoute, label: "Usuarios", icon: "shield" },
                    { id: "config" as AppRoute, label: "Configuración", icon: "settings" },
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

            <View
              style={[
                styles.sidebarFooter,
                { paddingBottom: Platform.OS === "android" ? 32 : 24 },
              ]}
            >
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
            style={{ flex: 1, height: screenHeight, minHeight: screenHeight }}
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
                            disabled={pagoDeudaTotalEnMonedaPago <= 0}
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
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.modalTitle}>
                      Factura {ventaDetailModal.venta.numero}
                    </Text>
                    <Text style={styles.clientCardMeta}>
                      🕒 {fmtDateTime(ventaDetailModal.venta.creado_en || ventaDetailModal.venta.fecha)}
                    </Text>
                    <Text style={[styles.clientCardName, { marginTop: 2 }]}>
                      {ventaDetailModal.venta.cliente_nombre ||
                        ventaDetailModal.venta.cliente ||
                        "Consumidor Final"}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setVentaDetailModal(null)} style={{ padding: 4 }}>
                    <Feather name="x" size={20} color={THEME.mutedForeground} />
                  </TouchableOpacity>
                </View>

                {/* Badges de Modalidad y Estado */}
                <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
                  <View style={[styles.statusBadge, { backgroundColor: THEME.inputBg, borderColor: THEME.border }]}>
                    <Text style={[styles.statusBadgeText, { color: THEME.foreground }]}>
                      {ventaDetailModal.venta.tipo_pago || "Contado"}
                      {ventaDetailModal.venta.metodo_pago_nombre ? ` (${ventaDetailModal.venta.metodo_pago_nombre})` : ""}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      ventaDetailModal.venta.estado === "Pagada"
                        ? { backgroundColor: THEME.successSoft, borderColor: THEME.successBorder }
                        : { backgroundColor: THEME.warningSoft, borderColor: THEME.warningBorder },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        {
                          color:
                            ventaDetailModal.venta.estado === "Pagada"
                              ? THEME.successStrong
                              : THEME.warningStrong,
                        },
                      ]}
                    >
                      {ventaDetailModal.venta.estado || "Pagada"}
                    </Text>
                  </View>
                </View>

                {/* Lista de productos */}
                <Text style={styles.fieldLabelSmall}>PRODUCTOS ({ventaDetailModal.items.length})</Text>
                <FlatList
                  data={ventaDetailModal.items}
                  keyExtractor={(it, idx) => String(it.id || idx)}
                  style={{ maxHeight: 260 }}
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

                {/* Desglose Financiero */}
                <View style={[styles.checkoutBalanceBanner, { marginTop: 10, gap: 4 }]}>
                  {Number(ventaDetailModal.venta.subtotal) > 0 && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Subtotal:</Text>
                      <Text style={styles.summaryVal}>
                        {fmt(
                          Number(ventaDetailModal.venta.subtotal) || 0,
                          ventaDetailModal.venta.moneda_codigo || "USD"
                        )}
                      </Text>
                    </View>
                  )}
                  {Number(ventaDetailModal.venta.descuento) > 0 && (
                    <View style={styles.summaryRow}>
                      <Text style={[styles.summaryLabel, { color: THEME.dangerStrong }]}>Descuento:</Text>
                      <Text style={[styles.summaryVal, { color: THEME.dangerStrong }]}>
                        -{fmt(
                          Number(ventaDetailModal.venta.descuento) || 0,
                          ventaDetailModal.venta.moneda_codigo || "USD"
                        )}
                      </Text>
                    </View>
                  )}
                  {Number(ventaDetailModal.venta.impuesto) > 0 && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Impuesto:</Text>
                      <Text style={styles.summaryVal}>
                        +{fmt(
                          Number(ventaDetailModal.venta.impuesto) || 0,
                          ventaDetailModal.venta.moneda_codigo || "USD"
                        )}
                      </Text>
                    </View>
                  )}
                  {/* Cobros extra (Delivery, Envío, Propina, etc.) */}
                  {(() => {
                    const v = ventaDetailModal.venta;
                    let lista: any[] = [];
                    if (Array.isArray(v.cobros_extra) && v.cobros_extra.length > 0) {
                      lista = v.cobros_extra;
                    } else if (v.cobros_extra_json) {
                      try {
                        lista = JSON.parse(v.cobros_extra_json);
                      } catch {}
                    }
                    if (lista.length > 0) {
                      return lista.map((ce: any, idx: number) => (
                        <View key={`ce-${idx}`} style={styles.summaryRow}>
                          <Text style={[styles.summaryLabel, { color: THEME.primary }]}>
                            + {ce.concepto || "Cobro extra"}:
                          </Text>
                          <Text style={[styles.summaryVal, { color: THEME.primary, fontWeight: "700" }]}>
                            +{fmt(Number(ce.monto) || 0, v.moneda_codigo || "USD")}
                          </Text>
                        </View>
                      ));
                    }
                    if (Number(v.cobros_extra) > 0.009) {
                      return (
                        <View style={styles.summaryRow}>
                          <Text style={[styles.summaryLabel, { color: THEME.primary }]}>Cobros extra:</Text>
                          <Text style={[styles.summaryVal, { color: THEME.primary, fontWeight: "700" }]}>
                            +{fmt(Number(v.cobros_extra), v.moneda_codigo || "USD")}
                          </Text>
                        </View>
                      );
                    }
                    return null;
                  })()}
                  <View style={[styles.summaryTotalRow, { borderTopWidth: 1, borderTopColor: THEME.border, paddingTop: 4 }]}>
                    <Text style={styles.summaryTotalLabel}>Total Factura</Text>
                    <Text style={styles.summaryTotalValue}>
                      {fmt(
                        Number(ventaDetailModal.venta.total) || 0,
                        ventaDetailModal.venta.moneda_codigo || "USD"
                      )}
                    </Text>
                  </View>
                </View>

                {ventaDetailModal.venta.observaciones ? (
                  <Text style={[styles.clientCardMeta, { marginTop: 6, fontStyle: "italic" }]}>
                    Obs: {ventaDetailModal.venta.observaciones}
                  </Text>
                ) : null}

                {/* Botones de Acción de Factura (igual que en PC: Pagar · Retornar · Eliminar) */}
                {(() => {
                  const v = ventaDetailModal.venta;
                  const creditoDeVenta = (creditosData.creditos || []).find(
                    (c) =>
                      (c.venta_id && String(c.venta_id) === String(v.id)) ||
                      (c.venta_numero && c.venta_numero === v.numero)
                  );
                  const tieneDeudaPendiente =
                    v.estado !== "Pagada" || Boolean(creditoDeVenta && creditoDeVenta.saldo > 0.01);

                  return (
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 8,
                        marginTop: 14,
                        paddingTop: 10,
                        borderTopWidth: 1,
                        borderTopColor: THEME.border,
                      }}
                    >
                      {tieneDeudaPendiente && (
                        <TouchableOpacity
                          style={[
                            styles.cartHeaderActionBtn,
                            {
                              flex: 1,
                              backgroundColor: THEME.successSoft,
                              borderColor: THEME.successBorder,
                            },
                          ]}
                          onPress={() => handlePagarVentaCredito(v)}
                        >
                          <Feather name="dollar-sign" size={14} color={THEME.successStrong} />
                          <Text
                            style={[
                              styles.cartHeaderActionBtnText,
                              { color: THEME.successStrong },
                            ]}
                          >
                            Pagar
                          </Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity
                        style={[
                          styles.cartHeaderActionBtn,
                          {
                            flex: 1,
                            backgroundColor: THEME.warningSoft,
                            borderColor: THEME.warningBorder,
                          },
                        ]}
                        onPress={() =>
                          openRetornoDirectoFromVenta(v, ventaDetailModal.items)
                        }
                      >
                        <Feather name="rotate-ccw" size={14} color={THEME.warningStrong} />
                        <Text
                          style={[
                            styles.cartHeaderActionBtnText,
                            { color: THEME.warningStrong },
                          ]}
                        >
                          Retornar
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.cartHeaderActionBtn,
                          {
                            flex: 1,
                            backgroundColor: THEME.dangerSoft,
                            borderColor: THEME.dangerBorder,
                          },
                        ]}
                        onPress={() => handleDeleteVenta(v)}
                      >
                        <Feather name="trash-2" size={14} color={THEME.dangerStrong} />
                        <Text
                          style={[
                            styles.cartHeaderActionBtnText,
                            { color: THEME.dangerStrong },
                          ]}
                        >
                          Eliminar
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })()}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL RETORNO DIRECTO (DESDE VENTA O COMPRA - CLON 1:1 DE PC) ==================== */}
      <Modal
        visible={!!retornoDirectoModal}
        transparent
        animationType="slide"
        onRequestClose={() => setRetornoDirectoModal(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={[styles.modalSheet, { maxHeight: "92%" }]}>
            {retornoDirectoModal &&
              (() => {
                const seleccionados = rdItemsState.filter(
                  (it) => it.seleccionado && it.cantidad > 0
                );
                const totalRetorno = seleccionados.reduce((sum, sel) => {
                  const orig = retornoDirectoModal.items.find(
                    (x) => x.producto_id === sel.producto_id
                  );
                  return sum + (orig?.precio_unit || 0) * sel.cantidad;
                }, 0);

                return (
                  <>
                    <View style={styles.modalHeader}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={styles.modalTitle}>
                          {retornoDirectoModal.tipo === "Cliente"
                            ? `Retornar de ${retornoDirectoModal.referenciaNumero}`
                            : `Devolver Compra ${retornoDirectoModal.referenciaNumero}`}
                        </Text>
                        <Text style={styles.clientCardMeta}>
                          {retornoDirectoModal.entidadNombre} · Selecciona los productos y cantidades
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => setRetornoDirectoModal(null)}
                        style={{ padding: 4 }}
                      >
                        <Feather name="x" size={20} color={THEME.mutedForeground} />
                      </TouchableOpacity>
                    </View>

                    <ScrollView
                      contentContainerStyle={{ gap: 10, paddingBottom: 14 }}
                      keyboardShouldPersistTaps="handled"
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <Text style={styles.fieldLabelSmall}>
                          PRODUCTOS ({retornoDirectoModal.items.length})
                        </Text>
                        <View style={{ flexDirection: "row", gap: 10 }}>
                          <TouchableOpacity
                            onPress={() =>
                              setRdItemsState((prev) =>
                                prev.map((it) => ({ ...it, seleccionado: true }))
                              )
                            }
                          >
                            <Text style={{ fontSize: 11, fontWeight: "700", color: THEME.primary600 }}>
                              Marcar todos
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() =>
                              setRdItemsState((prev) =>
                                prev.map((it) => ({ ...it, seleccionado: false }))
                              )
                            }
                          >
                            <Text
                              style={{
                                fontSize: 11,
                                fontWeight: "600",
                                color: THEME.mutedForeground,
                              }}
                            >
                              Desmarcar
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      {retornoDirectoModal.items.map((orig) => {
                        const st = rdItemsState.find((x) => x.producto_id === orig.producto_id) || {
                          producto_id: orig.producto_id,
                          cantidad: orig.cantidad_original,
                          seleccionado: false,
                        };
                        return (
                          <View
                            key={`rd-${orig.producto_id}`}
                            style={{
                              backgroundColor: st.seleccionado ? THEME.accent : THEME.inputBg,
                              borderWidth: 1,
                              borderColor: st.seleccionado ? THEME.primary : THEME.border,
                              borderRadius: 10,
                              padding: 10,
                              gap: 8,
                            }}
                          >
                            <TouchableOpacity
                              activeOpacity={0.8}
                              onPress={() =>
                                setRdItemsState((prev) =>
                                  prev.map((x) =>
                                    x.producto_id === orig.producto_id
                                      ? { ...x, seleccionado: !x.seleccionado }
                                      : x
                                  )
                                )
                              }
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                              }}
                            >
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                                <Feather
                                  name={st.seleccionado ? "check-square" : "square"}
                                  size={18}
                                  color={st.seleccionado ? THEME.primary600 : THEME.mutedForeground}
                                />
                                <View style={{ flex: 1 }}>
                                  <Text
                                    style={{
                                      fontSize: 13,
                                      fontWeight: "800",
                                      color: THEME.foreground,
                                    }}
                                  >
                                    {orig.producto_nombre}
                                  </Text>
                                  <Text style={styles.clientCardMeta}>
                                    Facturado: {orig.cantidad_original} x{" "}
                                    {fmt(orig.precio_unit, retornoDirectoModal.monedaCodigo)}
                                    {orig.presentacion_nombre
                                      ? ` (${orig.presentacion_nombre})`
                                      : ""}
                                  </Text>
                                </View>
                              </View>
                              <Text style={[styles.posProdPrice, { fontSize: 14 }]}>
                                {fmt(
                                  st.seleccionado ? orig.precio_unit * st.cantidad : 0,
                                  retornoDirectoModal.monedaCodigo
                                )}
                              </Text>
                            </TouchableOpacity>

                            {st.seleccionado && (
                              <View
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  paddingTop: 6,
                                  borderTopWidth: 1,
                                  borderTopColor: THEME.border,
                                }}
                              >
                                <Text style={{ fontSize: 11, fontWeight: "700", color: THEME.mutedForeground }}>
                                  Cantidad a retornar (máx. {orig.cantidad_original}):
                                </Text>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                  <TouchableOpacity
                                    style={{
                                      width: 30,
                                      height: 30,
                                      borderRadius: 7,
                                      borderWidth: 1,
                                      borderColor: THEME.border,
                                      backgroundColor: THEME.card,
                                      alignItems: "center",
                                      justifyContent: "center",
                                    }}
                                    onPress={() =>
                                      setRdItemsState((prev) =>
                                        prev.map((x) =>
                                          x.producto_id === orig.producto_id
                                            ? { ...x, cantidad: Math.max(1, x.cantidad - 1) }
                                            : x
                                        )
                                      )
                                    }
                                  >
                                    <Feather name="minus" size={14} color={THEME.foreground} />
                                  </TouchableOpacity>
                                  <Text
                                    style={{
                                      fontSize: 14,
                                      fontWeight: "800",
                                      color: THEME.foreground,
                                      minWidth: 26,
                                      textAlign: "center",
                                    }}
                                  >
                                    {st.cantidad}
                                  </Text>
                                  <TouchableOpacity
                                    style={{
                                      width: 30,
                                      height: 30,
                                      borderRadius: 7,
                                      borderWidth: 1,
                                      borderColor: THEME.border,
                                      backgroundColor: THEME.card,
                                      alignItems: "center",
                                      justifyContent: "center",
                                    }}
                                    onPress={() =>
                                      setRdItemsState((prev) =>
                                        prev.map((x) =>
                                          x.producto_id === orig.producto_id
                                            ? {
                                                ...x,
                                                cantidad: Math.min(
                                                  orig.cantidad_original,
                                                  x.cantidad + 1
                                                ),
                                              }
                                            : x
                                        )
                                      )
                                    }
                                  >
                                    <Feather name="plus" size={14} color={THEME.foreground} />
                                  </TouchableOpacity>
                                </View>
                              </View>
                            )}
                          </View>
                        );
                      })}

                      {/* Opción de descontar del crédito pendiente (igual que en PC) */}
                      {retornoDirectoModal.tieneCreditoPendiente && (
                        <TouchableOpacity
                          activeOpacity={0.8}
                          onPress={() => setRdAbonarCredito((v) => !v)}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 10,
                            backgroundColor: THEME.warningSoft,
                            borderWidth: 1,
                            borderColor: THEME.warningBorder,
                            borderRadius: 10,
                            padding: 10,
                          }}
                        >
                          <Feather
                            name={rdAbonarCredito ? "check-square" : "square"}
                            size={18}
                            color={THEME.warningStrong}
                          />
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                fontSize: 12.5,
                                fontWeight: "800",
                                color: THEME.warningStrong,
                              }}
                            >
                              Descontar del crédito pendiente
                            </Text>
                            <Text style={{ fontSize: 11, color: THEME.warningStrong }}>
                              El monto retornado se restará del saldo de la deuda asociada
                            </Text>
                          </View>
                        </TouchableOpacity>
                      )}

                      {/* Motivo del retorno con sugerencias rápidas */}
                      <View>
                        <Text style={styles.fieldLabelSmall}>MOTIVO DEL RETORNO</Text>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={{ gap: 6, marginVertical: 6 }}
                        >
                          {[
                            "Devolución de mercancía",
                            "Producto defectuoso",
                            "Cambio de opinión",
                            "Error en pedido",
                            "Garantía",
                          ].map((mot) => (
                            <TouchableOpacity
                              key={mot}
                              style={[
                                styles.catChip,
                                rdMotivo === mot && styles.catChipActive,
                              ]}
                              onPress={() => setRdMotivo(mot)}
                            >
                              <Text
                                style={[
                                  styles.catChipText,
                                  rdMotivo === mot && styles.catChipTextActive,
                                ]}
                              >
                                {mot}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                        <TextInput
                          style={styles.input}
                          placeholder="Motivo de la devolución..."
                          placeholderTextColor={THEME.mutedForeground}
                          value={rdMotivo}
                          onChangeText={setRdMotivo}
                        />
                      </View>

                      {/* Resumen Total a Retornar */}
                      <View style={styles.checkoutBalanceBanner}>
                        <View style={styles.summaryTotalRow}>
                          <Text style={styles.summaryTotalLabel}>
                            Total a retornar ({seleccionados.length} prod.)
                          </Text>
                          <Text style={[styles.summaryTotalValue, { color: THEME.warningStrong }]}>
                            {fmt(totalRetorno, retornoDirectoModal.monedaCodigo)}
                          </Text>
                        </View>
                      </View>

                      <TouchableOpacity
                        style={[
                          styles.primaryBtn,
                          { backgroundColor: THEME.warningStrong },
                          (rdSubmitting || seleccionados.length === 0) && { opacity: 0.6 },
                        ]}
                        disabled={rdSubmitting || seleccionados.length === 0}
                        onPress={handleSubmitRetornoDirecto}
                      >
                        {rdSubmitting ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Feather name="rotate-ccw" size={16} color="#fff" />
                            <Text style={styles.primaryBtnText}>
                              Confirmar Retorno (
                              {fmt(totalRetorno, retornoDirectoModal.monedaCodigo)})
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </ScrollView>
                  </>
                );
              })()}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==================== MODAL CIERRE DE CAJA ==================== */}
      <Modal
        visible={!!cajaParaCierre}
        transparent
        animationType="slide"
        onRequestClose={() => setCajaParaCierre(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {cajaParaCierre && (
              <>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>Cierre de Turno / Caja</Text>
                    <Text style={styles.clientCardMeta}>{cajaParaCierre.nombre}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setCajaParaCierre(null)}>
                    <Feather name="x" size={20} color={THEME.mutedForeground} />
                  </TouchableOpacity>
                </View>

                <View style={[styles.checkoutBalanceBanner, { marginVertical: 10 }]}>
                  <Text style={styles.summaryLabel}>Saldo en Sistema (Arqueo esperado):</Text>
                  <Text style={[styles.checkoutBigTotal, { fontSize: 24, marginTop: 4 }]}>
                    {fmt(Number(cajaParaCierre.saldo_actual) || 0, cajaParaCierre.moneda_codigo)}
                  </Text>
                </View>

                <Text style={[styles.fieldLabelSmall, { marginTop: 6 }]}>
                  OBSERVACIONES DEL ARQUEO / CIERRE (OPCIONAL)
                </Text>
                <TextInput
                  style={[styles.searchBoxInput, { height: 70, textAlignVertical: "top", padding: 8, marginTop: 6 }]}
                  multiline
                  placeholder="Ej. Billetes contados correctamente, sin novedades..."
                  placeholderTextColor={THEME.mutedForeground}
                  value={cierreObservaciones}
                  onChangeText={setCierreObservaciones}
                />

                <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                  <TouchableOpacity
                    style={[styles.outlineSmallBtn, { flex: 1, height: 44, justifyContent: "center" }]}
                    onPress={() => setCajaParaCierre(null)}
                  >
                    <Text style={styles.outlineSmallBtnText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryBtn, { flex: 1.5, height: 44, backgroundColor: THEME.danger }]}
                    onPress={handleCerrarCaja}
                    disabled={submittingCierre}
                  >
                    {submittingCierre ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Feather name="lock" size={16} color="#fff" />
                        <Text style={styles.primaryBtnText}>Confirmar Cierre</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL APERTURA DE CAJA ==================== */}
      <Modal
        visible={!!cajaParaAbrir}
        transparent
        animationType="slide"
        onRequestClose={() => setCajaParaAbrir(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {cajaParaAbrir && (
              <>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>Apertura de Turno / Caja</Text>
                    <Text style={styles.clientCardMeta}>{cajaParaAbrir.nombre}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setCajaParaAbrir(null)}>
                    <Feather name="x" size={20} color={THEME.mutedForeground} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>
                  SALDO INICIAL / BASE DE APERTURA ({cajaParaAbrir.moneda_codigo || ""})
                </Text>
                <TextInput
                  style={[styles.montoIngresadoInput, { marginTop: 6 }]}
                  keyboardType="numeric"
                  placeholder="0.00"
                  placeholderTextColor={THEME.mutedForeground}
                  value={saldoAperturaInput}
                  onChangeText={setSaldoAperturaInput}
                />

                <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                  <TouchableOpacity
                    style={[styles.outlineSmallBtn, { flex: 1, height: 44, justifyContent: "center" }]}
                    onPress={() => setCajaParaAbrir(null)}
                  >
                    <Text style={styles.outlineSmallBtnText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryBtn, { flex: 1.5, height: 44, backgroundColor: THEME.success }]}
                    onPress={handleAbrirCaja}
                    disabled={submittingAbrir}
                  >
                    {submittingAbrir ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Feather name="unlock" size={16} color="#fff" />
                        <Text style={styles.primaryBtnText}>Abrir Turno</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL AJUSTE DE KARDEX ==================== */}
      <Modal
        visible={modalAjusteKardexVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalAjusteKardexVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={[styles.modalSheet, { maxHeight: "90%" }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Ajuste de Inventario</Text>
                <Text style={styles.clientCardMeta}>Entrada o salida manual de existencias</Text>
              </View>
              <TouchableOpacity onPress={() => setModalAjusteKardexVisible(false)}>
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingVertical: 10, gap: 12 }}>
              {/* Selección de Producto */}
              {!ajusteProducto ? (
                <View>
                  <Text style={styles.fieldLabelSmall}>BUSCAR PRODUCTO A AJUSTAR</Text>
                  <View style={[styles.searchBox, { marginTop: 6, marginBottom: 8 }]}>
                    <Feather name="search" size={16} color={THEME.mutedForeground} />
                    <TextInput
                      style={styles.searchBoxInput}
                      placeholder="Escanear código o nombre..."
                      placeholderTextColor={THEME.mutedForeground}
                      value={ajusteSearchProd}
                      onChangeText={setAjusteSearchProd}
                      autoFocus
                    />
                    {ajusteSearchProd.length > 0 && (
                      <TouchableOpacity onPress={() => setAjusteSearchProd("")}>
                        <Feather name="x-circle" size={16} color={THEME.mutedForeground} />
                      </TouchableOpacity>
                    )}
                  </View>

                  <View style={{ maxHeight: 220, borderWidth: 1, borderColor: THEME.border, borderRadius: 10, overflow: "hidden" }}>
                    <ScrollView nestedScrollEnabled>
                      {productos
                        .filter((p) => {
                          if (!ajusteSearchProd.trim()) return true;
                          const q = ajusteSearchProd.toLowerCase().trim();
                          return (
                            p.nombre.toLowerCase().includes(q) ||
                            p.codigo.toLowerCase().includes(q)
                          );
                        })
                        .slice(0, 20)
                        .map((p) => (
                          <TouchableOpacity
                            key={p.id}
                            style={{
                              padding: 10,
                              borderBottomWidth: 1,
                              borderBottomColor: THEME.border,
                              flexDirection: "row",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                            onPress={() => {
                              setAjusteProducto(p);
                              setAjustePresentacionId(null);
                            }}
                          >
                            <View style={{ flex: 1, paddingRight: 6 }}>
                              <Text style={{ fontSize: 13, fontWeight: "600", color: THEME.foreground }}>
                                {p.nombre}
                              </Text>
                              <Text style={{ fontSize: 11, color: THEME.mutedForeground, fontFamily: "monospace" }}>
                                {p.codigo}
                              </Text>
                            </View>
                            <View style={[styles.statusBadge, { backgroundColor: p.stock > 0 ? THEME.successSoft : THEME.dangerSoft, borderColor: p.stock > 0 ? THEME.successBorder : THEME.dangerBorder }]}>
                              <Text style={[styles.statusBadgeText, { color: p.stock > 0 ? THEME.successStrong : THEME.dangerStrong }]}>
                                Stock: {p.stock}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                    </ScrollView>
                  </View>
                </View>
              ) : (
                <View>
                  {/* Tarjeta del producto seleccionado */}
                  <View style={[styles.checkoutBalanceBanner, { marginVertical: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={{ fontSize: 14, fontWeight: "800", color: THEME.foreground }}>
                        {ajusteProducto.nombre}
                      </Text>
                      <Text style={{ fontSize: 11, color: THEME.mutedForeground, fontFamily: "monospace" }}>
                        Cód: {ajusteProducto.codigo} · Stock actual: <Text style={{ fontWeight: "800", color: ajusteProducto.stock > 0 ? THEME.successStrong : THEME.dangerStrong }}>{ajusteProducto.stock} uds.</Text>
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.outlineSmallBtn, { height: 30, paddingHorizontal: 8 }]}
                      onPress={() => {
                        setAjusteProducto(null);
                        setAjustePresentacionId(null);
                      }}
                    >
                      <Text style={[styles.outlineSmallBtnText, { fontSize: 11 }]}>Cambiar</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Selector Unidad vs Presentaciones (Cajas) */}
                  <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>UNIDAD O PRESENTACIÓN (CAJA)</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                    <TouchableOpacity
                      style={[
                        styles.pillFilter,
                        !ajustePresentacionId && styles.pillFilterActive,
                        { paddingHorizontal: 12, paddingVertical: 6 },
                      ]}
                      onPress={() => setAjustePresentacionId(null)}
                    >
                      <Text
                        style={[
                          styles.pillFilterText,
                          !ajustePresentacionId && styles.pillFilterTextActive,
                          { fontSize: 12 },
                        ]}
                      >
                        Por Unidad ({ajusteProducto.stock} disp.)
                      </Text>
                    </TouchableOpacity>

                    {(ajusteProducto.presentaciones || []).map((pres) => {
                      const active = ajustePresentacionId === pres.id;
                      const dispCajas = Math.floor(ajusteProducto.stock / (pres.unidades || 1));
                      return (
                        <TouchableOpacity
                          key={pres.id}
                          style={[
                            styles.pillFilter,
                            active && styles.pillFilterActive,
                            { paddingHorizontal: 12, paddingVertical: 6 },
                          ]}
                          onPress={() => setAjustePresentacionId(pres.id)}
                        >
                          <Text
                            style={[
                              styles.pillFilterText,
                              active && styles.pillFilterTextActive,
                              { fontSize: 12 },
                            ]}
                          >
                            {pres.nombre} ×{pres.unidades} ({dispCajas} disp.)
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Factor informativo */}
                  {(() => {
                    const pres = (ajusteProducto.presentaciones || []).find((pr) => pr.id === ajustePresentacionId);
                    if (pres && pres.unidades > 1) {
                      const cant = parseFloat(ajusteCantidad) || 0;
                      return (
                        <View style={{ backgroundColor: THEME.secondary, padding: 8, borderRadius: 8, marginTop: 6, borderWidth: 1, borderColor: THEME.primary }}>
                          <Text style={{ fontSize: 11, color: THEME.foreground }}>
                            {cant} {pres.nombre} × {pres.unidades} = <Text style={{ fontWeight: "800", color: THEME.primary }}>{cant * pres.unidades} unidades</Text> en total
                          </Text>
                        </View>
                      );
                    }
                    return null;
                  })()}

                  {/* Tipo de Ajuste: Entrada (+) / Salida (-) */}
                  <Text style={[styles.fieldLabelSmall, { marginTop: 12 }]}>TIPO DE MOVIMIENTO</Text>
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                    <TouchableOpacity
                      style={[
                        styles.primaryBtn,
                        {
                          flex: 1,
                          height: 42,
                          backgroundColor: ajusteTipo === "Entrada" ? THEME.success : THEME.inputBg,
                          borderWidth: 1,
                          borderColor: ajusteTipo === "Entrada" ? THEME.successBorder : THEME.border,
                        },
                      ]}
                      onPress={() => setAjusteTipo("Entrada")}
                    >
                      <Feather name="arrow-down" size={16} color={ajusteTipo === "Entrada" ? "#fff" : THEME.foreground} />
                      <Text
                        style={[
                          styles.primaryBtnText,
                          { color: ajusteTipo === "Entrada" ? "#fff" : THEME.foreground },
                        ]}
                      >
                        Entrada (+)
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.primaryBtn,
                        {
                          flex: 1,
                          height: 42,
                          backgroundColor: ajusteTipo === "Salida" ? THEME.danger : THEME.inputBg,
                          borderWidth: 1,
                          borderColor: ajusteTipo === "Salida" ? THEME.dangerBorder : THEME.border,
                        },
                      ]}
                      onPress={() => setAjusteTipo("Salida")}
                    >
                      <Feather name="arrow-up" size={16} color={ajusteTipo === "Salida" ? "#fff" : THEME.foreground} />
                      <Text
                        style={[
                          styles.primaryBtnText,
                          { color: ajusteTipo === "Salida" ? "#fff" : THEME.foreground },
                        ]}
                      >
                        Salida (-)
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Cantidad con Stepper */}
                  <Text style={[styles.fieldLabelSmall, { marginTop: 12 }]}>CANTIDAD A AJUSTAR</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <TouchableOpacity
                      style={[styles.outlineSmallBtn, { width: 44, height: 44, justifyContent: "center", alignItems: "center" }]}
                      onPress={() => {
                        const val = Math.max(1, (parseFloat(ajusteCantidad) || 1) - 1);
                        setAjusteCantidad(String(val));
                      }}
                    >
                      <Feather name="minus" size={18} color={THEME.foreground} />
                    </TouchableOpacity>
                    <TextInput
                      style={[
                        styles.searchBoxInput,
                        {
                          flex: 1,
                          height: 44,
                          textAlign: "center",
                          fontSize: 18,
                          fontWeight: "800",
                          backgroundColor: THEME.inputBg,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: THEME.border,
                        },
                      ]}
                      keyboardType="numeric"
                      value={ajusteCantidad}
                      onChangeText={setAjusteCantidad}
                    />
                    <TouchableOpacity
                      style={[styles.outlineSmallBtn, { width: 44, height: 44, justifyContent: "center", alignItems: "center" }]}
                      onPress={() => {
                        const val = (parseFloat(ajusteCantidad) || 0) + 1;
                        setAjusteCantidad(String(val));
                      }}
                    >
                      <Feather name="plus" size={18} color={THEME.foreground} />
                    </TouchableOpacity>
                  </View>

                  {/* Motivo */}
                  <Text style={[styles.fieldLabelSmall, { marginTop: 12 }]}>MOTIVO DEL AJUSTE</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4, marginBottom: 6 }}>
                    {["Ajuste manual", "Merma", "Conteo físico", "Avería", "Inventario inicial"].map((m) => (
                      <TouchableOpacity
                        key={m}
                        style={[
                          styles.pillFilter,
                          ajusteMotivo === m && styles.pillFilterActive,
                          { paddingHorizontal: 10, paddingVertical: 4 },
                        ]}
                        onPress={() => setAjusteMotivo(m)}
                      >
                        <Text
                          style={[
                            styles.pillFilterText,
                            ajusteMotivo === m && styles.pillFilterTextActive,
                            { fontSize: 11 },
                          ]}
                        >
                          {m}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    style={[styles.searchBoxInput, { height: 40, backgroundColor: THEME.inputBg, borderRadius: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: THEME.border }]}
                    placeholder="Escribe el motivo..."
                    placeholderTextColor={THEME.mutedForeground}
                    value={ajusteMotivo}
                    onChangeText={setAjusteMotivo}
                  />

                  {/* Botones Guardar / Cancelar */}
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                    <TouchableOpacity
                      style={[styles.outlineSmallBtn, { flex: 1, height: 44, justifyContent: "center" }]}
                      onPress={() => setModalAjusteKardexVisible(false)}
                    >
                      <Text style={styles.outlineSmallBtnText}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.primaryBtn,
                        {
                          flex: 1.5,
                          height: 44,
                          backgroundColor: ajusteTipo === "Entrada" ? THEME.success : THEME.primary,
                        },
                      ]}
                      onPress={handleRegistrarAjuste}
                      disabled={ajusteSubmitting}
                    >
                      {ajusteSubmitting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Feather name="check" size={16} color="#fff" />
                          <Text style={styles.primaryBtnText}>Registrar Ajuste</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
                  {Number(receiptModal.cobrosExtra) > 0.009 && (
                    <View style={styles.summaryRow}>
                      <Text style={[styles.summaryLabel, { color: THEME.primary }]}>Cobros Extra:</Text>
                      <Text style={[styles.summaryVal, { color: THEME.primary, fontWeight: "700" }]}>
                        +{fmt(receiptModal.cobrosExtra, receiptModal.moneda)}
                      </Text>
                    </View>
                  )}
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

      {/* ==================== MODAL CREAR / EDITAR / VER PRODUCTO (CLON 1:1 DE PC ProductoModal) ==================== */}
      <Modal
        visible={prodModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setProdModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={[styles.modalSheet, { maxHeight: "94%" }]}>
            {/* Encabezado idéntico a PC */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {prodModalMode === "create"
                  ? "Nuevo Producto"
                  : prodModalMode === "edit"
                  ? "Editar Producto"
                  : "Detalle del Producto"}
              </Text>
              <TouchableOpacity onPress={() => setProdModalOpen(false)}>
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>

            {/* Alerta de Error si hay */}
            {prodFormError ? (
              <View
                style={{
                  backgroundColor: THEME.dangerSoft,
                  borderWidth: 1,
                  borderColor: THEME.dangerBorder,
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  marginBottom: 8,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Feather name="alert-circle" size={14} color={THEME.dangerStrong} />
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12,
                    fontWeight: "600",
                    color: THEME.dangerStrong,
                  }}
                >
                  {prodFormError}
                </Text>
              </View>
            ) : null}

            {/* Stepper para modo CREAR (1. Información -> 2. Precios y presentaciones -> 3. Existencias) */}
            {prodModalMode === "create" && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 10,
                  gap: 4,
                }}
              >
                {[
                  { id: 1 as const, label: "Información" },
                  { id: 2 as const, label: "Precios y cajas" },
                  { id: 3 as const, label: "Existencias" },
                ].map((s, idx) => {
                  const isCompleted = s.id < prodFormStep;
                  const isCurrent = s.id === prodFormStep;
                  return (
                    <React.Fragment key={s.id}>
                      <TouchableOpacity
                        disabled={!isCompleted}
                        onPress={() => isCompleted && setProdFormStep(s.id)}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor:
                              isCompleted || isCurrent ? THEME.primary : THEME.muted,
                          }}
                        >
                          {isCompleted ? (
                            <Feather name="check" size={12} color="#fff" />
                          ) : (
                            <Text
                              style={{
                                fontSize: 11,
                                fontWeight: "800",
                                color: isCurrent ? "#fff" : THEME.mutedForeground,
                              }}
                            >
                              {s.id}
                            </Text>
                          )}
                        </View>
                        <Text
                          style={{
                            fontSize: 11.5,
                            fontWeight: isCurrent ? "800" : "600",
                            color: isCurrent ? THEME.foreground : THEME.mutedForeground,
                          }}
                        >
                          {s.label}
                        </Text>
                      </TouchableOpacity>
                      {idx < 2 && (
                        <View
                          style={{
                            flex: 1,
                            height: 1.5,
                            backgroundColor: isCompleted ? THEME.primary : THEME.border,
                            marginHorizontal: 2,
                          }}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </View>
            )}

            {/* Pestañas directas para modo EDICIÓN (igual que en PC: saltar libremente entre las 3 secciones) */}
            {prodModalMode === "edit" && (
              <View
                style={{
                  flexDirection: "row",
                  gap: 6,
                  marginBottom: 10,
                }}
              >
                {[
                  { id: 1 as const, label: "1. Información" },
                  { id: 2 as const, label: "2. Precios y cajas" },
                  { id: 3 as const, label: "3. Existencias" },
                ].map((s) => {
                  const active = prodFormStep === s.id;
                  return (
                    <TouchableOpacity
                      key={s.id}
                      onPress={() => {
                        setProdFormError("");
                        setProdFormStep(s.id);
                      }}
                      style={{
                        flex: 1,
                        paddingVertical: 8,
                        paddingHorizontal: 6,
                        borderRadius: 8,
                        borderWidth: 1,
                        alignItems: "center",
                        justifyContent: "center",
                        borderColor: active ? THEME.primary : THEME.border,
                        backgroundColor: active ? THEME.accent : THEME.card,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: "800",
                          color: active ? THEME.primary600 : THEME.mutedForeground,
                          textAlign: "center",
                        }}
                        numberOfLines={1}
                      >
                        {s.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <ScrollView
              contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* ==================== MODO VISTA DETALLE (view) ==================== */}
              {prodModalMode === "view" && (editingProd || prodFullCloud) && (
                <View style={{ gap: 10 }}>
                  {(() => {
                    const pView = prodFullCloud || editingProd!;
                    const preciosTres = editingProd
                      ? preciosProductoTresMonedas(editingProd)
                      : [];
                    return (
                      <>
                        <View style={{ flexDirection: "row", gap: 10 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.fieldLabelSmall}>CÓDIGO</Text>
                            <Text
                              style={{
                                fontSize: 14,
                                fontWeight: "800",
                                color: THEME.foreground,
                                fontFamily: "monospace",
                              }}
                            >
                              {pView.codigo}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.fieldLabelSmall}>EXISTENCIAS</Text>
                            <Text
                              style={{
                                fontSize: 14,
                                fontWeight: "800",
                                color: THEME.foreground,
                              }}
                            >
                              {pView.stock} uds. (Mín: {pView.stock_minimo ?? 5})
                            </Text>
                          </View>
                        </View>

                        <View>
                          <Text style={styles.fieldLabelSmall}>NOMBRE</Text>
                          <Text
                            style={{
                              fontSize: 15,
                              fontWeight: "800",
                              color: THEME.foreground,
                            }}
                          >
                            {pView.nombre}
                          </Text>
                        </View>

                        <View>
                          <Text style={styles.fieldLabelSmall}>DESCRIPCIÓN</Text>
                          <Text style={{ fontSize: 13, color: THEME.mutedForeground }}>
                            {pView.descripcion || "—"}
                          </Text>
                        </View>

                        <View style={{ flexDirection: "row", gap: 10 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.fieldLabelSmall}>CATEGORÍA</Text>
                            <Text style={{ fontSize: 13, fontWeight: "700", color: THEME.foreground }}>
                              {pView.categoria_nombre ||
                                (pView.categoria_id
                                  ? (categoriasCloud.length > 0 ? categoriasCloud : categorias).find(
                                      (c: any) => String(c.id) === String(pView.categoria_id)
                                    )?.nombre
                                  : null) ||
                                "—"}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.fieldLabelSmall}>MARCA</Text>
                            <Text style={{ fontSize: 13, fontWeight: "700", color: THEME.foreground }}>
                              {pView.marca_nombre ||
                                (pView.marca_id
                                  ? marcasCloud.find((m: any) => String(m.id) === String(pView.marca_id))
                                      ?.nombre
                                  : null) ||
                                "—"}
                            </Text>
                          </View>
                        </View>

                        <View>
                          <Text style={styles.fieldLabelSmall}>PROVEEDORES</Text>
                          <Text style={{ fontSize: 13, fontWeight: "700", color: THEME.foreground }}>
                            {Array.isArray(pView.proveedores) && pView.proveedores.length > 0
                              ? pView.proveedores.map((pv: any) => pv.nombre).join(", ")
                              : pView.proveedor_nombre ||
                                (pView.proveedor_id
                                  ? proveedoresList.find(
                                      (pv: any) => String(pv.id) === String(pView.proveedor_id)
                                    )?.nombre
                                  : null) ||
                                "—"}
                          </Text>
                        </View>

                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={styles.fieldLabelSmall}>IVA:</Text>
                          <View
                            style={[
                              styles.ivaBadge,
                              pView.iva_incluido !== false && pView.iva_incluido !== 0
                                ? { backgroundColor: THEME.secondary, borderColor: THEME.primary }
                                : {},
                            ]}
                          >
                            <Text
                              style={[
                                styles.ivaBadgeText,
                                pView.iva_incluido !== false && pView.iva_incluido !== 0
                                  ? { color: THEME.primary600 }
                                  : {},
                              ]}
                            >
                              {pView.iva_incluido !== false && pView.iva_incluido !== 0
                                ? "Incluido (16%)"
                                : "Excluido (+IVA)"}
                            </Text>
                          </View>
                        </View>

                        <View
                          style={{
                            backgroundColor: THEME.inputBg,
                            borderRadius: 10,
                            borderWidth: 1,
                            borderColor: THEME.border,
                            padding: 10,
                            gap: 6,
                          }}
                        >
                          <Text style={styles.fieldLabelSmall}>PRECIOS POR MONEDA</Text>
                          {preciosTres.map((pm) => (
                            <View
                              key={pm.codigo}
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                alignItems: "center",
                                paddingVertical: 4,
                                borderBottomWidth: 1,
                                borderBottomColor: THEME.border,
                              }}
                            >
                              <Text style={{ fontSize: 12, fontWeight: "700", color: THEME.foreground }}>
                                {pm.simbolo} {pm.codigo} {pm.es_base_prod ? "(Base)" : ""}
                              </Text>
                              <View style={{ flexDirection: "row", gap: 12 }}>
                                <Text style={{ fontSize: 12, color: THEME.mutedForeground }}>
                                  Costo: {fmt(pm.costo, pm.codigo)}
                                </Text>
                                <Text style={{ fontSize: 12, fontWeight: "800", color: THEME.foreground }}>
                                  Precio: {fmt(pm.precio, pm.codigo)}
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>

                        {prodMargenReal !== null && (
                          <View
                            style={{
                              flexDirection: "row",
                              justifyContent: "space-between",
                              alignItems: "center",
                              backgroundColor: THEME.warningSoft,
                              borderWidth: 1,
                              borderColor: THEME.warningBorder,
                              borderRadius: 8,
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 11,
                                fontWeight: "800",
                                color: THEME.warningStrong,
                              }}
                            >
                              MARGEN REAL
                            </Text>
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: "800",
                                color: THEME.warningStrong,
                              }}
                            >
                              {prodMargenReal.toFixed(2)} %
                            </Text>
                          </View>
                        )}

                        <View>
                          <Text style={styles.fieldLabelSmall}>PRESENTACIONES</Text>
                          {prodFormPresentaciones.length === 0 ? (
                            <Text style={{ fontSize: 12, color: THEME.mutedForeground, marginTop: 4 }}>
                              Sin presentaciones (solo Unidad)
                            </Text>
                          ) : (
                            <View style={{ gap: 6, marginTop: 4 }}>
                              {prodFormPresentaciones.map((pr) => {
                                const uNum = parseInt(pr.unidades, 10) || 1;
                                const r = precioSegunModoProd(pr, uNum);
                                return (
                                  <View
                                    key={pr.key}
                                    style={{
                                      flexDirection: "row",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      backgroundColor: THEME.inputBg,
                                      padding: 8,
                                      borderRadius: 8,
                                      borderWidth: 1,
                                      borderColor: THEME.border,
                                    }}
                                  >
                                    <Text style={{ fontSize: 12, color: THEME.foreground, fontWeight: "600" }}>
                                      {pr.nombre} · 1 = {pr.unidades} unid.
                                      {pr.codigoBarras ? ` (${pr.codigoBarras})` : ""}
                                      {!pr.activo ? " (inactiva)" : ""}
                                    </Text>
                                    <Text
                                      style={{
                                        fontSize: 12,
                                        fontWeight: "800",
                                        color: THEME.primary600,
                                      }}
                                    >
                                      {fmt(r.precio, prodVentaMoneda?.codigo || "USD")}
                                    </Text>
                                  </View>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      </>
                    );
                  })()}
                </View>
              )}

              {/* ==================== PASO 1: INFORMACIÓN (create & edit) ==================== */}
              {prodModalMode !== "view" && prodFormStep === 1 && (
                <View style={{ gap: 10 }}>
                  {/* Código de barras + Escanear + Verificación en vivo */}
                  <View>
                    <Text style={styles.fieldLabelSmall}>CÓDIGO DE BARRAS / SKU *</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                      <TextInput
                        style={[
                          styles.input,
                          { flex: 1 },
                          prodVerifCodigo.estado === "ocupado" && {
                            borderColor: THEME.danger,
                          },
                          prodVerifCodigo.estado === "libre" && {
                            borderColor: THEME.success,
                          },
                        ]}
                        placeholder="Ej: HAR-001 o escanea el código"
                        placeholderTextColor={THEME.mutedForeground}
                        value={prodFormCodigo}
                        onChangeText={setProdFormCodigo}
                        maxLength={50}
                      />
                      <TouchableOpacity
                        style={styles.posScanTriggerBtn}
                        onPress={() => {
                          openBarcodeScanner("unico", (code) => {
                            setProdFormCodigo(code);
                            showToast(`Código ${code} capturado`, "success");
                          });
                        }}
                      >
                        <Feather name="camera" size={15} color="#fff" />
                        <Text style={styles.posScanTriggerBtnText}>Escanear</Text>
                      </TouchableOpacity>
                    </View>
                    {prodVerifCodigo.estado === "libre" && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          marginTop: 4,
                        }}
                      >
                        <Feather name="check-circle" size={12} color={THEME.successStrong} />
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: "600",
                            color: THEME.successStrong,
                          }}
                        >
                          {prodVerifCodigo.mensaje || "Código disponible"}
                        </Text>
                      </View>
                    )}
                    {prodVerifCodigo.estado === "ocupado" && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          marginTop: 4,
                        }}
                      >
                        <Feather name="alert-circle" size={12} color={THEME.dangerStrong} />
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: "600",
                            color: THEME.dangerStrong,
                          }}
                        >
                          {prodVerifCodigo.mensaje}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Nombre */}
                  <View>
                    <Text style={styles.fieldLabelSmall}>NOMBRE DEL PRODUCTO *</Text>
                    <TextInput
                      style={[styles.input, { marginTop: 4 }]}
                      placeholder="Ej: Harina de maíz 1kg"
                      placeholderTextColor={THEME.mutedForeground}
                      value={prodFormNombre}
                      onChangeText={setProdFormNombre}
                      maxLength={200}
                    />
                  </View>

                  {/* Categoría + Botón "+" Nueva Categoría */}
                  <View>
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 4,
                      }}
                    >
                      <Text style={styles.fieldLabelSmall}>CATEGORÍA</Text>
                      <TouchableOpacity
                        style={[styles.outlineSmallBtn, { height: 28, paddingHorizontal: 8 }]}
                        onPress={() => openCategoriaModal(null)}
                      >
                        <Feather name="plus" size={12} color={THEME.primary600} />
                        <Text
                          style={[
                            styles.outlineSmallBtnText,
                            { fontSize: 11, color: THEME.primary600 },
                          ]}
                        >
                          Nueva categoría
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ gap: 6 }}
                    >
                      <TouchableOpacity
                        style={[styles.catChip, !prodFormCatId && styles.catChipActive]}
                        onPress={() => setProdFormCatId("")}
                      >
                        <Text
                          style={[
                            styles.catChipText,
                            !prodFormCatId && styles.catChipTextActive,
                          ]}
                        >
                          Sin categoría
                        </Text>
                      </TouchableOpacity>
                      {(categoriasCloud.length > 0 ? categoriasCloud : categorias).map((c: any) => {
                        const sel = String(prodFormCatId) === String(c.id);
                        return (
                          <TouchableOpacity
                            key={c.id}
                            style={[styles.catChip, sel && styles.catChipActive]}
                            onPress={() => setProdFormCatId(sel ? "" : String(c.id))}
                          >
                            <Text style={[styles.catChipText, sel && styles.catChipTextActive]}>
                              {c.nombre}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>

                  {/* Marca + Botón "+" Nueva Marca */}
                  <View>
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 4,
                      }}
                    >
                      <Text style={styles.fieldLabelSmall}>MARCA</Text>
                      <TouchableOpacity
                        style={[styles.outlineSmallBtn, { height: 28, paddingHorizontal: 8 }]}
                        onPress={() => openMarcaModal(null)}
                      >
                        <Feather name="plus" size={12} color={THEME.primary600} />
                        <Text
                          style={[
                            styles.outlineSmallBtnText,
                            { fontSize: 11, color: THEME.primary600 },
                          ]}
                        >
                          Nueva marca
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ gap: 6 }}
                    >
                      <TouchableOpacity
                        style={[styles.catChip, !prodFormMarcaId && styles.catChipActive]}
                        onPress={() => setProdFormMarcaId("")}
                      >
                        <Text
                          style={[
                            styles.catChipText,
                            !prodFormMarcaId && styles.catChipTextActive,
                          ]}
                        >
                          Sin marca
                        </Text>
                      </TouchableOpacity>
                      {marcasCloud.map((m: any) => {
                        const sel = String(prodFormMarcaId) === String(m.id);
                        return (
                          <TouchableOpacity
                            key={m.id}
                            style={[styles.catChip, sel && styles.catChipActive]}
                            onPress={() => setProdFormMarcaId(sel ? "" : String(m.id))}
                          >
                            <Text style={[styles.catChipText, sel && styles.catChipTextActive]}>
                              {m.nombre}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>

                  {/* Proveedores (Multi-selector N:M) + Botón "+" Nuevo Proveedor */}
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
                        PROVEEDORES ({prodFormProvIds.length} seleccionados)
                      </Text>
                      <TouchableOpacity
                        style={[styles.outlineSmallBtn, { height: 28, paddingHorizontal: 8 }]}
                        onPress={() => openProveedorModal(null)}
                      >
                        <Feather name="plus" size={12} color={THEME.primary600} />
                        <Text
                          style={[
                            styles.outlineSmallBtnText,
                            { fontSize: 11, color: THEME.primary600 },
                          ]}
                        >
                          Nuevo proveedor
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {proveedoresList.length === 0 ? (
                      <Text style={{ fontSize: 11, color: THEME.mutedForeground }}>
                        Sin proveedores registrados. Usa "+ Nuevo proveedor" para crear uno.
                      </Text>
                    ) : (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ gap: 6 }}
                      >
                        {proveedoresList.map((pv: any) => {
                          const sid = String(pv.id);
                          const sel = prodFormProvIds.includes(sid);
                          return (
                            <TouchableOpacity
                              key={pv.id}
                              style={[styles.catChip, sel && styles.catChipActive]}
                              onPress={() =>
                                setProdFormProvIds((prev) =>
                                  prev.includes(sid)
                                    ? prev.filter((x) => x !== sid)
                                    : [...prev, sid]
                                )
                              }
                            >
                              <Text style={[styles.catChipText, sel && styles.catChipTextActive]}>
                                {sel ? "✓ " : ""}
                                {pv.nombre}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    )}
                  </View>

                  {/* Descripción */}
                  <View>
                    <Text style={styles.fieldLabelSmall}>DESCRIPCIÓN</Text>
                    <TextInput
                      style={[
                        styles.input,
                        { marginTop: 4, height: 68, textAlignVertical: "top", paddingTop: 8 },
                      ]}
                      multiline
                      placeholder="Ej: Harina de maíz precocida, marca PAN..."
                      placeholderTextColor={THEME.mutedForeground}
                      value={prodFormDesc}
                      onChangeText={setProdFormDesc}
                      maxLength={500}
                    />
                  </View>

                  {/* IVA Incluido (idéntico al bloque de PC) */}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setProdFormIvaIncluido((v) => !v)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      backgroundColor: THEME.inputBg,
                      borderWidth: 1,
                      borderColor: prodFormIvaIncluido ? THEME.primary : THEME.border,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                    }}
                  >
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: THEME.foreground }}>
                        IVA Incluido
                      </Text>
                      <Text style={{ fontSize: 11, color: THEME.mutedForeground, marginTop: 2 }}>
                        {prodFormIvaIncluido
                          ? "El precio ya incluye el IVA (16%)"
                          : "El IVA se calculará en el punto de venta"}
                      </Text>
                    </View>
                    <View
                      style={{
                        width: 44,
                        height: 26,
                        borderRadius: 13,
                        backgroundColor: prodFormIvaIncluido ? THEME.primary : THEME.muted,
                        justifyContent: "center",
                        paddingHorizontal: 3,
                      }}
                    >
                      <View
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 10,
                          backgroundColor: "#fff",
                          alignSelf: prodFormIvaIncluido ? "flex-end" : "flex-start",
                        }}
                      />
                    </View>
                  </TouchableOpacity>
                </View>
              )}

              {/* ==================== PASO 2: PRECIOS Y PRESENTACIONES (create & edit) ==================== */}
              {prodModalMode !== "view" && prodFormStep === 2 && (
                <View style={{ gap: 12 }}>
                  <Text style={{ fontSize: 11.5, color: THEME.mutedForeground }}>
                    Escribe el costo y precio por presentación (Caja, Bolsa...) o por unidad; todos los valores se sincronizan automáticamente.
                  </Text>

                  {/* ── SECCIÓN PRESENTACIONES / CAJAS (idéntica a renderPresentaciones en PC) ── */}
                  <View
                    style={{
                      backgroundColor: THEME.inputBg,
                      borderWidth: 1,
                      borderColor: THEME.border,
                      borderRadius: 10,
                      padding: 10,
                      gap: 8,
                    }}
                  >
                    <Text style={styles.fieldLabelSmall}>
                      PRESENTACIONES AL MAYOR (CAJA, BOLSA, PAQUETE...)
                    </Text>

                    {/* Sugerencias rápidas de nombre de presentación */}
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ gap: 5 }}
                    >
                      {PRESENTACIONES_SUGERIDAS.map((sug) => {
                        const active =
                          prodNuevaPresNombre.trim().toLowerCase() === sug.toLowerCase();
                        return (
                          <TouchableOpacity
                            key={sug}
                            style={[
                              styles.catChip,
                              { paddingVertical: 4, paddingHorizontal: 9 },
                              active && styles.catChipActive,
                            ]}
                            onPress={() => setProdNuevaPresNombre(sug)}
                          >
                            <Text
                              style={[
                                styles.catChipText,
                                { fontSize: 11 },
                                active && styles.catChipTextActive,
                              ]}
                            >
                              {sug}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>

                    {/* Fila de alta de nueva presentación */}
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <View style={{ flex: 1.3 }}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: THEME.mutedForeground }}>
                          Presentación
                        </Text>
                        <TextInput
                          style={[styles.input, { height: 38, backgroundColor: THEME.card, marginTop: 2 }]}
                          placeholder="Caja, Bolsa..."
                          placeholderTextColor={THEME.mutedForeground}
                          value={prodNuevaPresNombre}
                          onChangeText={setProdNuevaPresNombre}
                        />
                      </View>
                      <View style={{ width: 78 }}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: THEME.mutedForeground }}>
                          Unidades
                        </Text>
                        <TextInput
                          style={[
                            styles.input,
                            { height: 38, backgroundColor: THEME.card, marginTop: 2, textAlign: "center" },
                          ]}
                          placeholder="24"
                          placeholderTextColor={THEME.mutedForeground}
                          keyboardType="numeric"
                          value={prodNuevaPresUnidades}
                          onChangeText={setProdNuevaPresUnidades}
                        />
                      </View>
                    </View>

                    <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                      <TextInput
                        style={[
                          styles.input,
                          { flex: 1, height: 38, backgroundColor: THEME.card },
                          prodVerifNuevaPres.estado === "ocupado" && { borderColor: THEME.danger },
                          prodVerifNuevaPres.estado === "libre" && { borderColor: THEME.success },
                        ]}
                        placeholder="Código de barras de la caja (Opcional)"
                        placeholderTextColor={THEME.mutedForeground}
                        value={prodNuevaPresCodigo}
                        onChangeText={setProdNuevaPresCodigo}
                      />
                      <TouchableOpacity
                        style={[styles.outlineSmallBtn, { height: 38, paddingHorizontal: 10 }]}
                        onPress={() =>
                          openBarcodeScanner("unico", (code) => {
                            setProdNuevaPresCodigo(code);
                            showToast(`Código de caja ${code} capturado`, "success");
                          })
                        }
                      >
                        <Feather name="camera" size={14} color={THEME.primary600} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.primarySmallBtn, { height: 38, paddingHorizontal: 12 }]}
                        onPress={agregarPresentacionDesdePicker}
                      >
                        <Feather name="plus" size={14} color="#fff" />
                        <Text style={styles.primarySmallBtnText}>Agregar</Text>
                      </TouchableOpacity>
                    </View>

                    {prodVerifNuevaPres.estado !== "vacio" &&
                      prodVerifNuevaPres.estado !== "verificando" && (
                        <Text
                          style={{
                            fontSize: 10.5,
                            fontWeight: "600",
                            color:
                              prodVerifNuevaPres.estado === "ocupado"
                                ? THEME.dangerStrong
                                : THEME.successStrong,
                          }}
                        >
                          {prodVerifNuevaPres.estado === "ocupado" ? "⚠️ " : "✓ "}
                          {prodVerifNuevaPres.mensaje}
                        </Text>
                      )}

                    {/* Lista de Presentaciones Agregadas */}
                    {prodFormPresentaciones.length === 0 ? (
                      <View
                        style={{
                          paddingVertical: 12,
                          alignItems: "center",
                          borderWidth: 1,
                          borderStyle: "dashed",
                          borderColor: THEME.border,
                          borderRadius: 8,
                        }}
                      >
                        <Text style={{ fontSize: 11.5, color: THEME.mutedForeground }}>
                          Sin presentaciones. El producto se vende y compra por Unidad.
                        </Text>
                      </View>
                    ) : (
                      prodFormPresentaciones.map((p) => {
                        const unidadesNum = parseInt(p.unidades, 10);
                        const ok = Number.isInteger(unidadesNum) && unidadesNum > 1;
                        const modo = p.modo_venta ?? "derivado";
                        const r = ok
                          ? precioSegunModoProd(p, unidadesNum)
                          : {
                              precio: 0,
                              precioUnitario: 0,
                              costo: 0,
                              margen: null,
                              bajoCosto: false,
                            };
                        const costoCaja = ok
                          ? redondear(prodPrecioUnidadCosto() * unidadesNum, prodDecCosto)
                          : 0;

                        return (
                          <View
                            key={p.key}
                            style={{
                              backgroundColor: THEME.card,
                              borderWidth: 1,
                              borderColor: THEME.border,
                              borderRadius: 8,
                              padding: 9,
                              gap: 7,
                            }}
                          >
                            {/* Fila 1: Nombre, Unidades, Activo y Eliminar */}
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <TextInput
                                style={[styles.input, { flex: 1, height: 36 }]}
                                placeholder="Caja, Bolsa..."
                                value={p.nombre}
                                onChangeText={(v) =>
                                  actualizarPresentacionProd(p.key, { nombre: v })
                                }
                              />
                              <View style={{ width: 68 }}>
                                <TextInput
                                  style={[styles.input, { height: 36, textAlign: "center" }]}
                                  placeholder="Uds"
                                  keyboardType="numeric"
                                  value={p.unidades}
                                  onChangeText={(v) =>
                                    actualizarPresentacionProd(p.key, { unidades: v })
                                  }
                                />
                              </View>
                              <TouchableOpacity
                                style={[
                                  styles.outlineSmallBtn,
                                  { height: 36, paddingHorizontal: 8 },
                                  p.activo && {
                                    backgroundColor: THEME.secondary,
                                    borderColor: THEME.primary,
                                  },
                                ]}
                                onPress={() =>
                                  actualizarPresentacionProd(p.key, { activo: !p.activo })
                                }
                              >
                                <Text
                                  style={{
                                    fontSize: 10.5,
                                    fontWeight: "700",
                                    color: p.activo ? THEME.primary600 : THEME.mutedForeground,
                                  }}
                                >
                                  {p.activo ? "Activa" : "Inactiva"}
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => eliminarPresentacionProd(p.key)}
                                style={{ padding: 4 }}
                              >
                                <Feather name="trash-2" size={16} color={THEME.dangerStrong} />
                              </TouchableOpacity>
                            </View>

                            {/* Fila 2: Código de barras de la caja + Cámara */}
                            <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                              <TextInput
                                style={[
                                  styles.input,
                                  { flex: 1, height: 34, fontSize: 12, fontFamily: "monospace" },
                                ]}
                                placeholder="Código de barras de la caja (opcional)"
                                placeholderTextColor={THEME.mutedForeground}
                                value={p.codigoBarras}
                                onChangeText={(v) =>
                                  actualizarPresentacionProd(p.key, { codigoBarras: v })
                                }
                              />
                              <TouchableOpacity
                                style={[styles.outlineSmallBtn, { height: 34, paddingHorizontal: 9 }]}
                                onPress={() =>
                                  openBarcodeScanner("unico", (code) => {
                                    actualizarPresentacionProd(p.key, { codigoBarras: code });
                                  })
                                }
                              >
                                <Feather name="camera" size={13} color={THEME.primary600} />
                              </TouchableOpacity>
                            </View>

                            {/* Fila 3: Modo de precio (Derivado | Precio fijo | Por margen) */}
                            <View style={{ flexDirection: "row", gap: 5 }}>
                              {(
                                [
                                  { id: "derivado", label: "Derivado" },
                                  { id: "fijo", label: "Precio fijo" },
                                  { id: "margen", label: "Por margen %" },
                                ] as const
                              ).map((mOpt) => {
                                const sel = modo === mOpt.id;
                                return (
                                  <TouchableOpacity
                                    key={mOpt.id}
                                    onPress={() =>
                                      actualizarPresentacionProd(p.key, { modo_venta: mOpt.id })
                                    }
                                    style={{
                                      flex: 1,
                                      paddingVertical: 5,
                                      borderRadius: 6,
                                      borderWidth: 1,
                                      alignItems: "center",
                                      borderColor: sel ? THEME.primary : THEME.border,
                                      backgroundColor: sel ? THEME.accent : THEME.inputBg,
                                    }}
                                  >
                                    <Text
                                      style={{
                                        fontSize: 10.5,
                                        fontWeight: "700",
                                        color: sel ? THEME.primary600 : THEME.mutedForeground,
                                      }}
                                    >
                                      {mOpt.label}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>

                            {/* Fila 4: Costo compra de la caja y Precio venta de la caja (bidireccionales) */}
                            <View style={{ flexDirection: "row", gap: 8 }}>
                              <View style={{ flex: 1 }}>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    fontWeight: "700",
                                    color: THEME.mutedForeground,
                                  }}
                                >
                                  Costo caja ({prodCostoMoneda?.codigo ?? "USD"})
                                </Text>
                                <TextInput
                                  style={[styles.input, { height: 36, marginTop: 2 }]}
                                  keyboardType="decimal-pad"
                                  placeholder="0.00"
                                  value={ok && costoCaja > 0 ? String(costoCaja) : ""}
                                  onChangeText={(val) =>
                                    cambiarPrecioPresentacionCosto(val, unidadesNum)
                                  }
                                />
                                {ok && prodCostoMoneda && prodPrecioUnidadCosto() > 0 && (
                                  <Text
                                    style={{
                                      fontSize: 10,
                                      color: THEME.mutedForeground,
                                      marginTop: 2,
                                    }}
                                  >
                                    = {prodCostoMoneda.simbolo}
                                    {prodPrecioUnidadCosto().toFixed(prodDecCosto)} / unid.
                                  </Text>
                                )}
                              </View>

                              <View style={{ flex: 1 }}>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    fontWeight: "700",
                                    color: THEME.mutedForeground,
                                  }}
                                >
                                  {modo === "margen"
                                    ? "Margen caja (%)"
                                    : `Precio venta (${prodVentaMoneda?.codigo ?? "USD"})`}
                                </Text>
                                {modo === "margen" ? (
                                  <TextInput
                                    style={[styles.input, { height: 36, marginTop: 2 }]}
                                    keyboardType="decimal-pad"
                                    placeholder="15"
                                    value={p.margen_override}
                                    onChangeText={(val) =>
                                      actualizarPresentacionProd(p.key, { margen_override: val })
                                    }
                                  />
                                ) : modo === "fijo" ? (
                                  <TextInput
                                    style={[styles.input, { height: 36, marginTop: 2 }]}
                                    keyboardType="decimal-pad"
                                    placeholder="0.00"
                                    value={p.precio_override}
                                    onChangeText={(val) =>
                                      actualizarPresentacionProd(p.key, { precio_override: val })
                                    }
                                  />
                                ) : (
                                  <TextInput
                                    style={[styles.input, { height: 36, marginTop: 2 }]}
                                    keyboardType="decimal-pad"
                                    placeholder="0.00"
                                    value={ok && r.precio > 0 ? String(r.precio) : ""}
                                    onChangeText={(val) =>
                                      cambiarPrecioPresentacionVenta(val, unidadesNum)
                                    }
                                  />
                                )}
                                {ok && r.precio > 0 && prodVentaMoneda && (
                                  <Text
                                    style={{
                                      fontSize: 10,
                                      color: r.bajoCosto
                                        ? THEME.dangerStrong
                                        : THEME.mutedForeground,
                                      marginTop: 2,
                                    }}
                                  >
                                    = {prodVentaMoneda.simbolo}
                                    {r.precioUnitario.toFixed(prodDecVenta)} / unid.
                                    {r.margen !== null ? ` · ${r.margen}%` : ""}
                                    {r.bajoCosto ? " (Bajo costo)" : ""}
                                  </Text>
                                )}
                              </View>
                            </View>
                          </View>
                        );
                      })
                    )}
                  </View>

                  {/* ── MARGEN DE GANANCIA (%) + MARGEN REAL + BOTÓN REDONDEAR ── */}
                  <View
                    style={{
                      backgroundColor: THEME.inputBg,
                      borderWidth: 1,
                      borderColor: THEME.border,
                      borderRadius: 10,
                      padding: 10,
                      gap: 8,
                    }}
                  >
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: THEME.foreground }}>
                          Margen de ganancia (%)
                        </Text>
                        <Text style={{ fontSize: 10, color: THEME.mutedForeground, marginBottom: 4 }}>
                          Autocalcula el precio de venta
                        </Text>
                        <TextInput
                          style={[styles.input, { height: 38, backgroundColor: THEME.card }]}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={THEME.mutedForeground}
                          value={prodFormGanancia}
                          onChangeText={handleProdMargenChange}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "700",
                            color: THEME.warningStrong,
                          }}
                        >
                          Margen real
                        </Text>
                        <Text style={{ fontSize: 10, color: THEME.mutedForeground, marginBottom: 4 }}>
                          Venta vs. costo en {prodVentaMoneda?.codigo || "USD"}
                        </Text>
                        <View
                          style={{
                            height: 38,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: THEME.warningBorder,
                            backgroundColor: THEME.warningSoft,
                            justifyContent: "center",
                            paddingHorizontal: 10,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 13,
                              fontWeight: "800",
                              color: THEME.warningStrong,
                              fontFamily: "monospace",
                            }}
                          >
                            {prodMargenReal == null ? "—" : `${prodMargenReal.toFixed(2)} %`}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {prodPrecioRedondeadoSugerido && prodVentaMoneda && (
                      <TouchableOpacity
                        style={[
                          styles.outlineSmallBtn,
                          {
                            alignSelf: "flex-start",
                            borderColor: THEME.primary,
                            backgroundColor: THEME.secondary,
                          },
                        ]}
                        onPress={() =>
                          handleProdPrecioVentaChange(
                            String(prodVentaMoneda.id),
                            prodPrecioRedondeadoSugerido.precio.toFixed(prodDecVenta)
                          )
                        }
                      >
                        <Feather name="zap" size={12} color={THEME.primary600} />
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: "700",
                            color: THEME.primary600,
                          }}
                        >
                          Redondear a múltiplo de {prodPrecioRedondeadoSugerido.multiplo} →{" "}
                          {prodVentaMoneda.simbolo}{" "}
                          {prodPrecioRedondeadoSugerido.precio.toFixed(prodDecVenta)}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* ── TARJETAS DE PRECIOS UNITARIOS POR MONEDA (idénticas a renderMonedaCard en PC) ── */}
                  <Text style={styles.fieldLabelSmall}>PRECIOS UNITARIOS POR MONEDA</Text>
                  {monedas.map((m) => {
                    const mIdStr = String(m.id);
                    const esRefCompra = String(prodFormMonedaCostoId) === mIdStr;
                    const esRefVenta = String(prodFormMonedaPrecioId) === mIdStr;
                    const esAlgunaRef = esRefCompra || esRefVenta;
                    const vals = prodFormPreciosPorMoneda[mIdStr] || {
                      precioCompra: "",
                      precioVenta: "",
                    };

                    return (
                      <View
                        key={m.id}
                        style={{
                          borderRadius: 10,
                          borderWidth: 1.5,
                          borderColor: esAlgunaRef ? THEME.primary : THEME.border,
                          backgroundColor: esAlgunaRef ? THEME.accent : THEME.card,
                          padding: 10,
                          gap: 8,
                        }}
                      >
                        {/* Cabecera de la moneda + selectores Moneda de compra / Moneda de venta */}
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 6,
                          }}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <View
                              style={{
                                paddingHorizontal: 7,
                                paddingVertical: 3,
                                borderRadius: 6,
                                backgroundColor: esAlgunaRef ? THEME.primary : THEME.muted,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 11,
                                  fontWeight: "800",
                                  color: esAlgunaRef ? "#fff" : THEME.mutedForeground,
                                }}
                              >
                                {m.simbolo} {m.codigo}
                              </Text>
                            </View>
                            <Text
                              style={{
                                fontSize: 12.5,
                                fontWeight: "700",
                                color: THEME.foreground,
                              }}
                            >
                              {m.nombre}
                            </Text>
                            {m.es_base === 1 && (
                              <Text style={{ fontSize: 10, color: THEME.mutedForeground }}>
                                (Base)
                              </Text>
                            )}
                          </View>

                          {/* Radios: Moneda de compra | Moneda de venta */}
                          <View style={{ flexDirection: "row", gap: 6 }}>
                            <TouchableOpacity
                              onPress={() => handleSelectProdCostoMoneda(mIdStr)}
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 4,
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                borderRadius: 6,
                                borderWidth: 1,
                                borderColor: esRefCompra ? THEME.primary : THEME.border,
                                backgroundColor: esRefCompra ? THEME.secondary : THEME.inputBg,
                              }}
                            >
                              <Feather
                                name={esRefCompra ? "check-circle" : "circle"}
                                size={11}
                                color={esRefCompra ? THEME.primary600 : THEME.mutedForeground}
                              />
                              <Text
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: "700",
                                  color: esRefCompra ? THEME.primary600 : THEME.mutedForeground,
                                }}
                              >
                                Moneda compra
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={() => handleSelectProdVentaMoneda(mIdStr)}
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 4,
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                borderRadius: 6,
                                borderWidth: 1,
                                borderColor: esRefVenta ? THEME.primary : THEME.border,
                                backgroundColor: esRefVenta ? THEME.secondary : THEME.inputBg,
                              }}
                            >
                              <Feather
                                name={esRefVenta ? "check-circle" : "circle"}
                                size={11}
                                color={esRefVenta ? THEME.primary600 : THEME.mutedForeground}
                              />
                              <Text
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: "700",
                                  color: esRefVenta ? THEME.primary600 : THEME.mutedForeground,
                                }}
                              >
                                Moneda venta
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>

                        {/* Inputs: Precio de compra (COD) y Precio de venta (COD) */}
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <View style={{ flex: 1 }}>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 4,
                                marginBottom: 3,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: "700",
                                  color: THEME.mutedForeground,
                                }}
                              >
                                Precio compra ({m.codigo})
                              </Text>
                              {esRefCompra && (
                                <Text
                                  style={{
                                    fontSize: 9.5,
                                    fontWeight: "800",
                                    color: THEME.primary600,
                                  }}
                                >
                                  Ref.
                                </Text>
                              )}
                            </View>
                            <TextInput
                              style={[
                                styles.input,
                                {
                                  height: 38,
                                  backgroundColor: esRefCompra ? THEME.card : THEME.inputBg,
                                  opacity: esRefCompra ? 1 : 0.75,
                                },
                              ]}
                              editable={esRefCompra}
                              keyboardType="decimal-pad"
                              placeholder={esRefCompra ? "0.00" : "Auto..."}
                              placeholderTextColor={THEME.mutedForeground}
                              value={vals.precioCompra}
                              onChangeText={(v) => handleProdPrecioCompraChange(mIdStr, v)}
                            />
                          </View>

                          <View style={{ flex: 1 }}>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 4,
                                marginBottom: 3,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: "700",
                                  color: THEME.mutedForeground,
                                }}
                              >
                                Precio venta ({m.codigo})
                              </Text>
                              {esRefVenta && (
                                <Text
                                  style={{
                                    fontSize: 9.5,
                                    fontWeight: "800",
                                    color: THEME.primary600,
                                  }}
                                >
                                  Ref.
                                </Text>
                              )}
                            </View>
                            <TextInput
                              style={[
                                styles.input,
                                {
                                  height: 38,
                                  backgroundColor: esRefVenta ? THEME.card : THEME.inputBg,
                                  opacity: esRefVenta ? 1 : 0.75,
                                },
                              ]}
                              editable={esRefVenta}
                              keyboardType="decimal-pad"
                              placeholder={esRefVenta ? "0.00" : "Auto..."}
                              placeholderTextColor={THEME.mutedForeground}
                              value={vals.precioVenta}
                              onChangeText={(v) => handleProdPrecioVentaChange(mIdStr, v)}
                            />
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* ==================== PASO 3: EXISTENCIAS (create & edit) ==================== */}
              {prodModalMode !== "view" && prodFormStep === 3 && (
                <View style={{ gap: 12 }}>
                  {/* StockConPresentaciones: cantidad + selector Unidad vs Presentaciones */}
                  <View
                    style={{
                      backgroundColor: THEME.inputBg,
                      borderWidth: 1,
                      borderColor: THEME.border,
                      borderRadius: 10,
                      padding: 10,
                      gap: 8,
                    }}
                  >
                    <Text style={styles.fieldLabelSmall}>
                      {prodModalMode === "create"
                        ? "EXISTENCIAS INICIALES"
                        : "EXISTENCIAS ACTUALES"}
                    </Text>

                    {/* Selector de Unidad o Presentación */}
                    {prodFormPresentaciones.some(
                      (p) => p.nombre.trim() && parseInt(p.unidades, 10) > 1
                    ) && (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ gap: 6 }}
                      >
                        <TouchableOpacity
                          style={[
                            styles.catChip,
                            !prodFormStockUnidadId && styles.catChipActive,
                          ]}
                          onPress={() => cambiarUnidadStockProd("")}
                        >
                          <Text
                            style={[
                              styles.catChipText,
                              !prodFormStockUnidadId && styles.catChipTextActive,
                            ]}
                          >
                            Unidades (×1)
                          </Text>
                        </TouchableOpacity>
                        {prodFormPresentaciones
                          .filter((p) => p.nombre.trim() && parseInt(p.unidades, 10) > 1)
                          .map((p) => {
                            const sel = prodFormStockUnidadId === p.key;
                            return (
                              <TouchableOpacity
                                key={p.key}
                                style={[styles.catChip, sel && styles.catChipActive]}
                                onPress={() => cambiarUnidadStockProd(p.key)}
                              >
                                <Text
                                  style={[styles.catChipText, sel && styles.catChipTextActive]}
                                >
                                  {p.nombre.trim()} (×{p.unidades})
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                      </ScrollView>
                    )}

                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 10.5, color: THEME.mutedForeground }}>
                          Cantidad en{" "}
                          {prodFormStockUnidadId
                            ? prodFormPresentaciones.find(
                                (p) => p.key === prodFormStockUnidadId
                              )?.nombre || "presentación"
                            : "Unidades"}
                        </Text>
                        <TextInput
                          style={[styles.input, { marginTop: 4, backgroundColor: THEME.card }]}
                          keyboardType="decimal-pad"
                          value={prodFormStockTexto}
                          onChangeText={teclearStockProd}
                        />
                        {factorDeStockProd(prodFormStockUnidadId) > 1 && (
                          <Text
                            style={{
                              fontSize: 11,
                              fontWeight: "700",
                              color: THEME.primary600,
                              marginTop: 4,
                            }}
                          >
                            = {prodFormStock} unidades en total
                          </Text>
                        )}
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 10.5, color: THEME.mutedForeground }}>
                          Existencias mínimas (alerta)
                        </Text>
                        <TextInput
                          style={[styles.input, { marginTop: 4, backgroundColor: THEME.card }]}
                          keyboardType="numeric"
                          value={prodFormStockMin}
                          onChangeText={setProdFormStockMin}
                        />
                      </View>
                    </View>
                  </View>

                  {/* Switch Producto Activo */}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setProdFormActivo((v) => !v)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      backgroundColor: THEME.inputBg,
                      borderWidth: 1,
                      borderColor: prodFormActivo ? THEME.primary : THEME.border,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "700", color: THEME.foreground }}>
                      Producto Activo
                    </Text>
                    <View
                      style={{
                        width: 44,
                        height: 26,
                        borderRadius: 13,
                        backgroundColor: prodFormActivo ? THEME.primary : THEME.muted,
                        justifyContent: "center",
                        paddingHorizontal: 3,
                      }}
                    >
                      <View
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 10,
                          backgroundColor: "#fff",
                          alignSelf: prodFormActivo ? "flex-end" : "flex-start",
                        }}
                      />
                    </View>
                  </TouchableOpacity>

                  {/* Resumen del producto (idéntico al Paso 3 de PC en modo Crear) */}
                  <View
                    style={{
                      backgroundColor: THEME.inputBg,
                      borderWidth: 1,
                      borderColor: THEME.border,
                      borderRadius: 10,
                      padding: 12,
                      gap: 6,
                    }}
                  >
                    <Text style={styles.fieldLabelSmall}>RESUMEN DEL PRODUCTO</Text>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Código:</Text>
                      <Text style={styles.summaryVal}>{prodFormCodigo || "—"}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Nombre:</Text>
                      <Text style={styles.summaryVal}>{prodFormNombre || "—"}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Moneda de compra:</Text>
                      <Text style={styles.summaryVal}>
                        {prodCostoMoneda
                          ? `${prodCostoMoneda.simbolo} ${prodCostoMoneda.codigo}`
                          : "—"}
                      </Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Precio de compra (Costo):</Text>
                      <Text style={styles.summaryVal}>
                        {prodCostoMoneda &&
                        prodFormPreciosPorMoneda[String(prodCostoMoneda.id)]?.precioCompra
                          ? `${prodCostoMoneda.simbolo} ${
                              prodFormPreciosPorMoneda[String(prodCostoMoneda.id)].precioCompra
                            }`
                          : "—"}
                      </Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Moneda de venta:</Text>
                      <Text style={styles.summaryVal}>
                        {prodVentaMoneda
                          ? `${prodVentaMoneda.simbolo} ${prodVentaMoneda.codigo}`
                          : "—"}
                      </Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Precio de venta:</Text>
                      <Text style={styles.summaryVal}>
                        {prodVentaMoneda &&
                        prodFormPreciosPorMoneda[String(prodVentaMoneda.id)]?.precioVenta
                          ? `${prodVentaMoneda.simbolo} ${
                              prodFormPreciosPorMoneda[String(prodVentaMoneda.id)].precioVenta
                            }`
                          : "—"}
                      </Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Presentaciones:</Text>
                      <Text style={styles.summaryVal}>
                        {prodFormPresentaciones.length > 0
                          ? prodFormPresentaciones
                              .map((p) => `${p.nombre.trim() || "—"} ×${p.unidades || "?"}`)
                              .join(", ")
                          : "— (se vende por Unidad)"}
                      </Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Existencias:</Text>
                      <Text style={styles.summaryVal}>{prodFormStock} uds.</Text>
                    </View>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Footer de Navegación / Acciones idéntico a PC */}
            <View
              style={{
                flexDirection: "row",
                gap: 8,
                paddingTop: 10,
                borderTopWidth: 1,
                borderTopColor: THEME.border,
              }}
            >
              {prodModalMode === "view" ? (
                <>
                  <TouchableOpacity
                    style={[styles.outlineSmallBtn, { flex: 1, height: 42, justifyContent: "center" }]}
                    onPress={() => setProdModalOpen(false)}
                  >
                    <Text style={styles.outlineSmallBtnText}>Cerrar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryBtn, { flex: 1, height: 42, marginTop: 0 }]}
                    onPress={() => setProdModalMode("edit")}
                  >
                    <Feather name="edit-2" size={14} color="#fff" />
                    <Text style={styles.primaryBtnText}>Editar Producto</Text>
                  </TouchableOpacity>
                </>
              ) : prodModalMode === "create" ? (
                <>
                  {prodFormStep > 1 ? (
                    <TouchableOpacity
                      style={[
                        styles.outlineSmallBtn,
                        { height: 42, paddingHorizontal: 12, justifyContent: "center" },
                      ]}
                      onPress={prevStepProd}
                      disabled={savingProd}
                    >
                      <Feather name="chevron-left" size={14} color={THEME.foreground} />
                      <Text style={styles.outlineSmallBtnText}>Anterior</Text>
                    </TouchableOpacity>
                  ) : null}

                  <TouchableOpacity
                    style={[
                      styles.outlineSmallBtn,
                      {
                        flex: prodFormStep === 1 ? 1 : undefined,
                        height: 42,
                        paddingHorizontal: 14,
                        justifyContent: "center",
                      },
                    ]}
                    onPress={() => setProdModalOpen(false)}
                    disabled={savingProd}
                  >
                    <Text style={styles.outlineSmallBtnText}>Cancelar</Text>
                  </TouchableOpacity>

                  {prodFormStep < 3 ? (
                    <TouchableOpacity
                      style={[styles.primaryBtn, { flex: 1, height: 42, marginTop: 0 }]}
                      onPress={nextStepProd}
                    >
                      <Text style={styles.primaryBtnText}>Siguiente</Text>
                      <Feather name="chevron-right" size={15} color="#fff" />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.primaryBtn, { flex: 1, height: 42, marginTop: 0 }]}
                      onPress={handleSaveProducto}
                      disabled={savingProd}
                    >
                      {savingProd ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <>
                          <Feather name="check" size={16} color="#fff" />
                          <Text style={styles.primaryBtnText}>Crear Producto</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                /* Modo Editar: Cancelar + Guardar desde cualquier pestaña (igual que en PC) */
                <>
                  <TouchableOpacity
                    style={[styles.outlineSmallBtn, { flex: 1, height: 42, justifyContent: "center" }]}
                    onPress={() => setProdModalOpen(false)}
                    disabled={savingProd}
                  >
                    <Text style={styles.outlineSmallBtnText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryBtn, { flex: 1.4, height: 42, marginTop: 0 }]}
                    onPress={handleSaveProducto}
                    disabled={savingProd || !prodFormNombre.trim()}
                  >
                    {savingProd ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Feather name="check" size={16} color="#fff" />
                        <Text style={styles.primaryBtnText}>Guardar</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==================== MODAL CATEGORÍA ==================== */}
      <Modal
        visible={catModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCatModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingCat ? "Editar Categoría" : "Nueva Categoría"}
              </Text>
              <TouchableOpacity onPress={() => setCatModalOpen(false)}>
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabelSmall}>NOMBRE DE CATEGORÍA *</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej. Víveres, Bebidas..."
              value={catFormNombre}
              onChangeText={setCatFormNombre}
            />
            <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>DESCRIPCIÓN</Text>
            <TextInput
              style={styles.input}
              placeholder="Descripción opcional"
              value={catFormDesc}
              onChangeText={setCatFormDesc}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 14 }]}
              onPress={handleSaveCategoria}
              disabled={savingCat}
            >
              <Text style={styles.primaryBtnText}>
                {savingCat ? "Guardando..." : "Guardar Categoría"}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==================== MODAL MARCA ==================== */}
      <Modal
        visible={marcaModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMarcaModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingMarca ? "Editar Marca" : "Nueva Marca"}</Text>
              <TouchableOpacity onPress={() => setMarcaModalOpen(false)}>
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabelSmall}>NOMBRE DE LA MARCA *</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej. Polar, Nestlé..."
              value={marcaFormNombre}
              onChangeText={setMarcaFormNombre}
            />
            <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>DESCRIPCIÓN</Text>
            <TextInput
              style={styles.input}
              placeholder="Descripción opcional"
              value={marcaFormDesc}
              onChangeText={setMarcaFormDesc}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 14 }]}
              onPress={handleSaveMarca}
              disabled={savingMarca}
            >
              <Text style={styles.primaryBtnText}>
                {savingMarca ? "Guardando..." : "Guardar Marca"}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==================== MODAL PROVEEDOR ==================== */}
      <Modal
        visible={provModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setProvModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={[styles.modalSheet, { maxHeight: "88%" }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingProv ? "Editar Proveedor" : "Nuevo Proveedor"}
              </Text>
              <TouchableOpacity onPress={() => setProvModalOpen(false)}>
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabelSmall}>NOMBRE / RAZÓN SOCIAL *</Text>
              <TextInput style={styles.input} value={provFormNombre} onChangeText={setProvFormNombre} placeholder="Ej. Distribuidora Central C.A." />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabelSmall}>RIF / DOCUMENTO</Text>
                  <TextInput style={styles.input} value={provFormDoc} onChangeText={setProvFormDoc} placeholder="J-12345678-9" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabelSmall}>TELÉFONO</Text>
                  <TextInput style={styles.input} value={provFormTel} onChangeText={setProvFormTel} placeholder="+58..." />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabelSmall}>PERSONA CONTACTO</Text>
                  <TextInput style={styles.input} value={provFormContacto} onChangeText={setProvFormContacto} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabelSmall}>CIUDAD</Text>
                  <TextInput style={styles.input} value={provFormCiudad} onChangeText={setProvFormCiudad} />
                </View>
              </View>
              <Text style={styles.fieldLabelSmall}>EMAIL</Text>
              <TextInput style={styles.input} value={provFormEmail} onChangeText={setProvFormEmail} keyboardType="email-address" autoCapitalize="none" />
              <Text style={styles.fieldLabelSmall}>DIRECCIÓN</Text>
              <TextInput style={styles.input} value={provFormDir} onChangeText={setProvFormDir} />
              <TouchableOpacity
                style={[styles.primaryBtn, { marginTop: 10 }]}
                onPress={handleSaveProveedor}
                disabled={savingProv}
              >
                <Text style={styles.primaryBtnText}>
                  {savingProv ? "Guardando..." : "Guardar Proveedor"}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==================== MODAL NUEVA COMPRA ==================== */}
      <Modal
        visible={nuevaCompraModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setNuevaCompraModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={[styles.modalSheet, { maxHeight: "92%" }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Registrar Nueva Compra</Text>
              <TouchableOpacity onPress={() => setNuevaCompraModalOpen(false)}>
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabelSmall}>PROVEEDOR</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                <TouchableOpacity
                  style={[styles.catChip, !ncProveedorId && styles.catChipActive]}
                  onPress={() => setNcProveedorId("")}
                >
                  <Text style={[styles.catChipText, !ncProveedorId && styles.catChipTextActive]}>Sin Proveedor</Text>
                </TouchableOpacity>
                {proveedoresList.map((pv: any) => {
                  const sel = String(ncProveedorId) === String(pv.id);
                  return (
                    <TouchableOpacity
                      key={pv.id}
                      style={[styles.catChip, sel && styles.catChipActive]}
                      onPress={() => setNcProveedorId(String(pv.id))}
                    >
                      <Text style={[styles.catChipText, sel && styles.catChipTextActive]}>{pv.nombre}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={styles.fieldLabelSmall}>MONEDA DE COMPRA</Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {monedas.map((m) => {
                  const sel = String(ncMonedaId) === String(m.id);
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[styles.posModeTab, sel && styles.posModeTabActive]}
                      onPress={() => setNcMonedaId(String(m.id))}
                    >
                      <Text style={[styles.posModeTabText, sel && styles.posModeTabTextActive]}>
                        {m.codigo} ({m.simbolo})
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabelSmall}>MODALIDAD DE PAGO</Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {(["contado", "parcial", "credito"] as const).map((tp) => (
                  <TouchableOpacity
                    key={tp}
                    style={[styles.posModeTab, ncTipoPago === tp && styles.posModeTabActive]}
                    onPress={() => setNcTipoPago(tp)}
                  >
                    <Text style={[styles.posModeTabText, ncTipoPago === tp && styles.posModeTabTextActive]}>
                      {tp === "contado" ? "Contado" : tp === "parcial" ? "Parcial" : "A Crédito"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {ncTipoPago !== "credito" && (
                <>
                  <Text style={styles.fieldLabelSmall}>MÉTODO DE PAGO / CAJA</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {metodosPago.map((mp) => {
                      const sel = String(ncMetodoPagoId) === String(mp.id);
                      return (
                        <TouchableOpacity
                          key={mp.id}
                          style={[styles.metodoChip, sel && styles.metodoChipActive]}
                          onPress={() => setNcMetodoPagoId(String(mp.id))}
                        >
                          <Text style={[styles.metodoChipText, sel && styles.metodoChipTextActive]}>
                            {mp.nombre} ({mp.moneda_codigo})
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </>
              )}

              {ncTipoPago === "parcial" && (
                <>
                  <Text style={styles.fieldLabelSmall}>ABONO INICIAL</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    value={ncAbonoInicial}
                    onChangeText={setNcAbonoInicial}
                  />
                </>
              )}

              {/* Buscador + Escáner para agregar productos a la compra */}
              <Text style={styles.fieldLabelSmall}>AGREGAR PRODUCTOS A LA COMPRA</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={[styles.searchBox, { flex: 1 }]}>
                  <Feather name="search" size={15} color={THEME.mutedForeground} />
                  <TextInput
                    style={styles.searchBoxInput}
                    placeholder="Buscar producto para añadir..."
                    value={ncSearchProd}
                    onChangeText={setNcSearchProd}
                  />
                </View>
                <TouchableOpacity
                  style={styles.posScanTriggerBtn}
                  onPress={() =>
                    openBarcodeScanner("unico", async (code) => {
                      const hit =
                        productos.find((p) => p.codigo.toLowerCase() === code.toLowerCase()) ||
                        (await findLocalProductoByBarcode(code))?.producto;
                      if (hit) {
                        addProductoToCompra(hit);
                        showToast(`${hit.nombre} agregado a la compra`, "success");
                      } else {
                        showToast(`Código ${code} no registrado`, "error");
                      }
                    })
                  }
                >
                  <Feather name="camera" size={15} color="#fff" />
                  <Text style={styles.posScanTriggerBtnText}>Escanear</Text>
                </TouchableOpacity>
              </View>

              {ncSearchProd.trim().length > 0 && (
                <View style={{ maxHeight: 150, borderWidth: 1, borderColor: THEME.border, borderRadius: 8, backgroundColor: THEME.inputBg }}>
                  <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {productos
                      .filter(
                        (p) =>
                          p.nombre.toLowerCase().includes(ncSearchProd.toLowerCase()) ||
                          p.codigo.toLowerCase().includes(ncSearchProd.toLowerCase())
                      )
                      .slice(0, 12)
                      .map((p) => (
                        <TouchableOpacity
                          key={p.id}
                          style={{ padding: 9, borderBottomWidth: 1, borderBottomColor: THEME.border, flexDirection: "row", justifyContent: "space-between" }}
                          onPress={() => {
                            addProductoToCompra(p);
                            setNcSearchProd("");
                          }}
                        >
                          <Text style={{ fontSize: 12.5, fontWeight: "700", color: THEME.foreground }}>{p.nombre}</Text>
                          <Text style={{ fontSize: 11, color: THEME.primary600, fontWeight: "700" }}>+ Añadir</Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                </View>
              )}

              {/* Lista de ítems en la compra */}
              {ncItems.map((it, idx) => (
                <View
                  key={it.producto.id}
                  style={{
                    backgroundColor: THEME.inputBg,
                    borderWidth: 1,
                    borderColor: THEME.border,
                    borderRadius: 8,
                    padding: 10,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 13, fontWeight: "800", color: THEME.foreground, flex: 1 }}>
                      {it.producto.nombre}
                    </Text>
                    <TouchableOpacity onPress={() => setNcItems((prev) => prev.filter((_, i) => i !== idx))}>
                      <Feather name="trash-2" size={15} color={THEME.dangerStrong} />
                    </TouchableOpacity>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabelSmall}>CANTIDAD</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: THEME.card, height: 38 }]}
                        keyboardType="numeric"
                        value={it.cantidadStr}
                        onChangeText={(v) =>
                          setNcItems((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, cantidadStr: v } : x))
                          )
                        }
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabelSmall}>COSTO UNITARIO</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: THEME.card, height: 38 }]}
                        keyboardType="decimal-pad"
                        value={it.costoUnitStr}
                        onChangeText={(v) =>
                          setNcItems((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, costoUnitStr: v } : x))
                          )
                        }
                      />
                    </View>
                  </View>
                </View>
              ))}

              <TouchableOpacity
                style={[styles.primaryBtn, { marginTop: 10 }]}
                onPress={handleSaveCompra}
                disabled={savingCompra}
              >
                {savingCompra ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Feather name="check-circle" size={16} color="#fff" />
                    <Text style={styles.primaryBtnText}>
                      Confirmar Compra (
                      {fmt(
                        ncItems.reduce(
                          (s, x) =>
                            s +
                            (parseFloat(x.cantidadStr) || 0) *
                              (parseFloat(x.costoUnitStr.replace(",", ".")) || 0),
                          0
                        ),
                        monedas.find((m) => String(m.id) === String(ncMonedaId))?.codigo || monedaSeleccionada
                      )}
                      )
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==================== MODAL DETALLE DE COMPRA ==================== */}
      <Modal
        visible={!!compraDetailModal}
        transparent
        animationType="fade"
        onRequestClose={() => setCompraDetailModal(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {compraDetailModal && (
              <>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>Compra {compraDetailModal.compra.numero}</Text>
                    <Text style={styles.clientCardMeta}>
                      {compraDetailModal.compra.proveedor_nombre || "Sin proveedor"} ·{" "}
                      {String(compraDetailModal.compra.fecha || "").slice(0, 10)}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setCompraDetailModal(null)}>
                    <Feather name="x" size={20} color={THEME.mutedForeground} />
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ gap: 8 }}>
                  {compraDetailModal.items.map((it: any, idx: number) => (
                    <View
                      key={idx}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        paddingVertical: 6,
                        borderBottomWidth: 1,
                        borderBottomColor: THEME.border,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: THEME.foreground }}>
                          {it.producto_nombre || `Producto #${it.producto_id}`}
                        </Text>
                        <Text style={styles.clientCardMeta}>
                          {it.cantidad} x {fmt(Number(it.costo_unit) || 0, compraDetailModal.compra.moneda_codigo || monedaSeleccionada)}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: THEME.primary600 }}>
                        {fmt(Number(it.subtotal) || 0, compraDetailModal.compra.moneda_codigo || monedaSeleccionada)}
                      </Text>
                    </View>
                  ))}
                </ScrollView>

                <View
                  style={{
                    flexDirection: "row",
                    gap: 8,
                    marginTop: 14,
                    paddingTop: 10,
                    borderTopWidth: 1,
                    borderTopColor: THEME.border,
                  }}
                >
                  <TouchableOpacity
                    style={[
                      styles.cartHeaderActionBtn,
                      {
                        flex: 1,
                        backgroundColor: THEME.warningSoft,
                        borderColor: THEME.warningBorder,
                      },
                    ]}
                    onPress={() =>
                      openRetornoDirectoFromCompra(
                        compraDetailModal.compra,
                        compraDetailModal.items
                      )
                    }
                  >
                    <Feather name="rotate-ccw" size={14} color={THEME.warningStrong} />
                    <Text
                      style={[
                        styles.cartHeaderActionBtnText,
                        { color: THEME.warningStrong },
                      ]}
                    >
                      Devolver productos
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.cartHeaderActionBtn,
                      {
                        flex: 1,
                        backgroundColor: THEME.dangerSoft,
                        borderColor: THEME.dangerBorder,
                      },
                    ]}
                    onPress={() => handleDeleteCompra(compraDetailModal.compra)}
                  >
                    <Feather name="trash-2" size={14} color={THEME.dangerStrong} />
                    <Text
                      style={[
                        styles.cartHeaderActionBtnText,
                        { color: THEME.dangerStrong },
                      ]}
                    >
                      Eliminar compra
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL NUEVO RETORNO ==================== */}
      <Modal
        visible={nuevoRetornoModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setNuevoRetornoModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={[styles.modalSheet, { maxHeight: "90%" }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Registrar Retorno / Devolución</Text>
              <TouchableOpacity onPress={() => setNuevoRetornoModalOpen(false)}>
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabelSmall}>TIPO DE RETORNO</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["Cliente", "Proveedor"] as const).map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.posModeTab, nrTipo === t && styles.posModeTabActive]}
                    onPress={() => setNrTipo(t)}
                  >
                    <Text style={[styles.posModeTabText, nrTipo === t && styles.posModeTabTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabelSmall}>MOTIVO DE DEVOLUCIÓN</Text>
              <TextInput style={styles.input} value={nrMotivo} onChangeText={setNrMotivo} />

              <Text style={styles.fieldLabelSmall}>AGREGAR PRODUCTO DEVUELTO</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={[styles.searchBox, { flex: 1 }]}>
                  <Feather name="search" size={15} color={THEME.mutedForeground} />
                  <TextInput
                    style={styles.searchBoxInput}
                    placeholder="Buscar producto..."
                    value={nrSearchProd}
                    onChangeText={setNrSearchProd}
                  />
                </View>
                <TouchableOpacity
                  style={styles.posScanTriggerBtn}
                  onPress={() =>
                    openBarcodeScanner("unico", async (code) => {
                      const hit =
                        productos.find((p) => p.codigo.toLowerCase() === code.toLowerCase()) ||
                        (await findLocalProductoByBarcode(code))?.producto;
                      if (hit) addProductoToRetorno(hit);
                    })
                  }
                >
                  <Feather name="camera" size={15} color="#fff" />
                  <Text style={styles.posScanTriggerBtnText}>Escanear</Text>
                </TouchableOpacity>
              </View>

              {nrSearchProd.trim().length > 0 && (
                <View style={{ maxHeight: 140, borderWidth: 1, borderColor: THEME.border, borderRadius: 8, backgroundColor: THEME.inputBg }}>
                  <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {productos
                      .filter(
                        (p) =>
                          p.nombre.toLowerCase().includes(nrSearchProd.toLowerCase()) ||
                          p.codigo.toLowerCase().includes(nrSearchProd.toLowerCase())
                      )
                      .slice(0, 10)
                      .map((p) => (
                        <TouchableOpacity
                          key={p.id}
                          style={{ padding: 9, borderBottomWidth: 1, borderBottomColor: THEME.border, flexDirection: "row", justifyContent: "space-between" }}
                          onPress={() => {
                            addProductoToRetorno(p);
                            setNrSearchProd("");
                          }}
                        >
                          <Text style={{ fontSize: 12.5, fontWeight: "700", color: THEME.foreground }}>{p.nombre}</Text>
                          <Text style={{ fontSize: 11, color: THEME.primary600, fontWeight: "700" }}>+ Añadir</Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                </View>
              )}

              {nrItems.map((it, idx) => (
                <View key={it.producto.id} style={{ backgroundColor: THEME.inputBg, padding: 10, borderRadius: 8, gap: 6 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 13, fontWeight: "800" }}>{it.producto.nombre}</Text>
                    <TouchableOpacity onPress={() => setNrItems((prev) => prev.filter((_, i) => i !== idx))}>
                      <Feather name="trash-2" size={15} color={THEME.dangerStrong} />
                    </TouchableOpacity>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TextInput
                      style={[styles.input, { flex: 1, backgroundColor: THEME.card, height: 36 }]}
                      keyboardType="numeric"
                      placeholder="Cantidad"
                      value={it.cantidadStr}
                      onChangeText={(v) =>
                        setNrItems((prev) => prev.map((x, i) => (i === idx ? { ...x, cantidadStr: v } : x)))
                      }
                    />
                    <TextInput
                      style={[styles.input, { flex: 1, backgroundColor: THEME.card, height: 36 }]}
                      keyboardType="decimal-pad"
                      placeholder="Precio unit."
                      value={it.precioUnitStr}
                      onChangeText={(v) =>
                        setNrItems((prev) => prev.map((x, i) => (i === idx ? { ...x, precioUnitStr: v } : x)))
                      }
                    />
                  </View>
                </View>
              ))}

              <TouchableOpacity
                style={[styles.primaryBtn, { marginTop: 10 }]}
                onPress={handleSaveRetorno}
                disabled={savingRetorno}
              >
                <Text style={styles.primaryBtnText}>
                  {savingRetorno ? "Registrando..." : "Confirmar Retorno"}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==================== MODAL NUEVA TRANSACCIÓN DE CAJA ==================== */}
      <Modal
        visible={nuevaTransModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setNuevaTransModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Registrar Movimiento de Caja</Text>
              <TouchableOpacity onPress={() => setNuevaTransModalOpen(false)}>
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabelSmall}>TIPO DE MOVIMIENTO</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
              {(["Entrada", "Salida"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.posModeTab, ntTipo === t && styles.posModeTabActive]}
                  onPress={() => setNtTipo(t)}
                >
                  <Text style={[styles.posModeTabText, ntTipo === t && styles.posModeTabTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>CAJA</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 4 }}>
              {(cajasCloud.length > 0 ? cajasCloud : cajas).map((c: any) => {
                const sel = String(ntCajaId) === String(c.id);
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.catChip, sel && styles.catChipActive]}
                    onPress={() => setNtCajaId(String(c.id))}
                  >
                    <Text style={[styles.catChipText, sel && styles.catChipTextActive]}>
                      {c.nombre} ({c.moneda_codigo})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>MONTO *</Text>
            <TextInput style={styles.input} keyboardType="decimal-pad" placeholder="0.00" value={ntMonto} onChangeText={setNtMonto} />
            <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>DESCRIPCIÓN / CONCEPTO *</Text>
            <TextInput style={styles.input} placeholder="Ej. Pago de servicios, ingreso de sencillo..." value={ntDesc} onChangeText={setNtDesc} />
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 14 }]}
              onPress={handleSaveTransaccion}
              disabled={savingTrans}
            >
              <Text style={styles.primaryBtnText}>
                {savingTrans ? "Guardando..." : "Registrar Movimiento"}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==================== MODAL NUEVA CAJA ==================== */}
      <Modal
        visible={nuevaCajaModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setNuevaCajaModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Crear Nueva Caja</Text>
              <TouchableOpacity onPress={() => setNuevaCajaModalOpen(false)}>
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabelSmall}>NOMBRE DE LA CAJA *</Text>
            <TextInput style={styles.input} placeholder="Ej. Caja Principal USD" value={ncajaNombre} onChangeText={setNcajaNombre} />
            <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>MONEDA *</Text>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
              {monedas.map((m) => {
                const sel = String(ncajaMonedaId) === String(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.posModeTab, sel && styles.posModeTabActive]}
                    onPress={() => setNcajaMonedaId(String(m.id))}
                  >
                    <Text style={[styles.posModeTabText, sel && styles.posModeTabTextActive]}>
                      {m.codigo} ({m.simbolo})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 14 }]}
              onPress={handleCreateNuevaCaja}
              disabled={savingNuevaCaja}
            >
              <Text style={styles.primaryBtnText}>
                {savingNuevaCaja ? "Creando..." : "Crear Caja"}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==================== MODAL MONEDA Y TASA ==================== */}
      <Modal
        visible={monedaModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMonedaModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingMoneda ? `Tasa de ${editingMoneda.nombre} (${editingMoneda.codigo})` : "Nueva Moneda"}
              </Text>
              <TouchableOpacity onPress={() => setMonedaModalOpen(false)}>
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1.5 }}>
                <Text style={styles.fieldLabelSmall}>NOMBRE</Text>
                <TextInput style={styles.input} value={monFormNombre} onChangeText={setMonFormNombre} placeholder="Bolívares" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabelSmall}>CÓDIGO</Text>
                <TextInput style={styles.input} value={monFormCodigo} onChangeText={setMonFormCodigo} placeholder="VES" autoCapitalize="characters" />
              </View>
              <View style={{ width: 65 }}>
                <Text style={styles.fieldLabelSmall}>SÍMB.</Text>
                <TextInput style={styles.input} value={monFormSimbolo} onChangeText={setMonFormSimbolo} placeholder="Bs" />
              </View>
            </View>

            <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>TASA DE CAMBIO OFICIAL / REFERENCIA *</Text>
            <TextInput style={styles.input} keyboardType="decimal-pad" value={monFormTasa} onChangeText={setMonFormTasa} />

            <TouchableOpacity
              style={[
                styles.outlineSmallBtn,
                { marginTop: 10, height: 40 },
                monFormUsaDirecta && { backgroundColor: THEME.secondary, borderColor: THEME.primary },
              ]}
              onPress={() => setMonFormUsaDirecta((v) => !v)}
            >
              <Feather
                name={monFormUsaDirecta ? "check-square" : "square"}
                size={15}
                color={monFormUsaDirecta ? THEME.primary600 : THEME.foreground}
              />
              <Text style={styles.outlineSmallBtnText}>Usar Tasa Directa frente al USD</Text>
            </TouchableOpacity>

            {monFormUsaDirecta && (
              <>
                <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>TASA DIRECTA POR 1 USD</Text>
                <TextInput style={styles.input} keyboardType="decimal-pad" value={monFormTasaDirecta} onChangeText={setMonFormTasaDirecta} />
              </>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 14 }]}
              onPress={handleSaveMoneda}
              disabled={savingMoneda}
            >
              <Text style={styles.primaryBtnText}>
                {savingMoneda ? "Guardando..." : "Guardar Moneda y Tasa"}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==================== MODAL MÉTODO DE PAGO ==================== */}
      <Modal
        visible={mpModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMpModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingMp ? "Editar Método de Pago" : "Nuevo Método de Pago"}
              </Text>
              <TouchableOpacity onPress={() => setMpModalOpen(false)}>
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabelSmall}>NOMBRE DEL MÉTODO *</Text>
            <TextInput style={styles.input} placeholder="Ej. Pago Móvil Banesco, Zelle..." value={mpFormNombre} onChangeText={setMpFormNombre} />

            <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>TIPO</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 4 }}>
              {["Efectivo", "Pago Móvil", "Transferencia", "Tarjeta", "Zelle", "Biopago", "Otro"].map((tp) => {
                const sel = mpFormTipo === tp;
                return (
                  <TouchableOpacity
                    key={tp}
                    style={[styles.catChip, sel && styles.catChipActive]}
                    onPress={() => setMpFormTipo(tp)}
                  >
                    <Text style={[styles.catChipText, sel && styles.catChipTextActive]}>{tp}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>CAJA VINCULADA *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 4 }}>
              {(cajasCloud.length > 0 ? cajasCloud : cajas).map((c: any) => {
                const sel = String(mpFormCajaId) === String(c.id);
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.catChip, sel && styles.catChipActive]}
                    onPress={() => setMpFormCajaId(String(c.id))}
                  >
                    <Text style={[styles.catChipText, sel && styles.catChipTextActive]}>
                      {c.nombre} ({c.moneda_codigo})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 14 }]}
              onPress={handleSaveMetodoPago}
              disabled={savingMp}
            >
              <Text style={styles.primaryBtnText}>
                {savingMp ? "Guardando..." : "Guardar Método de Pago"}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==================== MODAL USUARIO ADMIN ==================== */}
      <Modal
        visible={usuarioModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setUsuarioModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingUsuario ? "Editar Usuario" : "Nuevo Usuario"}
              </Text>
              <TouchableOpacity onPress={() => setUsuarioModalOpen(false)}>
                <Feather name="x" size={20} color={THEME.mutedForeground} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabelSmall}>NOMBRE COMPLETO *</Text>
            <TextInput style={styles.input} value={usrFormName} onChangeText={setUsrFormName} placeholder="Ej. María Pérez" />
            <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>CORREO ELECTRÓNICO *</Text>
            <TextInput style={styles.input} value={usrFormEmail} onChangeText={setUsrFormEmail} autoCapitalize="none" keyboardType="email-address" placeholder="cajero@posbit.com" />
            <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>ROL EN EL SISTEMA</Text>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
              {(["cajero", "admin", "usuario"] as const).map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.posModeTab, usrFormRole === r && styles.posModeTabActive]}
                  onPress={() => setUsrFormRole(r)}
                >
                  <Text style={[styles.posModeTabText, usrFormRole === r && styles.posModeTabTextActive]}>
                    {r.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.fieldLabelSmall, { marginTop: 10 }]}>
              {editingUsuario ? "NUEVA CONTRASEÑA (OPCIONAL)" : "CONTRASEÑA (MÍN. 8 CARACTERES) *"}
            </Text>
            <TextInput style={styles.input} secureTextEntry value={usrFormPassword} onChangeText={setUsrFormPassword} placeholder="••••••••" />
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 14 }]}
              onPress={handleSaveUsuario}
              disabled={savingUsuario}
            >
              <Text style={styles.primaryBtnText}>
                {savingUsuario ? "Guardando..." : "Guardar Usuario"}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
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
    justifyContent: "space-between",
    paddingHorizontal: 12,
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
    gap: 6,
    flexWrap: "wrap",
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
  cartHeaderContainer: {
    marginBottom: 10,
    gap: 8,
  },
  cartHeaderTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cartScanHeaderBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: THEME.primary,
  },
  cartScanHeaderBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#ffffff",
  },
  cartHeaderTotalPill: {
    backgroundColor: THEME.accent,
    borderWidth: 1,
    borderColor: THEME.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  cartHeaderTotalPillText: {
    fontSize: 13,
    fontWeight: "900",
    color: THEME.primary600,
  },
  cartHeaderActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cartHeaderActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  cartHeaderActionBtnText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: THEME.foreground,
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
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flex: 1,
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sidebarDrawer: {
    width: 280,
    backgroundColor: THEME.sidebar,
    flexDirection: "column",
    overflow: "hidden",
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
  pillFilter: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: THEME.card,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  pillFilterActive: {
    backgroundColor: THEME.primary,
    borderColor: THEME.primary,
  },
  pillFilterText: {
    fontSize: 12,
    fontWeight: "700",
    color: THEME.mutedForeground,
  },
  pillFilterTextActive: {
    color: "#fff",
  },
  monedaPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: THEME.inputBg,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  monedaPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: THEME.foreground,
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
  posScanTriggerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: THEME.primary,
    borderWidth: 1,
    borderColor: THEME.primary600,
  },
  posScanTriggerBtnText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#ffffff",
  },
  posPriceCheckTriggerBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: THEME.secondary,
    borderWidth: 1,
    borderColor: THEME.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  scannerModalRoot: {
    flex: 1,
    backgroundColor: "#0c0a09",
  },
  scannerModalRootLowLightGlow: {
    backgroundColor: "#1c1917",
  },
  scannerTopHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: Platform.OS === "ios" ? 50 : 16,
    paddingBottom: 10,
    backgroundColor: "rgba(12, 10, 9, 0.94)",
    borderBottomWidth: 1,
    borderBottomColor: "#292524",
  },
  scannerCloseBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "#292524",
    borderWidth: 1,
    borderColor: "#44403c",
  },
  scannerCloseBtnText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#ffffff",
  },
  scannerHeaderTitle: {
    fontSize: 14.5,
    fontWeight: "800",
    color: "#ffffff",
  },
  scannerHeaderSub: {
    fontSize: 10.5,
    fontWeight: "600",
    color: THEME.primary,
    marginTop: 1,
  },
  scannerIconPillBtn: {
    width: 36,
    height: 36,
    borderRadius: 99,
    backgroundColor: "#292524",
    borderWidth: 1,
    borderColor: "#44403c",
    alignItems: "center",
    justifyContent: "center",
  },
  scannerIconPillBtnActive: {
    backgroundColor: "#facc15",
    borderColor: "#eab308",
  },
  scannerModeTabsRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: "#141210",
    borderBottomWidth: 1,
    borderBottomColor: "#292524",
  },
  scannerModeTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "#292524",
    borderWidth: 1,
    borderColor: "#3f3a36",
  },
  scannerModeTabActive: {
    backgroundColor: THEME.primary,
    borderColor: THEME.primary600,
  },
  scannerModeTabText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#d6d3ce",
  },
  scannerModeTabTextActive: {
    color: "#ffffff",
    fontWeight: "800",
  },
  scannerPermissionBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: "#0c0a09",
  },
  scannerPermissionIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(249, 115, 22, 0.14)",
    borderWidth: 1.5,
    borderColor: THEME.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  scannerPermissionTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#ffffff",
    textAlign: "center",
    marginBottom: 8,
  },
  scannerPermissionSub: {
    fontSize: 13,
    color: "#a8a29e",
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 20,
  },
  scannerGrantBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: THEME.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  scannerGrantBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#ffffff",
  },
  scannerManualInputPermissionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#292524",
    borderWidth: 1.5,
    borderColor: "#57534e",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  scannerManualInputPermissionBtnText: {
    fontSize: 13.5,
    fontWeight: "800",
    color: "#ffffff",
  },
  scannerViewportContainer: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#000000",
  },
  scannerSoftboxGlowBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 18,
    borderColor: "rgba(255, 255, 255, 0.88)",
    borderRadius: 4,
    zIndex: 4,
  },
  scannerInteractiveOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 14,
    zIndex: 5,
  },
  scannerTapFocusRing: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: "#facc15",
    backgroundColor: "rgba(250, 204, 21, 0.12)",
    zIndex: 10,
  },
  scannerReticleBox: {
    width: "88%",
    maxWidth: 330,
    height: 168,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "rgba(249, 115, 22, 0.45)",
    backgroundColor: "rgba(0, 0, 0, 0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    position: "relative",
    overflow: "hidden",
  },
  scannerReticleSuccess: {
    borderColor: THEME.success,
    backgroundColor: "rgba(16, 185, 129, 0.16)",
  },
  scannerReticleWarning: {
    borderColor: THEME.warning,
    backgroundColor: "rgba(245, 158, 11, 0.16)",
  },
  scannerReticleError: {
    borderColor: THEME.danger,
    backgroundColor: "rgba(239, 68, 68, 0.16)",
  },
  scannerCornerTL: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 28,
    height: 28,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderColor: THEME.primary,
    borderTopLeftRadius: 14,
  },
  scannerCornerTR: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 28,
    height: 28,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderColor: THEME.primary,
    borderTopRightRadius: 14,
  },
  scannerCornerBL: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 28,
    height: 28,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderColor: THEME.primary,
    borderBottomLeftRadius: 14,
  },
  scannerCornerBR: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderColor: THEME.primary,
    borderBottomRightRadius: 14,
  },
  scannerLaserLine: {
    width: "92%",
    height: 2.5,
    backgroundColor: THEME.primary,
    borderRadius: 2,
    shadowColor: THEME.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 8,
    elevation: 6,
  },
  scannerReticleHintPill: {
    position: "absolute",
    bottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 99,
    backgroundColor: "rgba(12, 10, 9, 0.72)",
  },
  scannerReticleHintText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#f5f5f4",
  },
  scannerZoomBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(12, 10, 9, 0.78)",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
  },
  scannerZoomChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
  },
  scannerZoomChipActive: {
    backgroundColor: THEME.primary,
  },
  scannerZoomChipText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#d6d3ce",
  },
  scannerZoomChipTextActive: {
    color: "#ffffff",
    fontWeight: "900",
  },
  scannerAssistToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  scannerAssistBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "rgba(28, 25, 23, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },
  scannerAssistBtnActive: {
    backgroundColor: "#facc15",
    borderColor: "#eab308",
  },
  scannerAssistBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#ffffff",
  },
  scannerManualFloatingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(28, 25, 23, 0.92)",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.3)",
    marginTop: 6,
  },
  scannerManualFloatingBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#ffffff",
  },
  scannerManualInputBar: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#1c1917",
    borderTopWidth: 1.5,
    borderTopColor: "#3f3a36",
  },
  scannerManualInputHeaderTitle: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#ffffff",
  },
  scannerManualTextInput: {
    flex: 1,
    height: 38,
    backgroundColor: "#292524",
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 13.5,
    color: "#ffffff",
    borderWidth: 1,
    borderColor: "#44403c",
  },
  scannerManualSubmitBtn: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: THEME.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  scannerManualSubmitBtnText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#ffffff",
  },
  scannerBottomDock: {
    backgroundColor: "#141210",
    borderTopWidth: 1,
    borderTopColor: "#292524",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 26 : 12,
    gap: 10,
  },
  scannerResultCard: {
    backgroundColor: THEME.card,
    borderRadius: 12,
    padding: 11,
    borderWidth: 2,
    borderColor: THEME.success,
  },
  scannerStatusPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  scannerQtyControlBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.inputBg,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 3,
  },
  scannerRemoveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: THEME.dangerSoft,
    borderWidth: 1,
    borderColor: THEME.dangerBorder,
  },
  scannerRemoveBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.dangerStrong,
  },
  scannerQtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 7,
    backgroundColor: THEME.foreground,
    alignItems: "center",
    justifyContent: "center",
  },
  scannerQuickAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: THEME.primary,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
  },
  scannerQuickAddBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#ffffff",
  },
  scannerEmptyPromptBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#1c1917",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#292524",
  },
  scannerEmptyPromptText: {
    flex: 1,
    fontSize: 11.5,
    color: "#a8a29e",
    lineHeight: 16,
  },
  scannerCartSummaryBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1c1917",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#292524",
  },
  scannerViewCartBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: "#292524",
    borderWidth: 1,
    borderColor: "#44403c",
  },
  scannerViewCartBtnText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#ffffff",
  },
  scannerCheckoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: THEME.primary,
  },
  scannerCheckoutBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#ffffff",
  },
});
