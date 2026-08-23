# Launch guide

Step-by-step from this folder to a live site and downloadable installers. No prior GitHub deployment experience assumed. Total time: about 30 minutes, most of it waiting for CI.

## 0. One-time prerequisites

- A GitHub account (free): https://github.com/join
- Git installed locally (`git --version` to check)
- Tell git who you are, if you never have:

  ```sh
  git config --global user.name "Seth"
  git config --global user.email "you@example.com"
  ```

## 1. Create the GitHub repository

1. Go to https://github.com/new
2. **Repository name:** `spread`
3. **Public**
4. Leave every checkbox off (no README, no .gitignore, no license — the project already has them)
5. Click **Create repository**

Leave the page open; you'll need the URL it shows (`https://github.com/YOURUSER/spread.git`).

## 2. Push the code

This folder is not a git repository yet, so initialize it first. A `.gitignore` is already in place so `node_modules/` and build output stay out of the repo. From `/home/claude/cardstock`:

```sh
cd /home/claude/cardstock
git init
git add .
git commit -m "Spread v0.1.0"
git branch -M main
git remote add origin https://github.com/YOURUSER/spread.git
git push -u origin main
```

Replace `YOURUSER` with your GitHub username. When git asks for a password, it wants a personal access token, not your account password — GitHub walks you through creating one at https://github.com/settings/tokens (fine-grained, repo scope), or install the `gh` CLI and run `gh auth login` to skip all that.

The push also triggers the test workflow and the web deploy workflow. The deploy will fail once — Pages isn't enabled yet. That's expected; next step fixes it.

## 3. Enable GitHub Pages

1. In the repo: **Settings → Pages**
2. Under **Build and deployment**, set **Source** to **GitHub Actions**
3. Go to the **Actions** tab, open the failed "Web (GitHub Pages)" run, and click **Re-run all jobs** (or just push any commit)

When the run finishes, the `deploy` job shows the live URL: `https://YOURUSER.github.io/spread/`. Open it — the tutorial should appear. Every future push to `main` redeploys automatically.

## 4. Fix the README link

The README ships with a placeholder. Replace it:

```sh
sed -i '' 's|YOURUSER|yourusername|g' README.md   # macOS
sed -i 's|YOURUSER|yourusername|g' README.md      # Linux
git add README.md
git commit -m "Set live URL"
git push
```

(`YOURUSER` appears twice in README.md; the command catches both.)

## 5. First release (desktop installers)

Installers build automatically when you push a version tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

Watch the **Actions** tab: "Desktop (Electron)" builds on macOS and Windows runners (10–20 minutes), then a release job creates a GitHub Release for the tag with `Spread-0.1.0-mac.dmg` and `Spread-Setup-0.1.0.exe` attached. Find it under the repo's **Releases**. Nothing else to do.

For the next release: bump `"version"` in both `package.json` and `desktop/package.json` (the installer filename uses the desktop one), commit, then tag `v0.1.1` and push the tag.

## 6. The unsigned-build warnings

The installers work fine but are not code-signed, because signing requires paid certificates: an Apple Developer membership ($99/year) for macOS notarization and a code-signing certificate (a few hundred dollars/year) for Windows. Until donations cover those, users see a one-time OS warning. This is normal for new open-source projects — the exact wording to give users (it's already in the README):

- **macOS:** "Apple could not verify Spread is free of malware." Right-click **Spread.app** → **Open** → **Open**, or System Settings → Privacy & Security → **Open Anyway**. First launch only. If macOS says the app is "damaged", the download is from a release older than v0.2.2 — redownload the current one.
- **Windows:** SmartScreen says "Windows protected your PC." Click **More info** → **Run anyway**. First run only.

If someone is nervous, point them at the web version — it has no warnings and is the recommended way to run Spread anyway.

## 7. Optional: custom domain later

The github.io URL is permanent and free; a custom domain (e.g. `spread.app`, ~$10–15/year) is cosmetic. When you want one: buy the domain, add a CNAME record pointing `www` (or the apex via ALIAS/ANAME) at `YOURUSER.github.io`, then set it in **Settings → Pages → Custom domain** and check **Enforce HTTPS**. GitHub's docs cover the DNS details. Nothing in the app needs to change — the build uses relative paths, so it works at any URL.

## 8. Optional: donations, and what they fund

Two easy options, neither requires giving anyone a card number to receive money:

- **GitHub Sponsors** (no fees): https://github.com/sponsors — sign up, connect a bank account via Stripe, then add a `.github/FUNDING.yml` file to the repo with `github: YOURUSER` and a Sponsor button appears on the repo.
- **Ko-fi** (no fees on donations): https://ko-fi.com — make a page, link it from the README, connect PayPal or Stripe to receive.

State the goal publicly and plainly: first ~$99/year funds the Apple Developer membership, then a Windows code-signing certificate — at which point the installer warnings in step 6 go away for everyone. Concrete goals get funded; vague tip jars don't.

## Launch checklist

- [ ] Repo created and pushed (steps 1–2)
- [ ] Pages enabled, site live at `https://YOURUSER.github.io/spread/` (step 3)
- [ ] README URL updated (step 4)
- [ ] `v0.1.0` tagged, installers on the Releases page (step 5)
- [ ] Downloaded both installers yourself and verified the first-launch steps as written (step 6)
- [ ] Announced with the web link first, installers second
