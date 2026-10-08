/**
 * Script para generar icon.ico a partir de icon.png
 * Se ejecuta durante el CI/CD en GitHub Actions.
 * 
 * Requiere: npm install --save-dev png-to-ico (solo para CI/CD)
 * O se puede usar una herramienta online para convertir.
 * 
 * En GitHub Actions se usa `sharp` o `electron-icon-maker`.
 */
const fs = require('fs');
const path = require('path');

const iconPng = path.join(__dirname, '..', 'resources', 'icon.png');
const iconIco = path.join(__dirname, '..', 'resources', 'icon.ico');

async function generateIco() {
  try {
    // Intentar usar png-to-ico si está disponible
    const pngToIco = require('png-to-ico');
    const pngBuffer = fs.readFileSync(iconPng);
    const icoBuffer = await pngToIco(pngBuffer);
    fs.writeFileSync(iconIco, icoBuffer);
    console.log('✅ icon.ico generado correctamente');
  } catch (err) {
    // Si png-to-ico no está disponible, copiar el PNG como fallback
    // electron-builder puede usar PNG directamente en muchos casos
    console.log('⚠️  png-to-ico no disponible, usando PNG como fallback');
    if (!fs.existsSync(iconIco)) {
      fs.copyFileSync(iconPng, iconIco);
    }
  }
}

generateIco().catch(console.error);
