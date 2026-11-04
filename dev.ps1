# dsh-balance-strip dev scaffold (ASCII only: avoids PS 5.1 encoding issues)
#   .\dev.ps1 build | test | ramp | pack | install | remove | all
param(
    [Parameter(Position = 0)]
    [string]$Task = 'test'
)

$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
if ([string]::IsNullOrEmpty($here)) {
    if (-not [string]::IsNullOrEmpty($PSCommandPath)) {
        $here = Split-Path -Parent $PSCommandPath
    } else {
        $here = (Get-Location).Path
    }
}
Set-Location -LiteralPath $here

$runtimeRoot = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies'
if (-not (Test-Path -LiteralPath $runtimeRoot)) {
    $runtimeRoot = 'C:\Users\admin\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies'
}
$node = Join-Path $runtimeRoot 'node\bin\node.exe'
$pnpm = Join-Path $runtimeRoot 'pnpm\bin\pnpm.mjs'
$python = Join-Path $runtimeRoot 'python\python.exe'
if (-not (Test-Path -LiteralPath $node)) { throw "node not found: $node" }

$tests = @('tests/core.test.mjs', 'tests/host.test.mjs', 'tests/client-bundle.test.mjs')

switch ($Task) {
    'build' {
        & $node scripts/build.mjs
    }
    'test' {
        & $node scripts/build.mjs
        & $node --test @tests
        if ($LASTEXITCODE -ne 0) { throw 'tests failed' }
    }
    'ramp' {
        & $node scripts/build.mjs
        $probe = Join-Path (Split-Path -Parent $here) '_probe'
        New-Item -ItemType Directory -Force -Path $probe | Out-Null
        & $node tools/emit-ramp.mjs aurora (Join-Path $probe 'ramp-aurora.json')
        & $node tools/emit-ramp.mjs signal (Join-Path $probe 'ramp-signal.json')
        if (Test-Path -LiteralPath $python) {
            & $python tools/preview.py (Join-Path $probe 'ramp-aurora.json') docs/preview-aurora.png top-dark
            & $python tools/preview.py (Join-Path $probe 'ramp-aurora.json') docs/preview-vignette.png vignette
            & $python tools/preview.py (Join-Path $probe 'ramp-signal.json') docs/preview-signal.png top-dark
        } else {
            Write-Host 'python not found: skipped preview images (ramp JSON written)'
        }
    }
    'pack' {
        & $node scripts/build.mjs
        & $node $pnpm pack
    }
    'install' {
        & $node scripts/build.mjs
        & dsh plugin --profile desktop add $here
    }
    'remove' {
        & dsh plugin --profile desktop remove dsh-balance-strip
    }
    'all' {
        & $node scripts/build.mjs
        & $node --test @tests
        if ($LASTEXITCODE -ne 0) { throw 'tests failed' }
        Write-Host 'ok: build + tests. run ".\dev.ps1 ramp" for previews.'
    }
    default {
        throw "unknown task: $Task (build|test|ramp|pack|install|remove|all)"
    }
}
