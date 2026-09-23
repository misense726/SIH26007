[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Get-Command arduino-cli -ErrorAction SilentlyContinue)) {
    throw "arduino-cli is not installed or is not on PATH."
}

$esp32Index = "https://espressif.github.io/arduino-esp32/package_esp32_index.json"

arduino-cli core update-index --additional-urls $esp32Index
if ($LASTEXITCODE -ne 0) {
    throw "Could not update the Espressif board index."
}

arduino-cli core install esp32:esp32@3.3.11 --additional-urls $esp32Index
if ($LASTEXITCODE -ne 0) {
    throw "Could not install esp32:esp32@3.3.11."
}

arduino-cli lib install `
    "VL53L0X@1.3.1" `
    "VL53L1X@1.3.1" `
    "ArduinoJson@6.21.5" `
    "Adafruit MPU6050@2.2.9" `
    "Adafruit BMP280 Library@3.0.0"
if ($LASTEXITCODE -ne 0) {
    throw "Could not install the pinned MI Sense firmware libraries."
}

Write-Host "MI Sense firmware toolchain is ready."
