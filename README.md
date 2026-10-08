# PosBit — Sistema web de inventario

Aplicación **Next.js (App Router) + React 19 + Tailwind CSS v4** para gestionar el
inventario de una bodega: productos, categorías, marcas, proveedores, compras,
ventas, punto de venta, kardex, métodos de pago, monedas, reportes y configuración.

## Requisitos

- Node.js 20+
- npm 10+
- PostgreSQL local corriendo en `localhost:5432` (base `posbit`, ver `.env.local`)

## Puesta en marcha

```bash
npm install
npm run dev
```

Abre http://localhost:3000 — te pedirá iniciar sesión.

**Credenciales iniciales:**

| Rol      | Email             | Contraseña |
|----------|-------------------|------------|
| admin    | `admin@admin.com` | `123123123`|

El usuario `admin` se crea automáticamente al arrancar el servidor (init de la BD);
`cajero` es el rol por defecto al registrarse en `/registro`.

> La BD arranca limpia: solo `configuración`, 3 monedas, 3 cajas, 9 métodos de pago
> y el admin. No hay seed de datos de prueba.

## Autenticación

- **Better Auth + PostgreSQL** (`pg` directo, sin ORM). Config en `src/lib/auth.ts`.
- Tablas (`user`, `session`, `account`, `verification`) ya migradas; si cambian los
  campos/plugins: `npx @better-auth/cli migrate -y`.
- Protección: `src/proxy.ts` (cookie optimista) + `requireSession()`/`requireRole()`
  en `src/lib/auth-server.ts` (validación real por página).

## Estructura

```
src/
├── app/
│   ├── (app)/              # Rutas protegidas (requieren sesión)
│   │   ├── layout.tsx          # requireSession + AppShell con el usuario real
│   │   ├── dashboard/ productos/ categorias/ marcas/ proveedores/
│   │   ├── compras/ ventas/ pos/ kardex/ metodos-pago/ monedas/
│   │   └── reportes/ configuracion/   # configuracion: solo rol admin
│   ├── (auth)/             # Rutas públicas: login/, registro/
│   ├── api/auth/[...all]/  # Route handler de Better Auth
│   ├── fonts/              # Fuentes vendorizadas (Inter, JetBrains Mono) — offline
│   ├── globals.css         # ★ Diseño centralizado: todos los tokens Tailwind
│   ├── layout.tsx          # Layout raíz (fuentes locales + metadata)
│   └── page.tsx            # Redirige a /dashboard
├── components/
│   ├── ui/                 # Componentes reutilizables
│   │   ├── button.tsx          # Button con variantes (primary/outline/ghost/...)
│   │   ├── badge.tsx           # Badge + StatusBadge (estados de negocio)
│   │   ├── card.tsx alert.tsx  # Card, CardHeader... / Alert de formularios
│   │   ├── kpi-card.tsx        # Tarjeta KPI con tendencia
│   │   ├── stat-card.tsx       # Tarjeta de resumen por estado
│   │   ├── table.tsx           # Table / Tr / Td
│   │   ├── input.tsx select.tsx label.tsx search-bar.tsx
│   │   ├── modal.tsx tabs.tsx switch.tsx pagination.tsx
│   │   └── avatar.tsx action-buttons.tsx empty-state.tsx page-header.tsx
│   ├── layout/             # AppShell, Sidebar (con sign-out), Topbar, nav.ts
│   └── charts/             # Gráficas recharts (client components)
├── lib/
│   ├── auth.ts             # Better Auth: pg + email/password + campo role
│   ├── auth-client.ts      # Cliente React (signIn/signUp/signOut/useSession)
│   ├── auth-server.ts      # requireSession() / requireRole() — server-only
│   ├── format.ts           # fmt (moneda) y fmtDate
│   ├── chart-colors.ts     # Espejo de --chart-* para recharts
│   └── utils.ts            # cn(), userInitials()
└── proxy.ts                # Redirección optimista por cookie de sesión
```

## Sistema de diseño

Todos los tokens viven en **`src/app/globals.css`**:

- **Marca**: escala completa `--color-primary-50 … 950` (naranja).
- **Estados**: `success / warning / danger / info / purple`, cada uno con
  variantes `base`, `-strong` (texto), `-soft` (fondo) y `-border`.
- **Semánticos**: `background`, `foreground`, `card`, `muted`, `accent`,
  `border`, `ring`, `sidebar-*` (con versión `.dark`).
- **Texto**: escala `--text-xs … 2xl` con sus line-heights; base de 14 px.
- **Radios**: `--radius-sm … xl` derivados de `--radius`.
- **Fuentes**: Inter (`font-sans`) y JetBrains Mono (`font-mono`) vía `next/font`.

Las gráficas (recharts) no aceptan clases Tailwind, por eso
`src/lib/chart-colors.ts` espeja los valores de `--chart-*`.
