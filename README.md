# Mrityunjay AI

Mrityunjay AI is an AI-powered wellness and recovery coach for older adults and people recovering from injury.

- Frontend: React + TypeScript + Vite (`/app`)
- Backend: Node.js + Express + TypeScript (`/api`)
- Database: Firestore
- File storage: Google Cloud Storage (walking video uploads)
- AI: Gemini API (daily plans and weekly summaries)
- Deployment target: Google Cloud Run

## Quick Start

### 1) API

```bash
cd /tmp/workspace/shivbatra999/mrityunjay-ai/api
cp .env.example .env
npm install
npm run dev
```

### 2) App

```bash
cd /tmp/workspace/shivbatra999/mrityunjay-ai/app
npm install
npm run dev
```

Set `VITE_API_BASE_URL` if your API is not running at `http://localhost:8080`.

See `/tmp/workspace/shivbatra999/mrityunjay-ai/docs/deployment.md` for Firestore, GCS, Gemini, and Cloud Run deployment steps.
