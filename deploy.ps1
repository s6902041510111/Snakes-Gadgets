# =========================================================
# deploy.ps1 — Deploy บันไดงูไอที ขึ้น Vercel (static, ไม่ต้อง build)
#
# ข้อกำหนด: ต้องมี Node.js เฉพาะตอน deploy เท่านั้น
#           (ตัวแอปเวลานำไปใช้จริง ยังเปิดแบบ double-click ได้ ไม่ต้องใช้ Node)
#   ดาวน์โหลด Node.js LTS: https://nodejs.org  -> ลง Next > Next
#
# วิธีใช้ (เปิด PowerShell ในโฟลเดอร์นี้ แล้วรัน):
#   powershell -ExecutionPolicy Bypass -File deploy.ps1            # ขึ้น production
#   powershell -ExecutionPolicy Bypass -File deploy.ps1 -Preview   # ขึ้น preview เท่านั้น
#
# ครั้งแรก: เบราว์เซอร์จะเปิดให้ล็อกอิน Vercel (สมัครฟรี: GitHub/Google/email)
# สำเร็จแล้วสคริปต์จะโชว์ URL เช่น https://it-snake-ladder-class.vercel.app/
# =========================================================
param(
  [switch]$Preview,
  [string]$Root = ''
)

$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = (Split-Path -Parent $MyInvocation.MyCommand.Path) }
$rootFull = (Resolve-Path -LiteralPath $Root).Path

Write-Host ""
Write-Host "=== Deploy บันไดงูไอที ขึ้น Vercel ===" -ForegroundColor Cyan
Write-Host "โฟลเดอร์: $rootFull"

# 1) เช็ค Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host ""
  Write-Host "[X] ยังไม่พบ Node.js บนเครื่อง (ต้องติดตั้งครั้งเดียว เท่านั้น)" -ForegroundColor Red
  Write-Host "    1) เปิด https://nodejs.org ดาวน์โหลดเวอร์ชัน LTS" -ForegroundColor Yellow
  Write-Host "    2) ดับเบิลคลิกติดตั้ง -> Next > Next > Install" -ForegroundColor Yellow
  Write-Host "    3) เปิด PowerShell ใหม่ แล้วรันสคริปต์นี้อีกครั้ง" -ForegroundColor Yellow
  try { Start-Process "https://nodejs.org" } catch { }
  exit 1
}
Write-Host "[OK] พบ Node.js: $(node --version)" -ForegroundColor Green

# 2) รัน vercel ผ่าน npx (ไม่ต้องติดตั้ง vercel แบบ global)
Write-Host ""
if ($Preview) {
  Write-Host "โหมด: PREVIEW (ยังไม่ขึ้น production)" -ForegroundColor Magenta
  & npx -y vercel "$rootFull" --yes
} else {
  Write-Host "โหมด: PRODUCTION (ขึ้นเว็บใช้งานจริง)" -ForegroundColor Magenta
  & npx -y vercel "$rootFull" --prod --yes
}
$code = $LASTEXITCODE
Write-Host ""
if ($code -eq 0) {
  Write-Host "✅ Deploy สำเร็จ! เปิด URL ที่แสดงด้านบนได้เลย" -ForegroundColor Green
  Write-Host "   ถ้าแก้ไฟล์ทีหลัง รันคำสั่งเดิมอีกครั้งเพื่ออัปเดต (deploy ใหม่)" -ForegroundColor Green
} else {
  Write-Host "⚠️ Deploy ไม่สำเร็จ (exit code $code)" -ForegroundColor Yellow
  Write-Host "   แก้ได้โดยล็อกอินใหม่: npx vercel login แล้วรันใหม่" -ForegroundColor Yellow
}
exit $code