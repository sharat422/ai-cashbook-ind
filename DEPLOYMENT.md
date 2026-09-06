# Branches & environments

Two isolated environments; each git branch auto-deploys to one of them. Test data
and real user data never mix (separate databases, separate `JWT_SECRET`).

| | Staging | Production |
| --- | --- | --- |
| **Git branch** | `dev` | `main` |
| Backend service | `smart-cashbook-api` | `smart-cashbook-api-prod` |
| URL | https://smart-cashbook-api.onrender.com | https://smart-cashbook-api-prod.onrender.com |
| Database | `smart-cashbook-db-staging` | `smart-cashbook-db-prod` |
| Region | Oregon (US) | Singapore (near India) |
| `DEBUG` | `true` (login with OTP `123456`) | `false` (real auth — see PRODUCTION_SETUP.md §7) |
| Use for | USA testing, iterating | India final test + launch |

## Everyday workflow

```
# 1. Build & iterate on dev → auto-deploys to STAGING
git checkout dev
# …commit work…
git push                      # → staging backend redeploys

# 2. Release: promote verified dev → main → auto-deploys to PRODUCTION
git checkout main
git merge --ff-only dev       # (or open a PR: dev → main)
git push                      # → production backend redeploys
```

- **Backend (Render)** auto-deploys on push: `dev` → staging, `main` → production
  (wired via the `branch:` fields in `render.yaml`).
- **Mobile (Codemagic)** builds are run **manually** per release — run the
  `*-staging` workflows from `dev`, the `*-production` workflows from `main`
  (each bakes in the correct API URL). See `codemagic.yaml`.

## One-time Render setup after this change

The `branch:` mapping only takes effect once the Blueprint is re-synced:

1. Render → the Blueprint for this repo → **Sync** (or New + → Blueprint → Apply).
2. Confirm **smart-cashbook-api** now tracks **dev** and **smart-cashbook-api-prod**
   tracks **main** (each service → Settings → Build & Deploy → Branch).
3. Keep the Blueprint's own tracked branch = **main** so production config
   (`render.yaml`) changes are reviewed before they apply.

Secrets (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, WhatsApp, etc.) are set per
service in the Render dashboard, never in git — set them on **both** services.
