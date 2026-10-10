param([string]$PlatformTools = '.tools/platform-tools', [switch]$Offline)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$toolsRoot = if ([System.IO.Path]::IsPathRooted($PlatformTools)) { $PlatformTools } else { [System.IO.Path]::GetFullPath((Join-Path $projectRoot $PlatformTools)) }
$env:RUSTC = Join-Path $toolsRoot 'rust/bin/rustc.exe'
$env:RUSTDOC = Join-Path $toolsRoot 'rust/bin/rustdoc.exe'
$env:CARGO_HOME = Join-Path $projectRoot '.tools/cargo'
$env:CC = Join-Path $toolsRoot 'llvm/bin/clang.exe'
$env:AR = Join-Path $toolsRoot 'llvm/bin/llvm-ar.exe'
$env:PATH = (Join-Path $toolsRoot 'rust/bin') + ';' + (Join-Path $toolsRoot 'llvm/bin') + ';' + $env:PATH
$buildArguments = @('build','--release','--target','sbpf-solana-solana','--manifest-path','programs/paysim/Cargo.toml')
if ($Offline) { $buildArguments += '--offline' }
& (Join-Path $toolsRoot 'rust/bin/cargo.exe') @buildArguments
if ($LASTEXITCODE -ne 0) { throw 'SBF compilation failed.' }
New-Item -ItemType Directory -Force -Path target/deploy | Out-Null
& (Join-Path $toolsRoot 'llvm/bin/llvm-objcopy.exe') --strip-all target/sbpf-solana-solana/release/paysim.so target/deploy/paysim.so
if ($LASTEXITCODE -ne 0) { throw 'SBF stripping failed.' }
Get-Item target/deploy/paysim.so | Select-Object FullName,Length
