import { auth } from "./auth";
import { pool } from "./db";

export const ADMIN_EMAIL = "admin@admin.com";
export const ADMIN_PASSWORD = "123123123";
export const ADMIN_NAME = "Administrador";
export const ADMIN_ROLE = "admin";

export async function seedAdminUser(): Promise<void> {
  const { rows } = await pool.query('SELECT id FROM "user" WHERE email = $1', [ADMIN_EMAIL]);
  if (rows.length > 0) return;

  await auth.api.signUpEmail({
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME },
  });

  await pool.query('UPDATE "user" SET role = $1 WHERE email = $2', [ADMIN_ROLE, ADMIN_EMAIL]);
  console.log(`Usuario administrador creado: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}
