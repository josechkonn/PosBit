import {
  Award,
  BarChart2,
  ClipboardList,
  DollarSign,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingCart,
  Store,
  Tag,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  ArrowLeftRight,
  Vault,
  Contact,
  HandCoins,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: "Principal",
    items: [{ href: "/dashboard", label: "Panel de control", icon: LayoutDashboard }],
  },
  {
    label: "Clientes",
    items: [
      { href: "/clientes", label: "Clientes", icon: Contact },
      { href: "/creditos", label: "Créditos / Deudores", icon: HandCoins },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { href: "/productos", label: "Productos", icon: Package },
      { href: "/categorias", label: "Categorías", icon: Tag },
      { href: "/marcas", label: "Marcas", icon: Award },
    ],
  },
  {
    label: "Operaciones",
    items: [
      { href: "/compras", label: "Compras", icon: ShoppingCart, roles: ["admin", "gerente"] },
      { href: "/ventas", label: "Ventas", icon: TrendingUp },
      { href: "/pos", label: "Punto de Venta", icon: Store },
      { href: "/retornos", label: "Retornos", icon: RotateCcw },
      { href: "/kardex", label: "Kardex", icon: ClipboardList },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { href: "/cajas", label: "Cajas", icon: Vault, roles: ["admin", "gerente"] },
      { href: "/transacciones", label: "Transacciones", icon: ArrowLeftRight, roles: ["admin", "gerente"] },
      { href: "/cierres-caja", label: "Cierres de Caja", icon: Wallet, roles: ["admin", "gerente"] },
    ],
  },
  {
    label: "Maestros",
    items: [
      { href: "/proveedores", label: "Proveedores", icon: Truck, roles: ["admin", "gerente"] },
      { href: "/metodos-pago", label: "Métodos de Pago", icon: DollarSign, roles: ["admin"] },
      { href: "/monedas", label: "Monedas", icon: DollarSign, roles: ["admin"] },
    ],
  },
  {
    label: "Análisis",
    items: [{ href: "/reportes", label: "Reportes", icon: BarChart2, roles: ["admin", "gerente"] }],
  },
  {
    label: "Sistema",
    items: [
      { href: "/usuarios", label: "Usuarios", icon: Users, roles: ["admin"] },
      { href: "/configuracion", label: "Configuración", icon: Settings, roles: ["admin"] },
    ],
  },
];

export function getNavGroupsForRole(role: string): NavGroup[] {
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.roles || item.roles.includes(role)
      ),
    }))
    .filter((group) => group.items.length > 0);
}

/** Etiqueta de la ruta actual (para el breadcrumb del topbar). */
export function pathLabel(pathname: string): string {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        return item.label;
      }
    }
  }
  return "Panel de control";
}
