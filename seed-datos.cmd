@echo off
rem ============================================================
rem  PosBit - Carga de datos demo en la base de datos
rem  Rellena todas las tablas del negocio con datos coherentes
rem  (stock<->kardex<->ventas/compras, cajas<->transacciones,
rem   creditos<->abonos). Es seguro ejecutarlo varias veces:
rem  reinicia las tablas de negocio conservando monedas,
rem  configuracion, cajas y usuarios.
rem ============================================================
chcp 65001 >nul
title PosBit - Carga de datos demo
cd /d "%~dp0"

echo ============================================
echo   PosBit - Carga de datos de demostracion
echo ============================================
echo.

if not exist ".env.local" (
  echo [ERROR] No se encontro el archivo .env.local en la raiz del proyecto.
  echo         Asegurate de que la base de datos esta configurada.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado o no esta en el PATH.
  echo         Instala Node.js desde https://nodejs.org y vuelve a intentar.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\pg" (
  echo [ERROR] No se encontraron las dependencias del proyecto.
  echo         Ejecuta primero:  npm install
  echo.
  pause
  exit /b 1
)

echo [1/2] Cargando datos demo en la base de datos...
echo.
call node scripts/seed-demo.cjs
if errorlevel 1 (
  echo.
  echo [ERROR] Fallo la carga de datos. Revisa el mensaje de arriba.
  echo.
  pause
  exit /b 1
)

if exist "scripts\verify-seed.cjs" (
  echo.
  echo [2/2] Verificando integridad de los datos...
  echo.
  call node scripts/verify-seed.cjs
)

echo.
echo ============================================
echo   Carga completada. Puedes cerrar esta ventana.
echo ============================================
pause
