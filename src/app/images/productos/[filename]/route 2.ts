export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { join } from "path";

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return new NextResponse("Invalid filename", { status: 400 });
    }

    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    let filePath: string | null = null;

    // 1. Check process.env.USER_DATA_PATH / uploads (for Electron production)
    if (process.env.USER_DATA_PATH) {
      const userPath = join(process.env.USER_DATA_PATH, "uploads", "images", "productos", filename);
      try {
        await stat(userPath);
        filePath = userPath;
      } catch {
        // Not found in USER_DATA_PATH
      }
    }

    // 2. Check public directory (for web / dev mode)
    if (!filePath) {
      const publicPath = join(process.cwd(), "public", "images", "productos", filename);
      try {
        await stat(publicPath);
        filePath = publicPath;
      } catch {
        // Not found in public path
      }
    }

    // 3. Fallback check for root uploads
    if (!filePath) {
      const rootUploadPath = join(process.cwd(), "uploads", "images", "productos", filename);
      try {
        await stat(rootUploadPath);
        filePath = rootUploadPath;
      } catch {
        // Not found
      }
    }

    if (!filePath) {
      return new NextResponse("Image not found", { status: 404 });
    }

    const fileBuffer = await readFile(filePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Error serving product image:", error);
    return new NextResponse("Internal server error", { status: 500 });
  }
}
