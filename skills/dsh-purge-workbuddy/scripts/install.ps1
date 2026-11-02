# dsh-purge → WorkBuddy 安装脚本
# 用法：
#   .\scripts\install.ps1           # 安装到国际版 profile (~/.workbuddy-ai)
#   .\scripts\install.ps1 -Cn       # 安装到 CN 版 profile (~/.workbuddy)
#   .\scripts\install.ps1 -DryRun   # 只打印计划，不改任何文件
#   .\scripts\install.ps1 -NoApply  # 只注册插件，不应用补丁
param(
    [switch]$Cn,
    [switch]$DryRun,
    [switch]$NoApply
)

$ErrorActionPreference = 'Stop'

$PkgRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PkgName = 'dsh-purge-workbuddy'
$MktName = 'dsh-purge-local'
$Parent  = Split-Path -Parent $PkgRoot
$MktRoot = Join-Path $Parent $MktName
$ProfileDir = if ($Cn) { Join-Path $env:USERPROFILE '.workbuddy' } else { Join-Path $env:USERPROFILE '.workbuddy-ai' }

function Say([string]$m) { Write-Host ('[install] ' + $m) }

Say ('package  = ' + $PkgRoot)
Say ('market   = ' + $MktRoot)
Say ('profile  = ' + $ProfileDir)
Say ('dryRun   = ' + [bool]$DryRun)

if (-not (Test-Path $PkgRoot)) { throw ('package not found: ' + $PkgRoot) }
if (-not (Test-Path $ProfileDir)) { throw ('profile not found: ' + $ProfileDir + ' (先启动一次 WorkBuddy)') }

$manifest = Get-Content (Join-Path $PkgRoot '.codebuddy-plugin\plugin.json') -Raw | ConvertFrom-Json
$Version = $manifest.version
Say ('version  = ' + $Version)

$pluginsDir  = Join-Path $ProfileDir 'plugins'
$cacheDir    = Join-Path $pluginsDir ('cache\' + $MktName + '\' + $PkgName + '\' + $Version)
$mktDir      = Join-Path $pluginsDir ('marketplaces\' + $MktName)
$installedJs = Join-Path $pluginsDir 'installed_plugins.json'
$knownJs     = Join-Path $pluginsDir 'known_marketplaces.json'
$settingsJs  = Join-Path $ProfileDir 'settings.json'
$key         = $PkgName + '@' + $MktName
$now         = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')

if ($DryRun) {
    Say ('PLAN copy   : ' + $PkgRoot + '  ->  ' + $cacheDir)
    Say ('PLAN market : ' + $MktRoot + '  ->  ' + $mktDir)
    Say ('PLAN reg    : known_marketplaces.json += ' + $MktName)
    Say ('PLAN reg    : installed_plugins.json  += ' + $key)
    Say ('PLAN reg    : settings.json enabledPlugins[' + $key + '] = true')
    if (-not $NoApply) { Say 'PLAN apply  : node lib/cli.mjs apply' }
    return
}

# ── 1. 复制插件到 cache ────────────────────────────────────────────────
if (Test-Path $cacheDir) { Remove-Item $cacheDir -Recurse -Force }
New-Item -ItemType Directory -Force $cacheDir | Out-Null
Get-ChildItem -Path $PkgRoot -Force | Where-Object { $_.Name -notin @('scripts') } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $cacheDir -Recurse -Force
}
$cnt = (Get-ChildItem $cacheDir -Recurse -File | Measure-Object).Count
Say ('copied   -> ' + $cacheDir + '  (' + $cnt + ' files)')

# ── 2. 建本地市场 ─────────────────────────────────────────────────────
if (Test-Path $mktDir) { Remove-Item $mktDir -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $mktDir '.codebuddy-plugin') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $mktDir 'plugins') | Out-Null
Copy-Item (Join-Path $MktRoot '.codebuddy-plugin\marketplace.json') (Join-Path $mktDir '.codebuddy-plugin\marketplace.json') -Force

$linkDest = Join-Path $mktDir ('plugins\' + $PkgName)
try {
    New-Item -ItemType Junction -Path $linkDest -Target $cacheDir -Force | Out-Null
    Say ('market   -> ' + $mktDir + '  (plugin junction -> cache)')
} catch {
    New-Item -ItemType Directory -Force $linkDest | Out-Null
    Get-ChildItem -Path $cacheDir -Force | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $linkDest -Recurse -Force
    }
    Say ('market   -> ' + $mktDir + '  (plugin copied; junction unavailable)')
}

# ── 3. 注册 known_marketplaces.json ───────────────────────────────────
$known = if (Test-Path $knownJs) { Get-Content $knownJs -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
$knownEntry = [pscustomobject]@{
    manifestName    = $MktName
    type            = 'directory'
    source          = [pscustomobject]@{ source = 'directory'; path = $mktDir }
    installLocation = $mktDir
    description     = 'dsh-purge 的 WorkBuddy 本地市场'
    lastUpdated     = $now
    autoUpdate      = $false
    isBuiltIn       = $false
}
$known | Add-Member -NotePropertyName $MktName -NotePropertyValue $knownEntry -Force
$known | ConvertTo-Json -Depth 8 | Set-Content $knownJs -Encoding utf8
Say ('registered marketplace -> ' + $MktName)

# ── 4. 注册 installed_plugins.json ───────────────────────────────────
$installed = if (Test-Path $installedJs) { Get-Content $installedJs -Raw | ConvertFrom-Json } else {
    [pscustomobject]@{ version = 2; plugins = [pscustomobject]@{} }
}
$entry = [pscustomobject]@{
    scope       = 'user'
    installPath = $cacheDir
    version     = $Version
    installedAt = $now
    lastUpdated = $now
}
$installed.plugins | Add-Member -NotePropertyName $key -NotePropertyValue @($entry) -Force
$installed | ConvertTo-Json -Depth 8 | Set-Content $installedJs -Encoding utf8
Say ('registered plugin -> ' + $key)

# ── 5. settings.json enabledPlugins ──────────────────────────────────
$settings = Get-Content $settingsJs -Raw | ConvertFrom-Json
if (-not ($settings.PSObject.Properties.Name -contains 'enabledPlugins')) {
    $settings | Add-Member -NotePropertyName enabledPlugins -NotePropertyValue ([pscustomobject]@{}) -Force
}
$settings.enabledPlugins | Add-Member -NotePropertyName $key -NotePropertyValue $true -Force
$settings | ConvertTo-Json -Depth 12 | Set-Content $settingsJs -Encoding utf8
Say ('enabled  -> ' + $key)

# ── 6. 应用补丁 ──────────────────────────────────────────────────────
# ── 5.5 写入目标绑定（两版并存时 hook 靠它定位，不依赖环境变量）─────────
$installTarget = if ($Cn) { 'D:\TOOL\WorkBuddy' } else { 'D:\TOOL\workBuddyAI_outside' }
$binding = [pscustomobject]@{
    edition    = if ($Cn) { 'cn' } else { 'international' }
    configDir  = $ProfileDir
    installDir = $installTarget
    boundAt    = $now
}
$binding | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $cacheDir 'target.json') -Encoding utf8
# 市场 junction 已指向 cache，无需再写
Say ('bound    -> ' + $binding.edition + '  config=' + $ProfileDir + '  install=' + $installTarget)

if (-not $NoApply) {
    # 显式锁定本版 profile / 安装目录，避免两版并存时定位到对方
    $env:WORKBUDDY_CONFIG_DIR  = $ProfileDir
    $env:WORKBUDDY_INSTALL_DIR = if ($Cn) { 'D:\TOOL\WorkBuddy' } else { 'D:\TOOL\workBuddyAI_outside' }
    Say ('running lib/cli.mjs apply  [config=' + $env:WORKBUDDY_CONFIG_DIR + ' install=' + $env:WORKBUDDY_INSTALL_DIR + ']')
    & node (Join-Path $cacheDir 'lib\cli.mjs') apply
    Remove-Item Env:WORKBUDDY_CONFIG_DIR  -ErrorAction SilentlyContinue
    Remove-Item Env:WORKBUDDY_INSTALL_DIR -ErrorAction SilentlyContinue
}

Say 'DONE. 重启 WorkBuddy 生效（插件清单在启动时加载）。'


