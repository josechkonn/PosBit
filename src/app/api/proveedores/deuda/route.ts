export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    await requireSession();
    const deudas = await query(`SELECT * FROM vista_deuda_proveedores ORDER BY deuda_total_base DESC`);
    return NextResponse.json(deudas);
  } catch (error) {
    console.error("Error al obtener deudas:", error);
    return NextResponse.json({ error: "Error al obtener deudas" }, { status: 500 });
  }
}