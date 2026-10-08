/**
 * Auto-Updater para PosBit Desktop
 *
 * Usa electron-updater conectado a GitHub Releases.
 * - Verifica actualizaciones al iniciar (tras 15s) y cada 30 minutos
 * - Soporta delta updates (blockmap) para descargas incrementales
 * - Muestra diálogos nativos al usuario para decidir cuándo instalar
 */
const { autoUpdater } = require('electron-updater');
const { dialog, Notification, app, BrowserWindow } = require('electron');

/** @type {BrowserWindow | null} */
let parentWindow = null;

/**
 * Configura y arranca el auto-updater.
 * @param {BrowserWindow} mainWindow - Ventana principal de la app
 */
function setupUpdater(mainWindow) {
  parentWindow = mainWindow;

  // --- Configuración ---
  autoUpdater.autoDownload = false;           // No descargar sin permiso
  autoUpdater.autoInstallOnAppQuit = true;    // Instalar al cerrar si hay update
  autoUpdater.allowDowngrade = false;

  // Logs (filtrando el stacktrace 404 cuando no hay releases)
  const log = require('electron-log');
  autoUpdater.logger = {
    info: (...args) => log.info(...args),
    warn: (...args) => log.warn(...args),
    error: (...args) => {
      const msg = args.map(a => typeof a === 'object' ? (a.stack || a.message || JSON.stringify(a)) : String(a)).join(' ');
      if (msg.includes('404') || msg.includes('releases.atom')) {
        log.info('[Updater] Sin versiones publicadas aún en GitHub (404)');
      } else {
        log.error(...args);
      }
    },
    debug: (...args) => log.debug(...args),
  };

  // --- Eventos ---

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Verificando actualizaciones...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[Updater] Nueva versión disponible: v${info.version}`);

    // Mostrar notificación nativa si el SO la soporta
    if (Notification.isSupported()) {
      const notif = new Notification({
        title: 'PosBit — Nueva versión disponible',
        body: `La versión ${info.version} está disponible. Haz clic para actualizar.`,
        icon: undefined, // Usa el icono de la app
      });
      notif.on('click', () => promptDownload(info));
      notif.show();
    }

    // También mostrar diálogo
    promptDownload(info);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] La app está actualizada');
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    console.log(`[Updater] Descargando: ${pct}% (${formatBytes(progress.transferred)}/${formatBytes(progress.total)})`);

    // Actualizar barra de progreso en la taskbar
    if (parentWindow && !parentWindow.isDestroyed()) {
      parentWindow.setProgressBar(progress.percent / 100);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[Updater] Actualización descargada: v${info.version}`);

    // Limpiar barra de progreso
    if (parentWindow && !parentWindow.isDestroyed()) {
      parentWindow.setProgressBar(-1);
    }

    promptInstall(info);
  });

  autoUpdater.on('error', (err) => {
    if (err.message && err.message.includes('404')) {
      console.log('[Updater] Sin releases publicadas aún en GitHub (404)');
    } else {
      console.error('[Updater] Error:', err.message);
    }
  });

  // --- Verificación periódica ---

  // Primera verificación después de 15 segundos
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(console.error);
  }, 15_000);

  // Verificar cada 30 minutos
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(console.error);
  }, 30 * 60 * 1000);
}

/**
 * Pregunta al usuario si desea descargar la actualización.
 */
async function promptDownload(info) {
  const { response } = await dialog.showMessageBox(parentWindow, {
    type: 'info',
    title: 'Actualización disponible',
    message: `Hay una nueva versión de PosBit (v${info.version})`,
    detail: [
      'La actualización solo descargará los cambios nuevos,',
      'por lo que será rápida.',
      '',
      '¿Deseas descargarla ahora?',
    ].join('\n'),
    buttons: ['Descargar ahora', 'Más tarde'],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    autoUpdater.downloadUpdate().catch(console.error);
  }
}

/**
 * Pregunta al usuario si desea reiniciar para instalar.
 */
async function promptInstall(info) {
  const { response } = await dialog.showMessageBox(parentWindow, {
    type: 'info',
    title: 'Actualización lista',
    message: `La versión ${info.version} está lista para instalarse`,
    detail: [
      'La aplicación se reiniciará brevemente para aplicar la actualización.',
      '',
      '¿Reiniciar ahora?',
    ].join('\n'),
    buttons: ['Reiniciar ahora', 'Instalar al cerrar'],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    autoUpdater.quitAndInstall(false, true);
  }
}

/**
 * Verificar manualmente (desde menú o acción del usuario).
 */
function checkForUpdatesManual() {
  autoUpdater.checkForUpdates().then((result) => {
    if (!result || !result.updateInfo) {
      dialog.showMessageBox(parentWindow, {
        type: 'info',
        title: 'Sin actualizaciones',
        message: 'Ya tienes la última versión de PosBit.',
        buttons: ['OK'],
      });
    }
  }).catch((err) => {
    dialog.showMessageBox(parentWindow, {
      type: 'error',
      title: 'Error al verificar',
      message: 'No se pudo verificar actualizaciones.',
      detail: err.message,
      buttons: ['OK'],
    });
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

module.exports = { setupUpdater, checkForUpdatesManual };
