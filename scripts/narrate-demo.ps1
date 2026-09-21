param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '../docs/video/render')
)
$ErrorActionPreference = 'Stop'
$scenes = Get-Content (Join-Path $PSScriptRoot '../docs/video/storyboard.json') -Raw | ConvertFrom-Json
$null = New-Item -ItemType Directory -Force -Path $OutputDirectory
$speaker = New-Object -ComObject SAPI.SpVoice
$voices = $speaker.GetVoices()
for ($index = 0; $index -lt $voices.Count; $index++) {
  if ($voices.Item($index).GetDescription() -match 'David') {
    $speaker.Voice = $voices.Item($index)
    break
  }
}
$speaker.Rate = 0
$speaker.Volume = 100
foreach ($scene in $scenes) {
  $stream = New-Object -ComObject SAPI.SpFileStream
  $stream.Format.Type = 22
  $path = [IO.Path]::GetFullPath((Join-Path $OutputDirectory "$($scene.id).wav"))
  $stream.Open($path, 3, $false)
  try {
    $speaker.AudioOutputStream = $stream
    $null = $speaker.Speak($scene.narration)
  } finally {
    $stream.Close()
  }
  Write-Output "$($scene.id): $path"
}