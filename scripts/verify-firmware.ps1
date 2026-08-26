[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Executable failed with exit code $LASTEXITCODE."
    }
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$python = if (Test-Path -LiteralPath $venvPython) {
    $venvPython
} else {
    (Get-Command python -ErrorAction Stop).Source
}

Push-Location $projectRoot
try {
    Invoke-Checked "arduino-cli" @(
        "compile", "--warnings", "all", "--fqbn", "esp32:esp32:esp32",
        "firmware/main_esp32"
    )
    Invoke-Checked "arduino-cli" @(
        "compile", "--warnings", "all", "--fqbn", "esp32:esp32:XIAO_ESP32C6",
        "firmware/front_xiao_esp32c6"
    )
    Invoke-Checked "arduino-cli" @(
        "compile", "--warnings", "all", "--fqbn", "esp32:esp32:esp32c3:CDCOnBoot=cdc,FlashMode=dio,FlashFreq=40",
        "firmware/middle_esp32c3_supermini"
    )
    Invoke-Checked $python @(
        "-m", "pytest", "-q",
        "firmware/main_esp32/tests",
        "firmware/tests",
        "backend/tests/test_serial_protocol.py"
    )
} finally {
    Pop-Location
}

Write-Host "MAIN, FRONT, and MIDDLE firmware builds and wired protocol checks passed."
