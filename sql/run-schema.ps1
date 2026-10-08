$env:PGPASSWORD = "postgres"

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] 'psql' no esta en la variable de entorno PATH de esta computadora." -ForegroundColor Red
    Write-Host "Por favor instala PostgreSQL o agrega la carpeta 'bin' de PostgreSQL al PATH." -ForegroundColor Yellow
    exit 1
}

$dbCheck = psql -h localhost -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='posbit'" 2>$null
$dbExists = if ($dbCheck) { $dbCheck.Trim() } else { "" }

if ($dbExists -ne "1") {
    Write-Host "Creando base de datos 'posbit'..." -ForegroundColor Yellow
    psql -h localhost -U postgres -d postgres -c "CREATE DATABASE posbit;"
} else {
    Write-Host "La base de datos 'posbit' ya existe." -ForegroundColor Green
}

Write-Host "Ejecutando schema.sql..." -ForegroundColor Cyan
psql -h localhost -U postgres -d posbit -f "$PSScriptRoot\schema.sql"
Write-Host "¡Esquema aplicado con exito!" -ForegroundColor Green
