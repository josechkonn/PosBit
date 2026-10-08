import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Redirección optimista por cookie (Next.js 16: "proxy" en vez de "middleware").
 * Solo comprueba que EXISTA la cookie de sesión; la validación real se hace en
 * el servidor con requireSession() / requireRole() (src/lib/auth-server.ts).
 */
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|registro|api|_next/static|_next/image|_next/webpack-hmr|favicon.ico|images).*)"],
};
