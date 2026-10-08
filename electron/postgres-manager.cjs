/**
 * PostgreSQL Portable Manager
 * 
 * Gestiona el ciclo de vida completo de un PostgreSQL embebido:
 *   1. Localiza los binarios portables en resources/
 *   2. Inicializa el directorio de datos en la primera ejecución (initdb)
 *   3. Inicia el servidor en un puerto dado (pg_ctl start)
 *   4. Espera a que esté listo para aceptar conexiones
 *   5. Detiene el servidor al cerrar la app (pg_ctl stop)
 */
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

class PostgresManager {
  /**
   * @param {string} userDataPath - Directorio de datos de la app (app.getPath('userData'))
   * @param {string} resourcesPath - Directorio de recursos (process.resourcesPath)
   */
  constructor(userDataPath, resourcesPath) {
    this.dataDir = path.join(userDataPath, 'pgdata');
    this.pgBinDir = path.join(resourcesPath, 'postgres', 'bin');
    this.port = null;
    this.process = null;
    this._stopped = false;
  }

  /** Path to a PostgreSQL binary */
  _bin(name) {
    return path.join(this.pgBinDir, process.platform === 'win32' ? `${name}.exe` : name);
  }

  /** Run a command and return stdout */
  _exec(bin, args, env = {}) {
    return new Promise((resolve, reject) => {
      execFile(bin, args, {
        env: { ...process.env, ...env },
        timeout: 60_000,
      }, (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          return reject(err);
        }
        resolve(stdout);
      });
    });
  }

  /**
   * Inicializa el directorio de datos si no existe.
   */
  async _initDb() {
    if (fs.existsSync(path.join(this.dataDir, 'PG_VERSION'))) {
      console.log('[PG] Directorio de datos ya existe, omitiendo initdb');
      return;
    }

    console.log('[PG] Inicializando directorio de datos...');
    fs.mkdirSync(this.dataDir, { recursive: true });

    await this._exec(this._bin('initdb'), [
      '-D', this.dataDir,
      '-U', 'postgres',
      '-E', 'UTF8',
      '--locale=C',
      '-A', 'trust',
    ]);

    // Configurar postgresql.conf para rendimiento en escritorio
    const confPath = path.join(this.dataDir, 'postgresql.conf');
    const extraConf = [
      '',
      '# PosBit desktop overrides',
      `port = ${this.port}`,
      'listen_addresses = \'127.0.0.1\'',
      'shared_buffers = 128MB',
      'work_mem = 4MB',
      'log_destination = \'stderr\'',
      'logging_collector = off',
      'max_connections = 20',
    ].join('\n');
    fs.appendFileSync(confPath, extraConf);

    console.log('[PG] initdb completado');
  }

  /**
   * Actualiza el puerto en postgresql.conf (necesario si el puerto cambió
   * entre ejecuciones).
   */
  _updatePort() {
    const confPath = path.join(this.dataDir, 'postgresql.conf');
    if (!fs.existsSync(confPath)) return;

    let conf = fs.readFileSync(confPath, 'utf-8');
    conf = conf.replace(/^port\s*=\s*\d+/m, `port = ${this.port}`);
    fs.writeFileSync(confPath, conf);
  }

  /**
   * Espera a que PostgreSQL acepte conexiones TCP.
   */
  /**
   * Espera a que PostgreSQL acepte conexiones TCP.
   */
  _waitForReady(maxAttempts = 100) {
    return new Promise((resolve, reject) => {
      let attempts = 0;

      const tryConnect = () => {
        attempts++;
        const socket = new net.Socket();

        socket.setTimeout(1000);

        socket.on('connect', () => {
          socket.destroy();
          console.log(`[PG] Servidor listo en el puerto ${this.port}`);
          resolve();
        });

        socket.on('error', () => {
          socket.destroy();
          if (attempts >= maxAttempts) {
            reject(new Error(`PostgreSQL no respondió después de ${maxAttempts} intentos`));
          } else {
            setTimeout(tryConnect, 200);
          }
        });

        socket.on('timeout', () => {
          socket.destroy();
          if (attempts >= maxAttempts) {
            reject(new Error(`PostgreSQL timeout después de ${maxAttempts} intentos`));
          } else {
            setTimeout(tryConnect, 200);
          }
        });

        socket.connect(this.port, '127.0.0.1');
      };

      tryConnect();
    });
  }

  /**
   * Inicia PostgreSQL embebido.
   * @param {number} port - Puerto TCP a usar
   * @returns {Promise<string>} - URL de conexión
   */
  async start(port) {
    this.port = port;
    this._stopped = false;

    // Verificar que los binarios existen
    if (!fs.existsSync(this._bin('initdb'))) {
      throw new Error(`No se encontraron binarios de PostgreSQL en ${this.pgBinDir}`);
    }

    const wasInitialized = this.isInitialized;
    await this._initDb();
    this._updatePort();

    console.log(`[PG] Verificando estado del servidor en puerto ${this.port}...`);

    // Limpiar posible PID viejo (crash anterior) de forma instantánea sin colgar la app
    const pidFile = path.join(this.dataDir, 'postmaster.pid');
    let needsStart = true;

    if (fs.existsSync(pidFile)) {
      try {
        const content = fs.readFileSync(pidFile, 'utf-8');
        const pidLine = content.split('\n')[0].trim();
        const pid = parseInt(pidLine, 10);

        let isAlive = false;
        if (pid > 0) {
          try {
            process.kill(pid, 0);
            isAlive = true;
          } catch {
            isAlive = false;
          }
        }

        if (isAlive) {
          try {
            await this._waitForReady(5); // Probar si responde en 1s
            console.log(`[PG] Servidor PostgreSQL ya estaba corriendo (PID ${pid})`);
            needsStart = false;
          } catch {
            // No responde en el puerto, apagarlo inmediato
            try {
              await this._exec(this._bin('pg_ctl'), ['stop', '-D', this.dataDir, '-m', 'immediate']);
            } catch {
              /* ignore */
            }
            try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
          }
        } else {
          console.log(`[PG] Eliminando PID residual de proceso inactivo (${pid})`);
          try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
        }
      } catch (err) {
        console.warn('[PG] Error verificando PID file:', err);
        try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
      }
    }

    if (needsStart) {
      console.log(`[PG] Iniciando PostgreSQL en puerto ${this.port}...`);
      try {
        await this._exec(this._bin('pg_ctl'), [
          'start',
          '-D', this.dataDir,
          '-o', `-p ${this.port}`,
          '-l', path.join(this.dataDir, 'server.log'),
        ]);
      } catch (err) {
        console.warn('[PG] pg_ctl start warning:', err.message);
      }

      await this._waitForReady(100);
    }

    // Crear la base de datos 'posbit' solo en la primera inicialización
    if (!wasInitialized) {
      try {
        await this._exec(this._bin('createdb'), [
          '-U', 'postgres',
          '-p', String(this.port),
          '-h', '127.0.0.1',
          'posbit',
        ]);
        console.log('[PG] Base de datos "posbit" creada');
      } catch (err) {
        // 'database "posbit" already exists' es OK
        if (!err.stderr?.includes('already exists')) {
          console.warn('[PG] createdb warning:', err.stderr || err.message);
        }
      }
    }

    const dbUrl = `postgresql://postgres:postgres@127.0.0.1:${this.port}/posbit`;
    console.log(`[PG] Listo: ${dbUrl}`);
    return dbUrl;
  }

  /**
   * Detiene PostgreSQL de forma segura.
   */
  async stop() {
    if (this._stopped) return;
    this._stopped = true;

    console.log('[PG] Deteniendo servidor...');
    try {
      await this._exec(this._bin('pg_ctl'), [
        'stop',
        '-D', this.dataDir,
        '-m', 'fast',
        '-w',
      ]);
      console.log('[PG] Servidor detenido');
    } catch (err) {
      console.warn('[PG] Error deteniendo servidor:', err.message);
    }
  }

  /**
   * @returns {boolean} true si el directorio de datos ya fue creado
   */
  get isInitialized() {
    return fs.existsSync(path.join(this.dataDir, 'PG_VERSION'));
  }
}

module.exports = { PostgresManager };
