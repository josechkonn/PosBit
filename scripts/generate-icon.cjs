/**
 * Genera icon.ico y icon.png válidos a partir de la imagen fuente.
 * 
 * Usa `sharp` para convertir a PNG y `png-to-ico` para generar el ICO.
 * Se ejecuta durante el CI/CD en GitHub Actions.
 * 
 * Requisitos (se instalan en CI con --no-save):
 *   npm install --no-save sharp png-to-ico
 */
const fs = require('fs');
const path = require('path');

const srcImage = path.join(__dirname, '..', 'resources', 'icon.png');
const outPng = path.join(__dirname, '..', 'resources', 'icon-converted.png');
const outIco = path.join(__dirname, '..', 'resources', 'icon.ico');

async function main() {
  // 1. Convertir la imagen fuente a PNG 256x256 válido con sharp
  const sharp = require('sharp');
  
  console.log('Convirtiendo imagen a PNG 256x256...');
  await sharp(srcImage)
    .resize(256, 256)
    .png()
    .toFile(outPng);
  
  // Reemplazar el icon.png original con el PNG válido
  fs.copyFileSync(outPng, srcImage);
  fs.unlinkSync(outPng);
  console.log('✅ icon.png generado (256x256 PNG)');

  // 2. Generar ICO desde el PNG válido
  try {
    const pngToIcoModule = require('png-to-ico');
    const pngToIco = pngToIcoModule.default || pngToIcoModule;
    const icoBuffer = await pngToIco(srcImage);
    fs.writeFileSync(outIco, icoBuffer);
    console.log(`✅ icon.ico generado (${icoBuffer.length} bytes)`);
  } catch (err) {
    console.error('❌ Error generando ICO:', err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
