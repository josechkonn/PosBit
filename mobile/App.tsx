import React, { useState, useEffect, useCallback } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  StatusBar,
} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  getLocalProductos,
  getLocalMonedas,
  createOfflineSale,
  getVentasLocales,
  type LocalProducto,
  type LocalMoneda,
  type LocalVentaPendiente,
} from "./src/lib/local-db";
import {
  getStoredSession,
  loginMobile,
  syncMobileWithCloud,
  clearStoredSession,
} from "./src/lib/sync-client";

type TabType = "catalogo" | "pos" | "sincronizacion" | "ajustes";

interface CartItem {
  producto: LocalProducto;
  cantidad: number;
}

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<{ id: string; name: string; email: string; role: string } | null>(
    null
  );
  const [serverUrl, setServerUrl] = useState("https://pos-bit-pi.vercel.app");
  const [email, setEmail] = useState("admin@admin.com");
  const [password, setPassword] = useState("123123123");
  const [authLoading, setAuthLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<TabType>("catalogo");
  const [isOnline, setIsOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [productos, setProductos] = useState<LocalProducto[]>([]);
  const [monedas, setMonedas] = useState<LocalMoneda[]>([]);
  const [ventasLocales, setVentasLocales] = useState<LocalVentaPendiente[]>([]);
  const [search, setSearch] = useState("");

  const [cart, setCart] = useState<CartItem[]>([]);
  const [clienteNombre, setClienteNombre] = useState("Consumidor Final");

  const loadLocalData = useCallback(async (searchQuery = "") => {
    const [prods, mons, vtas] = await Promise.all([
      getLocalProductos(searchQuery),
      getLocalMonedas(),
      getVentasLocales(),
    ]);
    setProductos(prods);
    setMonedas(mons);
    setVentasLocales(vtas);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const session = await getStoredSession();
        if (session.serverUrl) setServerUrl(session.serverUrl);
        if (session.user && session.token) {
          setUser(session.user);
          await loadLocalData();
        }
      } catch (e) {
        console.warn("Error cargando sesión móvil:", e);
      } finally {
        setInitializing(false);
      }
    })();
  }, [loadLocalData]);

  // Escuchar cambios de conectividad y sincronizar automáticamente al recuperar internet
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = Boolean(state.isConnected);
      setIsOnline(connected);
      if (connected && user) {
        handleSync(true);
      }
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (user) {
      loadLocalData(search);
    }
  }, [search, user, loadLocalData]);

  const handleLogin = async () => {
    if (!serverUrl || serverUrl === "https://") {
      Alert.alert("URL requerida", "Ingresa la URL de tu servidor PosBit Cloud o IP local.");
      return;
    }
    setAuthLoading(true);
    try {
      const data = await loginMobile(serverUrl, email, password);
      setUser(data.user);
      await handleSync(true);
      await loadLocalData();
    } catch (err: any) {
      Alert.alert("Error de acceso", err?.message || "No se pudo conectar al servidor");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSync = async (silent = false) => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await syncMobileWithCloud();
      await loadLocalData(search);
      if (!silent) {
        Alert.alert(
          "Sincronización exitosa",
          `Ventas subidas: ${res.ventasSubidas}\nProductos actualizados: ${res.productosActualizados}`
        );
      }
    } catch (err: any) {
      if (!silent) {
        Alert.alert("Modo Offline", err?.message || "Trabajando con datos locales.");
      }
    } finally {
      setSyncing(false);
    }
  };

  const addToCart = (producto: LocalProducto) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.producto.id === producto.id);
      if (existing) {
        return prev.map((i) =>
          i.producto.id === producto.id ? { ...i, cantidad: i.cantidad + 1 } : i
        );
      }
      return [...prev, { producto, cantidad: 1 }];
    });
  };

  const updateCartQty = (productoId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) =>
          i.producto.id === productoId ? { ...i, cantidad: i.cantidad + delta } : i
        )
        .filter((i) => i.cantidad > 0)
    );
  };

  const totalUsd = cart.reduce(
    (acc, item) => acc + item.producto.precio_base * item.cantidad,
    0
  );

  const monedaBase = monedas.find((m) => m.es_base === 1) || monedas[0];
  const monedaVes = monedas.find((m) => m.codigo === "VES");

  const handleCobrar = async () => {
    if (cart.length === 0) return;
    try {
      const monedaId = monedaBase ? String(monedaBase.id) : "1";
      await createOfflineSale({
        cliente_nombre: clienteNombre,
        moneda_id: monedaId,
        metodo_pago_id: null,
        caja_id: null,
        total: Number(totalUsd.toFixed(2)),
        items: cart.map((c) => ({
          producto_id: c.producto.id,
          nombre: c.producto.nombre,
          cantidad: c.cantidad,
          precio_unit: c.producto.precio_base,
          subtotal: Number((c.producto.precio_base * c.cantidad).toFixed(2)),
        })),
      });

      setCart([]);
      setClienteNombre("Consumidor Final");
      await loadLocalData(search);

      if (isOnline) {
        handleSync(true);
        Alert.alert("Venta registrada", "La venta se guardó y se sincronizó con la nube.");
      } else {
        Alert.alert(
          "Venta guardada (Modo Offline)",
          "La venta quedó guardada en el teléfono y se subirá automáticamente cuando vuelva el internet."
        );
      }
    } catch (err: any) {
      Alert.alert("Error", err?.message || "No se pudo guardar la venta");
    }
  };

  if (initializing) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loginBox}>
          <Text style={styles.brandTitle}>PosBit Mobile</Text>
          <Text style={styles.brandSub}>
            Punto de Venta y Catálogo Offline-First sincronizado con tu Nube
          </Text>

          <Text style={styles.label}>URL del Servidor PosBit Cloud (o IP local)</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            placeholder="https://tu-posbit.up.railway.app"
            placeholderTextColor="#64748b"
          />

          <Text style={styles.label}>Correo Electrónico</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="admin@admin.com"
            placeholderTextColor="#64748b"
          />

          <Text style={styles.label}>Contraseña</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor="#64748b"
          />

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleLogin}
            disabled={authLoading}
          >
            {authLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Conectar y Descargar Catálogo</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const pendientesCount = ventasLocales.filter((v) => v.sincronizado === 0).length;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header Superior con Estado Online / Offline */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>PosBit Mobile</Text>
          <Text style={styles.headerSub}>{user.name}</Text>
        </View>

        <TouchableOpacity
          onPress={() => handleSync(false)}
          style={[
            styles.statusBadge,
            isOnline ? styles.badgeOnline : styles.badgeOffline,
          ]}
        >
          <Text style={styles.statusBadgeText}>
            {syncing
              ? "Sincronizando..."
              : isOnline
                ? pendientesCount > 0
                  ? `Online (${pendientesCount} pend.)`
                  : "Online · Al día"
                : `Offline (${pendientesCount} en cola)`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Contenido por Pestaña */}
      <View style={styles.content}>
        {activeTab === "catalogo" && (
          <View style={{ flex: 1 }}>
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar por nombre o código de barras..."
              placeholderTextColor="#64748b"
            />
            <FlatList
              data={productos}
              keyExtractor={(item) => String(item.id)}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  No hay productos locales. Pulsa el botón de sincronización arriba.
                </Text>
              }
              renderItem={({ item }) => {
                const precioBs = monedaVes ? item.precio_base * monedaVes.tasa : null;
                return (
                  <View style={styles.cardRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.prodName}>{item.nombre}</Text>
                      <Text style={styles.prodCode}>
                        Cód: {item.codigo} · Stock: {item.stock}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", marginRight: 10 }}>
                      <Text style={styles.prodPrice}>${item.precio_base.toFixed(2)}</Text>
                      {precioBs !== null && (
                        <Text style={styles.prodPriceSub}>Bs. {precioBs.toFixed(2)}</Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.addBtn}
                      onPress={() => addToCart(item)}
                    >
                      <Text style={styles.addBtnText}>+ POS</Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
            />
          </View>
        )}

        {activeTab === "pos" && (
          <View style={{ flex: 1 }}>
            <TextInput
              style={styles.searchInput}
              value={clienteNombre}
              onChangeText={setClienteNombre}
              placeholder="Nombre del Cliente"
              placeholderTextColor="#64748b"
            />

            <FlatList
              data={cart}
              keyExtractor={(item) => String(item.producto.id)}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  El carrito está vacío. Agrega productos desde el Catálogo.
                </Text>
              }
              renderItem={({ item }) => (
                <View style={styles.cardRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.prodName}>{item.producto.nombre}</Text>
                    <Text style={styles.prodCode}>
                      ${item.producto.precio_base.toFixed(2)} c/u
                    </Text>
                  </View>
                  <View style={styles.qtyControls}>
                    <TouchableOpacity
                      style={styles.qtyBtn}
                      onPress={() => updateCartQty(item.producto.id, -1)}
                    >
                      <Text style={styles.qtyBtnText}>-</Text>
                    </TouchableOpacity>
                    <Text style={styles.qtyVal}>{item.cantidad}</Text>
                    <TouchableOpacity
                      style={styles.qtyBtn}
                      onPress={() => updateCartQty(item.producto.id, 1)}
                    >
                      <Text style={styles.qtyBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            />

            <View style={styles.checkoutFooter}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
                <Text style={styles.totalLabel}>Total a Cobrar:</Text>
                <Text style={styles.totalValue}>${totalUsd.toFixed(2)} USD</Text>
              </View>
              <TouchableOpacity
                style={[styles.primaryBtn, cart.length === 0 && { opacity: 0.5 }]}
                disabled={cart.length === 0}
                onPress={handleCobrar}
              >
                <Text style={styles.primaryBtnText}>
                  {isOnline
                    ? "Cobrar y Sincronizar con Nube"
                    : "Cobrar en Modo Offline"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {activeTab === "sincronizacion" && (
          <View style={{ flex: 1 }}>
            <TouchableOpacity
              style={[styles.primaryBtn, { marginBottom: 14 }]}
              onPress={() => handleSync(false)}
              disabled={syncing}
            >
              <Text style={styles.primaryBtnText}>
                {syncing
                  ? "Sincronizando con PosBit Cloud..."
                  : `Sincronizar Ahora (${pendientesCount} pendientes)`}
              </Text>
            </TouchableOpacity>

            <FlatList
              data={ventasLocales}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  Aún no se han registrado ventas desde este dispositivo móvil.
                </Text>
              }
              renderItem={({ item }) => (
                <View style={styles.cardRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.prodName}>{item.numero}</Text>
                    <Text style={styles.prodCode}>
                      {item.cliente_nombre} · {item.fecha}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.prodPrice}>${item.total.toFixed(2)}</Text>
                    <Text
                      style={{
                        fontSize: 11,
                        color: item.sincronizado ? "#10b981" : "#f59e0b",
                      }}
                    >
                      {item.sincronizado ? "Sincronizada en Nube" : "Pendiente por subir"}
                    </Text>
                  </View>
                </View>
              )}
            />
          </View>
        )}

        {activeTab === "ajustes" && (
          <View style={{ flex: 1, padding: 8 }}>
            <Text style={styles.label}>Servidor Conectado</Text>
            <Text style={[styles.prodName, { marginBottom: 16 }]}>{serverUrl}</Text>

            <Text style={styles.label}>Usuario Activo</Text>
            <Text style={[styles.prodName, { marginBottom: 24 }]}>
              {user.name} ({user.email})
            </Text>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: "#ef4444" }]}
              onPress={async () => {
                await clearStoredSession();
                setUser(null);
              }}
            >
              <Text style={styles.primaryBtnText}>Cerrar Sesión</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Barra de Navegación Inferior */}
      <View style={styles.tabBar}>
        {(
          [
            { key: "catalogo", label: "Catálogo" },
            { key: "pos", label: `POS (${cart.length})` },
            { key: "sincronizacion", label: `Sync (${pendientesCount})` },
            { key: "ajustes", label: "Ajustes" },
          ] as const
        ).map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabItem, activeTab === t.key && styles.tabItemActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <Text
              style={[
                styles.tabLabel,
                activeTab === t.key && styles.tabLabelActive,
              ]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#090d16" },
  centered: { flex: 1, backgroundColor: "#090d16", justifyContent: "center", alignItems: "center" },
  loginBox: { flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  brandTitle: { fontSize: 28, fontWeight: "700", color: "#f8fafc", marginBottom: 6 },
  brandSub: { fontSize: 13, color: "#94a3b8", marginBottom: 24 },
  label: { fontSize: 12, fontWeight: "600", color: "#cbd5e1", marginBottom: 6 },
  input: {
    backgroundColor: "#111827",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#f8fafc",
    marginBottom: 14,
  },
  primaryBtn: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: "center",
  },
  primaryBtnText: { color: "#ffffff", fontWeight: "600", fontSize: 14 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  headerTitle: { fontSize: 16, fontWeight: "700", color: "#f8fafc" },
  headerSub: { fontSize: 12, color: "#94a3b8" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  badgeOnline: { backgroundColor: "rgba(16, 185, 129, 0.15)" },
  badgeOffline: { backgroundColor: "rgba(245, 158, 11, 0.15)" },
  statusBadgeText: { fontSize: 11, fontWeight: "600", color: "#f8fafc" },
  content: { flex: 1, padding: 12 },
  searchInput: {
    backgroundColor: "#111827",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: "#f8fafc",
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  prodName: { fontSize: 14, fontWeight: "600", color: "#f8fafc" },
  prodCode: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  prodPrice: { fontSize: 15, fontWeight: "700", color: "#38bdf8" },
  prodPriceSub: { fontSize: 11, color: "#94a3b8" },
  addBtn: {
    backgroundColor: "#1d4ed8",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
  },
  addBtnText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  emptyText: { color: "#64748b", textAlign: "center", marginTop: 40, fontSize: 13 },
  qtyControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyBtn: {
    backgroundColor: "#1e293b",
    width: 28,
    height: 28,
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  qtyBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  qtyVal: { color: "#f8fafc", fontSize: 14, fontWeight: "600", minWidth: 20, textAlign: "center" },
  checkoutFooter: {
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    paddingTop: 12,
    marginTop: 8,
  },
  totalLabel: { color: "#94a3b8", fontSize: 14 },
  totalValue: { color: "#f8fafc", fontSize: 18, fontWeight: "700" },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    backgroundColor: "#0f172a",
  },
  tabItem: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabItemActive: { borderTopWidth: 2, borderTopColor: "#3b82f6" },
  tabLabel: { fontSize: 12, color: "#64748b", fontWeight: "600" },
  tabLabelActive: { color: "#3b82f6" },
});
