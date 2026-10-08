# Contexto del sistema — PosBit (para la IA)

## Qué es este proyecto

Sistema web de inventario (**bodega**) en español: dashboard, productos, categorías,
marcas, proveedores, compras, ventas, punto de venta (POS), kardex, métodos de pago,
monedas, reportes y configuración. Los datos actuales son **mock** (no hay backend).

## Stack (no cambiar sin motivo)

- **Next.js 16.3.0-canary.95** con **Turbopack** (App Router). Se usa el canal canary
  porque el flujo de verificación `/_next/mcp` exige ≥ 16.3 (el estable es 16.2.x).
  Cuando exista 16.3 estable → `npm install next@latest`.
- **React 19** · **TypeScript 6** (⚠️ TS 7 NO es compatible con Next: rompe el dev server).
- **Tailwind CSS v4** vía `@tailwindcss/postcss` (NO hay `tailwind.config.js`;
  los tokens van en CSS con `@theme`).
- **recharts 3** para gráficas · **lucide-react** para iconos · **cva + clsx + tailwind-merge**.
- **Better Auth 1.6 + PostgreSQL 18 local** (servicio `postgresql-x64-18`, puerto 5432).
- ⚠️ `.npmrc` tiene `legacy-peer-deps=true`: OBLIGATORIO (el canary rompe semver de peers).

## Restricción offline (decisión del usuario)

**Nada del runtime puede requerir internet**: las fuentes Inter/JetBrains Mono están
vendorizadas en `src/app/fonts/` con `next/font/local` (NO usar next/font/google),
la BD es Postgres LOCAL, y todas las deps están en node_modules (nada de `npx` en caliente).

## Autenticación y autorización (Better Auth)

- **Config**: `src/lib/auth.ts` (pool `pg` con `DATABASE_URL` de `.env.local`,
  email+password, campo extra `role` con `input:false` → el cliente NO puede autoasignarse rol).
- **Tablas** (ya migradas en la BD `posbit`): `user`, `session`, `account`, `verification`.
  Re-migrar con `npx @better-auth/cli migrate -y` solo si cambian plugins/campos.
- **Cliente**: `src/lib/auth-client.ts` (`signIn`, `signUp`, `signOut`, `useSession`).
- **Protección en 2 capas**:
  1. `src/proxy.ts` (Next 16 = "proxy", NO middleware.ts): redirección optimista por cookie.
  2. `src/lib/auth-server.ts`: `requireSession()` (→ /login) y `requireRole(role)` (→ /dashboard)
     — validación REAL en servidor. Usar en toda página server protegida nueva.
- **Rutas**: grupo `(app)` = protegidas (layout exige sesión y pasa el usuario al AppShell);
  grupo `(auth)` = /login y /registro (públicas).
- **Roles**: `admin` (todo, incl. /configuracion) y `cajero` (default al registrarse).
- **Regla**: NO importar funciones desde archivos `"use client"` a server components
  (reventó /configuracion); utilidades compartidas van en `src/lib/`.
- **Credenciales demo**: `admin@admin.com / 123123123` (admin, se crea automáticamente
  en el init de la BD) · `cajero` es el rol por defecto al registrarse.
- **Postgres**: servicio `postgresql-x64-18` (Running). La `postgresql-x64-17` quedó
  instalada pero Disabled (residuo de una instalación paralela; no reactivarla o
  peleará por el puerto 5432). Superusuario: `postgres` / `postgres` (local dev).

## Comandos

```bash
npm run dev     # http://localhost:3000 (redirige a /dashboard)
npm run build
npm start
```

## Estructura

```
src/
├── app/
│   ├── (app)/                # Rutas PROTEGIDAS (layout exige sesión)
│   │   ├── layout.tsx            # requireSession + <AppShell user>
│   │   └── dashboard/ productos/ ... (13 secciones)
│   ├── (auth)/               # Rutas públicas: login/, registro/
│   ├── api/auth/[...all]/    # Route handler de Better Auth
│   ├── fonts/                # Fuentes vendorizadas (offline)
│   ├── globals.css           # ★ ÚNICA fuente de verdad del diseño (tokens)
│   ├── layout.tsx            # fuentes locales + metadata
│   └── page.tsx              # redirect a /dashboard
├── components/
│   ├── ui/                   # Componentes reutilizables (button, badge, card, alert,
│   │                         # table, input, select, modal, tabs, switch, kpi-card, ...)
│   ├── layout/               # AppShell, Sidebar, Topbar, nav.ts (config de navegación)
│   └── charts/               # Gráficas recharts (client components)
├── lib/
│   ├── auth.ts               # Config Better Auth (pg + email/password + role)
│   ├── auth-client.ts        # Cliente React (signIn/signUp/signOut/useSession)
│   ├── auth-server.ts        # requireSession() / requireRole() (server-only)
│   ├── format.ts             # fmt() moneda es-BO, fmtDate()
│   ├── chart-colors.ts       # Espejo hex de --chart-* (recharts no acepta clases)
│   └── utils.ts              # cn(), userInitials()
└── proxy.ts                  # Redirección optimista por cookie (Next 16)
```

## Reglas de diseño (importantes)

1. **Nunca hardcodear colores hex ni clases de paleta Tailwind sueltas**
   (`orange-500`, `emerald-50`, `red-600`…). Usar siempre los tokens semánticos de
   `globals.css`: `primary` (+ escala `primary-50…950`), `success | warning | danger |
   info | purple` con variantes `-strong` (texto), `-soft` (fondo), `-border`.
2. **No crear botones, badges, inputs, tablas o modales sueltos**: usar los componentes
   de `src/components/ui/` (Button con variantes cva, Badge/StatusBadge, Card, KpiCard,
   StatCard, Table/Tr/Td, Input, Select, Label/Field, SearchBar, Modal, Tabs, Switch,
   Pagination, Avatar, ActionButtons, EmptyState, PageHeader). Si falta uno, crearlo ahí
   con `cva` + `cn()` siguiendo el estilo existente.
3. Textos: escala `--text-xs…2xl` (base 14 px). Moneda con `fmt()`, fechas con `fmtDate()`.
4. Gráficas: consumir `chart-colors.ts` (espejo de `--chart-*`); si cambia el tema,
   actualizar ambos archivos.
5. Idioma de la UI: **español**.

## Convenciones de código

- **Server components por defecto**; `"use client"` solo con hooks/estado/eventos
  (POS, Modal, Tabs, Switch, charts, AppShell/Sidebar/Topbar).
- Páginas server exportan `metadata` (título); las client pages no pueden.
- Navegación con `<Link>`; la config de menús vive en `components/layout/nav.ts`
  (al añadir una ruta nueva, registrarla ahí para sidebar + breadcrumb).
- Alias de imports: `@/*` → `./src/*`.
- Los datos viven en Postgres y se leen con `query()` / `queryOne()` de `src/lib/db.ts`;
  tipo derivado con `(typeof arr)[number]` cuando se trabaja con arrays locales.

## Flujo de verificación (tras cada cambio)

1. `npm run dev` corriendo → consultar `http://localhost:3000/_next/mcp`
   (JSON-RPC, respuestas SSE: leer la línea `data: `). Herramientas:
   `get_compilation_issues` (debe dar `[]`), `get_routes`, `get_errors`, `get_page_metadata`.
2. Verificar la ruta con HTTP 200 + contenido esperado (SSR).
3. ⚠️ **NO usar `agent-browser`** en este equipo: el usuario reportó que se traba.
   Decisión del usuario, respetarla.

## Notas / gotchas

- PowerShell 5.1 corrompe comillas al pasar JSON a `curl.exe`: enviar bodies con
  `-d @archivo.json`, nunca inline.
- `node_modules/next/AGENTS.md`: este Next tiene breaking changes; consultar
  `node_modules/next/dist/docs/` antes de asumir APIs de versiones viejas.
- `npm audit` muestra 2 vulns altas en deps transitivas del canary: conocidas, no forzar fix.
