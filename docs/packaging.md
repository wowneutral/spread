# Packaging Spread

Spread ships three ways from this one repo:

- **Web (PWA)** — Vite build in `dist/`, deployed to GitHub Pages on every push to `main` (`.github/workflows/web.yml`).
- **Desktop** — Electron wrapper in `desktop/`, packaged into a macOS `.dmg` (universal) and a Windows `.exe` (NSIS, x64) on every `v*` tag push (`.github/workflows/desktop.yml`).
- **Tests** — `npm test` + `tsc --noEmit` on every pull request (`.github/workflows/test.yml`).

## Dev commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server at http://localhost:5173 |
| `npm test` | Vitest run |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Web build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm --prefix desktop start` | Launch Electron pointed at the dev server (run `npm run dev` first) |
| `npm run build && npm --prefix desktop run dist` | Build installers locally into `desktop/release/` |

The desktop `dist` script has a `predist` hook that copies the repo's `dist/` into `desktop/dist/` (cross-platform Node `fs.cpSync`), so `electron-builder` packages a self-contained app; `electron.cjs` loads `desktop/dist/index.html` when packaged (`app.isPackaged`) and `http://localhost:5173` otherwise.

## Wiring the app builder must add (index.html + vite config)

`public/` assets are copied verbatim into `dist/` by Vite. For the PWA to work, `index.html` needs, in `<head>`:

```html
<link rel="manifest" href="manifest.webmanifest" />
<link rel="icon" href="favicon.ico" sizes="32x32" />
<link rel="icon" href="icon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="apple-touch-icon.png" />
<meta name="theme-color" content="#1B1A17" />
<script src="sw-register.js" defer></script>
```

Notes:

- `<script src="/sw-register.js" defer></script>` (absolute) also works **only** when the app is served at a domain root. Because GitHub Pages serves project sites at `username.github.io/REPO/`, use the relative `src="sw-register.js"` form shown above (or `href`/`src` values Vite rewrites — Vite does **not** rewrite plain `public/` references, so keep them relative).
- **Vite `base`:** set `base: './'` in `vite.config.ts` unconditionally. Relative base makes the same `dist/` work at a domain root, at `username.github.io/REPO/`, **and** from the `file://` load inside Electron. Without it, absolute `/assets/...` URLs 404 on project Pages and break the desktop build.
- `sw-register.js` registers `sw.js` only in production (skips `localhost`/`127.0.0.1`/`[::1]` and non-HTTPS), so the dev server and Electron are never service-worker-cached.
- The service worker cache name contains a `__BUILD_ID__` placeholder; the web workflow stamps it with the commit SHA after `npm run build` (`sed` on `dist/sw.js`), so each deploy invalidates the previous cache. Local builds keep the literal placeholder, which is harmless.
- To apply a waiting update immediately, the app may post `{ type: 'SKIP_WAITING' }` to the waiting worker (optional).

## Release flow (desktop installers)

1. Bump versions if desired (`package.json` and `desktop/package.json` — the installer filename uses the desktop version).
2. Tag and push:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. `desktop.yml` builds on `macos-latest` + `windows-latest` (unsigned: `CSC_IDENTITY_AUTO_DISCOVERY: false`), uploads the artifacts, and a final job creates a GitHub Release for the tag with `Spread-<version>-mac.dmg` and `Spread-Setup-<version>.exe` attached.

## GitHub Pages setup (one-time, repo settings)

1. Repo → **Settings → Pages** → under **Build and deployment**, set **Source** to **GitHub Actions**.
2. Push to `main` (or run the "Web (GitHub Pages)" workflow manually). The `deploy` job's environment shows the live URL.
3. That's it — `web.yml` already carries the required `pages: write` / `id-token: write` permissions and the `github-pages` environment.

## Unsigned installers: first-launch instructions

The builds carry no Apple Developer / Windows certificate. Since v0.2.2 the macOS app is **ad-hoc signed** in CI (`desktop/adhoc-sign.cjs`, an electron-builder `afterPack` hook running `codesign --sign -`): without any signature, Apple Silicon Gatekeeper rejects the app as "damaged" with no user-visible way to allow it; with the ad-hoc seal, users get the standard unidentified-developer flow instead. Users still see OS warnings once:

**macOS** — "Apple could not verify Spread is free of malware" / "unidentified developer":
- Right-click (or Ctrl-click) **Spread.app** → **Open** → **Open**, or approve under **System Settings → Privacy & Security → Open Anyway**. Needed only on first launch.
- A "damaged" dialog means a pre-v0.2.2 (unsigned) download — point the user at the current release.

**Windows** — SmartScreen "Windows protected your PC":
- Click **More info**, then **Run anyway**. Needed only on first run of the installer.

## Icons

`public/icon.svg` is the source of truth (yellow `#F7E354` rounded tile, dark `#211F1A` geometric "cb"). The raster set (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png` with safe-zone padding, `favicon.ico`, `apple-touch-icon.png`, plus `desktop/build/icon.icns` / `icon.ico` / `icon.png`) was generated with Python PIL from the same geometry. `desktop/build/icon.icns` was written by Pillow's ICNS encoder; if it ever needs regenerating without Pillow, electron-builder also accepts a 512px `desktop/build/icon.png` as the macOS icon source. Regenerate by re-running the PIL script against the SVG geometry if the mark changes.
