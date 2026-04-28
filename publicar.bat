@echo off
cd /d %~dp0

echo Carpeta actual:
cd

echo.
echo Ejecutando deploy...
echo.

wrangler pages deploy . --project-name=elbaco

echo.
echo Codigo de salida: %errorlevel%
pause
