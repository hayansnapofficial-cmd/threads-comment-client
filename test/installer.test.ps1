# Run with Windows PowerShell 5.1. No real npm installation or Codex registration.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../install.ps1')

$script:Passed = 0
function Assert-True([bool]$Value, [string]$Message) {
    if (-not $Value) { throw "Assertion failed: $Message" }
}
function Assert-Throws([scriptblock]$Action, [string]$Message) {
    $thrown = $false
    try { & $Action } catch { $thrown = $true }
    Assert-True $thrown $Message
}
function Test-Case([string]$Name, [scriptblock]$Action) {
    & $Action
    $script:Passed++
    Write-Host "PASS $Name"
}

$script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ('threads-installer-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $script:TestRoot | Out-Null
$script:PackageDirectory = Join-Path $script:TestRoot 'package with spaces'
New-Item -ItemType Directory -Path $script:PackageDirectory | Out-Null
$script:PackageFile = Join-Path $script:PackageDirectory $script:ThreadsClientAsset
$script:ChecksumFile = Join-Path $script:PackageDirectory 'SHA256SUMS'
function Write-Fixture {
    [IO.File]::WriteAllText($script:PackageFile, 'fixture package - never installed')
    $hash = (Get-FileHash -LiteralPath $script:PackageFile -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($script:ChecksumFile, "$hash  $script:ThreadsClientAsset`n")
}

try {
    Test-Case 'Node minimum and later major versions' {
        foreach ($version in @('v22.15.0', 'v22.15.1', 'v24.18.0')) { Assert-NodeVersion $version }
        foreach ($version in @('v20.19.0', 'v22.14.9', 'invalid')) { Assert-Throws { Assert-NodeVersion $version } "reject $version" }
    }
    Test-Case 'checksum accepts exact package and refuses modified bytes' {
        Write-Fixture
        Assert-True ((Get-VerifiedClientPackage $script:PackageDirectory) -ceq $script:PackageFile) 'valid package returned'
        [IO.File]::AppendAllText($script:PackageFile, 'tampered')
        Assert-Throws { Get-VerifiedClientPackage $script:PackageDirectory } 'tampered package rejected'
        Write-Fixture
    }
    Test-Case 'missing and ambiguous checksum entries are refused' {
        $valid = [IO.File]::ReadAllText($script:ChecksumFile)
        [IO.File]::WriteAllText($script:ChecksumFile, $valid + $valid)
        Assert-Throws { Get-VerifiedClientPackage $script:PackageDirectory } 'duplicate entries rejected'
        [IO.File]::WriteAllText($script:ChecksumFile, $valid.Replace($script:ThreadsClientAsset, 'other.tgz'))
        Assert-Throws { Get-VerifiedClientPackage $script:PackageDirectory } 'other package entry rejected'
        Write-Fixture
    }
    Test-Case 'install target stays below local app data and refuses a file ancestor' {
        $local = Join-Path $script:TestRoot 'local data'
        $expected = Join-Path $local 'ThreadsCommentMcp/customer-client/0.1.1'
        Assert-True ((Get-SafeInstallDirectory $local) -eq [IO.Path]::GetFullPath($expected)) 'versioned target'
        Assert-Throws { Get-SafeInstallDirectory '' } 'empty path rejected'
        Assert-Throws { Get-SafeInstallDirectory 'relative/path' } 'relative path rejected'
        New-Item -ItemType Directory -Path $local | Out-Null
        [IO.File]::WriteAllText((Join-Path $local 'ThreadsCommentMcp'), 'file')
        Assert-Throws { Get-SafeInstallDirectory $local } 'file ancestor rejected'
    }

    # Dependency injection by function replacement within this test process only.
    function Get-InstallerCommand {
        param([string[]]$Names, [string]$HelpText)
        if ($script:MissingCommand -and $Names -contains $script:MissingCommand) { throw $HelpText }
        return $Names[0]
    }
    function Invoke-InstallerCommand {
        param([string]$CommandPath, [string[]]$Arguments)
        $script:Calls.Add([pscustomobject]@{ Command = $CommandPath; Arguments = $Arguments })
        if ($Arguments[0] -eq '--version') { return 'v24.18.0' }
        if ($CommandPath -eq 'npm.cmd') {
            if ($script:FailNpm) { throw 'Mock npm failure' }
            $target = $Arguments[2]
            $root = Join-Path $target 'node_modules/threads-comment-client'
            New-Item -ItemType Directory -Path (Join-Path $root 'src') -Force | Out-Null
            [IO.File]::WriteAllText((Join-Path $root 'package.json'), ('{"name":"threads-comment-client","version":"' + $script:MetadataVersion + '"}'))
            [IO.File]::WriteAllText((Join-Path $root 'src/index.mjs'), '// mocked entry')
        }
    }
    function Reset-Mocks {
        $script:Calls = [Collections.Generic.List[object]]::new()
        $script:FailNpm = $false
        $script:MissingCommand = ''
        $script:MetadataVersion = '0.1.1'
    }
    Test-Case 'check-only verifies prerequisites without creating install directory or registering MCP' {
        Reset-Mocks
        $local = Join-Path $script:TestRoot 'check only'
        Invoke-ThreadsClientInstall -PackageDirectory $script:PackageDirectory -LocalAppData $local -CheckOnly
        Assert-True (-not (Test-Path -LiteralPath $local)) 'no directory created'
        Assert-True ($script:Calls.Count -eq 1 -and $script:Calls[0].Arguments[0] -eq '--version') 'only version probe ran'
    }
    Test-Case 'missing Codex fails before installation' {
        Reset-Mocks
        $script:MissingCommand = 'codex.exe'
        $local = Join-Path $script:TestRoot 'missing codex'
        Assert-Throws { Invoke-ThreadsClientInstall -PackageDirectory $script:PackageDirectory -LocalAppData $local } 'missing Codex rejected'
        Assert-True (-not (Test-Path -LiteralPath $local)) 'no install directory created'
    }
    Test-Case 'successful install uses no scripts and absolute Node entry registration; repeat is safe' {
        Reset-Mocks
        $local = Join-Path $script:TestRoot 'success'
        Invoke-ThreadsClientInstall -PackageDirectory $script:PackageDirectory -LocalAppData $local
        $npm = @($script:Calls | Where-Object Command -eq 'npm.cmd')[0]
        Assert-True ($npm.Arguments -contains '--ignore-scripts') 'lifecycle scripts disabled'
        Assert-True ($npm.Arguments -contains '--omit=dev') 'development dependencies omitted'
        $codex = @($script:Calls | Where-Object Command -eq 'codex.exe')[0]
        Assert-True (($codex.Arguments[0..4] -join '|') -eq 'mcp|add|threads-comments|--|node.exe') 'only intended MCP registered'
        Assert-True ($codex.Arguments[5] -eq (Join-Path $local 'ThreadsCommentMcp/customer-client/0.1.1/node_modules/threads-comment-client/src/index.mjs')) 'entry argument preserves spaces'
        Invoke-ThreadsClientInstall -PackageDirectory $script:PackageDirectory -LocalAppData $local
        Assert-True (@($script:Calls | Where-Object Command -eq 'codex.exe').Count -eq 2) 'same registration on repeat'
    }
    Test-Case 'npm failure prevents Codex registration' {
        Reset-Mocks
        $script:FailNpm = $true
        Assert-Throws { Invoke-ThreadsClientInstall -PackageDirectory $script:PackageDirectory -LocalAppData (Join-Path $script:TestRoot 'npm fails') } 'npm failure reported'
        Assert-True (@($script:Calls | Where-Object Command -eq 'codex.exe').Count -eq 0) 'no registration after npm failure'
    }
    Test-Case 'unexpected installed package version prevents Codex registration' {
        Reset-Mocks
        $script:MetadataVersion = '0.9.9'
        Assert-Throws { Invoke-ThreadsClientInstall -PackageDirectory $script:PackageDirectory -LocalAppData (Join-Path $script:TestRoot 'wrong version') } 'wrong version rejected'
        Assert-True (@($script:Calls | Where-Object Command -eq 'codex.exe').Count -eq 0) 'no registration after metadata mismatch'
    }
    Write-Host "Installer tests: $script:Passed passed. Real npm/Codex configuration was not changed."
} finally {
    $resolved = [IO.Path]::GetFullPath($script:TestRoot)
    $allowed = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notlike 'threads-installer-tests-*') { throw 'Unsafe test cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
