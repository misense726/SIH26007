param(
    [string]$PiHost = "misense.local",
    [int]$PiCameraPort = 8888,
    [int]$ApiPort = 8000,
    [int]$TelemetryPort = 8765,
    [double]$TelemetryHz = 20,
    [switch]$NoCamera
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$cameraUrl = $null
if (-not $NoCamera) {
    try {
        $piAddress = (Resolve-DnsName -Name $PiHost -Type A -ErrorAction Stop |
            Select-Object -First 1 -ExpandProperty IPAddress)
    } catch {
        if ($PiHost -match '^\d{1,3}(\.\d{1,3}){3}$') {
            $piAddress = $PiHost
        } else {
            throw "FogSen could not resolve the Pi host '$PiHost'. Pass -PiHost with its current LAN IP or use -NoCamera."
        }
    }
    $cameraUrl = "tcp://{0}:{1}" -f $piAddress, $PiCameraPort
}

$env:FOGSEN_HOST = "0.0.0.0"
$env:FOGSEN_PORT = [string]$ApiPort
$env:FOGSEN_MODE = "LIVE"
$env:FOGSEN_TELEMETRY_HZ = [string]$TelemetryHz
$env:FOGSEN_TELEMETRY_TRANSPORT = "WIFI"
$env:FOGSEN_WIFI_LISTEN_HOST = "0.0.0.0"
$env:FOGSEN_WIFI_LISTEN_PORT = [string]$TelemetryPort
$env:FOGSEN_CAMERA_DEHAZE_ENABLED = "false"
$env:FOGSEN_CAMERA_IR_ENABLED = "false"

if ($NoCamera) {
    Remove-Item Env:FOGSEN_CAMERA_STREAM_URL -ErrorAction SilentlyContinue
    Write-Host ("FogSen LIVE: API 0.0.0.0:{0}, MAIN Wi-Fi 0.0.0.0:{1}, {2} Hz, camera disabled" -f $ApiPort, $TelemetryPort, $TelemetryHz)
} else {
    $env:FOGSEN_CAMERA_STREAM_URL = $cameraUrl
    Write-Host ("FogSen LIVE: API 0.0.0.0:{0}, MAIN Wi-Fi 0.0.0.0:{1}, {2} Hz, Pi camera {3}" -f $ApiPort, $TelemetryPort, $TelemetryHz, $cameraUrl)
    Write-Host "Raw camera is enabled; optional ML enhancement stays off."
}

$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "FogSen virtual environment is missing: $python"
}

& $python -m uvicorn backend.app.main:app --host 0.0.0.0 --port $ApiPort
exit $LASTEXITCODE
