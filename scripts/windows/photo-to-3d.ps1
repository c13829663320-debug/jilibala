<#
.SYNOPSIS
  photo-to-3d.ps1 — Windows 端「照片 → 全身 3D GLB」流水线脚本（叽里呱啦 3D 流水线分片1）。

.DESCRIPTION
  流程：
    1) 校验输入照片（存在 / 格式 / 大小 ≤ 20MB）。
    2) 上传照片到 Tripo3D 云端（POST /upload/sts）。
    3) 创建 image_to_model 任务（POST /task）并轮询直到成功/失败。
    4) 下载生成的 PBR GLB 到本地输出目录。
    5) 调用本仓库 validate-glb.mjs 做本地导入校验（结构/骨骼/PBR/贴图/三角面）。
       校验不通过则以非零退出码失败，绝不把脏模型当成功产物。

  ★ 硬约束：本脚本不伪造任何云端成功结果。
    - 未设置 TRIPO_API_KEY → 立即报错退出（不生成假模型）。
    - Tripo 不可达 / 任务失败 / 超时 → 如实报错并退出。
    - 想在无云端环境调试，请看仓库 docs/avatar-glb-binding-spec.md 的「离线占位」一节，
      或直接用 usePlaceholder 走服务端 local-fallback 降级，而不是改本脚本。

.REQUIREMENTS
  - Windows 10/11 PowerShell 5.1 或 PowerShell 7+。
  - Node.js >= 18（用于跑 validate-glb.mjs；若未安装会跳过校验并给出警告，但仍会完成下载）。
  - 网络可访问 https://api.tripo3d.ai （或公司代理；可用 -Proxy 参数）。

.ENVIRONMENT
  TRIPO_API_KEY        必填。Tripo3D 密钥（服务端持有，切勿提交到 git）。
  TRIPO_API_BASE_URL   可选，默认 https://api.tripo3d.ai/v2/openapi。

.PARAMETER PhotoPath
  输入照片（jpg/png/webp）。建议：正面、全身、纯色背景。

.PARAMETER OutDir
  输出目录，默认 .\generated。产物：model.glb + validation-report.json。

.PARAMETER TaskId
  可选。若已有 Tripo 任务号，跳过「上传+建任务」直接轮询/下载。

.PARAMETER Proxy
  可选。HTTP 代理，如 http://127.0.0.1:12450。

.PARAMETER FaceLimit
  可选。人脸数上限，默认 1（单人肖像）。

.EXAMPLE
  # 在仓库根目录（scripts/windows/ 的上两级）打开 PowerShell：
  $env:TRIPO_API_KEY="sk-xxxx"
  powershell -ExecutionPolicy Bypass -File scripts\windows\photo-to-3d.ps1 -PhotoPath .\my-photo.jpg -OutDir .\generated
#>
param(
  [Parameter(Mandatory = $true)][string]$PhotoPath,
  [string]$OutDir = ".\generated",
  [string]$TaskId = "",
  [string]$Proxy = "",
  [int]$FaceLimit = 1
)

$ErrorActionPreference = "Stop"
$BaseUrl = ($env:TRIPO_API_BASE_URL ?? "https://api.tripo3d.ai/v2/openapi").TrimEnd('/')
$PollIntervalSec = 5
$MaxWaitMin = 20

function Fail($msg, [int]$code = 1) {
  Write-Host "[photo-to-3d] ERROR: $msg" -ForegroundColor Red
  exit $code
}

# ---- 0. 前置检查 -----------------------------------------------------------
if (-not $env:TRIPO_API_KEY -or $env:TRIPO_API_KEY.Trim() -eq "") {
  Fail "未设置环境变量 TRIPO_API_KEY。云端 Tripo 不可用时请勿伪造结果；请配置密钥后重试，或走服务端 usePlaceholder 降级。" 2
}
$key = $env:TRIPO_API_KEY.Trim()

if (-not (Test-Path $PhotoPath)) { Fail "照片不存在: $PhotoPath" 2 }
$photoItem = Get-Item $PhotoPath
if ($photoItem.Length -gt 20MB) { Fail "照片超过 20MB（Tripo 上限）：$([math]::Round($photoItem.Length/1MB,1))MB" 2 }
$ext = $photoItem.Extension.ToLower()
if (@(".jpg", ".jpeg", ".png", ".webp") -notcontains $ext) { Fail "仅支持 jpg/png/webp，收到 $ext" 2 }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$glbOut = Join-Path $OutDir "model.glb"

# 构造 Invoke-RestMethod 参数（含可选代理）
function New-Headers {
  return @{ Authorization = "Bearer $key" }
}
$irmParams = @{ TimeoutSec = 60 }
if ($Proxy -ne "") { $irmParams["Proxy"] = $Proxy }

# ---- 1. 上传 + 建任务（若未给 TaskId） -------------------------------------
if ($TaskId -eq "") {
  Write-Host "[1/5] 上传照片到 Tripo ..." -ForegroundColor Cyan
  $uploadPath = Join-Path $env:TEMP ("tripo-upload-" + [guid]::NewGuid().ToString("N") + $ext)
  Copy-Item $PhotoPath $uploadPath
  try {
    $uploadResp = Invoke-RestMethod -Uri "$BaseUrl/upload/sts" -Method Post -Headers (New-Headers) -Form @{
      file = Get-Item $uploadPath
    } @irmParams
  } catch {
    Remove-Item $uploadPath -ErrorAction SilentlyContinue
    Fail "上传失败：$($_.Exception.Message)"
  }
  Remove-Item $uploadPath -ErrorAction SilentlyContinue
  $fileToken = $uploadResp.data.image_token ?? $uploadResp.data.file_token
  if (-not $fileToken) { Fail "上传成功但未返回 image_token：$($uploadResp | ConvertTo-Json -Depth 5)" }
  Write-Host "      image_token = $fileToken"

  Write-Host "[2/5] 创建 image_to_model 任务 ..." -ForegroundColor Cyan
  $createBody = @{
    type = "image_to_model"
    file = @{ type = "image"; file_token = $fileToken }
    face_limit = $FaceLimit
  } | ConvertTo-Json -Depth 5
  try {
    $createResp = Invoke-RestMethod -Uri "$BaseUrl/task" -Method Post -Headers (New-Headers) -ContentType "application/json" -Body $createBody @irmParams
  } catch {
    Fail "创建任务失败：$($_.Exception.Message)"
  }
  $TaskId = $createResp.data.task_id
  if (-not $TaskId) { Fail "未返回 task_id：$($createResp | ConvertTo-Json -Depth 5)" }
}
Write-Host "      task_id = $TaskId"

# ---- 2. 轮询任务 -----------------------------------------------------------
Write-Host "[3/5] 轮询任务（最多 $MaxWaitMin 分钟）..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes($MaxWaitMin)
$task = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds $PollIntervalSec
  try {
    $resp = Invoke-RestMethod -Uri "$BaseUrl/task/$TaskId" -Headers (New-Headers) @irmParams
  } catch {
    Write-Host "      轮询出错（重试中）：$($_.Exception.Message)" -ForegroundColor Yellow
    continue
  }
  $task = $resp.data
  $status = $task.status
  $prog = if ($task.progress) { $task.progress } else { 0 }
  Write-Host ("      status={0} progress={1}%" -f $status, $prog)
  if ($status -eq "success") { break }
  if (@("failed", "banned", "expired", "cancelled", "unknown") -contains $status) {
    Fail "Tripo 任务终态=$status，未生成模型（不伪造结果）。输出：$($task | ConvertTo-Json -Depth 5)"
  }
}
if (-not $task -or $task.status -ne "success") {
  Fail "轮询超时（$MaxWaitMin 分钟），任务未完成。"
}

# ---- 3. 下载 GLB -----------------------------------------------------------
Write-Host "[4/5] 下载生成的 GLB ..." -ForegroundColor Cyan
$assetUrl = $task.output.pbr_model ?? $task.output.model ?? $task.output.base_model ?? $task.output.url
if (-not $assetUrl) { Fail "任务成功但 output 中无模型 URL：$($task.output | ConvertTo-Json -Depth 5)" }
try {
  Invoke-WebRequest -Uri $assetUrl -OutFile $glbOut @irmParams
} catch {
  Fail "模型下载失败：$($_.Exception.Message)"
}
Write-Host "      已保存: $glbOut ($([math]::Round((Get-Item $glbOut).Length/1KB)) KB)"
Write-Host "      注意：Tripo 下载链接约 5 分钟过期，请尽快下载/校验。"

# ---- 4. 本地 GLB 导入校验 --------------------------------------------------
Write-Host "[5/5] 本地 GLB 校验 ..." -ForegroundColor Cyan
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$validator = Join-Path $repoRoot "scripts\windows\validate-glb.mjs"
$reportOut = Join-Path $OutDir "validation-report.json"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host "      未找到 node.exe：跳过本地校验。请安装 Node.js 后手动运行：" -ForegroundColor Yellow
  Write-Host "      node scripts\windows\validate-glb.mjs `"$glbOut`" --pretty" -ForegroundColor Yellow
  exit 0
}
& node $validator $glbOut --pretty
if ($LASTEXITCODE -ne 0) {
  Fail "GLB 未通过导入校验（见上方报告）。请按 docs/avatar-glb-binding-spec.md 修正后重跑。" $LASTEXITCODE
}
& node $validator $glbOut | Out-File -Encoding utf8 $reportOut
Write-Host "      校验通过。报告已存: $reportOut" -ForegroundColor Green
Write-Host "`n完成。下一步：把 $glbOut 放到 apps/web/public/models/ 或通过 POST /api/custom-characters/finalize 入库。" -ForegroundColor Green
