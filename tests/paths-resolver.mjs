// Hook de resolución para Node: `@/x` → <repo>/src/x.ts
// Lo carga tests/paths-loader.mjs (ver comentario de ese archivo).
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = join(repoRoot, "src", specifier.slice(2));
    const withTs = target.endsWith(".ts") ? target : `${target}.ts`;
    return { url: pathToFileURL(withTs).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}