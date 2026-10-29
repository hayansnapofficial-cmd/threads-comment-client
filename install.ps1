[CmdletBinding()]
param([switch]$CheckOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ThreadsClientVersion = '0.1.2'
$script:ThreadsClientAsset = "threads-comment-client-$script:ThreadsClientVersion.tgz"

function Get-InstallerCommand {
    param([string[]]$Names, [string]$HelpText)
    foreach ($name in $Names) {
        $command = Get-Command -Name $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $command) { return $command.Source }
    }
    throw $HelpText
}

function Invoke-InstallerCommand {
    param([string]$CommandPath, [string[]]$Arguments)
    & $CommandPath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "명령 실행에 실패했습니다 (종료 코드 $LASTEXITCODE). 위 오류를 확인한 뒤 다시 실행해 주세요." }
}

function Assert-NodeVersion {
    param([string]$VersionText)
    if ($VersionText.Trim() -notmatch '^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$') { throw 'Node.js 버전을 확인하지 못했습니다.' }
    $version = [version]("{0}.{1}.{2}" -f $Matches[1], $Matches[2], $Matches[3])
    if ($version -lt [version]'22.15.0') { throw 'Node.js 22.15 이상이 필요합니다. https://nodejs.org/ 에서 설치한 뒤 이 창을 닫고 다시 실행해 주세요.' }
}

function Get-VerifiedClientPackage {
    param([string]$PackageDirectory)
    $packagePath = Join-Path $PackageDirectory $script:ThreadsClientAsset
    $sumsPath = Join-Path $PackageDirectory 'SHA256SUMS'
    foreach ($path in @($packagePath, $sumsPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw '설치 파일이 빠져 있습니다. Windows 설치 ZIP을 모두 압축 해제한 뒤 install.cmd를 실행해 주세요.' }
        if (((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw '연결된 파일 대신 ZIP에 포함된 실제 설치 파일을 사용해 주세요.' }
    }
    $expected = @()
    foreach ($line in [IO.File]::ReadAllLines($sumsPath)) {
        if ($line -match '^([a-fA-F0-9]{64})\s+\*?([^\r\n]+)$' -and $Matches[2] -ceq $script:ThreadsClientAsset) { $expected += $Matches[1] }
    }
    if ($expected.Count -ne 1) { throw 'SHA256SUMS에서 이 버전의 검증값을 확인하지 못했습니다. 공식 릴리스 ZIP을 다시 받아 주세요.' }
    $actual = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
    if ($actual -ine $expected[0]) { throw '설치 파일의 SHA-256 검증값이 일치하지 않습니다. 설치하지 않았습니다. 공식 릴리스 ZIP을 다시 받아 주세요.' }
    return $packagePath
}

function Get-SafeInstallDirectory {
    param([string]$LocalAppData)
    if ([string]::IsNullOrWhiteSpace($LocalAppData) -or -not [IO.Path]::IsPathRooted($LocalAppData)) { throw '현재 Windows 사용자의 LocalAppData 경로를 찾을 수 없습니다.' }
    $base = [IO.Path]::GetFullPath($LocalAppData).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $parts = @('ThreadsCommentMcp', 'customer-client', $script:ThreadsClientVersion)
    $current = $base
    foreach ($part in @('') + $parts) {
        if ($part) { $current = Join-Path $current $part }
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw '설치 경로가 일반 폴더가 아닙니다. LocalAppData의 ThreadsCommentMcp 폴더를 확인해 주세요.' }
        }
    }
    $target = [IO.Path]::GetFullPath($current)
    if (-not $target.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '설치 경로가 사용자 폴더 밖으로 벗어났습니다.' }
    return $target
}

function Invoke-ThreadsClientInstall {
    param([string]$PackageDirectory = $PSScriptRoot, [string]$LocalAppData = $env:LOCALAPPDATA, [switch]$CheckOnly)
    Write-Host 'Threads 댓글 보조 MCP 설치 확인 중...'
    $packagePath = Get-VerifiedClientPackage -PackageDirectory $PackageDirectory
    $nodePath = Get-InstallerCommand -Names @('node.exe') -HelpText 'Node.js 22.15 이상이 필요합니다. https://nodejs.org/ 에서 설치한 뒤 이 창을 닫고 다시 실행해 주세요.'
    $nodeVersion = (Invoke-InstallerCommand -CommandPath $nodePath -Arguments @('--version') | Out-String).Trim()
    Assert-NodeVersion -VersionText $nodeVersion
    $npmPath = Get-InstallerCommand -Names @('npm.cmd') -HelpText 'npm을 찾지 못했습니다. https://nodejs.org/ 에서 Node.js를 다시 설치한 뒤 다시 실행해 주세요.'
    $codexPath = Get-InstallerCommand -Names @('codex.exe', 'codex.cmd') -HelpText 'Codex CLI를 찾지 못했습니다. PowerShell에서 npm.cmd install -g @openai/codex 를 실행한 뒤 이 창을 닫고 다시 실행해 주세요.'
    $installDirectory = Get-SafeInstallDirectory -LocalAppData $LocalAppData
    if ($CheckOnly) {
        Write-Host '설치 파일 검증과 실행 환경 확인을 마쳤습니다. 파일 설치 및 Codex 등록은 하지 않았습니다.'
        return
    }

    Write-Host '[1/2] 사용자 폴더에 MCP를 설치합니다. 인터넷 연결이 필요합니다.'
    New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
    Invoke-InstallerCommand -CommandPath $npmPath -Arguments @('install', '--prefix', $installDirectory, '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', $packagePath) | Out-Host
    $packageRoot = Join-Path $installDirectory 'node_modules/threads-comment-client'
    $entry = Join-Path $packageRoot 'src/index.mjs'
    $metadataPath = Join-Path $packageRoot 'package.json'
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf) -or -not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { throw 'MCP 설치 결과를 확인하지 못했습니다. Codex 등록은 변경하지 않았습니다.' }
    $metadata = [IO.File]::ReadAllText($metadataPath) | ConvertFrom-Json
    if ($metadata.name -cne 'threads-comment-client' -or $metadata.version -cne $script:ThreadsClientVersion) { throw '설치된 패키지 이름 또는 버전이 다릅니다. Codex 등록은 변경하지 않았습니다.' }
    # Import definitions only: no login, credential read, provider call, or stdio server startup.
    $verifyScript = "const {pathToFileURL}=await import('node:url'); await import(pathToFileURL(process.argv[1]).href);"
    Invoke-InstallerCommand -CommandPath $nodePath -Arguments @('--input-type=module', '--eval', $verifyScript, (Join-Path $packageRoot 'src/server.mjs')) | Out-Host

    Write-Host '[2/2] Codex에 threads-comments MCP를 등록합니다.'
    Invoke-InstallerCommand -CommandPath $codexPath -Arguments @('mcp', 'add', 'threads-comments', '--', $nodePath, $entry) | Out-Host
    Write-Host ''
    Write-Host '설치 완료. Codex를 다시 열고 다음 문장을 입력해 주세요:' -ForegroundColor Green
    Write-Host 'threads-comments MCP로 내 Threads 계정을 연결해 줘. 로그인 화면은 오른쪽에 열어 줘.'
    Write-Host '열린 화면에서 본인 계정으로 로그인하고 동의한 뒤, 채팅에 로그인 완료라고 입력하세요.'
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
        Invoke-ThreadsClientInstall -CheckOnly:$CheckOnly
        exit 0
    } catch {
        Write-Host ''
        Write-Host ('설치를 완료하지 못했습니다: ' + $_.Exception.Message) -ForegroundColor Red
        exit 1
    }
}
