# Mrityunjay AI MVP deployment (Google Cloud Run)

## Environment variables (API)

- `PORT=8080`
- `GEMINI_API_KEY=<your-gemini-api-key>`
- `GEMINI_MODEL=gemini-2.5-flash` (optional)
- `FIRESTORE_CHECKINS_COLLECTION=checkins`
- `GCS_BUCKET_NAME=<your-gcs-bucket>`

## Required Google Cloud services

1. Firestore (Native mode)
2. Cloud Storage bucket for walking videos
3. Cloud Run

## API deployment

From `/tmp/workspace/shivbatra999/mrityunjay-ai/api`:

```bash
npm ci
npm run build
```

Deploy to Cloud Run (example):

```bash
gcloud run deploy mrityunjay-ai-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=$GEMINI_API_KEY,GCS_BUCKET_NAME=$GCS_BUCKET_NAME
```

Grant the Cloud Run service account access to:

- Firestore (read/write)
- Storage bucket object admin (or restricted upload permissions)

## Frontend deployment

From `/tmp/workspace/shivbatra999/mrityunjay-ai/app`:

```bash
npm ci
VITE_API_BASE_URL=https://<cloud-run-api-url> npm run build
```

Deploy built static assets with your preferred host (Firebase Hosting / Cloud Run static container / Cloud Storage static hosting).

## Endpoints

- `GET /health`
- `POST /api/checkins`
- `POST /api/uploads/walking-video-url`
- `POST /api/plans/daily`
- `GET /api/summaries/weekly/:userId`

All coaching responses are explicitly non-medical and intended for wellness guidance only.
