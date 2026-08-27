param(
    [string]$PiHost = "misense.local",
    [int]$PiCameraPort = 8888,
    [int]$ApiPort = 8000,
    [int]$TelemetryPort = 8765
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

try {
    $piAddress = (Resolve-DnsName -Name $PiHost -Type A -ErrorAction Stop |
        Select-Object -First 1 -ExpandProperty IPAddress)
} catch {
    if ($PiHost -match '^\d{1,3}(\.\d{1,3}){3}$') {
        $piAddress = $PiHost
    } else {
        throw "FogSen could not resolve the Pi host '$PiHost'. Pass -PiHost with its current LAN IP or hostname."
    }
}

$cameraUrl = "tcp://{0}:{1}" -f $piAddress, $PiCameraPort
$env:FOGSEN_HOST = "0.0.0.0"
$env:FOGSEN_PORT = [string]$ApiPort
$env:FOGSEN_MODE = "LIVE"
$env:FOGSEN_TELEMETRY_TRANSPORT = "WIFI"
$env:FOGSEN_WIFI_LISTEN_HOST = "0.0.0.0"
$env:FOGSEN_WIFI_LISTEN_PORT = [string]$TelemetryPort
$env:FOGSEN_CAMERA_STREAM_URL = $cameraUrl
$env:FOGSEN_CAMERA_DEHAZE_ENABLED = "false"
$env:FOGSEN_CAMERA_IR_ENABLED = "false"

Write-Host ("FogSen LIVE: API 0.0.0.0:{0}, MAIN Wi-Fi 0.0.0.0:{1}, Pi camera {2}" -f $ApiPort, $TelemetryPort, $cameraUrl)
Write-Host "Raw camera is enabled; optional ML enhancement stays off for a low-latency baseline."

$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "FogSen virtual environment is missing: $python"
}

& $python -m uvicorn backend.app.main:app --host 0.0.0.0 --port $ApiPort
exit $LASTEXITCODE
