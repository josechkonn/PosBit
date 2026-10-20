import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Proxy de seguridad y enrutamiento (Next.js 16: "proxy" en vez de "middleware").
 * Valida la existencia de credenciales de autenticación para páginas y APIs.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rutas de API protegidas
  if (pathname.startsWith("/api/")) {
    const isPublicApi =
      pathname.startsWith("/api/auth") ||
      pathname.startsWith("/api/mobile/login") ||
      pathname.startsWith("/api/sync");

    if (!isPublicApi) {
      const sessionCookie = getSessionCookie(request);
      const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
      const syncKey = request.headers.get("x-sync-api-key") || request.headers.get("X-Sync-Api-Key");

      if (!sessionCookie && !authHeader && !syncKey) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
      }
    }
    return NextResponse.next();
  }

  // Rutas de interfaz web (páginas del sistema)
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|registro|_next/static|_next/image|_next/webpack-hmr|favicon.ico|images).*)"],
};

