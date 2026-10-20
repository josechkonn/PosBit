# PosBit Mobile (Expo / React Native Offline-First)

Aplicación móvil oficial de **PosBit** diseñada con arquitectura **Offline-First** (SQLite local en el dispositivo + sincronización bidireccional con PosBit Cloud).

## Características incluidas

1. **Base de datos SQLite local (`expo-sqlite`):**
   - Guarda todo el catálogo de productos, precios, monedas y tasas en el teléfono.
   - Permite consultar precios y cobrar incluso **sin conexión a internet**.
2. **Cola de ventas Offline (`ventas_locales`):**
   - Si el vendedor cobra sin señal, la venta queda encolada localmente y en cuanto vuelve la conexión (`@react-native-community/netinfo`) se sube sola a `/api/ventas`.
3. **Autenticación por Token Bearer (`/api/mobile/login`):**
   - Compatible con el backend de PosBit mediante `Authorization: Bearer <token>` guardado de forma cifrada en `expo-secure-store`.

---

## Cómo probar en desarrollo

```bash
cd mobile
npm install
npx expo start
```

Escanea el código QR con la app **Expo Go** en tu teléfono Android o iPhone.

---

## Cómo generar el instalador `.APK` para Android

El archivo [`eas.json`](./eas.json) ya viene configurado con el perfil `apk` (`"buildType": "apk"`):

```bash
cd mobile
npm install -g eas-cli
eas login
npm run build:apk
```

Al finalizar el proceso en la nube de Expo, te dará un enlace directo para descargar e instalar el archivo `.apk` en cualquier teléfono o tablet Android.
