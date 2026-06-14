# GitHub Pages Deployment

This guide is the Phase 6 deployment path for Web GeneDB Collector.

The supported path is fixed to:

```text
GitHub Free
-> public repository
-> GitHub Actions
-> GitHub Pages project site
```

Do not use `Deploy from a branch` for this project. The repository workflow builds the Vite app and uploads the `dist` artifact through GitHub Actions.

## 1. Safety Rules Before Upload

Only upload this folder as the repository root:

```powershell
H:\Vibe Cording\SUP12 web ver\web-genedb-collector
```

Do not upload the parent workspace:

```powershell
H:\Vibe Cording\SUP12 web ver
```

The parent workspace contains legacy SUP12 files, local results, logs, and internal working material. A GitHub Free Pages site must be public, so the public repository must not contain:

- real analysis sequence
- API key, password, token, credential, or personal email
- company internal material
- real NCBI full result JSON/XML
- downloaded ZIP/FASTA/FASTQ/XML/log output
- legacy SUP12 `results`, `logs`, `data/cache`, or certificate material

The app sends the sequence from the browser to NCBI when the user submits a BLAST job. The repository must not store that sequence.

## 2. Confirm The Correct Folder

Open PowerShell and run:

```powershell
cd "H:\Vibe Cording\SUP12 web ver\web-genedb-collector"
Get-ChildItem package.json
Get-ChildItem .github\workflows\deploy-pages.yml
Get-ChildItem src
```

If any command fails, you are not in the correct folder.

## 3. Local Validation Before GitHub

Run these commands before the first upload and before later updates:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

Optional local preview:

```powershell
npm run preview
```

Then open the preview URL shown by Vite, usually:

```text
http://localhost:4173/
```

Local validation should confirm that the page loads, the validation/status UI is visible, and no browser console error appears. Do not use a real company sequence for local smoke testing unless the test is explicitly approved.

## 4. Sensitive File Check Before Commit

Run these checks from the `web-genedb-collector` folder:

```powershell
git status --short
rg -n "api[_-]?key|secret|password|token|BEGIN PRIVATE|@.*\." README.md docs src test .github package.json package-lock.json vite.config.ts index.html
rg -n "\.fasta|\.fastq|\.fa|\.fna|\.fq|\.xml|\.zip|process\.log|run_info\.json|_meta\.json" .
```

Expected notes:

- Documentation may mention forbidden file types as warnings. That is acceptable.
- `id-token: write` in `.github/workflows/deploy-pages.yml` is required by GitHub Pages deployment. That is not a user secret.
- Synthetic minimized fixtures under `test/fixtures` are acceptable.

Stop and inspect if `git status --short` shows any real result file, log file, private config file, or sequence file.

## 5. Create A Public GitHub Repository

In GitHub web:

1. Go to `https://github.com/new`.
2. Repository name: `web-genedb-collector` is recommended.
3. Visibility: `Public`.
4. Do not add README, `.gitignore`, or license in GitHub web when using the command path below.
5. Create repository.

GitHub Free supports GitHub Pages for public repositories. Private repository Pages requires a paid plan or another hosting choice.

## 6. Upload The Project

From PowerShell:

```powershell
cd "H:\Vibe Cording\SUP12 web ver\web-genedb-collector"
git init
git add .
git commit -m "Initial Web GeneDB Collector"
git branch -M main
git remote add origin https://github.com/<USER>/web-genedb-collector.git
git push -u origin main
```

Replace `<USER>` with the GitHub account name.

If the GitHub repository was created with a README by mistake, use this safer path instead:

```powershell
cd "H:\Vibe Cording\SUP12 web ver"
git clone https://github.com/<USER>/web-genedb-collector.git web-genedb-collector-public
Copy-Item -Recurse -Force ".\web-genedb-collector\*" ".\web-genedb-collector-public\"
cd ".\web-genedb-collector-public"
git status --short
git add .
git commit -m "Initial Web GeneDB Collector"
git push
```

Check `git status --short` carefully before `git add .`.

## 7. Enable GitHub Pages

In the GitHub repository:

```text
Settings
-> Pages
-> Build and deployment
-> Source
-> GitHub Actions
```

The repository already contains:

```text
.github/workflows/deploy-pages.yml
```

That workflow runs on every push to `main` and on manual `workflow_dispatch`.

The workflow does:

```text
checkout
setup Node 22
configure GitHub Pages
npm ci
npm test
npm run build
upload dist artifact
deploy to GitHub Pages
```

Required workflow permissions are already set:

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

If deployment is blocked, check:

```text
Settings -> Actions -> General
```

Actions must be enabled for the repository.

## 8. Deployment URL

For a repository named `web-genedb-collector`, the URL is normally:

```text
https://<USER>.github.io/web-genedb-collector/
```

The workflow injects:

```text
VITE_BASE_PATH=/${{ github.event.repository.name }}/
```

So a different repository name also works as a project site.

Do not create this as a user site repository named `<USER>.github.io` unless the Vite base path strategy is reviewed first. This project is configured for a project site path like `/<REPO>/`.

GitHub Pages may take several minutes after a successful Actions run before the site URL responds.

## 9. GitHub Pages Smoke Test

After the Actions workflow succeeds:

1. Open the Pages URL.
2. Confirm the app loads and the Phase 5 recovery/status UI is visible.
3. Confirm browser console has no unexpected error.
4. Enter only synthetic or public short test sequence for smoke testing.
5. Enter a numeric taxid only.
6. Use a low `max hits` value for a first live test, such as `10` or `50`.
7. Submit and confirm RID/RTOE is shown.
8. Respect the 60 second polling interval.
9. If READY + hits, confirm result download, parser summary, and ZIP download.
10. Record only URL, browser, network type, RID, status, and summary counts. Do not record the full query sequence or raw BLAST result.

Use `docs/SMOKE_TEST_PLAN.md` as the detailed checklist.

## 10. Company Network Failure Record

If it fails on the company network, record only:

```text
Date/time:
GitHub Pages URL:
Browser:
Network: company / personal
NCBI BLAST web page reachable: yes / no
RID issued: yes / no
Last visible status:
Console error summary:
Network tab HTTP status summary:
ZIP created: yes / no
Notes without sequence/raw result:
```

Do not paste the full query sequence, full NCBI response, or downloaded result file into the report.

## 11. Updating The Site Later

After editing code or docs:

```powershell
cd "H:\Vibe Cording\SUP12 web ver\web-genedb-collector"
npm run typecheck
npm test
npm run build
git status --short
git add .
git commit -m "Update Web GeneDB Collector"
git push
```

GitHub Actions deploys the new version.

## 12. References

- GitHub Docs: Configuring a publishing source for your GitHub Pages site
- GitHub Docs: Using custom workflows with GitHub Pages
