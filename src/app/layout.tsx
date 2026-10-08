import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/* Fuentes vendorizadas en ./fonts — la app NO depende de internet para cargar */
const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin.woff2",
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "PosBit — Sistema web de inventario",
    template: "%s — PosBit",
  },
  description:
    "Gestiona el inventario de tu bodega: proveedores, compras, ventas, kardex, métodos de pago, monedas y reportes detallados.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
