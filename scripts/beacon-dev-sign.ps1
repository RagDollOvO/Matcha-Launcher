param([Parameter(Mandatory)][string]$PackageDirectory, [Parameter(Mandatory)][string]$TrustOutput)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $TrustOutput) { throw 'TrustOutput must be new.' }
$package = (Resolve-Path -LiteralPath $PackageDirectory).Path
if (Test-Path -LiteralPath "$package/release.p7s") { throw 'Signature already exists.' }
# An ephemeral development key, held only in this signing process. It is never
# exported, stored in the project, handed to Pi, or mapped into the builder.
Add-Type -AssemblyName System.Security.Cryptography.Pkcs
$rsa = [Security.Cryptography.RSA]::Create(3072)
try {
  $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Beacon Offline Development', $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $cert = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(30))
  $content = [Security.Cryptography.Pkcs.ContentInfo]::new([IO.File]::ReadAllBytes("$package/release.json"))
  $cms = [Security.Cryptography.Pkcs.SignedCms]::new($content, $true)
  $signer = [Security.Cryptography.Pkcs.CmsSigner]::new($cert)
  $signer.DigestAlgorithm = [Security.Cryptography.Oid]::new('2.16.840.1.101.3.4.2.1')
  $cms.ComputeSignature($signer)
  [IO.File]::WriteAllBytes("$package/release.p7s", $cms.Encode())
  $pin = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($cert.RawData)).ToLower()
  @{ schemaVersion=1; signers=@(@{certificateSha256=$pin; identity='Beacon offline development (ephemeral)'; channel='development'}); revokedReleases=@(); revokedSigners=@() } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $TrustOutput -Encoding utf8NoBOM
  @{ status='signed-development'; trustPolicy=$TrustOutput; expires=$cert.NotAfter.ToUniversalTime().ToString('o') } | ConvertTo-Json
} finally { if ($cert) { $cert.Dispose() }; $rsa.Dispose() }
