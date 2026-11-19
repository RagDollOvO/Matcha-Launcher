$ErrorActionPreference = 'Stop'
try {
  $env:PATH = "C:\toolchain\bin;$env:WINDIR\system32;$env:WINDIR"
  $env:SOURCE_DATE_EPOCH = '0'
  $compiler = 'C:\toolchain\bin\i686-w64-mingw32-clang++.exe'
  $version = (& $compiler --version | Out-String).Trim()
  $flags = @('-std=c++17','-O2','-DNDEBUG','-g0','-shared','-static','-s','-Werror=date-time','-Wl,--no-insert-timestamp','-IC:/input/include')
  foreach ($id in @('a','b')) {
    $dir = "C:\build-$id"
    New-Item -ItemType Directory -Path $dir | Out-Null
    Copy-Item -LiteralPath C:\input\plugin.cpp -Destination "$dir/plugin.cpp"
    Push-Location $dir
    & $compiler @flags "-ffile-prefix-map=$dir=/src" plugin.cpp -o plugin.dll 2>&1 | Out-File "C:\output\compile-$id.log"
    if ($LASTEXITCODE -ne 0) { throw "compile-$id failed: $LASTEXITCODE" }
    Copy-Item -LiteralPath "$dir/plugin.dll" -Destination "C:\output\plugin-$id.dll"
    Pop-Location
  }
  @{ schemaVersion=1; status='built'; compiler=$version; flags=$flags; isolation='windows-sandbox'; builds=@('plugin-a.dll','plugin-b.dll') } | ConvertTo-Json -Depth 5 | Set-Content C:\output\result.json -Encoding utf8
} catch {
  @{ schemaVersion=1; status='failed'; error=$_.Exception.Message } | ConvertTo-Json | Set-Content C:\output\result.json -Encoding utf8
} finally {
  # This shuts down only this disposable guest, never the host or game.
  & "$env:WINDIR\system32\shutdown.exe" /s /t 3
}
