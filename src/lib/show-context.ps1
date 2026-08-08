# show-context.ps1
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "    📊 КОНТЕКСТ ПРОЕКТА" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "📁 СТРУКТУРА ПРОЕКТА (глубина 2)" -ForegroundColor Yellow
Write-Host "-----------------------------------------" -ForegroundColor Yellow
Get-ChildItem -Directory | ForEach-Object {
    Write-Host "[$($_.Name)]" -ForegroundColor Green
    Get-ChildItem $_.FullName -Directory | ForEach-Object {
        Write-Host "  ├── $($_.Name)" -ForegroundColor Gray
    }
    Get-ChildItem $_.FullName -File | Select-Object -First 5 | ForEach-Object {
        Write-Host "  │   └── $($_.Name)" -ForegroundColor DarkGray
    }
    if ((Get-ChildItem $_.FullName -File).Count -gt 5) {
        Write-Host "  │   └── ... и ещё $((Get-ChildItem $_.FullName -File).Count - 5) файлов" -ForegroundColor DarkGray
    }
}
Write-Host ""

# CONTEXT.md
if (Test-Path "CONTEXT.md") {
    Write-Host "📄 CONTEXT.md" -ForegroundColor Yellow
    Write-Host "-----------------------------------------" -ForegroundColor Yellow
    Get-Content "CONTEXT.md"
    Write-Host ""
}

# Ключевые файлы
Write-Host "📄 КЛЮЧЕВЫЕ ФАЙЛЫ (первые 30 строк)" -ForegroundColor Yellow
Write-Host "-----------------------------------------" -ForegroundColor Yellow

$files = @(
    "lib/notify.ts",
    "app/api/book/route.ts",
    "lib/supabase/admin.ts"
)

foreach ($file in $files) {
    if (Test-Path $file) {
        Write-Host "`n📄 $file" -ForegroundColor Cyan
        Write-Host "---" -ForegroundColor DarkGray
        Get-Content $file -Head 30
        Write-Host "---" -ForegroundColor DarkGray
    }
}

Write-Host "`n✅ Скопируй этот вывод в чат!" -ForegroundColor Green