# MacClipper Updater Guide

MacClipper now uses Sparkle for updates. New builds read a hosted Sparkle appcast, while the older `update-feed.json` stays around only so already-installed pre-Sparkle builds can migrate once.

## Hosted feeds
- Sparkle appcast for current builds:
  - `https://raw.githubusercontent.com/Userbro20/macclip-auto-update/main/appcast.xml`
- Legacy JSON migration feed for older builds:
  - `https://raw.githubusercontent.com/Userbro20/macclip-auto-update/main/update-feed.json`

## How it works
- Production builds use `SUFeedURL` from `AppResources/Info.plist`, download a signed DMG, verify the Ed25519 signature with `SUPublicEDKey`, and install through Sparkle’s standard updater flow.
- Developer builds now ship with the updater explicitly disabled so the dev app cannot try to update itself from the production feed.
- Older custom-updater builds still read `update-feed.json`, verify the SHA-256 checksum, install the same hosted DMG archive, and land on the Sparkle-enabled build.

## Sparkle keys
- A Sparkle signing keypair was generated locally with `./.build/artifacts/sparkle/Sparkle/bin/generate_keys`.
- The public key is embedded in `AppResources/Info.plist` under `SUPublicEDKey`.
- The private key stays in the login Keychain and is used by `sign_update` during release generation.

## Release flow
1. Increase `CFBundleShortVersionString` in `AppResources/Info.plist`.
2. Increase `CFBundleVersion` in `AppResources/Info.plist`.
3. Upload target release notes via env var if you want to override the previous notes:

```bash
export MACCLIPPER_RELEASE_NOTES="Sparkle migration release with embedded framework packaging."
```

4. For builds you install on other Macs, point the packaged app at a reachable backend before generating the release archive. Either set the API base URL:

```bash
export MACCLIPPER_API_BASE_URL="https://your-api-host.example.com"
```

Or set the full account portal URL directly:

```bash
export MACCLIPPER_ACCOUNT_PORTAL_URL="https://your-api-host.example.com/buy-4k.html"
```

5. Run the release helper. Pass the final public HTTPS download URL if it differs from the default GitHub Releases path:

```bash
cd /Users/meteorite/macclipper
./scripts/release_with_update.sh
```

Or:

```bash
cd /Users/meteorite/macclipper
./scripts/release_with_update.sh https://github.com/Userbro20/macclip-auto-update/releases/download/v1.2/MacClipper.zip
```
6. Upload `dist/MacClipper.dmg` to the exact URL referenced in the generated feed files.
7. Push `appcast.xml` and `update-feed.json` so both new and old clients see the same release archive.

Example DMG URL:

```bash
cd /Users/meteorite/macclipper
./scripts/release_with_update.sh https://github.com/Userbro20/macclip-auto-update/releases/download/v1.2/MacClipper.dmg
```

## What the release helper updates
- `dist/MacClipper.dmg`
- `appcast.xml`
- `update-feed.json`

The script signs the DMG with Sparkle’s `sign_update`, writes a Sparkle `<enclosure>` entry with the EdDSA signature and length, and also refreshes the legacy SHA-256 manifest for older clients.

## Notes
- Keep using a public immutable HTTPS archive URL.
- `appcast.xml` can stay empty between releases; Sparkle treats it as “no update available.”
- The app bundle now embeds `Sparkle.framework`, so always test the packaged bundle with `open dist/MacClipper.app`.
