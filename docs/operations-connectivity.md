# BetterP operations connectivity

This document is the first file to read when a new Codex session needs to operate BetterP infrastructure.

It intentionally does not contain secret values. Keep tokens, passwords, API keys and connection strings in Windows User environment variables, Render env vars, Cloudflare, Neon or the provider dashboard.

## Local operator variables

These variables allow Codex/PowerShell to connect to the infrastructure providers.

| Variable | Required for | Where to create/get it | Notes |
| --- | --- | --- | --- |
| `RENDER_API_KEY` | Render service/env/deploy API | Render dashboard, Account Settings, API Keys | Token should be rotated if pasted in chat. |
| `NEON_API_KEY` | Neon project/database API | Neon console, Account Settings, API Keys | Token should be rotated if pasted in chat. |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Pages and DNS API | Cloudflare dashboard, API Tokens | Needs `Account > Cloudflare Pages > Edit`, `Zone > DNS > Edit`, `Zone > Zone > Read`. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account operations | Cloudflare dashboard account overview | Current account ID is listed below. |
| `CLOUDFLARE_ZONE_ID` | DNS operations for `betterp.net` | Cloudflare zone overview | Current zone ID is listed below. |
| `BETTERP_TIENDA_FACIL_INTERNAL_TOKEN` | Shared BetterP to Tienda Facil bridge | Locally generated random token | Same value must be configured in BetterP and Tienda Facil Render services. |

Verify local availability:

```powershell
"RENDER_API_KEY","NEON_API_KEY","CLOUDFLARE_API_TOKEN","CLOUDFLARE_ACCOUNT_ID","CLOUDFLARE_ZONE_ID","BETTERP_TIENDA_FACIL_INTERNAL_TOKEN" | ForEach-Object {
  $value = [Environment]::GetEnvironmentVariable($_, "User")
  if ([string]::IsNullOrWhiteSpace($value)) { "$_=MISSING" } else { "$_=SET" }
}
```

Save a value directly:

```powershell
function Save-UserEnvValue {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][string]$Value
  )

  $clean = $Value.Trim()
  if ([string]::IsNullOrWhiteSpace($clean)) { "$Name=EMPTY_NOT_SAVED"; return }

  [Environment]::SetEnvironmentVariable($Name, $clean, "User")
  [Environment]::SetEnvironmentVariable($Name, $clean, "Process")
  "$Name=SET length=$($clean.Length)"
}
```

GitHub CLI:

```powershell
gh auth status
gh auth refresh -h github.com -s workflow
```

## GitHub repositories

| Solution | Repo | Branch used in production |
| --- | --- | --- |
| BetterP / Renta Facil / backoffice | `https://github.com/pepernillo/bettERP` | `main` |
| Vende Facil / PIM | `https://github.com/pepernillo/pim-system-v3` | Render currently tracks `codex/render-production-readiness`; repo also has `main`. |
| Tienda Facil | `https://github.com/pepernillo/tienda-facil` | `main` |

## Render

Shared Render owner/workspace:

- Owner ID: `tea-d7gsfh6gvqtc73ep17h0`
- Main environment ID: `evm-d7gsgtugvqtc73ep1p70`
- Default backend region in current services: `virginia`

Current Render services:

| Name | ID | Type | Repo | Branch | Root | Plan | URL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bettERP` | `srv-d7gsgu28qa3s73cosklg` | web | `pepernillo/bettERP` | `main` | `backend` | `free` | `https://betterp.onrender.com` |
| `bettERP` | `crn-d87l768jo6nc73bb51jg` | cron | `pepernillo/bettERP` | `main` | `backend` | `starter` | n/a |
| `bettERP-1` | `srv-d7gtdj8sfn5c73e2g0f0` | web | `pepernillo/bettERP` | `main` | `backend` | `free` | `https://betterp-1.onrender.com` |
| `betterp-api-demo` | `srv-d7pga29kh4rs73e627j0` | web | `pepernillo/bettERP` | `main` | `backend` | `free` | `https://betterp-api-demo.onrender.com` |
| `betterp-backoffice-mkt-publish` | `crn-d8rr7tb7uimc73fj3h4g` | cron | `pepernillo/bettERP` | `main` | `backend` | `starter` | n/a |
| `betterp-backoffice-mkt-metrics` | `crn-d9agp181juns739rjjbg` | cron | `pepernillo/bettERP` | `main` | `backend` | `starter` | n/a |
| `betterp-backoffice-mkt-weekly-close` | `crn-d9agp581juns73cf5gsg` | cron | `pepernillo/bettERP` | `main` | `backend` | `starter` | n/a |
| `betterp-payment-reminders-lab` | `crn-d8qa7mnavr4c73878nmg` | cron | `pepernillo/bettERP` | `main` | `backend` | `starter` | n/a |
| `pim-system-v3` | `srv-d8c7hfl8nd3s7398fqdg` | web | `pepernillo/pim-system-v3` | `codex/render-production-readiness` | `backend` | `free` | `https://pim-system-v3.onrender.com` |
| `tienda-facil-api` | `srv-d8svmvvlk1mc73ag4qog` | web | `pepernillo/tienda-facil` | `main` | `backend` | `free` | `https://tienda-facil-api.onrender.com` |

Tienda Facil Render:

- Service name: `tienda-facil-api`
- Service ID: `srv-d8svmvvlk1mc73ag4qog`
- Repo: `https://github.com/pepernillo/tienda-facil`
- Branch: `main`
- Root: `backend`
- Plan: `free`
- Region: `virginia`
- Health check: `/health/`
- Custom API domain target: `api-tiendafacil.betterp.net`
- Render URL: `https://tienda-facil-api.onrender.com`
- Status: live.
- Custom domain status: verified in Render as `cdm-d8svo8beo5us73d5nlbg`.

### Render env var names by service

Do not document the values here.

BetterP production backend `srv-d7gsgu28qa3s73cosklg`:

```text
ALLOWED_HOSTS
APP_ENV
AUTO_MIGRATE_ON_STARTUP
BACKEND_PUBLIC_BASE_URL
BETTERP_EMAIL_LOGO_URL
BETTERP_LEGAL_NAME
BETTERP_MARKETING_BASE_URL
BETTERP_SALES_NOTIFY_EMAIL
CACHE_KEY_PREFIX
CORS_ALLOW_ALL_ORIGINS
CORS_ALLOWED_ORIGINS
CSRF_COOKIE_SECURE
CSRF_TRUSTED_ORIGINS
DATABASE_URL
DEFAULT_FROM_EMAIL
DEMO_MODE
DISABLE_OUTBOUND_INTEGRATIONS
FACTURACION_ENCRYPTION_KEY
FACTURAMA_SANDBOX_BASE_URL
FACTURAMA_SANDBOX_PASSWORD
FACTURAMA_SANDBOX_USERNAME
FRONTEND_BASE_URL
GOOGLE_CLIENT_ID
GOOGLE_VISION_API_KEY
INBOUND_EMAIL_IMAP_BATCH_SIZE
INBOUND_EMAIL_IMAP_ENABLED
INBOUND_EMAIL_IMAP_FOLDER
INBOUND_EMAIL_IMAP_HOST
INBOUND_EMAIL_IMAP_PASSWORD
INBOUND_EMAIL_IMAP_PORT
INBOUND_EMAIL_IMAP_USE_SSL
INBOUND_EMAIL_IMAP_USERNAME
LOCK_TENANT_MESSAGE_TEMPLATES
MARKETING_INSTAGRAM_CLIENT_ID
MARKETING_INSTAGRAM_CLIENT_SECRET
MARKETING_INSTAGRAM_REDIRECT_URI
MARKETING_META_REDIRECT_URI
MERCADO_LIBRE_CLIENT_ID
MERCADO_LIBRE_CLIENT_SECRET
MERCADO_LIBRE_REDIRECT_URI
MERCADO_LIBRE_WEBHOOK_SECRET
META_APP_ID
META_APP_SECRET
META_CLIENT_ID
META_CLIENT_SECRET
META_REDIRECT_URI
OPENAI_API_KEY
OPENAI_RENTAL_COPY_MODEL
OUTBOUND_WHATSAPP_ALLOWED_NUMBERS
R2_ACCESS_KEY_ID
R2_ENDPOINT_URL
R2_PUBLIC_DOMAIN
R2_SECRET_ACCESS_KEY
REDIS_IGNORE_EXCEPTIONS
REDIS_URL
RENTA_ESPACIOS_SYNC_TOKEN
REQUIRE_WHATSAPP_SHARED_NUMBER_AGREEMENT
RESEND_API_KEY
RESEND_FROM_EMAIL
RESEND_FROM_NAME
RESEND_REPLY_TO
RESEND_VERIFIED_DOMAIN
RESEND_WEBHOOK_SECRET
SECRET_KEY
SECURE_HSTS_PRELOAD
SECURE_HSTS_SECONDS
SECURE_SSL_REDIRECT
SESSION_COOKIE_SECURE
STRIPE_LIVE_WEBHOOK_SECRET
STRIPE_TEST_SECRET_KEY
STRIPE_TEST_WEBHOOK_SECRET
VENDE_FACIL_INTERNAL_API_TOKEN
WHATSAPP_CLOUD_API_BASE_URL
WHATSAPP_CLOUD_API_VERSION
WHATSAPP_META_APP_ID
WHATSAPP_META_APP_SECRET
WHATSAPP_WEBHOOK_VERIFY_TOKEN
```

Vende Facil backend `srv-d8c7hfl8nd3s7398fqdg`:

```text
ALLOWED_HOSTS
AMAZON_SP_API_CLIENT_ID
AMAZON_SP_API_CLIENT_SECRET
AMAZON_SP_API_ENDPOINT
AMAZON_SP_API_MARKETPLACE_ID
AMAZON_SP_API_REGION
AMAZON_SP_API_SANDBOX_ENDPOINT
AMAZON_SP_API_USER_AGENT
ASSETS_PUBLIC_BASE_URL
AWS_ACCESS_KEY_ID
AWS_S3_ENDPOINT_URL
AWS_S3_REGION_NAME
AWS_S3_SIGNATURE_VERSION
AWS_SECRET_ACCESS_KEY
AWS_STORAGE_BUCKET_NAME
BETTERP_API_BASE_URL
BETTERP_VENDE_FACIL_INTERNAL_TOKEN
CORS_ALLOWED_ORIGINS
CSRF_TRUSTED_ORIGINS
DATABASE_URL
DEBUG
FRONTEND_URL
GOOGLE_API_KEY
ML_APP_ID
ML_CLIENT_SECRET
ML_REDIRECT_URI
ML_SITE_ID
SECRET_KEY
```

Tienda Facil backend target:

```text
PYTHON_VERSION
SECRET_KEY
DEBUG
DATABASE_URL
ALLOWED_HOSTS
CORS_ALLOWED_ORIGINS
CSRF_TRUSTED_ORIGINS
BETTERP_API_BASE_URL
BETTERP_TIENDA_FACIL_INTERNAL_TOKEN
BETTERP_CAPA_ACCOUNT_PREFIX
```

## Cloudflare

Current Cloudflare account and zone:

- Account ID: `b726be184d2a8dadbfd3cac8d2921131`
- Account name: `01.agodinez@gmail.com's Account`
- Zone: `betterp.net`
- Zone ID: `34fadfd8f8c105f10e78125349b4010c`

Pages projects:

| Project | ID | Subdomain | Production branch |
| --- | --- | --- | --- |
| `betterp` | `2a65695e-71ed-4b0d-9236-d4f06891fe38` | `betterp.pages.dev` | `main` |
| `betterp-demo` | `664e7f9d-5014-4ca1-b8fe-f4eb67df332f` | `betterp-demo.pages.dev` | `main` |
| `tienda-facil` | `28daa33d-91ab-475a-9119-d79a0d873e3b` | `tienda-facil.pages.dev` | `main` |
| `vendefacil` | `25dea9ed-ede0-42d4-8091-b73d3e9ba48f` | `vendefacil.pages.dev` | `codex/render-production-readiness` |

Tienda Facil Cloudflare target:

- Pages project: `tienda-facil`
- Pages project ID: `28daa33d-91ab-475a-9119-d79a0d873e3b`
- Production branch: `main`
- Web domain: `tiendafacil.betterp.net`
- Pages URL: `https://tienda-facil.pages.dev`
- Custom domain: `https://tiendafacil.betterp.net`
- Status: deployed successfully; custom web domain is active.

Relevant DNS records:

| Name | Type | Target |
| --- | --- | --- |
| `betterp.net` | CNAME | `betterp.pages.dev` |
| `app.betterp.net` | CNAME | `betterp.pages.dev` |
| `api.betterp.net` | CNAME | `betterp.onrender.com` |
| `demo.betterp.net` | CNAME | `betterp-demo.pages.dev` |
| `vendefacil.betterp.net` | CNAME | `vendefacil.pages.dev` |
| `api-vendefacil.betterp.net` | CNAME | `pim-system-v3.onrender.com` |
| `assets-vendefacil.betterp.net` | CNAME | `public.r2.dev` |
| `tiendafacil.betterp.net` | CNAME | `tienda-facil.pages.dev` |
| `api-tiendafacil.betterp.net` | CNAME | `tienda-facil-api.onrender.com` |

Tienda Facil DNS records:

```text
tiendafacil.betterp.net      CNAME tienda-facil.pages.dev
api-tiendafacil.betterp.net  CNAME tienda-facil-api.onrender.com
```

## Neon

Current Neon organization:

- Org name: `B Retro Games`
- Org ID: `org-rough-pine-77061144`
- Default region used for active projects: `aws-us-east-1`
- Postgres version: `17`

Projects:

| Project | Project ID | Region | Notes |
| --- | --- | --- | --- |
| `demo.betterp.net` | `polished-frost-24570041` | `aws-us-east-1` | BetterP demo DB candidate. Confirm through Render `DATABASE_URL` before destructive work. |
| `pim-v3-prod` | `little-shape-41809458` | `aws-us-east-1` | Existing production DB candidate. Confirm through Render `DATABASE_URL` before destructive work. |
| `vendefacil-production` | `broad-wave-74382764` | `aws-us-east-1` | Vende Facil production DB candidate. Confirm through Render `DATABASE_URL` before destructive work. |
| `tienda-facil` | `billowing-waterfall-59578791` | `aws-us-east-1` | Created for Tienda Facil. DB `tienda_facil`, role `tienda_facil_owner`, branch `br-bitter-meadow-ahhjftml`. |

Never document full `DATABASE_URL` values here because they include passwords.

## Solution endpoints

| Solution | Web | API |
| --- | --- | --- |
| BetterP landing, Renta Facil y backoffice | `https://betterp.net` | `https://api.betterp.net` |
| Vende Facil | `https://vendefacil.betterp.net` | `https://api-vendefacil.betterp.net` |
| Tienda Facil | `https://tiendafacil.betterp.net` | `https://api-tiendafacil.betterp.net` |

## Bridge tokens and solution auth

BetterP owns login. Embedded solutions should not implement standalone login unless explicitly required.

| Bridge | BetterP variable | Solution variable | Header |
| --- | --- | --- | --- |
| BetterP to Vende Facil | `VENDE_FACIL_INTERNAL_API_TOKEN` | `BETTERP_VENDE_FACIL_INTERNAL_TOKEN` | `x-betterp-vende-facil-token` or internal key, depending endpoint |
| BetterP to Tienda Facil | to be added in BetterP as Tienda token variable | `BETTERP_TIENDA_FACIL_INTERNAL_TOKEN` | `x-betterp-tienda-facil-token` |

Expected context headers for embedded solutions:

```text
x-betterp-account-id
x-betterp-capa-id
x-betterp-actor-id
x-betterp-actor-email
x-betterp-internal-key
```

## Common commands

List Render services without values:

```powershell
$render = [Environment]::GetEnvironmentVariable("RENDER_API_KEY","User")
$headers = @{ Authorization = "Bearer $render"; Accept = "application/json" }
Invoke-RestMethod -Method Get -Uri "https://api.render.com/v1/services?limit=100" -Headers $headers |
  ForEach-Object { $_.service | Select-Object name,id,type,ownerId,repo,branch,rootDir }
```

List Cloudflare Pages projects:

```powershell
$cfToken = [Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN","User")
$cfAccount = [Environment]::GetEnvironmentVariable("CLOUDFLARE_ACCOUNT_ID","User")
$headers = @{ Authorization = "Bearer $cfToken"; "Content-Type" = "application/json" }
Invoke-RestMethod -Method Get -Uri "https://api.cloudflare.com/client/v4/accounts/$cfAccount/pages/projects" -Headers $headers |
  Select-Object -ExpandProperty result |
  Select-Object name,id,subdomain,production_branch
```

List Neon projects:

```powershell
$neon = [Environment]::GetEnvironmentVariable("NEON_API_KEY","User")
$headers = @{ Authorization = "Bearer $neon"; Accept = "application/json" }
Invoke-RestMethod -Method Get -Uri "https://console.neon.tech/api/v2/projects?org_id=org-rough-pine-77061144&limit=100" -Headers $headers |
  Select-Object -ExpandProperty projects |
  Select-Object name,id,region_id,pg_version
```

## Safety rules

- Do not paste tokens into chat unless unavoidable.
- Do not commit `.env`, Render env dumps or database URLs.
- Rotate provider tokens after any accidental exposure.
- Before changing production DBs, identify the Neon project by parsing Render `DATABASE_URL` privately and do not print it.
- Before creating new Render services from private repos, make sure the Render GitHub App has access to that repo.
- Before creating Cloudflare Pages projects by API, make sure the token has `Account > Cloudflare Pages > Edit`.
