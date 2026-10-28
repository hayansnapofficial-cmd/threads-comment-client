param([ValidateSet('read','write','remove')][string]$Mode, [Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.Security
  $targetPath = [IO.Path]::GetFullPath($Path)
  $targetDirectory = [IO.Path]::GetDirectoryName($targetPath)
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $entropy = [Text.Encoding]::UTF8.GetBytes('threads-comment-client/session/v1')
  if ([IO.Directory]::Exists($targetDirectory) -and ([IO.File]::GetAttributes($targetDirectory) -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe directory' }
  if ([IO.File]::Exists($targetPath) -and ([IO.File]::GetAttributes($targetPath) -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe file' }
  if ($Mode -eq 'write') {
    [IO.Directory]::CreateDirectory($targetDirectory) | Out-Null
    $directoryAcl = [Security.AccessControl.DirectorySecurity]::new()
    $directoryAcl.SetOwner($identity)
    $directoryAcl.SetAccessRuleProtection($true, $false)
    $directoryAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    [IO.Directory]::SetAccessControl($targetDirectory, $directoryAcl)
    $plainText = [Console]::In.ReadToEnd()
    if ($plainText.Length -gt 16384) { throw 'Oversized credential' }
    $plainBytes = [Text.Encoding]::UTF8.GetBytes($plainText)
    $cipher = [Security.Cryptography.ProtectedData]::Protect($plainBytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $temporaryPath = $targetPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
      [IO.File]::WriteAllBytes($temporaryPath, $cipher)
      if ([IO.File]::Exists($targetPath)) { [IO.File]::Replace($temporaryPath, $targetPath, [NullString]::Value) }
      else { [IO.File]::Move($temporaryPath, $targetPath) }
    } finally {
      if ([IO.File]::Exists($temporaryPath)) { [IO.File]::Delete($temporaryPath) }
      [Array]::Clear($plainBytes, 0, $plainBytes.Length)
    }
  } elseif ($Mode -eq 'read' -and [IO.File]::Exists($targetPath)) {
    if ([IO.FileInfo]::new($targetPath).Length -gt 32768) { throw 'Oversized credential' }
    $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($targetPath), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plainBytes)) }
    finally { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  } elseif ($Mode -eq 'remove' -and [IO.File]::Exists($targetPath)) { [IO.File]::Delete($targetPath) }
} catch { [Console]::Error.WriteLine('Credential storage unavailable'); exit 1 }
