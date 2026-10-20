# Azure Static Web Apps deployment plan

Status: **plan only**. The app has not been deployed to Azure by the author. The application runs fully locally without any Azure account (`npm run dev`).

## 1. Architecture and hosting choice

The game is a static single-page app: HTML, CSS and JavaScript produced by `vite build`. All game logic and storage (`localStorage`) run in the visitor's browser. The AI difficulty selection needs a small backend (`server/`, Node.js + Express) because the Gemini API key must stay on a server; see section 10. **The game still loads without the backend**; finishing a round then reports that evaluation is unavailable and offers the labelled rule-based fallback.

**Azure Static Web Apps (SWA)** fits because it:

- serves static files from a global CDN with free managed HTTPS;
- has a Free plan suitable for a demo;
- integrates with GitHub Actions for build and deploy;
- can create preview environments for pull requests.

```
Browser  <--HTTPS-->  Azure Static Web Apps (CDN + static hosting)  <--deploy--  GitHub Actions  <--  GitHub repo
   |                                                      |
   +-- localStorage (anonymous history, stays on device)  +-- POST /api/sessions/:id/rounds (numbers only) --> Backend (App Service / Functions) --> Gemini API
                                                                                                   ^ GEMINI_API_KEY in app settings / Key Vault
```

## 2. Prerequisites

- An Azure subscription (a free account is enough) and permission to create resources.
- The code pushed to a GitHub repository you own.
- Node.js 22 locally (see `.nvmrc`) to verify the build before deploying.
- Optional: Azure CLI (`az`) if you prefer the command line to the portal.

## 3. Build settings

| Setting | Value |
| --- | --- |
| Install command | `npm ci` |
| Build command | `npm run build` |
| App location (source) | `/` |
| Output location | `dist` |
| API location | _(empty: the backend is hosted separately, section 10)_ |
| `VITE_API_BASE_URL` | Public URL of the backend, set at build time (GitHub repository **variable**, not a secret). Empty only if the API is served from the same origin. |

## 4. Connect the GitHub repository (portal route)

1. In the Azure portal choose **Create a resource > Static Web App**.
2. Select the subscription and a resource group (create e.g. `rg-memory-game`).
3. Name the app, select the **Free** plan and the region closest to your users.
4. Under **Deployment details** choose **GitHub**, sign in, then pick your organization, repository and branch (`main`).
5. Under **Build Details** choose **Custom**, and set App location `/`, Api location empty, Output location `dist`.
6. Review and create. Azure adds a workflow file to your repository and stores a deployment token as a GitHub secret.

Pull that generated workflow into your local clone (`git pull`) so it stays under version control.

## 5. Deploying with GitHub Actions

Two options:

- **Azure-generated workflow (step 4).** Azure commits `.github/workflows/azure-static-web-apps-<name>.yml`, which builds and deploys on every push to `main` and creates preview environments for pull requests. If you use it, protect `main` with the required `CI` check, or add `npm run lint`, `typecheck` and `test:run` steps to it.
- **Manual workflow included in this repo.** `.github/workflows/azure-static-web-apps.yml` is triggered only through **Actions > Deploy to Azure Static Web Apps (manual) > Run workflow**. It runs lint, typecheck, tests and the build, then uploads `dist/`. It is separate from `ci.yml`, so CI never needs Azure credentials. It has not been executed by the author, so check its first run carefully.

To use the manual workflow:

1. Create the Static Web App in Azure (portal step 4, or choose "Other" as the deployment source).
2. In the Azure portal open the resource > **Overview > Manage deployment token** and copy the token.
3. In GitHub open **Settings > Secrets and variables > Actions > New repository secret**, name it `AZURE_STATIC_WEB_APPS_API_TOKEN` and paste the token.
4. Run the workflow from the Actions tab.

## 6. Required configuration and secrets

| Item | Where | Notes |
| --- | --- | --- |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | GitHub repository secret | Deployment token for the one Static Web App. Never commit it. |
| `VITE_API_BASE_URL` | GitHub repository variable (frontend build) | Public backend URL. Not secret. |
| `GEMINI_API_KEY` | Backend app setting / Key Vault reference | **Secret.** Never in GitHub variables, the repo, or any `VITE_*` value. |
| `GEMINI_MODEL`, `ALLOWED_ORIGINS`, `TRUST_PROXY`, `LLM_TIMEOUT_MS`, `RATE_LIMIT_*`, `PORT` | Backend app settings | See `.env.example`. Set `ALLOWED_ORIGINS` to the Static Web App origin. |

## 7. Security considerations

- No credentials are stored in the repository; the deployment token lives only in GitHub Secrets. Rotate it from the Azure portal if it is ever exposed.
- The app collects no personal data. Results contain a random per-page-load ID, a timestamp, moves, time and difficulty, and stay in the visitor's `localStorage`.
- HTTPS is enforced by Static Web Apps. You may add security headers (for example a restrictive `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`) with a `staticwebapp.config.json` file in `public/`. This is a recommended hardening step that has not been added or tested yet.
- Keep dependencies patched (`npm audit`, Dependabot) and limit who can run the deployment workflow with branch protection and GitHub environments.
- Use least-privilege Azure roles on the resource group.

## 8. Cost-control assumptions

- The **Free** plan has no monthly charge but has bandwidth and feature limits; the app is a few hundred KB, so a demo should stay well inside them. Check the current limits on the Azure pricing page before relying on this.
- The frontend has no usage-based costs. The backend (section 10) adds App Service or Functions costs, and **Gemini API usage is billed or quota-limited by Google** according to your key's plan; the server rate limit (default 10 requests per client per minute) and the 600-token output cap bound it. Check current pricing before relying on any free tier.
- Put the resources in one resource group so you can delete everything with one command when the assessment ends: `az group delete --name rg-memory-game`.
- Optionally create an Azure budget alert at a small amount as a safety net.

## 9. Verify the deployment

1. Open the Static Web App URL from the portal **Overview** page; confirm it loads over HTTPS.
2. Play a full Easy round (4×4, 16 cards, 8 pairs): moves and timer update and the win message appears. Press **Next round** and confirm the board changes to the size named in the message (for example 5×4 with 20 cards).
3. Check that the next-round message and the difficulty badge change as described in the README.
4. Reload the page and confirm the recent results persist; click **Clear history** and confirm.
5. Open browser dev tools > Network: the only cross-origin requests should be the `/api/sessions...` calls to your backend. Confirm the Console has no errors.
6. Finish a round with the backend running and configured: the result panel shows Gemini's next difficulty and reason. Stop the backend (or remove the key) and finish another round: the panel shows the error with **Retry** and the labelled rule-based fallback.
7. In GitHub **Actions**, confirm the deployment run succeeded, and test a pull request preview if you use that feature.

## 10. Hosting the backend securely

Status: **not deployed or tested on Azure by the author.** Two options; both keep `GEMINI_API_KEY` out of the repository and the browser.

**Option A: Azure App Service (Linux, Node 22) running the Express app as-is.**

1. Create a Web App (Node 22 LTS). Deploy the repository (for example `az webapp up`, or a GitHub Actions workflow of your own) and set the startup command to `npm run server` (dependencies must include `tsx`, which is a devDependency here; either install with devDependencies or compile `server/` to JavaScript first).
2. In **Settings > Environment variables** add `GEMINI_API_KEY` (preferably a Key Vault reference), `GEMINI_MODEL`, `ALLOWED_ORIGINS=https://<your-swa>.azurestaticapps.net`, `TRUST_PROXY=1`. App Service provides `PORT`; the server reads it.
3. Enforce HTTPS only. Set the frontend's `VITE_API_BASE_URL` repository variable to the Web App URL and redeploy the frontend.
4. Verify `GET https://<backend>/api/health` returns `{"ok":true,"aiConfigured":true}` (it never returns the key).

**Option B: Azure Functions / SWA managed API.** Port the handlers in `server/rounds.ts` (`RoundsService`) and `server/evaluation.ts` into an HTTP-triggered function; the logic is framework-independent. Rate limiting then needs API Management or a shared store because the in-process limiter in `server/app.ts` does not apply. This port is **not implemented** in this repository.

Hardening checklist: Key Vault + managed identity for the key; restrict `ALLOWED_ORIGINS` to the exact frontend origin; keep the rate limit; set a budget alert and a Gemini quota; never log request bodies; rotate the key if it is ever exposed.
