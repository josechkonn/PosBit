import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, type Session } from "@/lib/auth";
import { queryOne } from "@/lib/db";

export async function requireSession(): Promise<Session> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const userDb = await queryOne('SELECT role FROM "user" WHERE id = $1', [session.user.id]);
  (session.user as { role?: string }).role = userDb?.role ?? "usuario";

  return session;
}

export async function requireRole(roles: string | string[]): Promise<Session> {
  const session = await requireSession();
  const userRole = (session.user as { role?: string }).role;
  const requiredRoles = Array.isArray(roles) ? roles : [roles];
  if (!requiredRoles.includes(userRole ?? "")) redirect("/dashboard");
  return session;
}
