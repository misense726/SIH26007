param(
    [string]$PiHost = "misense.local",
    [int]$PiCameraPort = 8888,
    [int]$ApiPort = 8000,
    [int]$TelemetryPort = 8765,
    [double]$TelemetryHz = 20,
    [string]$SerialPort = "",
    [switch]$NoCamera
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "MI Sense virtual environment is missing: $python"
}

if (-not $SerialPort.Trim()) {
    $detectedPorts = @(& $python -c "from serial.tools import list_ports; print(*[p.device for p in list_ports.comports() if p.vid == 0x10C4 and p.pid == 0xEA60], sep='\n')")
    $detectedPorts = @($detectedPorts | Where-Object { $_ -match '^COM\d+$' })
    if ($detectedPorts.Count -ne 1) {
        $found = if ($detectedPorts.Count -eq 0) { "none" } else { $detectedPorts -join ", " }
        throw "MI Sense could not identify one MAIN CP210x USB port (found: $found). Pass -SerialPort COMx after checking the connected boards."
    }
    $SerialPort = $detectedPorts[0]
}

$cameraUrl = $null
if (-not $NoCamera) {
    try {
        $piAddress = (Resolve-DnsName -Name $PiHost -Type A -ErrorAction Stop |
            Select-Object -First 1 -ExpandProperty IPAddress)
    } catch {
        if ($PiHost -match '^\d{1,3}(\.\d{1,3}){3}$') {
            $piAddress = $PiHost
        } else {
            throw "MI Sense could not resolve the Pi host '$PiHost'. Pass -PiHost with its current LAN IP or use -NoCamera."
        }
    }
    $cameraUrl = "tcp://{0}:{1}" -f $piAddress, $PiCameraPort
}

$env:FOGSEN_HOST = "0.0.0.0"
$env:FOGSEN_PORT = [string]$ApiPort
$env:FOGSEN_MODE = "LIVE"
$env:FOGSEN_TELEMETRY_HZ = [string]$TelemetryHz
$env:FOGSEN_TELEMETRY_TRANSPORT = "BOTH"
$env:FOGSEN_SERIAL_PORT = $SerialPort
$env:FOGSEN_WIFI_LISTEN_HOST = "0.0.0.0"
$env:FOGSEN_WIFI_LISTEN_PORT = [string]$TelemetryPort

if ($NoCamera) {
    Remove-Item Env:FOGSEN_CAMERA_STREAM_URL -ErrorAction SilentlyContinue
    $env:FOGSEN_CAMERA_DEHAZE_ENABLED = "false"
    $env:FOGSEN_CAMERA_IR_ENABLED = "false"
    Write-Host ("MI Sense LIVE: API 0.0.0.0:{0}, MAIN USB {1} + Wi-Fi 0.0.0.0:{2}, {3} Hz, camera disabled" -f $ApiPort, $SerialPort, $TelemetryPort, $TelemetryHz)
} else {
    $env:FOGSEN_CAMERA_STREAM_URL = $cameraUrl
    Write-Host ("MI Sense LIVE: API 0.0.0.0:{0}, MAIN USB {1} + Wi-Fi 0.0.0.0:{2}, {3} Hz, Pi camera {4}" -f $ApiPort, $SerialPort, $TelemetryPort, $TelemetryHz, $cameraUrl)
    Write-Host "Camera processing settings are loaded from .env when present."
}

$uvicornArgs = @("-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", [string]$ApiPort)
$envFile = Join-Path $projectRoot ".env"
if (-not $NoCamera -and (Test-Path -LiteralPath $envFile)) {
    $uvicornArgs += @("--env-file", $envFile)
}

& $python @uvicornArgs
exit $LASTEXITCODE
