import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";

export async function GET() {
  try {
    const session = await requireSession();
    const user = session.user as { name: string; email: string; role?: string };
    
    console.log("[/api/me] session.user:", JSON.stringify({
      id: session.user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    }));

    return NextResponse.json({
      user: {
        name: user.name,
        email: user.email,
        role: user.role ?? "usuario",
      },
    });
  } catch (err) {
    console.error("[/api/me] error:", err);
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
}
