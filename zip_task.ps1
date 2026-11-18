
$dest = 'C:\\Users\\Maicol\\Desktop\\srei-para-github.zip'
$temp = Join-Path $env:TEMP ('srei_pkg_' + [System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temp | Out-Null

Get-ChildItem -Path 'C:\\Users\\Maicol\\.gemini\\antigravity\\scratch\\srei-inclusive-education' -Exclude 'node_modules', '.git', '*.sqlite*' | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $temp -Recurse -Force
}

# Limpiar posibles bases de datos SQLite temporales copiadas en src/db
Get-ChildItem -Path (Join-Path $temp 'src/db') -Filter '*.sqlite*' | Remove-Item -Force -ErrorAction SilentlyContinue

if (Test-Path $dest) { Remove-Item $dest -Force }
Compress-Archive -Path (Join-Path $temp '*') -DestinationPath $dest -Force
Remove-Item $temp -Recurse -Force

Get-Item $dest | Select-Object Name, Length, LastWriteTime
