# Explicit integration check: real npm in a temporary directory, mocked Codex registration.
# Requires npm ci in this repository so the test MCP SDK is available.
[CmdletBinding()]
param([string]$PackageDirectory = (Join-Path $PSScriptRoot '..'))

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../install.ps1')

$script:SmokeRoot = Join-Path ([IO.Path]::GetTempPath()) ('threads-installer-live-' + [guid]::NewGuid().ToString('N'))
$script:ExpectedCodex = Get-InstallerCommand -Names @('codex.exe', 'codex.cmd') -HelpText 'Codex CLI is required for this environment check.'
$script:Registration = $null
Set-Item -Path Function:Invoke-RealInstallerCommand -Value ${function:Invoke-InstallerCommand}
function Invoke-InstallerCommand {
    param([string]$CommandPath, [string[]]$Arguments)
    if ($CommandPath -eq $script:ExpectedCodex) {
        if (($Arguments[0..3] -join '|') -cne 'mcp|add|threads-comments|--') { throw 'Unexpected Codex command' }
        $script:Registration = @($Arguments)
        Write-Host '[TEST] Codex registration captured; user configuration was not changed.'
        return
    }
    Invoke-RealInstallerCommand -CommandPath $CommandPath -Arguments $Arguments
}

try {
    Invoke-ThreadsClientInstall -PackageDirectory $PackageDirectory -LocalAppData $script:SmokeRoot
    if ($null -eq $script:Registration) { throw 'Registration was not reached' }
    $node = $script:Registration[4]
    $entry = $script:Registration[5]
    if (-not [IO.Path]::IsPathRooted($node) -or -not [IO.Path]::GetFullPath($entry).StartsWith([IO.Path]::GetFullPath($script:SmokeRoot) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected registered command paths' }
    $check = "const {Client}=await import('@modelcontextprotocol/client'); const {StdioClientTransport}=await import('@modelcontextprotocol/client/stdio'); const client=new Client({name:'installer-smoke',version:'1.0.0'}); try { await client.connect(new StdioClientTransport({command:process.execPath,args:[process.argv[1]]})); const {tools}=await client.listTools(); if(tools.length!==20) throw new Error('Unexpected tool count '+tools.length); console.log('PASS installed MCP SDK initialize + listTools: '+tools.length); } finally { await client.close(); }"
    Push-Location (Join-Path $PSScriptRoot '..')
    try { Invoke-RealInstallerCommand -CommandPath $node -Arguments @('--input-type=module', '--eval', $check, $entry) }
    finally { Pop-Location }
    Write-Host 'PASS real npm install, Node import, MCP initialization, and 20-tool list. No account/provider operations.'
} finally {
    $resolved = [IO.Path]::GetFullPath($script:SmokeRoot)
    $allowed = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notlike 'threads-installer-live-*') { throw 'Unsafe smoke-test cleanup path' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
