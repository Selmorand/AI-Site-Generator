@echo off
cd /d C:\inetpub\wwwroot\webgen
git pull
npm install
npm run build
taskkill /F /FI "WINDOWTITLE eq start-server.bat*" 2>nul
start "" "C:\inetpub\wwwroot\webgen\start-server.bat"
echo Deploy complete.
