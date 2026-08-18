param(
  [string]$BaseUrl = "https://hoanlai.id.vn"
)

$ErrorActionPreference = "Stop"
$base = $BaseUrl.TrimEnd("/")
Add-Type -AssemblyName System.Net.Http
$client = [Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds(20)

try {
  $healthResponse = $client.GetAsync("$base/health").GetAwaiter().GetResult()
  $healthText = $healthResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  if (-not $healthResponse.IsSuccessStatusCode) { throw "Health returned HTTP $([int]$healthResponse.StatusCode)" }
  $health = $healthText | ConvertFrom-Json
  if (-not $health.ok -or $health.database -ne "healthy") { throw "D1 is unhealthy." }

  $homeHtml = $client.GetStringAsync("$base/").GetAwaiter().GetResult()
  if (-not $homeHtml.Contains("challenges.cloudflare.com/turnstile")) { throw "Home page is missing Turnstile." }
  if (-not $homeHtml.Contains("/api/create-link")) { throw "Home page is not the expected Hoan Lai build." }
  if (-not $homeHtml.Contains("/api/account/change-password")) { throw "User account security controls are missing." }
  if (-not $homeHtml.Contains("/api/account/data-requests")) { throw "Personal data request controls are missing." }
  if (-not $homeHtml.Contains("registrationConsent")) { throw "Versioned registration consent is missing." }
  if (-not $homeHtml.Contains("/api/auth/request-email-verification")) { throw "Email verification controls are missing." }

  $homeResponse = $client.GetAsync("$base/").GetAwaiter().GetResult()
  if (-not $homeResponse.Headers.Contains("Cross-Origin-Opener-Policy")) { throw "Home page is missing Cross-Origin-Opener-Policy." }
  if (-not $homeResponse.Headers.Contains("Cross-Origin-Resource-Policy")) { throw "Home page is missing Cross-Origin-Resource-Policy." }

  $admin = $client.GetStringAsync("$base/admin").GetAwaiter().GetResult()
  if (-not $admin.Contains("/api/admin/reconciliation")) { throw "Admin is missing reconciliation." }
  if (-not $admin.Contains("/api/admin/payouts/reveal")) { throw "Admin is missing protected account reveal." }
  if (-not $admin.Contains("/api/admin/launch-readiness")) { throw "Admin is missing commercial launch readiness." }
  if (-not $admin.Contains("/api/admin/test-alert")) { throw "Admin is missing operational alert testing." }

  $protected = $client.GetAsync("$base/api/admin/reconciliation").GetAwaiter().GetResult()
  if ([int]$protected.StatusCode -ne 401) { throw "Admin API did not reject an unauthenticated request." }

  $dataExport = $client.GetAsync("$base/api/account/export").GetAwaiter().GetResult()
  if ([int]$dataExport.StatusCode -ne 401) { throw "Personal data export did not reject an unauthenticated request." }

  $readiness = $client.GetAsync("$base/api/admin/launch-readiness").GetAwaiter().GetResult()
  if ([int]$readiness.StatusCode -ne 401) { throw "Launch readiness API did not reject an unauthenticated request." }

  $alertTest = $client.PostAsync("$base/api/admin/test-alert", [Net.Http.StringContent]::new("{}", [Text.Encoding]::UTF8, "application/json")).GetAwaiter().GetResult()
  if ([int]$alertTest.StatusCode -ne 401) { throw "Operational alert test API did not reject an unauthenticated request." }

  $verification = $client.PostAsync("$base/api/auth/request-email-verification", [Net.Http.StringContent]::new("{}", [Text.Encoding]::UTF8, "application/json")).GetAwaiter().GetResult()
  if ([int]$verification.StatusCode -ne 401) { throw "Email verification request API did not reject an unauthenticated request." }

  $invalidVerificationBody = '{"token":"invalid-verification-token-00000000000000000000"}'
  $invalidVerification = $client.PostAsync("$base/api/auth/verify-email", [Net.Http.StringContent]::new($invalidVerificationBody, [Text.Encoding]::UTF8, "application/json")).GetAwaiter().GetResult()
  if ([int]$invalidVerification.StatusCode -ne 400) { throw "Email verification API did not safely reject an invalid token." }

  [pscustomobject]@{
    ok = $true
    database = $health.database
    sync = $health.sync
    turnstileWidget = $true
    adminProtected = $true
    personalDataProtected = $true
    emailVerificationProtected = $true
    operationalAlertProtected = $true
    invalidEmailTokenRejected = $true
    checkedAt = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json
}
finally {
  $client.Dispose()
}
