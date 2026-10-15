# Azure Static Web Apps deployment plan

Status: **plan only**. The app has not been deployed to Azure by the author. The application runs fully locally without any Azure account (`npm run dev`).

## 1. Architecture and hosting choice

The game is a static single-page app: HTML, CSS and JavaScript produced by `vite build`. All game logic and storage (`localStorage`) run in the visitor's browser, so no server, database or API is needed.

**Azure Static Web Apps (SWA)** fits because it:

- serves static files from a global CDN with free managed HTTPS;
- has a Free plan suitable for a demo;
- integrates with GitHub Actions for build and deploy;
- can create preview environments for pull requests.

```
Browser  <--HTTPS-->  Azure Static Web Apps (CDN + static hosting)  <--deploy--  GitHub Actions  <--  GitHub repo
   |
   +-- localStorage (anonymous session history, never leaves the device)
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
| API location | _(empty, no backend)_ |

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
| App settings / environment variables | _none_ | The app reads no environment variables and calls no external services. |

## 7. Security considerations

- No credentials are stored in the repository; the deployment token lives only in GitHub Secrets. Rotate it from the Azure portal if it is ever exposed.
- The app collects no personal data. Results contain a random per-page-load ID, a timestamp, moves, time and difficulty, and stay in the visitor's `localStorage`.
- HTTPS is enforced by Static Web Apps. You may add security headers (for example a restrictive `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`) with a `staticwebapp.config.json` file in `public/`. This is a recommended hardening step that has not been added or tested yet.
- Keep dependencies patched (`npm audit`, Dependabot) and limit who can run the deployment workflow with branch protection and GitHub environments.
- Use least-privilege Azure roles on the resource group.

## 8. Cost-control assumptions

- The **Free** plan has no monthly charge but has bandwidth and feature limits; the app is a few hundred KB, so a demo should stay well inside them. Check the current limits on the Azure pricing page before relying on this.
- There are no databases, functions, storage accounts or AI services, so there are no usage-based costs to monitor.
- Put the resources in one resource group so you can delete everything with one command when the assessment ends: `az group delete --name rg-memory-game`.
- Optionally create an Azure budget alert at a small amount as a safety net.

## 9. Verify the deployment

1. Open the Static Web App URL from the portal **Overview** page; confirm it loads over HTTPS.
2. Play a full Easy round (4×4, 16 cards, 8 pairs): moves and timer update and the win message appears. Press **Next round** and confirm the board changes to the size named in the message (for example 5×4 with 20 cards).
3. Check that the next-round message and the difficulty badge change as described in the README.
4. Reload the page and confirm the recent results persist; click **Clear history** and confirm.
5. Open browser dev tools > Network and confirm there are no requests to other domains, and the Console has no errors.
6. In GitHub **Actions**, confirm the deployment run succeeded, and test a pull request preview if you use that feature.
