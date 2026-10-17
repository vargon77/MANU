[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = 'Ruta al ejecutable whisper-server de Windows.')] [string] $WhisperServerPath,
    [Parameter(Mandatory = $true, HelpMessage = 'Ruta al modelo Whisper.cpp multilingüe GGML.')] [string] $WhisperModelPath,
    [Parameter(Mandatory = $true, HelpMessage = 'Ruta al ejecutable llama-server de Windows.')] [string] $LlamaServerPath,
    [Parameter(Mandatory = $true, HelpMessage = 'Ruta a un modelo Gemma GGUF compatible.')] [string] $GemmaModelPath,
    [Parameter(Mandatory = $true, HelpMessage = 'Ruta al ejecutable Piper de Windows.')] [string] $PiperPath,
    [Parameter(Mandatory = $true, HelpMessage = 'Ruta al modelo de voz Piper ONNX.')] [string] $PiperModelPath,
    [Parameter(Mandatory = $false)] [string] $PiperConfigPath,
    [Parameter(Mandatory = $true, HelpMessage = 'Ruta al ejecutable Rhubarb de Windows.')] [string] $RhubarbPath,
    [Parameter(Mandatory = $true, HelpMessage = 'Ruta al modelo recurrente Silero VAD ONNX.')] [string] $SileroModelPath,
    [Parameter(Mandatory = $false)] [string] $DestinationRoot = (Split-Path -Parent $PSScriptRoot),
    [switch] $Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-SourceFile {
    param([string] $Path, [string] $Label)
    $resolved = [System.IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "$Label no es un archivo existente: $resolved"
    }
    $file = Get-Item -LiteralPath $resolved
    if ($file.Length -le 0) {
        throw "$Label está vacío: $resolved"
    }
    return $resolved
}

function Get-Sha256 {
    param([string] $Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-HelpFlag {
    param([string] $Executable, [string] $Flag, [string] $Label)
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $Executable
    $startInfo.Arguments = '--help'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) {
            throw "$Label no pudo iniciarse para validar --help."
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(15000)) {
            $process.Kill()
            throw "$Label no respondió a --help en 15 segundos."
        }
        $helpText = $stdoutTask.GetAwaiter().GetResult() + "`n" + $stderrTask.GetAwaiter().GetResult()
        if ($helpText.Length -gt 1048576) {
            throw "$Label devolvió más de 1 MiB durante --help."
        }
        if (-not $helpText.Contains($Flag)) {
            throw "$Label no anuncia el flag requerido '$Flag' en --help."
        }
    }
    catch {
        throw "Validación de $Label fallida: $($_.Exception.Message)"
    }
    finally {
        $process.Dispose()
    }
}

function Install-Asset {
    param(
        [string] $Source,
        [string] $RelativePath,
        [string] $Name
    )
    $destination = Join-Path $script:root $RelativePath
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null

    $sourceHash = Get-Sha256 $Source
    if (Test-Path -LiteralPath $destination -PathType Leaf) {
        $installedHash = Get-Sha256 $destination
        if ($installedHash -eq $sourceHash) {
            $file = Get-Item -LiteralPath $destination
            return [pscustomobject]@{
                name = $Name
                path = $RelativePath.Replace('\', '/')
                sha256 = $sourceHash
                bytes = $file.Length
            }
        }
        if (-not $Force) {
            throw "$destination ya existe con otro SHA-256. Usa -Force para reemplazarlo."
        }
    }

    $temporary = "$destination.staging.$([Guid]::NewGuid().ToString('N'))"
    try {
        Copy-Item -LiteralPath $Source -Destination $temporary
        if ((Get-Sha256 $temporary) -ne $sourceHash) {
            throw "La copia de $Name no coincide con el SHA-256 de origen."
        }
        Move-Item -LiteralPath $temporary -Destination $destination -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -LiteralPath $temporary -Force
        }
    }

    $installed = Get-Item -LiteralPath $destination
    return [pscustomobject]@{
        name = $Name
        path = $RelativePath.Replace('\', '/')
        sha256 = $sourceHash
        bytes = $installed.Length
    }
}

function ConvertTo-DotEnvValue {
    param([string] $Value)
    $normalized = $Value.Replace('\', '/').Replace('"', '\"')
    return '"' + $normalized + '"'
}

function Write-ManagedFile {
    param([string] $Path, [string] $Content)
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $current = [System.IO.File]::ReadAllText($Path)
        if ($current -ceq $Content) {
            return
        }
        if (-not $Force) {
            throw "$Path ya existe con contenido distinto. Conservado; usa -Force para regenerarlo."
        }
    }
    $temporary = "$Path.staging.$([Guid]::NewGuid().ToString('N'))"
    try {
        $encoding = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList @($false)
        [System.IO.File]::WriteAllText($temporary, $Content, $encoding)
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -LiteralPath $temporary -Force
        }
    }
}

$script:root = [System.IO.Path]::GetFullPath($DestinationRoot)
$whisperServer = Resolve-SourceFile $WhisperServerPath 'WHISPER_BIN'
$whisperModel = Resolve-SourceFile $WhisperModelPath 'WHISPER_MODEL'
$llamaServer = Resolve-SourceFile $LlamaServerPath 'LLAMA_BIN'
$gemmaModel = Resolve-SourceFile $GemmaModelPath 'LLAMA_MODEL'
$piperBinary = Resolve-SourceFile $PiperPath 'PIPER_BIN'
$piperModel = Resolve-SourceFile $PiperModelPath 'PIPER_MODEL'
$rhubarbBinary = Resolve-SourceFile $RhubarbPath 'RHUBARB_BIN'
$sileroModel = Resolve-SourceFile $SileroModelPath 'VAD_MODEL'

if ([string]::IsNullOrWhiteSpace($PiperConfigPath)) {
    $PiperConfigPath = "$PiperModelPath.json"
}
$piperConfig = Resolve-SourceFile $PiperConfigPath 'PIPER_MODEL JSON'

try {
    $piperMetadata = Get-Content -LiteralPath $piperConfig -Raw | ConvertFrom-Json
    $piperSampleRate = [int] $piperMetadata.audio.sample_rate
    if ($piperSampleRate -lt 8000 -or $piperSampleRate -gt 96000) {
        throw 'audio.sample_rate debe estar entre 8000 y 96000.'
    }
}
catch {
    throw "El JSON de voz Piper no es válido: $($_.Exception.Message)"
}

Assert-HelpFlag $whisperServer '--port' 'WHISPER_BIN'
Assert-HelpFlag $llamaServer '--jinja' 'LLAMA_BIN'
Assert-HelpFlag $piperBinary '--output_raw' 'PIPER_BIN'
Assert-HelpFlag $rhubarbBinary '--recognizer' 'RHUBARB_BIN'

New-Item -ItemType Directory -Path (Join-Path $script:root 'local/bin') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $script:root 'local/models/whisper') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $script:root 'local/models/llm') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $script:root 'local/models/tts') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $script:root 'local/models/vad') -Force | Out-Null

$assets = @(
    (Install-Asset $whisperServer 'local/bin/whisper-server.exe' 'whisper-server'),
    (Install-Asset $llamaServer 'local/bin/llama-server.exe' 'llama-server'),
    (Install-Asset $piperBinary 'local/bin/piper.exe' 'piper'),
    (Install-Asset $rhubarbBinary 'local/bin/rhubarb.exe' 'rhubarb'),
    (Install-Asset $whisperModel 'local/models/whisper/ggml-model.bin' 'whisper-model'),
    (Install-Asset $gemmaModel 'local/models/llm/gemma-model.gguf' 'gemma-model'),
    (Install-Asset $piperModel 'local/models/tts/voice.onnx' 'piper-model'),
    (Install-Asset $piperConfig 'local/models/tts/voice.onnx.json' 'piper-config'),
    (Install-Asset $sileroModel 'local/models/vad/silero-vad.onnx' 'silero-vad-model')
)

$envLines = @(
    "WHISPER_BIN=$(ConvertTo-DotEnvValue (Join-Path $script:root 'local/bin/whisper-server.exe'))",
    "WHISPER_MODEL=$(ConvertTo-DotEnvValue (Join-Path $script:root 'local/models/whisper/ggml-model.bin'))",
    "LLAMA_BIN=$(ConvertTo-DotEnvValue (Join-Path $script:root 'local/bin/llama-server.exe'))",
    "LLAMA_MODEL=$(ConvertTo-DotEnvValue (Join-Path $script:root 'local/models/llm/gemma-model.gguf'))",
    "PIPER_BIN=$(ConvertTo-DotEnvValue (Join-Path $script:root 'local/bin/piper.exe'))",
    "PIPER_MODEL=$(ConvertTo-DotEnvValue (Join-Path $script:root 'local/models/tts/voice.onnx'))",
    "RHUBARB_BIN=$(ConvertTo-DotEnvValue (Join-Path $script:root 'local/bin/rhubarb.exe'))",
    "VAD_MODEL=$(ConvertTo-DotEnvValue (Join-Path $script:root 'local/models/vad/silero-vad.onnx'))"
)
$envPath = Join-Path $script:root '.env.local'
Write-ManagedFile $envPath (($envLines -join "`n") + "`n")

$lockPath = Join-Path $script:root 'local/asset-lock.json'
$lockContent = ($assets | ConvertTo-Json -Depth 4) + "`n"
Write-ManagedFile $lockPath $lockContent

Write-Output "Assets locales instalados en: $script:root"
Write-Output "Configuración generada: $envPath"
Write-Output "Inventario SHA-256: $lockPath"
