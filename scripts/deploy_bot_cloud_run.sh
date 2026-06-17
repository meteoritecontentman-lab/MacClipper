#!/usr/bin/env bash
set -euo pipefail

# Deploy the Discord bot as an always-on Cloud Run service that is independent
# from website/Firebase hosting deploys.

PROJECT_ID=""
REGION="us-central1"
SERVICE_NAME="macclipper-discord-bot"
API_BASE_URL="https://macclipper-ce502.web.app/api"
DISCORD_TOKEN_SECRET="DISCORD_BOT_TOKEN"
BOT_SHARED_SECRET_NAME="MACCLIPPER_BOT_SHARED_SECRET"
MIN_INSTANCES="1"
MAX_INSTANCES="1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT_ID="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --service)
      SERVICE_NAME="$2"
      shift 2
      ;;
    --api-base-url)
      API_BASE_URL="$2"
      shift 2
      ;;
    --discord-token-secret)
      DISCORD_TOKEN_SECRET="$2"
      shift 2
      ;;
    --bot-shared-secret-name)
      BOT_SHARED_SECRET_NAME="$2"
      shift 2
      ;;
    --min-instances)
      MIN_INSTANCES="$2"
      shift 2
      ;;
    --max-instances)
      MAX_INSTANCES="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI is required. Install Google Cloud SDK first." >&2
  exit 1
fi

if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
fi

if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "(unset)" ]]; then
  echo "No GCP project selected. Pass --project <PROJECT_ID>." >&2
  exit 1
fi

echo "Deploying ${SERVICE_NAME} to project ${PROJECT_ID} (${REGION})"

gcloud run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --source "/Users/meteorite/macclipper/bot" \
  --platform managed \
  --no-allow-unauthenticated \
  --min-instances "$MIN_INSTANCES" \
  --max-instances "$MAX_INSTANCES" \
  --concurrency 80 \
  --cpu 1 \
  --memory 512Mi \
  --no-cpu-throttling \
  --set-env-vars "MACCLIPPER_API_BASE_URL=${API_BASE_URL}" \
  --set-secrets "DISCORD_BOT_TOKEN=${DISCORD_TOKEN_SECRET}:latest,MACCLIPPER_BOT_SHARED_SECRET=${BOT_SHARED_SECRET_NAME}:latest"

echo "Deployment complete."
SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
echo "Bot URL: ${SERVICE_URL}"
echo "Health URL: ${SERVICE_URL}/health"
