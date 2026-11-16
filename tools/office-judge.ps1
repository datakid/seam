param(
    [string]$InputDir,
    [string]$OutputFile,
    [int]$TimeoutSeconds = 60,
    [string]$Single
)

$missing = [System.Reflection.Missing]::Value

function Open-One([string]$path) {
    $ext = [System.IO.Path]::GetExtension($path).TrimStart('.').ToLowerInvariant()
    if ($ext -match '^(docx|docm|dotx|dotm)$') {
        $app = New-Object -ComObject Word.Application
        $app.DisplayAlerts = 0
        try {
            $doc = $app.Documents.Open([ref]$path, [ref]$false, [ref]$true, [ref]$false, [ref]$missing, [ref]$missing, [ref]$missing, [ref]$missing, [ref]$missing, [ref]$missing, [ref]$missing, [ref]$false, [ref]$false)
            $doc.Close([ref]$false)
        } finally { $app.Quit() }
    } elseif ($ext -match '^(xlsx|xlsm|xltx|xltm)$') {
        $app = New-Object -ComObject Excel.Application
        $app.DisplayAlerts = $false
        try {
            $book = $app.Workbooks.Open($path, 0, $true, $missing, $missing, $missing, $true, $missing, $missing, $missing, $missing, $missing, $false, $missing, 0)
            $book.Close($false)
        } finally { $app.Quit() }
    } elseif ($ext -match '^(pptx|pptm|potx|potm|ppsx|ppsm)$') {
        $app = New-Object -ComObject PowerPoint.Application
        try {
            $deck = $app.Presentations.Open($path, -1, 0, 0)
            $deck.Close()
        } finally { $app.Quit() }
    } else {
        throw "unsupported extension $ext"
    }
}

if ($Single) {
    try {
        Open-One $Single
        Write-Output '{"verdict":"open"}'
    } catch {
        $message = ($_.Exception.Message -replace '[\r\n"\\]', ' ')
        Write-Output ('{"verdict":"fail","message":"' + $message + '"}')
    }
    exit 0
}

$results = [ordered]@{}
foreach ($file in Get-ChildItem -Path $InputDir -File | Sort-Object Name) {
    $id = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    $out = [System.IO.Path]::GetTempFileName()
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-File', $PSCommandPath, '-Single', $file.FullName) -RedirectStandardOutput $out -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill()
        Get-Process -Name WINWORD, EXCEL, POWERPNT -ErrorAction SilentlyContinue | Stop-Process -Force
        $results[$id] = @{ verdict = 'timeout' }
    } else {
        $text = (Get-Content -Raw $out)
        try { $results[$id] = ($text | ConvertFrom-Json) } catch { $results[$id] = @{ verdict = 'fail'; message = 'no output' } }
    }
    Remove-Item $out -ErrorAction SilentlyContinue
}
$results | ConvertTo-Json -Depth 4 | Set-Content -Path $OutputFile -Encoding UTF8
