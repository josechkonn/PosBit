import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, type Session } from "@/lib/auth";
import { queryOne } from "@/lib/db";

interface CachedSessionEntry {
  session: Session;
  expiresAtMs: number;
}

const SESSION_CACHE_TTL_MS = 20_000;
const globalForAuthCache = globalThis as unknown as {
  sessionCache?: Map<string, CachedSessionEntry>;
};

const sessionCache =
  globalForAuthCache.sessionCache ?? new Map<string, CachedSessionEntry>();
globalForAuthCache.sessionCache = sessionCache;

function getCachedSession(key: string): Session | null {
  const entry = sessionCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAtMs) {
    sessionCache.delete(key);
    return null;
  }
  return entry.session;
}

function setCachedSession(key: string, session: Session): void {
  if (sessionCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of sessionCache.entries()) {
      if (now > v.expiresAtMs) sessionCache.delete(k);
    }
  }
  sessionCache.set(key, {
    session,
    expiresAtMs: Date.now() + SESSION_CACHE_TTL_MS,
  });
}

/**
 * Obtiene la sesión activa soportando:
 *   1. Cookies de Better-Auth (Web / Electron local)
 *   2. Authorization: Bearer <session_token> (App Móvil Expo / Clientes API)
 *   3. X-Sync-Api-Key / Bearer <cloud_api_key> (Sincronización máquina a máquina)
 */
export async function getSessionOrBearer(): Promise<Session | null> {
  const reqHeaders = await headers();

  const authHeader = reqHeaders.get("authorization") || reqHeaders.get("Authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  const syncKeyHeader = reqHeaders.get("x-sync-api-key") || reqHeaders.get("X-Sync-Api-Key");
  const cookieHeader = reqHeaders.get("cookie") || "";

  // Clave rápida de caché en memoria para evitar consultar Supabase múltiples veces por página
  const cacheKey = syncKeyHeader
    ? `sync:${syncKeyHeader}`
    : bearerToken
      ? `bearer:${bearerToken}`
      : cookieHeader
        ? `cookie:${cookieHeader}`
        : null;

  if (cacheKey) {
    const cached = getCachedSession(cacheKey);
    if (cached) return cached;
  }

  // 1. Intentar sesión estándar por cookies de Better-Auth (solo si hay cookies)
  if (cookieHeader) {
    const cookieSession = await auth.api.getSession({
      headers: reqHeaders,
    });

    if (cookieSession) {
      const existingRole = (cookieSession.user as { role?: string }).role;
      if (!existingRole) {
        const userDb = await queryOne<{ role: string }>(
          'SELECT role FROM "user" WHERE id = $1',
          [cookieSession.user.id]
        );
        (cookieSession.user as { role?: string }).role = userDb?.role ?? "usuario";
      }
      if (cacheKey) setCachedSession(cacheKey, cookieSession);
      return cookieSession;
    }
  }

  // 2. Intentar token Bearer (App Móvil Expo o cliente remoto)
  if (bearerToken) {
    const sessionRow = await queryOne<{
      session_id: string;
      token: string;
      expiresAt: Date;
      createdAt: Date;
      updatedAt: Date;
      ipAddress: string | null;
      userAgent: string | null;
      userId: string;
      user_name: string;
      user_email: string;
      user_emailVerified: boolean;
      user_image: string | null;
      user_createdAt: Date;
      user_updatedAt: Date;
      user_role: string;
    }>(
      `SELECT 
         s.id AS session_id, s.token, s."expiresAt", s."createdAt", s."updatedAt",
         s."ipAddress", s."userAgent", s."userId",
         u.name AS user_name, u.email AS user_email, u."emailVerified" AS "user_emailVerified",
         u.image AS user_image, u."createdAt" AS "user_createdAt", u."updatedAt" AS "user_updatedAt",
         u.role AS user_role
       FROM "session" s
       JOIN "user" u ON u.id = s."userId"
       WHERE s.token = $1 AND s."expiresAt" > NOW()
       LIMIT 1`,
      [bearerToken]
    );

    if (sessionRow) {
      const resolved = {
        session: {
          id: sessionRow.session_id,
          token: sessionRow.token,
          userId: sessionRow.userId,
          expiresAt: new Date(sessionRow.expiresAt),
          createdAt: new Date(sessionRow.createdAt),
          updatedAt: new Date(sessionRow.updatedAt),
          ipAddress: sessionRow.ipAddress,
          userAgent: sessionRow.userAgent,
        },
        user: {
          id: sessionRow.userId,
          name: sessionRow.user_name,
          email: sessionRow.user_email,
          emailVerified: sessionRow.user_emailVerified,
          image: sessionRow.user_image,
          createdAt: new Date(sessionRow.user_createdAt),
          updatedAt: new Date(sessionRow.user_updatedAt),
          role: sessionRow.user_role ?? "usuario",
        },
      } as unknown as Session;
      if (cacheKey) setCachedSession(cacheKey, resolved);
      return resolved;
    }
  }

  // 3. Verificar llave maestra de sincronización (X-Sync-Api-Key o Bearer igual a CLOUD_SYNC_SECRET / sync_config.cloud_api_key)
  const candidateSyncKey = syncKeyHeader || bearerToken;
  if (candidateSyncKey) {
    const envSecret = process.env.CLOUD_SYNC_SECRET || process.env.CLOUD_API_KEY;
    let validSyncKey = Boolean(envSecret && candidateSyncKey === envSecret);

    if (!validSyncKey) {
      try {
        const cfgRow = await queryOne<{ cloud_api_key: string | null }>(
          `SELECT cloud_api_key FROM sync_config WHERE id = 1`
        );
        if (cfgRow?.cloud_api_key && cfgRow.cloud_api_key === candidateSyncKey) {
          validSyncKey = true;
        }
      } catch {
        // sync_config aún no inicializada
      }
    }

    if (validSyncKey) {
      const adminUser = await queryOne<{
        id: string;
        name: string;
        email: string;
        role: string;
      }>(`SELECT id, name, email, role FROM "user" ORDER BY (role = 'admin') DESC LIMIT 1`);

      if (adminUser) {
        const resolved = {
          session: {
            id: "sync-session",
            token: candidateSyncKey,
            userId: adminUser.id,
            expiresAt: new Date(Date.now() + 86400_000),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          user: {
            id: adminUser.id,
            name: adminUser.name,
            email: adminUser.email,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            role: adminUser.role ?? "admin",
          },
        } as unknown as Session;
        if (cacheKey) setCachedSession(cacheKey, resolved);
        return resolved;
      }
    }
  }

  return null;
}

export class AuthError extends Error {
  status: number;
  constructor(message = "No autorizado", status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export async function requireSession(): Promise<Session> {
  const session = await getSessionOrBearer();
  if (!session) {
    const reqHeaders = await headers();
    const accept = reqHeaders.get("accept") || "";
    if (accept.includes("text/html")) {
      redirect("/login");
    }
    throw new AuthError("No autorizado", 401);
  }
  return session;
}

export async function requireRole(roles: string | string[]): Promise<Session> {
  const session = await requireSession();
  const userRole = (session.user as { role?: string }).role;
  const requiredRoles = Array.isArray(roles) ? roles : [roles];
  if (!requiredRoles.includes(userRole ?? "")) {
    const reqHeaders = await headers();
    const accept = reqHeaders.get("accept") || "";
    if (accept.includes("text/html")) {
      redirect("/dashboard");
    }
    throw new AuthError("Acceso prohibido", 403);
  }
  return session;
}
