$ErrorActionPreference = "Stop"

$secureToken = Read-Host "Nhap Cloudflare Turnstile API token MOI" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
$tokenPath = Join-Path $env:USERPROFILE ".cf-turnstile-token"

try {
    $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($plainToken)) {
        throw "Token khong duoc de trong."
    }

    [IO.File]::WriteAllText($tokenPath, $plainToken, [Text.UTF8Encoding]::new($false))
    & icacls.exe $tokenPath /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Remove-Item -LiteralPath $tokenPath -Force -ErrorAction SilentlyContinue
        throw "Khong the gioi han quyen truy cap file token."
    }

    Write-Host "Da luu token vao file tam chi danh cho tai khoan Windows hien tai." -ForegroundColor Green
}
finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    Remove-Variable plainToken -ErrorAction SilentlyContinue
    Remove-Variable secureToken -ErrorAction SilentlyContinue
}
