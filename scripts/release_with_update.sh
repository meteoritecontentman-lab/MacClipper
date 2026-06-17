#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPCAST_XML="$ROOT/appcast.xml"
LEGACY_FEED_JSON="$ROOT/update-feed.json"
PLIST_PATH="$ROOT/AppResources/Info.plist"
ARCHIVE_PATH="$ROOT/dist/MacClipper.dmg"
RELEASES_URL="https://github.com/Userbro20/macclip-auto-update/releases"
DEFAULT_NOTES="Sparkle-based MacClipper release."

find_sparkle_tool() {
        local tool_name="$1"
        local candidates=(
                "$ROOT/.build/artifacts/sparkle/Sparkle/bin/$tool_name"
                "$ROOT/.build/index-build/artifacts/sparkle/Sparkle/bin/$tool_name"
                "$ROOT/.build/checkouts/Sparkle/bin/$tool_name"
        )

        local candidate
        for candidate in "${candidates[@]}"; do
                if [[ -x "$candidate" ]]; then
                        printf '%s\n' "$candidate"
                        return 0
                fi
        done

        echo "Unable to locate Sparkle tool '$tool_name'. Run swift build once first." >&2
        return 1
}

read_release_notes() {
        if [[ -n "${MACCLIPPER_RELEASE_NOTES:-}" ]]; then
                printf '%s' "$MACCLIPPER_RELEASE_NOTES"
                return 0
        fi

        /usr/bin/python3 - "$LEGACY_FEED_JSON" "$DEFAULT_NOTES" <<'PY'
import json
import pathlib
import sys

feed_path = pathlib.Path(sys.argv[1])
default_notes = sys.argv[2]

if feed_path.exists():
                try:
                                notes = str(json.loads(feed_path.read_text(encoding="utf-8")).get("notes", "")).strip()
                except Exception:
                                notes = ""
                if notes:
                                print(notes)
                                raise SystemExit(0)

print(default_notes)
PY
}

cd "$ROOT"

rm -rf "$ROOT/dist"
mkdir -p "$ROOT/dist"
./scripts/build_dmg.sh

SHORT_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST_PATH")"
BUILD_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$PLIST_PATH")"
DOWNLOAD_URL="${1:-https://github.com/Userbro20/macclip-auto-update/releases/download/v$SHORT_VERSION/MacClipper.dmg}"
RELEASE_NOTES="$(read_release_notes)"
SPARKLE_SIGN_UPDATE="$(find_sparkle_tool sign_update)"

if [[ "$DOWNLOAD_URL" != https://* ]]; then
        echo "Release download URL must use HTTPS." >&2
        exit 1
fi

ARCHIVE_SIZE="$(stat -f%z "$ARCHIVE_PATH")"
ARCHIVE_SHA256="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')"
SIGNATURE_FRAGMENT="$($SPARKLE_SIGN_UPDATE "$ARCHIVE_PATH")"
PUBLISHED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
PUB_DATE="$(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')"
MINIMUM_SYSTEM_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$PLIST_PATH")"

/usr/bin/python3 - "$APPCAST_XML" "$LEGACY_FEED_JSON" "$SHORT_VERSION" "$BUILD_VERSION" "$DOWNLOAD_URL" "$RELEASES_URL" "$SIGNATURE_FRAGMENT" "$ARCHIVE_SIZE" "$RELEASE_NOTES" "$PUB_DATE" "$MINIMUM_SYSTEM_VERSION" "$PUBLISHED_AT" "$ARCHIVE_SHA256" <<'PY'
import html
import json
import pathlib
import sys

(
    appcast_path,
    legacy_feed_path,
    short_version,
    build_version,
    download_url,
    releases_url,
    signature_fragment,
    archive_size,
    release_notes,
    pub_date,
    minimum_system_version,
    published_at,
    archive_sha256,
) = sys.argv[1:14]

notes_lines = [line.strip() for line in release_notes.splitlines() if line.strip()]
if not notes_lines:
    notes_lines = ["No release notes were provided for this build."]

notes_html = "".join(f"<p>{html.escape(line)}</p>" for line in notes_lines)

appcast = f'''<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
        <channel>
                <title>MacClipper Updates</title>
                <link>{html.escape(releases_url)}</link>
                <description>Sparkle appcast for MacClipper releases.</description>
                <language>en</language>
                <item>
                        <title>Version {html.escape(short_version)}</title>
                        <link>{html.escape(releases_url)}</link>
                        <sparkle:version>{html.escape(build_version)}</sparkle:version>
                        <sparkle:shortVersionString>{html.escape(short_version)}</sparkle:shortVersionString>
                        <sparkle:minimumSystemVersion>{html.escape(minimum_system_version)}</sparkle:minimumSystemVersion>
                        <pubDate>{html.escape(pub_date)}</pubDate>
                        <description><![CDATA[{notes_html}]]></description>
                        <enclosure url="{html.escape(download_url, quote=True)}" {signature_fragment} type="application/octet-stream" />
                        <enclosure url="{html.escape(download_url, quote=True)}" {signature_fragment} type="application/x-apple-diskimage" />
                </item>
        </channel>
</rss>
'''

pathlib.Path(appcast_path).write_text(appcast, encoding="utf-8")

legacy_feed = {
        "version": short_version,
        "build": int(build_version),
        "downloadURL": download_url,
        "sha256": archive_sha256,
        "notes": " ".join(notes_lines),
        "publishedAt": published_at,
}

pathlib.Path(legacy_feed_path).write_text(json.dumps(legacy_feed, indent=2) + "\n", encoding="utf-8")
PY

HTTP_STATUS="$(curl -I -L -sS -o /dev/null -w '%{http_code}' "$DOWNLOAD_URL" || true)"

echo
echo "Release archive ready: $ARCHIVE_PATH"
echo "Sparkle appcast updated: $APPCAST_XML"
echo "Legacy migration feed updated: $LEGACY_FEED_JSON"
echo "Archive SHA-256: $ARCHIVE_SHA256"

if [[ "$HTTP_STATUS" != "200" ]]; then
        echo "Warning: $DOWNLOAD_URL returned HTTP $HTTP_STATUS. Upload dist/MacClipper.dmg there before pushing appcast.xml and update-feed.json."
fi
