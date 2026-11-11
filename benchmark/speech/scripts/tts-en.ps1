# Renders the synthetic English benchmark texts with the local Windows TTS voices (System.Speech).
# Output: 16 kHz, 16-bit, mono WAV + tts-manifest.json with the exact generation parameters.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File benchmark/speech/scripts/tts-en.ps1
#
# Offline, no downloads. Only voices already installed on Windows are used.
param(
  [string]$Texts = "benchmark/speech/references/synthetic-en-texts.json",
  [string]$OutDir = "benchmark/speech/audio/synthetic-en/tts"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$spec = Get-Content -Raw -Encoding UTF8 $Texts | ConvertFrom-Json
New-Item -ItemType Directory -Force $OutDir | Out-Null
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$voices = @('Microsoft Zira Desktop', 'Microsoft David Desktop')
$installed = (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
foreach ($v in $voices) { if ($installed -notcontains $v) { throw "Voice not installed: $v" } }

$items = @()
function Render($text, $voice, $rate, $file) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice($voice)
  $synth.Rate = $rate
  $synth.Volume = 100
  $synth.SetOutputToWaveFile($file, $format)
  $synth.Speak($text)
  $synth.SetOutputToNull()
  $synth.Dispose()
}
foreach ($t in $spec.texts) {
  foreach ($voice in $voices) {
    $short = if ($voice -like '*Zira*') { 'zira' } else { 'david' }
    $file = Join-Path $OutDir "$($t.id)-$short-r0.wav"
    Render $t.text $voice 0 $file
    $items += [pscustomobject]@{ textId = $t.id; voice = $voice; rate = 0; file = $file }
  }
}
# Fast speech: rate +5 (System.Speech range is -10..10), alternating voices.
$i = 0
foreach ($id in $spec.fast) {
  $t = $spec.texts | Where-Object { $_.id -eq $id }
  $voice = $voices[$i % 2]; $i++
  $short = if ($voice -like '*Zira*') { 'zira' } else { 'david' }
  $file = Join-Path $OutDir "$id-$short-r5.wav"
  Render $t.text $voice 5 $file
  $items += [pscustomobject]@{ textId = $id; voice = $voice; rate = 5; file = $file }
}
$os = Get-CimInstance Win32_OperatingSystem
[pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  engine = 'System.Speech.Synthesis.SpeechSynthesizer (Windows SAPI 5)'
  os = "$($os.Caption) $($os.Version)"
  format = '16000 Hz, 16-bit PCM, mono'
  volume = 100
  items = $items
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $OutDir 'tts-manifest.json')
Write-Output "Rendered $($items.Count) files into $OutDir"
