// Loader de Node mínimo para ejecutar tests de src/lib/* SIN Next.js:
// resuelve el alias `@/` → raíz/src (los módulos importan con alias de la app).
// Uso: node --import ./tests/paths-loader.mjs tests/costing.ts
import { register } from "node:module";

register(new URL("./paths-resolver.mjs", import.meta.url));