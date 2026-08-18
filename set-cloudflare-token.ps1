$ErrorActionPreference = "Stop"

$secureToken = Read-Host "Nhap Cloudflare API token MOI" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)

try {
    $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($plainToken)) {
        throw "Token khong duoc de trong."
    }

    [Environment]::SetEnvironmentVariable("CLOUDFLARE_API_TOKEN", $plainToken, "User")
    Write-Host "Da luu CLOUDFLARE_API_TOKEN. Hay dong hoan toan VS Code roi mo lai." -ForegroundColor Green
}
finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    Remove-Variable plainToken -ErrorAction SilentlyContinue
    Remove-Variable secureToken -ErrorAction SilentlyContinue
}
