# Discord Bot Always-On Hosting (Cloud Run)

This setup keeps the Discord bot online independently from website/Firebase deploys.

## Log analyzer embed system
- The bot now auto-detects app logs posted in general/support/help channels and replies with a diagnosis embed.
- It reads message text, code blocks, and text-like attachments (`.log`, `.txt`, `.md`, `.json`).
- To restrict analysis to specific channels, set `DISCORD_LOG_ANALYZER_CHANNEL_IDS` to comma-separated channel IDs.
- Feature flags in `bot/.env.example`:
  - `DISCORD_LOG_ANALYZER_ENABLED=true|false`
  - `DISCORD_LOG_ANALYZER_CHANNEL_IDS=123,456`
  - `DISCORD_LOG_ANALYZER_MIN_LINES=8`
  - `DISCORD_LOG_ANALYZER_MAX_CHARS=40000`
  - `DISCORD_LOG_ANALYZER_ATTACHMENT_MAX_BYTES=800000`

## Discord app permissions required
- Enable Message Content Intent in the Discord Developer Portal for your bot application.
- Without Message Content Intent, slash commands still work, but automatic log parsing from chat content will not.

## Why this fixes your outage pattern
- Firebase Hosting serves static web assets and API rewrites, but it does not run your long-lived Discord websocket bot process.
- Deploying website assets should never control bot uptime.
- Cloud Run service `macclipper-discord-bot` runs separately with `min-instances=1`, so website rebuild/redeploy events do not stop the bot.

## Prerequisites
- Google Cloud SDK (`gcloud`) installed
- Authenticated account with access to your project
- Secret Manager secrets created:
  - `DISCORD_BOT_TOKEN`
  - `MACCLIPPER_BOT_SHARED_SECRET`

## Deploy command
From repo root:

```bash
./scripts/deploy_bot_cloud_run.sh --project macclipper-ce502 --region us-central1
```

Optional flags:
- `--service <name>`: override service name
- `--api-base-url <url>`: override API base URL (default: `https://macclipper-ce502.web.app/api`)
- `--discord-token-secret <secret_name>`: override Discord token secret name
- `--bot-shared-secret-name <secret_name>`: override backend bot secret name

## Website status page wiring
Set this env var for the React site build:

```bash
REACT_APP_BOT_HEALTH_URL=https://<cloud-run-service-url>/health
```

Then rebuild/deploy website hosting. The `/bot-hosting` page will report real bot runtime status.

## Emergency local fallback (until Cloud Run is deployed)

```bash
cd /Users/meteorite/macclipper
source .venv/bin/activate
mkdir -p .run/logs
nohup python bot/bot.py > .run/logs/discord-bot.log 2>&1 &
echo $! > .run/discord-bot.pid
```

This keeps bot online on your machine only while the machine/network stay up.
