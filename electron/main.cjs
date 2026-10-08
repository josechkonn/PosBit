/**
 * PosBit Desktop — Proceso principal de Electron
 *
 * Flujo de arranque:
 *   1. Mostrar splash screen
 *   2. Iniciar PostgreSQL embebido (solo en producción)
 *   3. Iniciar servidor Next.js (standalone en prod, dev server en dev)
 *   4. Abrir ventana principal apuntando a localhost
 *   5. Configurar auto-updater
 *   6. Configurar system tray
 *
 * En desarrollo (isDev), se espera que `npm run dev` ya esté corriendo.
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');

const isDev = !app.isPackaged;

// --- Estado global ---
/** @type {BrowserWindow | null} */ let mainWindow = null;
/** @type {BrowserWindow | null} */ let splashWindow = null;
/** @type {Tray | null} */          let tray = null;
/** @type {import('child_process').ChildProcess | null} */ let nextProcess = null;
/** @type {import('./postgres-manager.cjs').PostgresManager | null} */ let pgManager = null;
let appUrl = '';

// =====================================================================
// Single instance lock — solo una instancia de PosBit a la vez
// =====================================================================
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// =====================================================================
// Helpers
// =====================================================================
function findAvailablePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(port, maxAttempts = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tryConnect = () => {
      attempts++;
      const req = require('http').get(`http://127.0.0.1:${port}`, (res) => {
        resolve();
      });
      req.on('error', () => {
        if (attempts >= maxAttempts) {
          reject(new Error(`El servidor Next.js no respondió después de ${maxAttempts} intentos`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (attempts >= maxAttempts) {
          reject(new Error('Timeout esperando servidor Next.js'));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
    };
    tryConnect();
  });
}

// =====================================================================
// Splash Screen
// =====================================================================
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 360,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

function splashStatus(msg) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.executeJavaScript(
      `document.getElementById('status').textContent = ${JSON.stringify(msg)}`
    ).catch(() => {});
  }
}

// =====================================================================
// PostgreSQL
// =====================================================================
async function startPostgres() {
  if (isDev) {
    return process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/posbit';
  }

  const { PostgresManager } = require('./postgres-manager.cjs');
  pgManager = new PostgresManager(app.getPath('userData'), process.resourcesPath);

  splashStatus('Iniciando base de datos...');
  const port = await findAvailablePort();
  const dbUrl = await pgManager.start(port);
  splashStatus('Base de datos lista');
  return dbUrl;
}

// =====================================================================
// Next.js Server
// =====================================================================
async function startNextServer(databaseUrl) {
  if (isDev) {
    // En dev, se espera que `npm run dev` esté corriendo en el puerto 3000
    const devPort = parseInt(process.env.DEV_PORT || '3000', 10);
    appUrl = `http://localhost:${devPort}`;
    return;
  }

  splashStatus('Iniciando aplicación...');

  const port = await findAvailablePort();
  appUrl = `http://127.0.0.1:${port}`;

  // Ruta al Node.js portable bundleado y al server standalone
  const nodeBin = path.join(process.resourcesPath, 'node', 'node.exe');
  const serverJs = path.join(process.resourcesPath, 'standalone', 'server.js');

  // Verificar que existen
  if (!fs.existsSync(nodeBin)) {
    throw new Error(`Node.js no encontrado en: ${nodeBin}`);
  }
  if (!fs.existsSync(serverJs)) {
    throw new Error(`server.js no encontrado en: ${serverJs}`);
  }

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
  };

  nextProcess = spawn(nodeBin, [serverJs], {
    env,
    cwd: path.join(process.resourcesPath, 'standalone'),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  nextProcess.stdout.on('data', (d) => console.log('[Next]', d.toString().trim()));
  nextProcess.stderr.on('data', (d) => console.error('[Next]', d.toString().trim()));
  nextProcess.on('exit', (code) => {
    console.log(`[Next] Proceso terminó con código ${code}`);
    if (!app.isQuitting) {
      // Reintentar si el servidor muere inesperadamente
      dialog.showErrorBox('Error', 'El servidor de la aplicación se detuvo inesperadamente. La aplicación se cerrará.');
      app.quit();
    }
  });

  // Esperar a que el servidor responda
  splashStatus('Cargando interfaz...');
  await waitForServer(port);
}

// =====================================================================
// Ventana Principal
// =====================================================================
function createMainWindow() {
  const iconPath = path.join(__dirname, '..', 'resources', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    title: 'PosBit',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
    },
  });

  mainWindow.loadURL(appUrl);

  mainWindow.once('ready-to-show', () => {
    // Cerrar splash
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.maximize();
  });

  // Abrir links externos en el navegador del sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Minimizar al tray en vez de cerrar
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Menú de la app (simplificado)
  const menuTemplate = [
    {
      label: 'PosBit',
      submenu: [
        {
          label: 'Verificar actualizaciones',
          click: () => {
            if (!isDev) {
              const { checkForUpdatesManual } = require('./updater.cjs');
              checkForUpdatesManual();
            }
          },
        },
        { type: 'separator' },
        {
          label: `Versión ${app.getVersion()}`,
          enabled: false,
        },
        { type: 'separator' },
        {
          label: 'DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow?.webContents.toggleDevTools(),
          visible: isDev,
        },
        { type: 'separator' },
        {
          label: 'Salir',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.isQuitting = true;
            app.quit();
          },
        },
      ],
    },
  ];

  const { Menu: ElectronMenu } = require('electron');
  ElectronMenu.setApplicationMenu(ElectronMenu.buildFromTemplate(menuTemplate));
}

// =====================================================================
// System Tray
// =====================================================================
function createTray() {
  const iconPath = path.join(__dirname, '..', 'resources', 'icon.png');
  let trayIcon;

  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else {
    // Crear un icono placeholder de 16x16
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('PosBit');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir PosBit',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: `v${app.getVersion()}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// =====================================================================
// IPC Handlers
// =====================================================================
function setupIPC() {
  ipcMain.handle('get-version', () => app.getVersion());

  ipcMain.on('check-updates', () => {
    if (!isDev) {
      const { checkForUpdatesManual } = require('./updater.cjs');
      checkForUpdatesManual();
    }
  });

  ipcMain.on('minimize-to-tray', () => {
    if (mainWindow) mainWindow.hide();
  });
}

// =====================================================================
// Lifecycle
// =====================================================================
app.whenReady().then(async () => {
  try {
    createSplash();
    setupIPC();

    // 1. Iniciar PostgreSQL
    const dbUrl = await startPostgres();

    // 2. Iniciar servidor Next.js
    await startNextServer(dbUrl);

    // 3. Abrir ventana principal
    createMainWindow();

    // 4. System tray
    createTray();

    // 5. Auto-updater (solo en producción)
    if (!isDev) {
      try {
        const { setupUpdater } = require('./updater.cjs');
        setupUpdater(mainWindow);
      } catch (updaterErr) {
        console.error('[PosBit] Error al inicializar auto-updater:', updaterErr);
      }
    }

    console.log('[PosBit] Aplicación lista');
  } catch (err) {
    console.error('[PosBit] Error al iniciar:', err);

    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy();
    }

    dialog.showErrorBox(
      'Error al iniciar PosBit',
      `No se pudo iniciar la aplicación:\n\n${err.message}\n\nRevisa los logs para más detalles.`
    );

    app.quit();
  }
});

app.on('window-all-closed', () => {
  // No hacer nada — la app vive en el tray
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', async () => {
  app.isQuitting = true;

  // Detener Next.js
  if (nextProcess && !nextProcess.killed) {
    console.log('[PosBit] Deteniendo servidor Next.js...');
    nextProcess.kill('SIGTERM');
    nextProcess = null;
  }

  // Detener PostgreSQL
  if (pgManager) {
    try {
      await pgManager.stop();
    } catch (err) {
      console.error('[PosBit] Error deteniendo PostgreSQL:', err);
    }
    pgManager = null;
  }
});
