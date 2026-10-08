export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { queryOne } from "@/lib/db";

function getUploadDir() {
  if (process.env.USER_DATA_PATH) {
    return join(process.env.USER_DATA_PATH, "uploads", "images", "productos");
  }
  return join(process.cwd(), "public", "images", "productos");
}

export async function POST(request: Request) {
  try {
    await requireSession();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const productoId = formData.get("producto_id") as string | null;

    if (!file || !productoId) {
      return NextResponse.json({ error: "Archivo y producto_id requeridos" }, { status: 400 });
    }

    // Verify product exists
    const producto = await queryOne(`SELECT id FROM productos WHERE id = $1`, [productoId]);
    if (!producto) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: "Solo se permiten imágenes (JPG, PNG, WebP, GIF)" }, { status: 400 });
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "La imagen no debe superar 2MB" }, { status: 400 });
    }

    // Generate filename
    const ext = file.name.split(".").pop() || "jpg";
    const filename = `prod-${productoId}-${Date.now()}.${ext}`;
    const uploadDir = getUploadDir();

    // Ensure directory exists
    await mkdir(uploadDir, { recursive: true });

    // Save file
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(join(uploadDir, filename), buffer);

    // Update product with image path
    await queryOne(
      `UPDATE productos SET imagen = $1 WHERE id = $2`,
      [`/images/productos/${filename}`, productoId]
    );

    return NextResponse.json({ url: `/images/productos/${filename}` });
  } catch (error) {
    console.error("Error uploading image:", error);
    return NextResponse.json({ error: "Error al subir la imagen" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireSession();

    const { searchParams } = new URL(request.url);
    const productoId = searchParams.get("producto_id");

    if (!productoId) {
      return NextResponse.json({ error: "producto_id requerido" }, { status: 400 });
    }

    const producto = await queryOne(`SELECT imagen FROM productos WHERE id = $1`, [productoId]);
    if (!producto) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }

    if (producto.imagen) {
      // Remove image file from both locations if present
      const filename = producto.imagen.split("/").pop();
      if (filename) {
        const { unlink } = await import("fs/promises");
        const paths = [
          join(getUploadDir(), filename),
          join(process.cwd(), "public", "images", "productos", filename),
        ];
        for (const p of paths) {
          try {
            await unlink(p);
          } catch {
            // File might not exist in this location, ignore
          }
        }
      }

      // Clear image from DB
      await queryOne(`UPDATE productos SET imagen = NULL WHERE id = $1`, [productoId]);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting image:", error);
    return NextResponse.json({ error: "Error al eliminar la imagen" }, { status: 500 });
  }
}
