const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const desktopZip = path.join('C:', 'Users', 'Maicol', 'Desktop', 'srei-para-github.zip');

console.log('Empaquetando proyecto SREI...');
const psScript = `
$dest = '${desktopZip.replace(/\\/g, '\\\\')}'
$temp = Join-Path $env:TEMP ('srei_pkg_' + [System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temp | Out-Null

Get-ChildItem -Path '${root.replace(/\\/g, '\\\\')}' -Exclude 'node_modules', '.git', '*.sqlite*' | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $temp -Recurse -Force
}

# Limpiar posibles bases de datos SQLite temporales copiadas en src/db
Get-ChildItem -Path (Join-Path $temp 'src/db') -Filter '*.sqlite*' | Remove-Item -Force -ErrorAction SilentlyContinue

if (Test-Path $dest) { Remove-Item $dest -Force }
Compress-Archive -Path (Join-Path $temp '*') -DestinationPath $dest -Force
Remove-Item $temp -Recurse -Force

Get-Item $dest | Select-Object Name, Length, LastWriteTime
`;

const psPath = path.join(root, 'zip_task.ps1');
fs.writeFileSync(psPath, psScript, 'utf8');
try {
  const out = execSync(`powershell -ExecutionPolicy Bypass -File "${psPath}"`, { encoding: 'utf8' });
  console.log(out);
} finally {
  if (fs.existsSync(psPath)) fs.unlinkSync(psPath);
}
