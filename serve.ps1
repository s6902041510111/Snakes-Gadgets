# =========================================================
# serve.ps1 — เซิร์ฟเวอร์ไฟล์สถิตสำหรับทดสอบบน localhost
# ไม่ต้องติดตั้ง Node.js/Python: ใช้ .NET ในตัวของ Windows
#
# วิธีใช้:
#   powershell -ExecutionPolicy Bypass -File serve.ps1            (พอร์ต 8099)
#   powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 9000
#
# แล้วเปิด http://localhost:8099/ ในเบราว์เซอร์
# หมายเหตุ: แอปยังเปิดผ่าน file:// (ดับเบิลคลิก index.html) ได้ตามปกติ —
#           เซิร์ฟเวอร์นี้ช่วยให้ทดสอบ Browser API (BroadcastChannel/QR) ครบถ้วน
# =========================================================
param(
  [string]$Root = '',
  [int]$Port = 8099
)

$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = (Split-Path -Parent $MyInvocation.MyCommand.Path) }
$rootFull = (Resolve-Path -LiteralPath $Root).Path
Write-Host "Serving $rootFull on http://localhost:$Port/" -ForegroundColor Cyan

$mimes = @{
  '.html'  = 'text/html; charset=utf-8'
  '.js'    = 'text/javascript; charset=utf-8'
  '.mjs'   = 'text/javascript; charset=utf-8'
  '.css'   = 'text/css; charset=utf-8'
  '.json'  = 'application/json; charset=utf-8'
  '.svg'   = 'image/svg+xml'
  '.png'   = 'image/png'
  '.jpg'   = 'image/jpeg'
  '.ico'   = 'image/x-icon'
  '.woff2' = 'font/woff2'
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

function Send-Response($stream, [int]$status, [string]$statusText, [string]$contentType, [byte[]]$body) {
  $head = "HTTP/1.1 $status $statusText`r`n" +
          "Content-Type: $contentType`r`n" +
          "Content-Length: $($body.Length)`r`n" +
          "Cache-Control: no-store, no-cache, must-revalidate`r`n" +
          "Connection: close`r`n`r`n"
  $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($headBytes, 0, $headBytes.Length)
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
      $requestLine = $reader.ReadLine()
      if (-not $requestLine) { $client.Close(); continue }
      $parts = $requestLine.Split(' ')
      $rawPath = if ($parts.Count -ge 2) { $parts[1] } else { '/' }
      while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq '') { break }
      }
      $path = [System.Uri]::UnescapeDataString(($rawPath -split '\?')[0])
      $path = $path.TrimStart('/')
      if ($path -eq '') { $path = 'index.html' }
      $full = Join-Path $rootFull $path
      if (Test-Path -LiteralPath $full -PathType Container) { $full = Join-Path $full 'index.html' }
      if ((Test-Path -LiteralPath $full -PathType Leaf) -and $full.StartsWith($rootFull)) {
        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        $ct = if ($mimes.ContainsKey($ext)) { $mimes[$ext] } else { 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($full)
        Send-Response $stream 200 'OK' $ct $bytes
      } else {
        $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
        Send-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' $body
      }
    } catch {
      try {
        $body = [System.Text.Encoding]::UTF8.GetBytes("500 Error: $($_.Exception.Message)")
        Send-Response $stream 500 'Internal Server Error' 'text/plain; charset=utf-8' $body
      } catch { }
    } finally {
      try { $client.Close() } catch { }
    }
  }
} finally {
  try { $listener.Stop() } catch { }
}