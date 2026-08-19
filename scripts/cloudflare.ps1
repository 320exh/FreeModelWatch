# Cloudflare helper for OpenCode / Hy3 sessions.
# This file contains NO secrets. It loads CF_READ_TOKEN / CF_WRITE_TOKEN
# from the project-local .env.local (gitignored) and exposes two wrappers:
#   CF   - read-only Cloudflare API calls (uses CF_READ_TOKEN)
#   CFw  - mutating Cloudflare API calls (uses CF_WRITE_TOKEN)
# Usage:
#   CF   "/zones?name=freeai.today"
#   CFw  "/zones/<id>/bot_management" -Method Put -Body $json

$ErrorActionPreference = 'SilentlyContinue'

$cfEnvParent = Join-Path $PSScriptRoot '..'
$cfEnvFile = Join-Path $cfEnvParent '.env.local'

if (Test-Path -LiteralPath $cfEnvFile) {
    Get-Content -LiteralPath $cfEnvFile | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$') {
            $k = $Matches[1]
            $v = $Matches[2].Trim('"').Trim("'")
            if ($k -eq 'CF_READ_TOKEN' -or $k -eq 'CF_WRITE_TOKEN') {
                Set-Item -Path "env:$k" -Value $v
            }
        }
    }
}

function CF {
    param(
        [Parameter(Mandatory = $true)] [string] $Path,
        [string] $Method = 'Get',
        [string] $Body = $null
    )
    $h = @{ Authorization = "Bearer $env:CF_READ_TOKEN" }
    $uri = "https://api.cloudflare.com/client/v4$Path"
    if ($Body) {
        Invoke-RestMethod -Uri $uri -Method $Method -Headers $h -Body $Body -ContentType 'application/json'
    } else {
        Invoke-RestMethod -Uri $uri -Method $Method -Headers $h
    }
}

function CFw {
    param(
        [Parameter(Mandatory = $true)] [string] $Path,
        [string] $Method = 'Post',
        [string] $Body = $null
    )
    $h = @{ Authorization = "Bearer $env:CF_WRITE_TOKEN" }
    $uri = "https://api.cloudflare.com/client/v4$Path"
    if ($Body) {
        Invoke-RestMethod -Uri $uri -Method $Method -Headers $h -Body $Body -ContentType 'application/json'
    } else {
        Invoke-RestMethod -Uri $uri -Method $Method -Headers $h
    }
}
