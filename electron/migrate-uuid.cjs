/**
 * Ejecuta la migración integer → UUID usando el psql portable.
 * Se llama desde main.cjs tras iniciar PostgreSQL y antes de arrancar Next.js.
 * Idempotente: si ya es UUID, no hace nada (el SQL lo detecta).
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * @param {string} pgBinDir - Directorio con binarios de PostgreSQL (ej: resources/postgres/bin)
 * @param {number} port - Puerto donde corre PostgreSQL
 * @returns {Promise<void>}
 */
async function runUuidMigration(pgBinDir, port) {
  const psqlPath = path.join(pgBinDir, process.platform === 'win32' ? 'psql.exe' : 'psql');
  const sqlPath = path.join(process.resourcesPath, 'standalone', 'sql', 'migrate-to-uuid.sql');

  if (!fs.existsSync(psqlPath)) {
    throw new Error(`psql no encontrado en: ${psqlPath}`);
  }
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`Script SQL no encontrado en: ${sqlPath}`);
  }

  console.log('[Migración] Ejecutando migración integer → UUID...');

  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PGPASSWORD: 'postgres',
    };

    const child = execFile(psqlPath, [
      '-U', 'postgres',
      '-h', '127.0.0.1',
      '-p', String(port),
      '-d', 'posbit',
      '-f', sqlPath,
      '-v', 'ON_ERROR_STOP=1',
    ], { env, timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[Migración] ERROR:', err.message);
        console.error('[Migración] stderr:', stderr);
        return reject(new Error(`Migración falló: ${stderr || err.message}`));
      }
      console.log('[Migración] stdout:', stdout);
      resolve();
    });
  });
}

module.exports = { runUuidMigration };