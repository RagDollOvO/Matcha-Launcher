param(
  [Parameter(Mandatory)][string]$ProjectDirectory,
  [Parameter(Mandatory)][string]$ToolchainDirectory,
  [Parameter(Mandatory)][string]$OutputDirectory,
  [switch]$Run
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$toolchain = (Resolve-Path -LiteralPath $ToolchainDirectory).Path
$out = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $out) { throw 'OutputDirectory must be new; keep previous evidence intact.' }
$repo = Split-Path $PSScriptRoot
New-Item -ItemType Directory -Path "$out/input", "$out/output" | Out-Null
# Copy only explicit build inputs. Project-supplied commands never execute.
foreach ($name in @('plugin.cpp','manifest.json','LICENSE')) {
  $item = Get-Item -LiteralPath (Join-Path $project $name)
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse inputs rejected' }
  Copy-Item -LiteralPath $item.FullName -Destination "$out/input/$name"
}
New-Item -ItemType Directory -Path "$out/input/include", "$out/input/include/nlohmann" | Out-Null
Copy-Item -LiteralPath "$repo/native/include/l4p_plugin.h" -Destination "$out/input/include/l4p_plugin.h"
Copy-Item -LiteralPath "$repo/native/vendor/nlohmann/json.hpp" -Destination "$out/input/include/nlohmann/json.hpp"
Copy-Item -LiteralPath "$PSScriptRoot/beacon-sandbox-guest.ps1" -Destination "$out/input/guest.ps1"
$inputs = @(Get-ChildItem -LiteralPath "$out/input" -File -Recurse | Sort-Object FullName | ForEach-Object {
  @{ path = $_.FullName.Substring("$out/input".Length + 1).Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower(); size = $_.Length }
})
# Pin all toolchain executables, headers, CRT and libraries actually exposed to
# the builder, including compiler support DLLs. Public report contains no key.
$tools = @(Get-ChildItem -LiteralPath $toolchain -File -Recurse | Sort-Object FullName | ForEach-Object {
  if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse toolchain rejected' }
  @{ path = $_.FullName.Substring($toolchain.Length + 1).Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower(); size = $_.Length }
})
@{ schemaVersion=1; inputs=$inputs; toolchain=$tools; architecture='x86'; sdkApi=1; isolation='windows-sandbox'; network='disabled'; independentReproduction='not-run' } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$out/build-inputs.json" -Encoding utf8
$escapedInput = [Security.SecurityElement]::Escape("$out\input")
$escapedOutput = [Security.SecurityElement]::Escape("$out\output")
$escapedTools = [Security.SecurityElement]::Escape($toolchain)
@"
<Configuration>
  <VGpu>Disable</VGpu><Networking>Disable</Networking><ClipboardRedirection>Disable</ClipboardRedirection>
  <AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><PrinterRedirection>Disable</PrinterRedirection>
  <MemoryInMB>6144</MemoryInMB>
  <MappedFolders>
    <MappedFolder><HostFolder>$escapedInput</HostFolder><SandboxFolder>C:\input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$escapedTools</HostFolder><SandboxFolder>C:\toolchain</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$escapedOutput</HostFolder><SandboxFolder>C:\output</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\input\guest.ps1</Command></LogonCommand>
</Configuration>
"@ | Set-Content -LiteralPath "$out/build.wsb" -Encoding utf8
if ($Run) {
  $process = Start-Process -FilePath "$env:WINDIR/System32/WindowsSandbox.exe" -ArgumentList ('"' + "$out/build.wsb" + '"') -WindowStyle Hidden -PassThru
  @{ sandboxLauncherPid=$process.Id; output=$out; completion="$out/output/result.json" } | ConvertTo-Json
} else { Write-Output "$out/build.wsb" }
