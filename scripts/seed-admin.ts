import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const { auth } = await import("../src/lib/auth");
  const { pool } = await import("../src/lib/db");

  const email = "admin@admin.com";
  const password = "123123123";
  const name = "Administrador";
  const role = "admin";

  try {
    const existing = await pool.query('SELECT id FROM "user" WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      const userId = existing.rows[0].id;
      await pool.query('DELETE FROM "account" WHERE "userId" = $1', [userId]);
      await pool.query('DELETE FROM "session" WHERE "userId" = $1', [userId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
      console.log("Usuario existente eliminado.");
    }
  } catch (err) {
    console.error("Error eliminando usuario existente:", err);
  }

  try {
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name,
      },
    });

    await pool.query('UPDATE "user" SET role = $1 WHERE email = $2', [role, email]);
    console.log("Usuario administrador creado exitosamente.");
    console.log(`  Email: ${email}`);
    console.log(`  Contraseña: ${password}`);
    console.log(`  Rol: ${role}`);
  } catch (err) {
    console.error("Error al crear el usuario:", err);
  }
}

main();
