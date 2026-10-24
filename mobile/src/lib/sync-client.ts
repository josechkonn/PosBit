import * as SecureStore from "expo-secure-store";
import {
  getMeta,
  setMeta,
  saveCatalogOffline,
  getVentasLocales,
  markVentaSincronizada,
  getAbonosLocalesPendientes,
  markAbonoSincronizado,
  createOfflineAbono,
  getMobileDb,
} from "./local-db";

const KEY_SERVER_URL = "posbit_server_url";
const KEY_AUTH_TOKEN = "posbit_auth_token";
const KEY_USER_JSON = "posbit_user_json";

export async function getStoredSession(): Promise<{
  serverUrl: string | null;
  token: string | null;
  user: { id: string; name: string; email: string; role: string } | null;
}> {
  const serverUrl = await SecureStore.getItemAsync(KEY_SERVER_URL);
  const token = await SecureStore.getItemAsync(KEY_AUTH_TOKEN);
  const userStr = await SecureStore.getItemAsync(KEY_USER_JSON);
  return {
    serverUrl,
    token,
    user: userStr ? JSON.parse(userStr) : null,
  };
}

export async function clearStoredSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_AUTH_TOKEN);
  await SecureStore.deleteItemAsync(KEY_USER_JSON);
}

/**
 * Inicia sesión contra el servidor PosBit Cloud (o IP local) y guarda el catálogo inicial completo en una sola petición.
 */
export async function loginMobile(
  rawServerUrl: string,
  email: string,
  password: string
) {
  const serverUrl = rawServerUrl.trim().replace(/\/+$/, "");
  if (!serverUrl || serverUrl === "https://" || serverUrl === "http://") {
    throw new Error(
      "Por favor ingresa la URL completa de tu servidor (ej. https://pos-bit-pi.vercel.app)"
    );
  }

  let res: Response;
  try {
    res = await fetch(`${serverUrl}/api/mobile/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (netErr: any) {
    throw new Error(
      `No se pudo conectar a "${serverUrl}". Verifica tu conexión y la URL (${netErr?.message || netErr}).`
    );
  }

  const rawText = await res.text();
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(
      `El servidor respondió con error (HTTP ${res.status}). La URL ingresada no devolvió una respuesta válida de PosBit.`
    );
  }

  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Error ${res.status}: No se pudo iniciar sesión`);
  }

  await SecureStore.setItemAsync(KEY_SERVER_URL, serverUrl);
  if (data.token) {
    await SecureStore.setItemAsync(KEY_AUTH_TOKEN, data.token);
  }
  if (data.user) {
    await SecureStore.setItemAsync(KEY_USER_JSON, JSON.stringify(data.user));
  }

  await saveCatalogOffline({
    configuracion_global: data.configuracionGlobal,
    monedas: data.monedas,
    cajas: data.cajas,
    metodos_pago: data.metodosPago,
    categorias: data.categorias,
    marcas: data.marcas,
    proveedores: data.proveedores,
    clientes: data.clientes,
    cliente_limites_credito: data.clienteLimitesCredito,
    productos: data.productos,
    producto_proveedores: data.productoProveedores,
    producto_presentaciones: data.productoPresentaciones,
    creditos: data.creditos,
    abonos: data.abonos,
    ventas: data.ventas,
  });

  if (data.serverTime && Array.isArray(data.productos) && data.productos.length > 0) {
    await setMeta("last_pull_iso", data.serverTime);
  }

  return data;
}

/**
 * Helper para fetch con timeout configurable para evitar que peticiones
 * móviles colgadas dejen la sincronización bloqueada o en "Offline".
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 12000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sincroniza bidireccionalmente la App Móvil con el Servidor PosBit en la Nube:
 *   1. Sube todas las ventas creadas en modo offline (`sincronizado = 0`) a `/api/ventas` (con idempotencia)
 *   2. Sube todos los abonos creados en modo offline (`sincronizado = 0`) a `/api/creditos/[id]/abonos`
 *   3. Descarga el delta móvil (`mode=mobile`: monedas, cajas, métodos, clientes, créditos, abonos, productos, presentaciones, ventas)
 */
export async function syncMobileWithCloud(): Promise<{
  ventasSubidas: number;
  productosActualizados: number;
  fecha: string;
}> {
  const { serverUrl, token } = await getStoredSession();
  if (!serverUrl || !token) {
    throw new Error("Sesión no configurada");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  // 1. Subir ventas pendientes creadas en el teléfono de forma tolerante a fallos
  const todasVentas = await getVentasLocales();
  const pendientes = todasVentas.filter((v) => v.sincronizado === 0);
  let ventasSubidas = 0;

  for (const venta of pendientes) {
    try {
      const items = JSON.parse(venta.items_json || "[]");
      const pagos = venta.pagos_json ? JSON.parse(venta.pagos_json) : undefined;
      const cobros_extra = venta.cobros_extra_json ? JSON.parse(venta.cobros_extra_json) : undefined;
      const tipoPago = venta.tipo_pago || "Contado";
      const obsBase = venta.observaciones ? `${venta.observaciones} · ` : "";

      const res = await fetchWithTimeout(`${serverUrl}/api/ventas`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          origen_offline: true,
          cliente_id: venta.cliente_id ? String(venta.cliente_id) : null,
          cliente: venta.cliente_nombre,
          tipo_pago: tipoPago,
          fecha: venta.fecha,
          moneda_id: venta.moneda_id,
          metodo_pago_id: venta.metodo_pago_id,
          caja_id: venta.caja_id,
          descuento: venta.descuento || 0,
          monto_pagado: venta.monto_pagado,
          pagos,
          cobros_extra,
          observaciones: `${obsBase}Venta desde App Móvil (${venta.numero})`,
          items: items.map((it: any) => ({
            producto_id: it.producto_id,
            cantidad: it.cantidad,
            precio_unit: it.precio_unit,
            subtotal: it.subtotal,
            descuento: it.descuento || 0,
            presentacion_id: it.presentacion_id || undefined,
            presentacion_nombre: it.presentacion_nombre || undefined,
            presentacion_unidades: it.presentacion_unidades || undefined,
            cantidad_presentaciones: it.cantidad_presentaciones || undefined,
            precio_presentacion: it.precio_presentacion || undefined,
          })),
        }),
      }, 10000);

      if (res.ok) {
        await markVentaSincronizada(venta.id);
        ventasSubidas++;
      }
    } catch (err) {
      console.warn(`[Sync] Advertencia subiendo venta local ${venta.id}:`, err);
    }
  }

  // 2. Subir abonos pendientes creados en el teléfono de forma tolerante a fallos
  const abonosPend = await getAbonosLocalesPendientes();
  for (const ab of abonosPend) {
    if (!ab.credito_id || String(ab.credito_id).startsWith("local-")) continue;
    try {
      const lineas = ab.lineas_json ? JSON.parse(ab.lineas_json) : undefined;
      const res = await fetchWithTimeout(`${serverUrl}/api/creditos/${ab.credito_id}/abonos`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          fecha: ab.fecha,
          monto: ab.monto,
          moneda_id: ab.moneda_id,
          metodo_pago_id: ab.metodo_pago_id,
          caja_id: ab.caja_id,
          lineas,
          observaciones: ab.observaciones,
        }),
      }, 10000);
      if (res.ok) {
        await markAbonoSincronizado(ab.id);
      }
    } catch (err) {
      console.warn(`[Sync] Advertencia subiendo abono local ${ab.id}:`, err);
    }
  }

  // 3. Descargar delta incremental optimizado desde /api/sync?mode=mobile
  // En vez de lanzar 10 peticiones pesadas en paralelo cada 45s (lo que agotaba sockets y dejaba la app Offline),
  // PosBit envía todo el delta necesario en 1 sola petición SQL ultraligera con since.
  const lastSync = await getMeta("last_pull_iso");
  const syncUrl = lastSync
    ? `${serverUrl}/api/sync?mode=mobile&since=${encodeURIComponent(lastSync)}`
    : `${serverUrl}/api/sync?mode=mobile`;

  let pullRes: Response;
  try {
    pullRes = await fetchWithTimeout(syncUrl, { method: "GET", headers }, 15000);
  } catch (netErr: any) {
    throw new Error(`Conexión no disponible (${netErr?.message || "Timeout de red"})`);
  }

  const pullText = await pullRes.text();
  let delta: any;
  try {
    delta = JSON.parse(pullText);
  } catch {
    throw new Error(`Error HTTP ${pullRes.status} al descargar datos desde ${syncUrl}`);
  }

  if (!pullRes.ok) {
    throw new Error(delta?.error || `Error al descargar catálogo (HTTP ${pullRes.status})`);
  }

  // Si subimos ventas con créditos temporales locales, limpiar los temporales antes de guardar los oficiales del servidor
  if (ventasSubidas > 0 || abonosPend.length > 0) {
    const db = await getMobileDb();
    await db.runAsync(`DELETE FROM creditos WHERE id LIKE 'local-%'`);
    await db.runAsync(`DELETE FROM abonos WHERE id LIKE 'local-%'`);
  }

  const deltaTables = delta.tables || {};

  await saveCatalogOffline({
    configuracion_global: deltaTables.configuracion_global,
    monedas: deltaTables.monedas,
    cajas: deltaTables.cajas,
    metodos_pago: deltaTables.metodos_pago,
    categorias: deltaTables.categorias,
    marcas: deltaTables.marcas,
    proveedores: deltaTables.proveedores,
    clientes: deltaTables.clientes,
    cliente_limites_credito: deltaTables.cliente_limites_credito,
    productos: deltaTables.productos,
    producto_proveedores: deltaTables.producto_proveedores,
    producto_presentaciones: deltaTables.producto_presentaciones,
    creditos: deltaTables.creditos,
    abonos: deltaTables.abonos,
    ventas: deltaTables.ventas,
    venta_items: deltaTables.venta_items,
    eliminados: delta.eliminados,
  });

  const nowIso = delta.hasta || new Date().toISOString();
  await setMeta("last_pull_iso", nowIso);

  const prodsActualizados = Array.isArray(deltaTables.productos) ? deltaTables.productos.length : 0;

  return {
    ventasSubidas,
    productosActualizados: prodsActualizados,
    fecha: nowIso,
  };
}

/**
 * Crea o actualiza un cliente directamente en la nube y actualiza la base SQLite local.
 */
export async function saveClienteCloud(payload: {
  id?: string | null;
  nombre: string;
  tipo: string;
  documento?: string | null;
  email?: string | null;
  telefono?: string | null;
  ciudad?: string | null;
  direccion?: string | null;
  recibe_credito: boolean;
  limites_credito: Array<{ moneda_id: string; limite: number }>;
  activo?: boolean;
}) {
  const { serverUrl, token } = await getStoredSession();
  if (!serverUrl || !token) throw new Error("Sesión no configurada");

  const method = payload.id ? "PUT" : "POST";
  const res = await fetch(`${serverUrl}/api/clientes`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Error al guardar cliente");
  }

  await saveCatalogOffline({
    clientes: [data],
    cliente_limites_credito: Array.isArray(data.limites_credito)
      ? data.limites_credito.map((l: any) => ({
          cliente_id: data.id,
          moneda_id: l.moneda_id,
          limite: l.limite,
        }))
      : [],
  });
  return data;
}

/**
 * Ajusta el límite de crédito de un cliente en una moneda puntual (usado en el POS y en el perfil del cliente).
 */
export async function patchClienteLimiteCloud(payload: {
  id: string;
  moneda_id: string;
  limite: number;
  recibe_credito?: boolean;
}) {
  const { serverUrl, token } = await getStoredSession();

  try {
    if (serverUrl && token) {
      const res = await fetch(`${serverUrl}/api/clientes`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn("patchClienteLimiteCloud non-200:", res.status);
      }
    }
  } catch (err) {
    console.warn("patchClienteLimiteCloud offline fallback:", err);
  }

  const db = await getMobileDb();
  if (payload.recibe_credito) {
    await db.runAsync(`UPDATE clientes SET recibe_credito = 1 WHERE id = ?`, [payload.id]);
  }
  await db.runAsync(
    `INSERT INTO cliente_limites_credito (cliente_id, moneda_id, limite)
     VALUES (?, ?, ?)
     ON CONFLICT(cliente_id, moneda_id) DO UPDATE SET limite = excluded.limite`,
    [payload.id, String(payload.moneda_id), Number(payload.limite) || 0]
  );
  return { ok: true, ...payload };
}

/**
 * Registra un abono a un crédito (intenta subirlo en tiempo real y si no hay red lo encola en SQLite).
 */
export async function registrarAbonoMobile(payload: {
  credito_id: string;
  cliente_id: string;
  fecha: string;
  monto: number;
  moneda_id: string;
  monto_en_moneda_credito: number;
  metodo_pago_id: string | null;
  caja_id: string | null;
  lineas?: any[] | null;
  observaciones?: string | null;
}) {
  const { serverUrl, token } = await getStoredSession();
  if (serverUrl && token && payload.credito_id && !String(payload.credito_id).startsWith("local-")) {
    try {
      const res = await fetch(`${serverUrl}/api/creditos/${payload.credito_id}/abonos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fecha: payload.fecha,
          monto: payload.monto,
          moneda_id: payload.moneda_id,
          metodo_pago_id: payload.metodo_pago_id,
          caja_id: payload.caja_id,
          lineas: payload.lineas,
          observaciones: payload.observaciones,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Error al registrar abono");
      }
      // Actualizar crédito y abonos en SQLite inmediatamente
      const db = await getMobileDb();
      await db.runAsync(
        `UPDATE creditos SET saldo = ?, estado = ?, actualizado_en = ? WHERE id = ?`,
        [Number(data.nuevoSaldo) || 0, String(data.nuevoEstado || "Parcial"), new Date().toISOString(), payload.credito_id]
      );
      if (Array.isArray(data.abonos)) {
        await saveCatalogOffline({ abonos: data.abonos });
      }
      return { online: true, data };
    } catch (err: any) {
      // Si es un error de validación de negocio del servidor, propagarlo
      if (err?.message && !err.message.includes("Network") && !err.message.includes("fetch")) {
        throw err;
      }
    }
  }

  // Fallback 100% offline en SQLite
  await createOfflineAbono(payload);
  return { online: false };
}

/**
 * Aplica un pago de deuda global del cliente repartiéndolo automáticamente entre sus facturas pendientes
 * desde la más antigua (FIFO), idéntico a /api/creditos/pagar-deuda en la versión Web.
 * Si está sin conexión, aplica el reparto sobre SQLite local y encola los abonos.
 */
export async function pagarDeudaGlobalMobile(payload: {
  cliente_id: string;
  monto: number;
  moneda_id: string;
  fecha: string;
  metodo_pago_id: string | null;
  caja_id: string | null;
  observaciones?: string | null;
  distribucionOffline: Array<{
    credito_id: string;
    moneda_id: string;
    monto_aplicado: number;
  }>;
}): Promise<{
  online: boolean;
  aplicadas: number;
  completadas: number;
  sobrante_base?: number;
}> {
  const { serverUrl, token } = await getStoredSession();
  if (serverUrl && token) {
    try {
      const res = await fetch(`${serverUrl}/api/creditos/pagar-deuda`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          cliente_id: payload.cliente_id,
          monto: payload.monto,
          moneda_id: payload.moneda_id,
          fecha: payload.fecha,
          metodo_pago_id: payload.metodo_pago_id,
          caja_id: payload.caja_id,
          observaciones: payload.observaciones || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Error al aplicar el pago de deuda");
      }

      // Actualizar los créditos afectados en SQLite local inmediatamente
      const db = await getMobileDb();
      if (Array.isArray(data.aplicado)) {
        for (const ap of data.aplicado) {
          const row = await db.getFirstAsync<{ id: string; saldo: number }>(
            `SELECT id, saldo FROM creditos WHERE id = ? OR numero = ?`,
            [String(ap.credito_id), String(ap.numero || "")]
          );
          if (row) {
            const isPagado = ap.estado === "Pagado" || Number(ap.saldo ?? 0) <= 0.009;
            const nuevoSaldo = isPagado ? 0 : Math.max(0, Number(ap.saldo ?? (row.saldo - (Number(ap.monto) || 0))));
            const nuevoEstado = isPagado ? "Pagado" : "Parcial";
            await db.runAsync(
              `UPDATE creditos SET saldo = ?, estado = ?, actualizado_en = ? WHERE id = ?`,
              [nuevoSaldo, nuevoEstado, new Date().toISOString(), String(row.id)]
            );
          }
        }
      }

      return {
        online: true,
        aplicadas: Array.isArray(data.aplicado) ? data.aplicado.length : 0,
        completadas: Number(data.creditos_completados) || 0,
        sobrante_base: Number(data.sobrante_base) || 0,
      };
    } catch (err: any) {
      if (err?.message && !err.message.includes("Network") && !err.message.includes("fetch")) {
        throw err;
      }
    }
  }

  // Fallback offline: repartir sobre cada crédito pendiente según el preview FIFO
  let aplicadas = 0;
  let completadas = 0;
  const db = await getMobileDb();
  for (const dist of payload.distribucionOffline) {
    if (dist.monto_aplicado <= 0.0005) continue;
    const row = await db.getFirstAsync<{ id: string; saldo: number }>(
      `SELECT id, saldo FROM creditos WHERE id = ? OR numero = ?`,
      [String(dist.credito_id), String(dist.credito_id)]
    );
    const targetId = row ? row.id : dist.credito_id;
    const saldoAntes = Number(row?.saldo || 0);
    await createOfflineAbono({
      credito_id: targetId,
      cliente_id: payload.cliente_id,
      fecha: payload.fecha,
      monto: dist.monto_aplicado,
      moneda_id: dist.moneda_id,
      monto_en_moneda_credito: dist.monto_aplicado,
      metodo_pago_id: payload.metodo_pago_id,
      caja_id: payload.caja_id,
      observaciones: payload.observaciones
        ? `${payload.observaciones} (Abono global)`
        : "Abono global repartido",
    });
    aplicadas++;
    if (saldoAntes - dist.monto_aplicado <= 0.01) {
      completadas++;
    }
  }

  return {
    online: false,
    aplicadas,
    completadas,
    sobrante_base: 0,
  };
}

/**
 * Obtiene el perfil completo de un cliente desde el servidor (/api/clientes/[id], /api/ventas?cliente_id=[id], /api/retornos?cliente_id=[id])
 * incluyendo estadísticas, top productos más comprados, ventas detalladas con ítems y retornos.
 */
export async function fetchClientePerfilCloud(clienteId: string): Promise<{
  detalle: any | null;
  ventas: any[];
  ventaItems: any[];
  creditos: any[];
  retornos: any[];
  retornoItems: any[];
} | null> {
  const { serverUrl, token } = await getStoredSession();
  if (!serverUrl || !token) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const fetchJson = async (url: string) => {
    try {
      const r = await fetch(url, { method: "GET", headers });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  };

  const [det, vData, crData, retData] = await Promise.all([
    fetchJson(`${serverUrl}/api/clientes/${encodeURIComponent(clienteId)}`),
    fetchJson(`${serverUrl}/api/ventas?cliente_id=${encodeURIComponent(clienteId)}`),
    fetchJson(`${serverUrl}/api/creditos?cliente_id=${encodeURIComponent(clienteId)}`),
    fetchJson(`${serverUrl}/api/retornos?cliente_id=${encodeURIComponent(clienteId)}`),
  ]);

  if (!det && !vData && !crData) return null;

  return {
    detalle: det,
    ventas: Array.isArray(vData?.ventas) ? vData.ventas : [],
    ventaItems: Array.isArray(vData?.items) ? vData.items : [],
    creditos: Array.isArray(crData?.creditos) ? crData.creditos : [],
    retornos: Array.isArray(retData?.retornos) ? retData.retornos : [],
    retornoItems: Array.isArray(retData?.items) ? retData.items : [],
  };
}

/**
 * Obtiene los movimientos de Kardex desde la nube con paginación y filtros
 */
export async function fetchKardexCloud(params: {
  search?: string;
  tipo?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{
  data: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
} | null> {
  const { serverUrl, token } = await getStoredSession();
  if (!serverUrl || !token) return null;
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.tipo && params.tipo !== "todos") q.set("tipo", params.tipo);
  q.set("page", String(params.page || 1));
  q.set("limit", String(params.limit || 50));
  try {
    const res = await fetch(`${serverUrl}/api/kardex?${q.toString()}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Obtiene todas las cajas registradas y sus turnos desde la nube
 */
export async function fetchCajasCloud(): Promise<any[] | null> {
  const { serverUrl, token } = await getStoredSession();
  if (!serverUrl || !token) return null;
  try {
    const res = await fetch(`${serverUrl}/api/cajas`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Realiza el cierre de una caja registradora
 */
export async function cerrarCajaCloud(
  caja_id: string,
  observaciones?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  const { serverUrl, token } = await getStoredSession();
  if (!serverUrl || !token) return { success: false, error: "Sesión no configurada" };
  try {
    const res = await fetch(`${serverUrl}/api/cierres-caja`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ caja_id, observaciones }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error || "Error al cerrar caja" };
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err?.message || "Error de conexión con el servidor" };
  }
}

/**
 * Abre o reabre una caja con saldo inicial
 */
export async function abrirCajaCloud(
  caja_id: string,
  saldo_apertura: number
): Promise<{ success: boolean; data?: any; error?: string }> {
  const { serverUrl, token } = await getStoredSession();
  if (!serverUrl || !token) return { success: false, error: "Sesión no configurada" };
  try {
    const res = await fetch(`${serverUrl}/api/cajas`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id: caja_id, accion: "abrir", saldo_apertura }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error || "Error al abrir caja" };
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err?.message || "Error de conexión con el servidor" };
  }
}

/**
 * Obtiene el detalle completo de una venta desde el servidor
 */
export async function fetchVentaDetalleCloud(venta_id: string): Promise<any | null> {
  const { serverUrl, token } = await getStoredSession();
  if (!serverUrl || !token) return null;
  try {
    const res = await fetch(`${serverUrl}/api/ventas?id=${encodeURIComponent(venta_id)}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.venta || json;
  } catch {
    return null;
  }
}

/**
 * Registra un ajuste de kardex manual (Entrada o Salida) en el servidor
 */
export async function registrarAjusteKardexCloud(items: Array<{
  producto_id: number;
  tipo: "Entrada" | "Salida";
  cantidad: number;
  motivo: string;
  presentacion_id?: string | null;
}>): Promise<{ success: boolean; error?: string }> {
  const { serverUrl, token } = await getStoredSession();
  if (!serverUrl || !token) return { success: false, error: "Sesión no configurada" };
  try {
    const res = await fetch(`${serverUrl}/api/kardex/ajustes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || "Error al registrar ajuste" };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || "Error de conexión con el servidor" };
  }
}

/**
 * Obtiene los datos de Reportes desde el servidor
 */
export async function fetchReportesCloud(params: {
  tipo?: string;
  moneda_id?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
} = {}): Promise<any | null> {
  const { serverUrl, token } = await getStoredSession();
  if (!serverUrl || !token) return null;
  const q = new URLSearchParams();
  if (params.tipo) q.set("tipo", params.tipo);
  if (params.moneda_id) q.set("moneda_id", params.moneda_id);
  if (params.fecha_inicio) q.set("fecha_inicio", params.fecha_inicio);
  if (params.fecha_fin) q.set("fecha_fin", params.fecha_fin);
  try {
    const res = await fetch(`${serverUrl}/api/reportes?${q.toString()}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Helper genérico autenticado para peticiones REST hacia el backend PosBit
 */
export async function apiRequestMobile<T = any>(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: any
): Promise<T> {
  const { serverUrl, token } = await getStoredSession();
  if (!serverUrl || !token) {
    throw new Error("Sesión no configurada. Conéctate al servidor primero.");
  }
  const url = path.startsWith("http") ? path : `${serverUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    if (!res.ok) {
      throw new Error(`Error HTTP ${res.status}`);
    }
  }
  if (!res.ok) {
    throw new Error(json?.error || `Error HTTP ${res.status}`);
  }
  return json as T;
}

/**
 * PRODUCTOS CRUD (Crear / Editar / Eliminar / Verificar Código / Detalle Completo)
 * Idéntico al flujo de src/components/producto/producto-modal.tsx en PC/Web
 */
export async function verificarCodigoProductoCloud(params: {
  tipo?: "producto" | "caja";
  codigos: string[];
  excluirProductoId?: string | number | null;
  excluirId?: string | null;
}): Promise<Record<string, { disponible: boolean; mensaje: string }>> {
  try {
    const clean = params.codigos.map((c) => c.trim()).filter(Boolean);
    if (clean.length === 0) return {};
    const qs = new URLSearchParams();
    qs.set("tipo", params.tipo || "producto");
    for (const c of clean) qs.append("codigo", c);
    if (params.excluirProductoId != null && String(params.excluirProductoId) !== "") {
      qs.set("excluirProductoId", String(params.excluirProductoId));
    }
    if (params.excluirId) {
      qs.set("excluirId", String(params.excluirId));
    }
    const res = await apiRequestMobile<{
      resultados?: Record<string, { disponible: boolean; mensaje: string }>;
    }>(`/api/productos/verificar-codigo?${qs.toString()}`, "GET");
    return res?.resultados || {};
  } catch {
    return {};
  }
}

export async function fetchProductoFullCloud(params: {
  id?: string | number;
  codigo?: string;
}): Promise<any | null> {
  try {
    const search = params.codigo || (params.id ? String(params.id) : "");
    const qs = new URLSearchParams();
    if (search) qs.set("search", search);
    qs.set("limit", "30");
    const res = await apiRequestMobile<{ productos?: any[] }>(
      `/api/productos?${qs.toString()}`,
      "GET"
    );
    const list = Array.isArray(res?.productos) ? res.productos : [];
    if (params.id != null) {
      const exact = list.find((p) => String(p.id) === String(params.id));
      if (exact) return exact;
    }
    if (params.codigo) {
      const exactCod = list.find(
        (p) => String(p.codigo || "").toLowerCase() === String(params.codigo).toLowerCase()
      );
      if (exactCod) return exactCod;
    }
    return list[0] || null;
  } catch {
    return null;
  }
}

export async function saveProductoCloud(payload: {
  id?: string | number | null;
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  categoria_id?: string | number | null;
  marca_id?: string | number | null;
  proveedor_ids?: Array<string | number>;
  proveedor_id?: string | number | null;
  stock?: number;
  stock_minimo?: number;
  activo?: boolean;
  iva_incluido?: boolean;
  moneda_base_id?: string | number | null;
  moneda_costo_id?: string | number | null;
  precio_base: number;
  costo_base: number;
  margen_ganancia?: number;
  precios?: Record<string, { precio: number; costo: number }>;
  presentaciones?: Array<{
    id?: string;
    nombre: string;
    unidades: number;
    activo: boolean;
    codigo: string | null;
    modo_venta: "derivado" | "fijo" | "margen";
    precio_override: number | null;
    margen_override: number | null;
  }>;
}) {
  const method = payload.id ? "PUT" : "POST";
  const cleanProvIds = Array.from(
    new Set(
      (payload.proveedor_ids || (payload.proveedor_id ? [payload.proveedor_id] : []))
        .map((x) => (x != null ? String(x).trim() : ""))
        .filter((s) => s.length > 0 && s !== "null" && s !== "undefined" && s !== "NaN")
    )
  );
  const provPrincipal = cleanProvIds[0] ?? null;

  let data: any;
  try {
    data = await apiRequestMobile<any>("/api/productos", method, {
      ...payload,
      proveedor_ids: cleanProvIds,
      proveedor_id: provPrincipal,
    });
  } catch (err: any) {
    // Fallback si el servidor remoto aún tiene el bug legacy de parseInt en proveedor_ids con UUID
    if (String(err?.message || "").toLowerCase().includes("uuid")) {
      const { proveedor_ids: _ignoreIds, proveedor_id: _ignoreId, ...safePayload } = payload;
      data = await apiRequestMobile<any>("/api/productos", method, safePayload);
    } else {
      throw err;
    }
  }

  const db = await getMobileDb();
  const prodId = data?.id ?? payload.id;

  // Garantizar sincronización de descripción, categoría, marca y relación N:M de proveedores (UUID)
  // contra cualquier versión del servidor en la nube mediante remote_push
  if (prodId != null) {
    try {
      const nowIso = new Date(Date.now() + 1500).toISOString();
      await apiRequestMobile("/api/sync", "POST", {
        action: "remote_push",
        payload: {
          dispositivo_id: "mobile-pos",
          desde: null,
          hasta: nowIso,
          tables: {
            productos: [
              {
                ...data,
                id: Number(prodId),
                codigo: payload.codigo,
                nombre: payload.nombre,
                descripcion: payload.descripcion ?? null,
                categoria_id: payload.categoria_id || null,
                marca_id: payload.marca_id || null,
                proveedor_id: provPrincipal,
                actualizado_en: nowIso,
              },
            ],
            producto_proveedores: cleanProvIds.map((pid) => ({
              producto_id: Number(prodId),
              proveedor_id: String(pid),
            })),
          },
          eliminados: [],
        },
      });
    } catch {
      // Ignorar si remote_push no es necesario
    }

    await db.runAsync(`DELETE FROM producto_presentaciones WHERE producto_id = ?`, [Number(prodId)]);
  }

  // Consultar el producto enriquecido (con presentaciones, proveedores y nombres de categoría/marca)
  const fullProd = await fetchProductoFullCloud({
    id: prodId,
    codigo: data?.codigo || payload.codigo,
  });

  const prodToSave = fullProd || {
    ...data,
    descripcion: payload.descripcion ?? data?.descripcion ?? null,
    categoria_id: payload.categoria_id ?? data?.categoria_id ?? null,
    marca_id: payload.marca_id ?? data?.marca_id ?? null,
    proveedor_id: provPrincipal ?? data?.proveedor_id ?? null,
  };
  const presToSave = Array.isArray(prodToSave?.presentaciones)
    ? prodToSave.presentaciones.map((pr: any) => ({
        ...pr,
        producto_id: Number(prodToSave.id),
      }))
    : [];

  await saveCatalogOffline({
    productos: prodToSave ? [prodToSave] : [],
    producto_presentaciones: presToSave,
  });
  return prodToSave;
}

export async function deleteProductoCloud(id: string | number) {
  await apiRequestMobile(`/api/productos?id=${encodeURIComponent(String(id))}`, "DELETE");
  const db = await getMobileDb();
  await db.runAsync(`DELETE FROM producto_presentaciones WHERE producto_id = ?`, [String(id)]);
  await db.runAsync(`DELETE FROM productos WHERE id = ?`, [String(id)]);
  return { success: true };
}

/**
 * CATEGORÍAS CRUD
 */
export async function fetchCategoriasCloud(): Promise<any[]> {
  try {
    const list = await apiRequestMobile<any[]>("/api/categorias", "GET");
    if (Array.isArray(list)) {
      await saveCatalogOffline({ categorias: list });
      return list;
    }
    return [];
  } catch {
    return [];
  }
}

export async function saveCategoriaCloud(payload: {
  id?: string | number | null;
  nombre: string;
  descripcion?: string | null;
  activa?: boolean;
}) {
  const method = payload.id ? "PUT" : "POST";
  const data = await apiRequestMobile<any>("/api/categorias", method, payload);
  await saveCatalogOffline({ categorias: [data] });
  return data;
}

export async function deleteCategoriaCloud(id: string | number) {
  await apiRequestMobile(`/api/categorias?id=${encodeURIComponent(String(id))}`, "DELETE");
  const db = await getMobileDb();
  await db.runAsync(`DELETE FROM categorias WHERE id = ?`, [String(id)]);
  return { success: true };
}

/**
 * MARCAS CRUD
 */
export async function fetchMarcasCloud(): Promise<any[]> {
  try {
    const list = await apiRequestMobile<any[]>("/api/marcas", "GET");
    if (Array.isArray(list)) {
      await saveCatalogOffline({ marcas: list });
      return list;
    }
    return [];
  } catch {
    return [];
  }
}

export async function saveMarcaCloud(payload: {
  id?: string | number | null;
  nombre: string;
  pais?: string | null;
  descripcion?: string | null;
  activo?: boolean;
}) {
  const method = payload.id ? "PUT" : "POST";
  const data = await apiRequestMobile<any>("/api/marcas", method, {
    ...payload,
    pais: payload.pais ?? payload.descripcion ?? null,
  });
  await saveCatalogOffline({ marcas: [data] });
  return data;
}

export async function deleteMarcaCloud(id: string | number) {
  await apiRequestMobile(`/api/marcas?id=${encodeURIComponent(String(id))}`, "DELETE");
  const db = await getMobileDb();
  await db.runAsync(`DELETE FROM marcas WHERE id = ?`, [String(id)]);
  return { success: true };
}

/**
 * PROVEEDORES CRUD
 */
export async function fetchProveedoresCloud(search = ""): Promise<any[]> {
  try {
    const q = new URLSearchParams({ limit: "200" });
    if (search.trim()) q.set("search", search.trim());
    const res = await apiRequestMobile<any>(`/api/proveedores?${q.toString()}`, "GET");
    const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
    if (list.length > 0) {
      await saveCatalogOffline({ proveedores: list });
    }
    return list;
  } catch {
    return [];
  }
}

export async function saveProveedorCloud(payload: {
  id?: string | number | null;
  nombre: string;
  rif?: string | null;
  documento?: string | null;
  contacto?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  ciudad?: string | null;
  notas?: string | null;
  activo?: boolean;
}) {
  const method = payload.id ? "PUT" : "POST";
  const data = await apiRequestMobile<any>("/api/proveedores", method, {
    ...payload,
    rif: payload.rif ?? payload.documento ?? null,
  });
  await saveCatalogOffline({ proveedores: [data] });
  return data;
}

export async function deleteProveedorCloud(id: string | number) {
  await apiRequestMobile(`/api/proveedores?id=${encodeURIComponent(String(id))}`, "DELETE");
  const db = await getMobileDb();
  await db.runAsync(`DELETE FROM proveedores WHERE id = ?`, [String(id)]);
  return { success: true };
}

/**
 * COMPRAS (Listado + Registrar nueva compra con actualización de stock/costos)
 */
export async function fetchComprasCloud(): Promise<{ compras: any[]; items: any[] }> {
  try {
    const res = await apiRequestMobile<any>("/api/compras", "GET");
    return {
      compras: Array.isArray(res?.compras) ? res.compras : [],
      items: Array.isArray(res?.items) ? res.items : [],
    };
  } catch {
    return { compras: [], items: [] };
  }
}

export async function crearCompraCloud(payload: {
  proveedor_id?: string | number | null;
  fecha?: string;
  moneda_id: string | number;
  metodo_pago_id?: string | number | null;
  caja_id?: string | number | null;
  tipo_pago: "contado" | "parcial" | "credito";
  abono_inicial?: number;
  observaciones?: string | null;
  referencia?: string | null;
  items: Array<{
    producto_id: string | number;
    cantidad: number;
    costo_unit: number;
    presentacion_id?: string | number | null;
  }>;
}) {
  const res = await apiRequestMobile<any>("/api/compras", "POST", payload);
  return res;
}

export async function eliminarCompraCloud(id: string | number) {
  return await apiRequestMobile<any>(`/api/compras?id=${encodeURIComponent(String(id))}`, "DELETE");
}

export async function eliminarVentaCloud(id: string | number) {
  const res = await apiRequestMobile<any>(`/api/ventas?id=${encodeURIComponent(String(id))}`, "DELETE");
  const db = await getMobileDb();
  await db.runAsync(`DELETE FROM ventas_remotas WHERE id = ?`, [String(id)]);
  await db.runAsync(`DELETE FROM venta_items_remotos WHERE venta_id = ?`, [String(id)]);
  return res;
}

/**
 * RETORNOS / DEVOLUCIONES (Listado + Registrar nuevo retorno de cliente o proveedor + Retorno Directo desde Venta/Compra)
 */
export async function fetchRetornosCloud(): Promise<{ retornos: any[]; items: any[] }> {
  try {
    const res = await apiRequestMobile<any>("/api/retornos", "GET");
    return {
      retornos: Array.isArray(res?.retornos) ? res.retornos : [],
      items: Array.isArray(res?.items) ? res.items : [],
    };
  } catch {
    return { retornos: [], items: [] };
  }
}

export async function crearRetornoCloud(payload: {
  tipo: "Cliente" | "Proveedor";
  venta_id?: string | number | null;
  compra_id?: string | number | null;
  cliente_id?: string | number | null;
  proveedor_id?: string | number | null;
  fecha?: string;
  motivo?: string | null;
  abonar_credito?: boolean;
  observaciones?: string | null;
  metodo_reembolso?: "efectivo" | "credito" | "cambio";
  metodo_pago_id?: string | number | null;
  caja_id?: string | number | null;
  items: Array<{
    producto_id: string | number;
    cantidad: number;
    precio_unit?: number;
  }>;
}) {
  return await apiRequestMobile<any>("/api/retornos", "POST", payload);
}

/**
 * TRANSACCIONES DE CAJA (Listado + Registrar Entrada/Salida manual)
 */
export async function fetchTransaccionesCloud(): Promise<any[]> {
  try {
    const res = await apiRequestMobile<any[]>("/api/transacciones", "GET");
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

export async function crearTransaccionCloud(payload: {
  caja_id: string | number;
  tipo: "Entrada" | "Salida";
  monto: number;
  descripcion: string;
}) {
  return await apiRequestMobile<any>("/api/transacciones", "POST", payload);
}

export async function crearCajaCloud(payload: { nombre: string; moneda_id: string | number }) {
  return await apiRequestMobile<any>("/api/cajas", "POST", payload);
}

/**
 * MONEDAS Y TASAS DE CAMBIO
 */
export async function saveMonedaCloud(payload: {
  id?: string | number | null;
  nombre: string;
  codigo: string;
  simbolo: string;
  tasa: number;
  es_base?: boolean;
  decimales?: number;
  usa_tasa_usd_directa?: boolean;
  tasa_usd_directa?: number | null;
}) {
  const method = payload.id ? "PUT" : "POST";
  const data = await apiRequestMobile<any>("/api/monedas", method, payload);
  await saveCatalogOffline({ monedas: [data] });
  return data;
}

/**
 * MÉTODOS DE PAGO CRUD
 */
export async function fetchMetodosPagoCloud(): Promise<any[]> {
  try {
    const list = await apiRequestMobile<any[]>("/api/metodos-pago", "GET");
    if (Array.isArray(list)) {
      await saveCatalogOffline({ metodos_pago: list });
      return list;
    }
    return [];
  } catch {
    return [];
  }
}

export async function saveMetodoPagoCloud(payload: {
  id?: string | number | null;
  nombre: string;
  tipo: string;
  caja_id: string | number;
  activo?: boolean;
}) {
  const method = payload.id ? "PUT" : "POST";
  const data = await apiRequestMobile<any>("/api/metodos-pago", method, payload);
  await saveCatalogOffline({ metodos_pago: [data] });
  return data;
}

export async function deleteMetodoPagoCloud(id: string | number) {
  await apiRequestMobile(`/api/metodos-pago?id=${encodeURIComponent(String(id))}`, "DELETE");
  const db = await getMobileDb();
  await db.runAsync(`DELETE FROM metodos_pago WHERE id = ?`, [String(id)]);
  return { success: true };
}

/**
 * CONFIGURACIÓN DE EMPRESA Y MOTOR DE CONVERSIÓN GLOBAL
 */
export async function fetchConfiguracionEmpresaCloud(): Promise<any[]> {
  try {
    const res = await apiRequestMobile<any[]>("/api/configuracion", "GET");
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

export async function saveConfiguracionClaveCloud(clave: string, valor: string, tipo = "empresa", descripcion = "") {
  return await apiRequestMobile<any>("/api/configuracion", "POST", {
    clave,
    valor,
    tipo,
    descripcion,
  });
}

export async function saveConfiguracionGlobalCloud(payload: {
  modo_conversion_ventas?: "directa" | "triangulacion";
  modo_conversion_compras?: "directa" | "triangulacion";
  metodo_conversion_ventas?: "directa" | "triangulacion";
  metodo_conversion_compras?: "directa" | "triangulacion";
  moneda_transito_ventas_id?: string | null;
  moneda_transito_compras_id?: string | null;
  redondear_conversion_ventas?: boolean;
  redondeo_activo?: boolean;
  redondeo_multiplo?: number;
  redondeo_no_bajar_de_costo?: boolean;
  actualizar_precio_en_compra?: boolean;
  auto_precio_compra?: boolean;
  porcentaje_ganancia_defecto?: number;
  iva_porcentaje?: number;
}) {
  const body = {
    ...payload,
    metodo_conversion_ventas: payload.metodo_conversion_ventas || payload.modo_conversion_ventas || "directa",
    metodo_conversion_compras: payload.metodo_conversion_compras || payload.modo_conversion_compras || "directa",
    auto_precio_compra: payload.auto_precio_compra ?? payload.actualizar_precio_en_compra ?? false,
    redondeo_activo: payload.redondeo_activo ?? payload.redondear_conversion_ventas ?? false,
    redondeo_multiplo: payload.redondeo_multiplo ?? (payload.redondear_conversion_ventas ? 1 : 0),
    redondeo_no_bajar_de_costo: payload.redondeo_no_bajar_de_costo ?? true,
  };
  const data = await apiRequestMobile<any>("/api/configuracion-global", "PUT", body);
  await saveCatalogOffline({ configuracion_global: data });
  return data;
}

export async function recalcularPreciosGlobalCloud() {
  return await apiRequestMobile<any>("/api/configuracion-global/recalcular-precios", "POST", {});
}

/**
 * GESTIÓN DE USUARIOS (ADMIN)
 */
export async function fetchUsuariosAdminCloud(): Promise<{ users: any[]; currentUserId?: string }> {
  try {
    const res = await apiRequestMobile<any>("/api/admin/users?limit=100", "GET");
    return {
      users: Array.isArray(res?.users) ? res.users : [],
      currentUserId: res?.currentUserId,
    };
  } catch {
    return { users: [] };
  }
}

export async function saveUsuarioAdminCloud(payload: {
  id?: string | null;
  name: string;
  email: string;
  role: "admin" | "cajero" | "usuario";
  password?: string;
}) {
  const method = payload.id ? "PUT" : "POST";
  return await apiRequestMobile<any>("/api/admin/users", method, payload);
}

export async function deleteUsuarioAdminCloud(id: string) {
  return await apiRequestMobile<any>("/api/admin/users", "DELETE", { id });
}
