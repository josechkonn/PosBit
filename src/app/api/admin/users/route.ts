export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { pool, waitForDB } from "@/lib/db";
import { hashPassword } from "@/lib/password";

async function requireAdmin() {
  await waitForDB();
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session || (session.user as { role?: string }).role !== "admin") {
    return null;
  }
  return { session, headers: h };
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
  const offset = (page - 1) * limit;

  const { rows: totalRows } = await pool.query('SELECT COUNT(*) as count FROM "user"');
  const total = Number(totalRows[0].count);

  const { rows } = await pool.query(
    'SELECT id, name, email, role, "createdAt" FROM "user" ORDER BY "createdAt" DESC, id ASC LIMIT $1 OFFSET $2',
    [limit, offset]
  );

  return NextResponse.json({
    users: rows,
    currentUserId: admin.session.user.id,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await request.json();
  const { name, email, password, role } = body;

  if (!name || !email || !password) {
    return NextResponse.json({ error: "Faltan campos obligatorios." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "La contraseña debe tener minimo 8 caracteres." },
      { status: 400 }
    );
  }

  const validRoles = ["usuario", "cajero", "admin"];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: "Rol no valido." }, { status: 400 });
  }

  try {
    await auth.api.signUpEmail({
      body: { email, password, name },
    });

    await pool.query('UPDATE "user" SET role = $1 WHERE email = $2', [role, email]);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
      return NextResponse.json(
        { error: "Ya existe una cuenta con ese correo." },
        { status: 400 }
      );
    }
    const message = err?.body?.message || err?.message || "Error al crear usuario.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await request.json();
  const { id, name, email, role, password } = body;

  if (!id || !name || !email) {
    return NextResponse.json({ error: "Faltan campos obligatorios." }, { status: 400 });
  }

  const validRoles = ["usuario", "cajero", "admin"];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: "Rol no valido." }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      'UPDATE "user" SET name = $1, email = $2, role = $3, "updatedAt" = NOW() WHERE id = $4',
      [name, email, role, id]
    );

    if (password && password.length >= 8) {
      const pwHash = await hashPassword(password);
      await client.query(
        'UPDATE "account" SET password = $1, "updatedAt" = NOW() WHERE "userId" = $2 AND "providerId" = $3',
        [pwHash, id, "credential"]
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    const message = err instanceof Error ? err.message : "Error al actualizar usuario.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await request.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: "Falta el ID del usuario." }, { status: 400 });
  }

  if (id === admin.session.user.id) {
    return NextResponse.json(
      { error: "No puedes eliminarte a ti mismo." },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query('DELETE FROM "account" WHERE "userId" = $1', [id]);
    await client.query('DELETE FROM "session" WHERE "userId" = $1', [id]);
    await client.query('DELETE FROM "user" WHERE id = $1', [id]);
    await client.query("COMMIT");
    return NextResponse.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    const message = err instanceof Error ? err.message : "Error al eliminar usuario.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
