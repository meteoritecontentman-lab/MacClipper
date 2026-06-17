# MacClipper

A lightweight macOS menu-bar replay-buffer app inspired by Medal.tv.

## Super Simple GitHub Help

If you want the easiest possible GitHub update steps, read:

`GITHUB-UPDATE-README.md`

## What it does
- Lives in the **top menu bar** as an icon
- Keeps a rolling replay buffer of your desktop display
- Lets you choose which monitor the replay buffer targets when multiple displays are connected
- Saves the **last 30 seconds** (or a custom duration) with a global shortcut
- Lets you say **"Mac clip that"** to trigger a clip hands-free while the app is open
- Captures **system audio** and **microphone audio** into the exported clip
- Keeps the replay buffer armed on launch and re-arms it after interruptions
- Lets you tweak settings for clip length, shortcut, cursor visibility, and save folder

## Run it
```bash
cd /Users/meteorite/macclipper
swift run
```

## Run the local API
```bash
cd /Users/meteorite/macclipper
npm install
npm run web:start
```

## Bring Everything Up
```bash
cd /Users/meteorite/macclipper
./initialize
```

That single command will:
- build Firebase Functions
- build the website bundle used by Firebase Hosting
- package `dist/MacClipper.app`
- start the local bot/API on port `4173`
- start Firebase Hosting, Functions, and Firestore emulators
- open the Mac app, local API health URL, local website, and Firebase Emulator UI

The local hosted website opens on `http://127.0.0.1:5005` by default so it does not collide with macOS services that often occupy port `5000`.

To also deploy the hosted stack before opening the live URLs:

```bash
cd /Users/meteorite/macclipper
./initialize --deploy
```

Or run it through npm:

```bash
cd /Users/meteorite/macclipper
npm run initialize -- --deploy
```

That server exposes the local JSON API and bot-facing API on:

```text
http://127.0.0.1:4173
```

## Bot API
Point the Discord bot at this repo's backend with:

```text
MACCLIPPER_API_BASE_URL=http://127.0.0.1:4173
```

The backend keeps its config locked in `backend/config.env`. To print the generated bot API secret for `MACCLIPPER_BOT_SHARED_SECRET`, run:

```bash
cd /Users/meteorite/macclipper
npm run web:bot-secret
```

The bot contract now includes:

- `GET /api/bot/health`
- `GET /api/bot/users/lookup`
- `POST /api/bot/users/link-discord`
- `POST /api/bot/users/admin`
- `POST /api/bot/users/status`
- `POST /api/bot/users/subscription`
- `POST /api/bot/users/features/grant`
- `POST /api/bot/users/features/revoke`
- `POST /api/app-installations/resolve`
- `GET /api/entitlements/by-user-id`

For always-on production hosting (independent from website deploys), use the dedicated Cloud Run bot setup documented in `docs/bot-cloud-run-hosting.md`.

`/api/bot/users/features/grant` returns a `macclipper://purchase-complete?...` activation URL, and linked apps can also pick the same feature up live from `/api/entitlements/by-user-id`.

`/api/app-installations/resolve` saves each Mac's hashed machine identity plus metadata on first launch, returns a canonical `appUuid`, and reuses that same `appUuid` on reinstalls of the app on the same Mac.

This repo no longer ships a bundled website frontend. The separate website running elsewhere on your machine is the one meant for the account and purchase UI.

## Package it as a `.app`
```bash
cd /Users/meteorite/macclipper
./scripts/package_app.sh
open dist/MacClipper.app
```

If you install the app on another Mac, do not ship the default localhost API URL. Point the packaged app at a reachable backend first:

```bash
cd /Users/meteorite/macclipper
MACCLIPPER_API_BASE_URL="https://your-api-host.example.com" ./scripts/package_app.sh
```

Or set the full purchase/account page URL directly:

```bash
cd /Users/meteorite/macclipper
MACCLIPPER_ACCOUNT_PORTAL_URL="https://your-api-host.example.com/buy-4k.html" ./scripts/package_app.sh
```

Without that override, the bundled app keeps `MacClipperAccountPortalURL=http://127.0.0.1:4173/buy-4k.html`, which means installs on other Macs generate a local UUID but never register it with your API and cannot sync entitlements from the Discord bot.

To package a specific architecture explicitly:

```bash
cd /Users/meteorite/macclipper
MACCLIPPER_BUILD_ARCH=arm64 ./scripts/package_app.sh
MACCLIPPER_BUILD_ARCH=x86_64 ./scripts/package_app.sh
```

For builds you hand to other people, use a `Developer ID Application` certificate and notarize the app. The packaging script now prefers `Developer ID Application` automatically and will notarize plus staple the app when you provide a notarytool keychain profile:

```bash
cd /Users/meteorite/macclipper
MACCLIPPER_NOTARY_PROFILE="macclipper-notary" ./scripts/package_app.sh
```

If the script falls back to `Apple Development` or ad-hoc signing, other Macs can still show Gatekeeper verification warnings and may force the user into `Privacy & Security` to open the app manually.

## Build a drag-and-drop `.dmg`
```bash
cd /Users/meteorite/macclipper
./scripts/build_dmg.sh
open dist/MacClipper.dmg
```

By default this now produces separate architecture DMGs:

```text
dist/MacClipper-apple-silicon.dmg
dist/MacClipper-intel.dmg
```

`dist/MacClipper.dmg` is kept as a copy of the native-architecture build for convenience. To build only one DMG architecture, set `MACCLIPPER_DMG_ARCHS`, for example:

```bash
MACCLIPPER_DMG_ARCHS="arm64" ./scripts/build_dmg.sh
MACCLIPPER_DMG_ARCHS="x86_64" ./scripts/build_dmg.sh
```

## Built-in updater feeds
Sparkle-enabled builds now use this hosted appcast:

```text
https://raw.githubusercontent.com/Userbro20/macclip-auto-update/main/appcast.xml
```

Older pre-Sparkle builds still use this legacy migration feed once:

```text
https://raw.githubusercontent.com/Userbro20/macclip-auto-update/main/update-feed.json
```

Both feeds should reference the same packaged HTTPS release archive:

```text
MacClipper.zip
```

Generate that archive plus both feed files with:

```bash
cd /Users/meteorite/macclipper
./scripts/release_with_update.sh
```

Set `MACCLIPPER_RELEASE_NOTES` first if you want custom release notes in the generated appcast.

## Permissions
On first launch, macOS will ask for:
- **Screen Recording / System Audio Recording**
- **Microphone access**
- **Speech Recognition** for the voice clip phrase

If clips fail, re-enable permissions in:
`System Settings → Privacy & Security`

## Discord Rich Presence
MacClipper can publish Discord Rich Presence while the app is open.

To show the MacClipper name and icon in Discord, set a real Discord application ID in `AppResources/Info.plist` under `DiscordRichPresenceClientID`, then upload the MacClipper icon to that Discord application with the asset key `macclipper`.

The activity text and button URLs are also defined in `AppResources/Info.plist`. The visual card layout itself is controlled by Discord.
