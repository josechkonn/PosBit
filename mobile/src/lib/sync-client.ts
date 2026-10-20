import * as SecureStore from "expo-secure-store";
import {
  getMeta,
  setMeta,
  saveCatalogOffline,
  getVentasLocales,
  markVentaSincronizada,
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
 * Inicia sesión contra el servidor PosBit Cloud (o IP local) y guarda el catálogo inicial para uso offline.
 */
export async function loginMobile(
  rawServerUrl: string,
  email: string,
  password: string
) {
  const serverUrl = rawServerUrl.trim().replace(/\/+$/, "");
  if (!serverUrl || serverUrl === "https://" || serverUrl === "http://") {
    throw new Error("Por favor ingresa la URL completa de tu servidor (ej. https://tu-posbit.vercel.app)");
  }

  let res: Response;
  try {
    res = await fetch(`${serverUrl}/api/mobile/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (netErr: any) {
    throw new Error(`No se pudo conectar a "${serverUrl}". Verifica tu conexión y la URL (${netErr?.message || netErr}).`);
  }

  const rawText = await res.text();
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(
      `El servidor respondió con error (HTTP ${res.status}). La URL ingresada no devolvió una respuesta válida de PosBit. Verifica que la URL del servidor sea correcta.`
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
    monedas: data.monedas,
    cajas: data.cajas,
    metodos_pago: data.metodosPago,
  });

  return data;
}

/**
 * Sincroniza bidireccionalmente la App Móvil con el Servidor PosBit en la Nube:
 *   1. Sube todas las ventas creadas en modo offline (`sincronizado = 0`) a `/api/ventas`
 *   2. Descarga los cambios del catálogo (productos, precios, tasas de moneda) desde `/api/sync`
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
    const items = JSON.parse(venta.items_json);
    const res = await fetch(`${serverUrl}/api/ventas`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        cliente: venta.cliente_nombre,
        tipo_pago: "Contado",
        fecha: venta.fecha,
        moneda_id: venta.moneda_id,
        metodo_pago_id: venta.metodo_pago_id,
        caja_id: venta.caja_id,
        estado: "Completada",
        observaciones: `Venta desde App Móvil (${venta.numero})`,
        items: items.map((it: any) => ({
          producto_id: it.producto_id,
          cantidad: it.cantidad,
          precio_unit: it.precio_unit,
          subtotal: it.subtotal,
        })),
      }),
    });

    if (res.ok) {
      await markVentaSincronizada(venta.id);
      ventasSubidas++;
    }
  }

  // 2. Descargar catálogo e inventario desde `/api/sync`
  const lastSync = await getMeta("last_pull_iso");
  const syncUrl = lastSync
    ? `${serverUrl}/api/sync?since=${encodeURIComponent(lastSync)}`
    : `${serverUrl}/api/sync`;

  const pullRes = await fetch(syncUrl, { method: "GET", headers });
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
  const prods = delta.tables?.productos || [];
  await saveCatalogOffline({
    monedas: delta.tables?.monedas,
    cajas: delta.tables?.cajas,
    metodos_pago: delta.tables?.metodos_pago,
    productos: prods,
  });

  const nowIso = delta.hasta || new Date().toISOString();
  await setMeta("last_pull_iso", nowIso);

  return {
    ventasSubidas,
    productosActualizados: prods.length,
    fecha: nowIso,
  };
}
