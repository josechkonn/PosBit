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
    clientes: data.clientes,
    cliente_limites_credito: data.clienteLimitesCredito,
    productos: data.productos,
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

  // 1. Subir ventas pendientes creadas en el teléfono
  const todasVentas = await getVentasLocales();
  const pendientes = todasVentas.filter((v) => v.sincronizado === 0);
  let ventasSubidas = 0;

  for (const venta of pendientes) {
    const items = JSON.parse(venta.items_json || "[]");
    const pagos = venta.pagos_json ? JSON.parse(venta.pagos_json) : undefined;
    const cobros_extra = venta.cobros_extra_json ? JSON.parse(venta.cobros_extra_json) : undefined;
    const tipoPago = venta.tipo_pago || "Contado";
    const obsBase = venta.observaciones ? `${venta.observaciones} · ` : "";

    const res = await fetch(`${serverUrl}/api/ventas`, {
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
    });

    if (res.ok) {
      await markVentaSincronizada(venta.id);
      ventasSubidas++;
    }
  }

  // 2. Subir abonos pendientes creados en el teléfono
  const abonosPend = await getAbonosLocalesPendientes();
  for (const ab of abonosPend) {
    if (!ab.credito_id || String(ab.credito_id).startsWith("local-")) continue;
    const lineas = ab.lineas_json ? JSON.parse(ab.lineas_json) : undefined;
    const res = await fetch(`${serverUrl}/api/creditos/${ab.credito_id}/abonos`, {
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
    });
    if (res.ok) {
      await markAbonoSincronizado(ab.id);
    }
  }

  // 3. Descargar catálogo, monedas, configuración de conversión, clientes y créditos en paralelo
  const lastSync = await getMeta("last_pull_iso");
  const syncUrl = lastSync
    ? `${serverUrl}/api/sync?mode=mobile&since=${encodeURIComponent(lastSync)}`
    : `${serverUrl}/api/sync?mode=mobile`;

  const fetchJsonSafe = async (url: string) => {
    try {
      const r = await fetch(url, { method: "GET", headers });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  };

  const [pullRes, monedasDirect, cfgGlobalDirect, clientesDirect, creditosDirect, ventasDirect] =
    await Promise.all([
      fetch(syncUrl, { method: "GET", headers }),
      fetchJsonSafe(`${serverUrl}/api/monedas`),
      fetchJsonSafe(`${serverUrl}/api/configuracion-global`),
      fetchJsonSafe(`${serverUrl}/api/clientes?limit=500`),
      fetchJsonSafe(`${serverUrl}/api/creditos`),
      fetchJsonSafe(`${serverUrl}/api/ventas?limit=150`),
    ]);

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

  const prods = delta.tables?.productos || [];
  const monedasMerged =
    Array.isArray(monedasDirect) && monedasDirect.length > 0
      ? monedasDirect
      : delta.tables?.monedas;
  const clientesMerged =
    Array.isArray(clientesDirect?.data) && clientesDirect.data.length > 0
      ? clientesDirect.data
      : delta.tables?.clientes;
  const creditosMerged =
    Array.isArray(creditosDirect?.creditos) && creditosDirect.creditos.length > 0
      ? creditosDirect.creditos
      : delta.tables?.creditos;
  const ventasMerged =
    Array.isArray(ventasDirect?.ventas) && ventasDirect.ventas.length > 0
      ? ventasDirect.ventas
      : delta.tables?.ventas;
  const ventaItemsMerged =
    Array.isArray(ventasDirect?.items) && ventasDirect.items.length > 0
      ? ventasDirect.items
      : delta.tables?.venta_items;

  await saveCatalogOffline({
    configuracion_global: cfgGlobalDirect || delta.tables?.configuracion_global,
    monedas: monedasMerged,
    cajas: delta.tables?.cajas,
    metodos_pago: delta.tables?.metodos_pago,
    categorias: delta.tables?.categorias,
    clientes: clientesMerged,
    cliente_limites_credito: delta.tables?.cliente_limites_credito,
    productos: prods,
    producto_presentaciones: delta.tables?.producto_presentaciones,
    creditos: creditosMerged,
    abonos: delta.tables?.abonos,
    ventas: ventasMerged,
    venta_items: ventaItemsMerged,
    eliminados: delta.eliminados,
  });

  const nowIso = delta.hasta || new Date().toISOString();
  await setMeta("last_pull_iso", nowIso);

  return {
    ventasSubidas,
    productosActualizados: prods.length,
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
