param([ValidateSet('preflight','inspect','terminate','verify','launch','repair')][string]$Action, [string]$Runtime, [int]$OwnerPid, [string]$RepairPair)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$runtimePath = [System.IO.Path]::GetFullPath($Runtime).TrimEnd('\')
$mainPath = Join-Path $runtimePath 'Steam++.exe'
$workerPath = Join-Path $runtimePath 'modules\Accelerator\Steam++.Accelerator.exe'
if ($Action -eq 'preflight') {
    # Upstream's launcher resets its own startup task by name. Protect an
    # existing standalone installation's scheduled task before launching it.
    $task = Get-ScheduledTask | Where-Object {
        $_.TaskName -match '^(Steam\+\+|SteamTools|Watt Toolkit)(_\{|$)' -or
            @($_.Actions | Where-Object { $_.Execute -match '(^|[\\/])Steam\+\+\.exe"?$' }).Count -gt 0
    } | Select-Object -First 1
    $port = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object { $_.Port -eq 443 -and $_.Address.ToString() -in @('0.0.0.0','127.0.0.1','::') } | Select-Object -First 1
    @{startupTask=[bool]$task; portBusy=[bool]$port} | ConvertTo-Json -Compress
    exit
}
if ($Action -in @('verify','launch')) {
    $signature = Get-AuthenticodeSignature -LiteralPath $mainPath
    # Pinned to the publisher certificate of the bundled 3.2.0 release.
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne 'E1E00C478E41300480A63CD62D5F771D24CF903B') { throw 'Steam++ component signature validation failed.' }
    if ($Action -eq 'verify') { @{valid=$true} | ConvertTo-Json -Compress; exit }
    # Only the signed Watt Toolkit executable is elevated. This script and Matcha stay at caller integrity.
    foreach ($name in @('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY')) { [Environment]::SetEnvironmentVariable($name,$null,'Process') }
    try {
        # Process.Start preserves the native error (not a localized Start-Process message).
        $start=[Diagnostics.ProcessStartInfo]::new($mainPath,'-clt c -silence')
        $start.WorkingDirectory=$runtimePath
        $start.UseShellExecute=$true
        $start.Verb='runas'
        $start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
        $engine=[Diagnostics.Process]::Start($start)
        @{status='started';pid=$engine.Id} | ConvertTo-Json -Compress
    } catch {
        $detail=$_.Exception
        while ($detail -and $detail -isnot [ComponentModel.Win32Exception]) { $detail=$detail.InnerException }
        if ($detail -and $detail.NativeErrorCode -eq 1223) { @{status='cancelled'} | ConvertTo-Json -Compress }
        elseif ($detail) { @{status='failed';win32=$detail.NativeErrorCode} | ConvertTo-Json -Compress }
        else { throw }
    }
    exit
}
if ($Action -eq 'repair') {
    $hosts = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
    $before = [IO.File]::ReadAllBytes($RepairPair + '.before')
    $after = [IO.File]::ReadAllBytes($RepairPair + '.after')
    $handle = [IO.File]::Open($hosts, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        if ($handle.Length -ne $before.Length) { throw 'Hosts changed since recovery began.' }
        $current = [byte[]]::new($before.Length)
        $offset = 0
        while ($offset -lt $current.Length) {
            $count = $handle.Read($current, $offset, $current.Length - $offset)
            if ($count -eq 0) { throw 'Hosts read ended unexpectedly.' }
            $offset += $count
        }
        if ([Convert]::ToBase64String($current) -cne [Convert]::ToBase64String($before)) { throw 'Hosts changed since recovery began.' }
        try {
            $handle.Position = 0
            $handle.Write($after, 0, $after.Length)
            $handle.SetLength($after.Length)
            $handle.Flush($true)
        } catch {
            $handle.Position = 0
            $handle.Write($before, 0, $before.Length)
            $handle.SetLength($before.Length)
            $handle.Flush($true)
            throw
        }
    } finally { $handle.Dispose() }
    & "$env:WINDIR\System32\ipconfig.exe" /flushdns | Out-Null
    @{repaired=$true} | ConvertTo-Json -Compress
    exit
}
$processes = @(Get-CimInstance Win32_Process -Filter "Name='Steam++.exe' OR Name='Steam++.Accelerator.exe'")
# WMI may omit ExecutablePath for an elevated process. Query just its image name;
# never identify or terminate a process by a reusable PID or basename alone.
if (@($processes | Where-Object { -not $_.ExecutablePath }).Count) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class MatchaProcessImage {
    [DllImport("kernel32", SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
    [DllImport("kernel32",CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder name,ref int size);
    [DllImport("kernel32")] static extern bool CloseHandle(IntPtr h);
    public static string Read(int pid) {
        IntPtr h=OpenProcess(0x1000,false,pid); if(h==IntPtr.Zero)return null;
        try {int n=32768;var b=new StringBuilder(n);return QueryFullProcessImageName(h,0,b,ref n)?b.ToString():null;} finally{CloseHandle(h);}
    }
}
'@
}
$processes = @($processes | ForEach-Object {
    $image=$_.ExecutablePath
    if (-not $image) { $image=[MatchaProcessImage]::Read([int]$_.ProcessId) }
    [pscustomobject]@{ProcessId=$_.ProcessId;ParentProcessId=$_.ParentProcessId;CommandLine=$_.CommandLine;ExecutablePath=$image}
})
if ($Action -eq 'terminate') {
    # Only a previously owned main PID at the exact isolated executable path.
    $owner = $processes | Where-Object { $_.ProcessId -eq $OwnerPid -and $_.ExecutablePath -ieq $mainPath }
    if ($OwnerPid -gt 0) {
        $children = @($processes | Where-Object { $_.ParentProcessId -eq $OwnerPid -and ($_.ExecutablePath -ieq $mainPath -or $_.ExecutablePath -ieq $workerPath) })
        if ($owner) { Stop-Process -Id $OwnerPid -ErrorAction SilentlyContinue }
        foreach ($child in $children) { Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue }
        # Elevated helpers also observe the main process and can exit after it does.
        $ids = @(@($children) + @($owner) | Where-Object { $_ -and $_.ProcessId -gt 0 } | ForEach-Object { [int]$_.ProcessId })
        if ($ids.Count) {
            for ($i = 0; $i -lt 20; $i++) {
                if (@(Get-Process -Id $ids -ErrorAction SilentlyContinue).Count -eq 0) { break }
                Start-Sleep -Milliseconds 100
            }
            if (@(Get-Process -Id $ids -ErrorAction SilentlyContinue).Count -gt 0) { throw 'Owned Steam++ processes did not exit.' }
        }
    }
    @{stopped=$true} | ConvertTo-Json -Compress
    exit
}
$rows = @($processes | ForEach-Object {
    @{pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; path=$_.ExecutablePath;
      main=($_.ExecutablePath -ieq $mainPath -and $_.CommandLine -notmatch ' -clt sudo(?: |$)');
      owned=($_.ExecutablePath -ieq $mainPath -or $_.ExecutablePath -ieq $workerPath)}
})
@{processes=$rows} | ConvertTo-Json -Depth 4 -Compress
