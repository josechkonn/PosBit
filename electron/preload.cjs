/**
 * Preload script — puente seguro entre Electron y el renderer (Next.js).
 *
 * Expone funciones limitadas al window vía contextBridge.
 * El renderer NUNCA tiene acceso directo a Node.js.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('posbit', {
  /** Versión de la app (del package.json) */
  getVersion: () => ipcRenderer.invoke('get-version'),

  /** Plataforma actual (win32, darwin, linux) */
  getPlatform: () => process.platform,

  /** Verificar actualizaciones manualmente */
  checkForUpdates: () => ipcRenderer.send('check-updates'),

  /** Escuchar eventos de actualización */
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (_event, status) => callback(status));
  },

  /** Minimizar al tray */
  minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),
});
