# show-context.ps1
# Устанавливаем кодировку UTF-8 для корректного отображения русского текста
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues['*:Encoding'] = 'utf8'

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "    КОНТЕКСТ ПРОЕКТА" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "СТРУКТУРА ПРОЕКТА (глубина 2)" -ForegroundColor Yellow
Write-Host "-----------------------------------------" -ForegroundColor Yellow

# Показываем папки и файлы в корне
Get-ChildItem -Directory | ForEach-Object {
    $dirName = $_.Name
    Write-Host "[$dirName]" -ForegroundColor Green
    $dirs = Get-ChildItem $_.FullName -Directory
    $files = Get-ChildItem $_.FullName -File | Select-Object -First 5
    
    foreach ($d in $dirs) {
        Write-Host "  ├── $($d.Name)" -ForegroundColor Gray
    }
    foreach ($f in $files) {
        Write-Host "  │   └── $($f.Name)" -ForegroundColor DarkGray
    }
    $fileCount = (Get-ChildItem $_.FullName -File).Count
    if ($fileCount -gt 5) {
        Write-Host "  │   └── ... и ещё $($fileCount - 5) файлов" -ForegroundColor DarkGray
    }
}
Write-Host ""

# CONTEXT.md
if (Test-Path "CONTEXT.md") {
    Write-Host "CONTEXT.md" -ForegroundColor Yellow
    Write-Host "-----------------------------------------" -ForegroundColor Yellow
    Get-Content "CONTEXT.md" -Encoding UTF8
    Write-Host ""
}

# Ключевые файлы
Write-Host "КЛЮЧЕВЫЕ ФАЙЛЫ (первые 30 строк)" -ForegroundColor Yellow
Write-Host "-----------------------------------------" -ForegroundColor Yellow

$files = @(
    "lib/notify.ts",
    "app/api/book/route.ts",
    "lib/supabase/admin.ts"
)

foreach ($file in $files) {
    if (Test-Path $file) {
        Write-Host "`n$file" -ForegroundColor Cyan
        Write-Host "---" -ForegroundColor DarkGray
        Get-Content $file -Head 30 -Encoding UTF8
        Write-Host "---" -ForegroundColor DarkGray
    }
}

Write-Host "`nСкопируй этот вывод в чат!" -ForegroundColor Green