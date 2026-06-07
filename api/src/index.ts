import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { Firestore, Timestamp } from '@google-cloud/firestore'
import { Storage } from '@google-cloud/storage'
import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))

const PORT = Number(process.env.PORT ?? 8080)
const CHECKINS_COLLECTION = process.env.FIRESTORE_CHECKINS_COLLECTION ?? 'checkins'
const GCS_BUCKET = process.env.GCS_BUCKET_NAME
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'

const firestore = createFirestoreClient()
const storage = createStorageClient()
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null
const inMemoryCheckins = new Map<string, StoredCheckIn[]>()

type StoredCheckIn = {
  id: string
  userId: string
  age: number
  weight: number
  steps: number
  walkingVideoPath?: string
  createdAt: string
}

const dailyCheckInSchema = z.object({
  userId: z.string().trim().min(1),
  age: z.number().int().min(50).max(120),
  weight: z.number().positive().max(400),
  steps: z.number().int().min(0).max(100000),
  walkingVideoPath: z.string().trim().min(1).optional(),
})

const uploadSchema = z.object({
  userId: z.string().trim().min(1),
  fileName: z.string().trim().min(1),
  mimeType: z.enum(['video/mp4', 'video/quicktime', 'video/webm']).default('video/mp4'),
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mrityunjay-ai-api' })
})

app.post('/api/checkins', async (req, res) => {
  const parsed = dailyCheckInSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid check-in payload', details: parsed.error.issues })
  }

  const now = new Date().toISOString()
  const record: StoredCheckIn = {
    id: `checkin_${Date.now()}`,
    ...parsed.data,
    createdAt: now,
  }

  try {
    await saveCheckIn(record)
    return res.status(201).json({
      checkIn: record,
      note: 'This app provides wellness coaching guidance and is not medical diagnosis or treatment advice.',
    })
  } catch (error) {
    return res.status(500).json({ error: 'Unable to save check-in', details: getErrorMessage(error) })
  }
})

app.post('/api/uploads/walking-video-url', async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid upload payload', details: parsed.error.issues })
  }

  if (!storage || !GCS_BUCKET) {
    return res.status(400).json({
      error: 'Video uploads are not configured.',
      details: 'Set GCS_BUCKET_NAME and Google Cloud credentials to enable uploads.',
    })
  }

  const safeName = parsed.data.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const objectPath = `${parsed.data.userId}/${Date.now()}-${safeName}`

  try {
    const [uploadUrl] = await storage
      .bucket(GCS_BUCKET)
      .file(objectPath)
      .getSignedUrl({
        action: 'write',
        version: 'v4',
        expires: Date.now() + 15 * 60 * 1000,
        contentType: parsed.data.mimeType,
      })

    return res.json({ uploadUrl, objectPath, expiresInMinutes: 15 })
  } catch (error) {
    return res.status(500).json({ error: 'Unable to generate upload URL', details: getErrorMessage(error) })
  }
})

app.post('/api/plans/daily', async (req, res) => {
  const userSchema = z.object({ userId: z.string().trim().min(1) })
  const parsed = userSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request payload', details: parsed.error.issues })
  }

  try {
    const latestCheckIn = await getLatestCheckIn(parsed.data.userId)
    if (!latestCheckIn) {
      return res.status(404).json({ error: 'No check-in found for this user.' })
    }

    const plan = await generateDailyPlan(latestCheckIn)
    return res.json({
      userId: parsed.data.userId,
      plan,
      disclaimer: 'Wellness coaching only. This app does not provide medical diagnosis.',
    })
  } catch (error) {
    return res.status(500).json({ error: 'Unable to generate daily plan', details: getErrorMessage(error) })
  }
})

app.get('/api/summaries/weekly/:userId', async (req, res) => {
  const userId = req.params.userId?.trim()
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' })
  }

  try {
    const weeklyCheckins = await getCheckInsForPastDays(userId, 7)
    if (weeklyCheckins.length === 0) {
      return res.status(404).json({ error: 'No check-ins found for this user in the past week.' })
    }

    const summary = await generateWeeklySummary(weeklyCheckins)
    return res.json({
      userId,
      summary,
      disclaimer: 'Wellness coaching summary only. This app is not a medical diagnosis tool.',
    })
  } catch (error) {
    return res.status(500).json({ error: 'Unable to generate weekly summary', details: getErrorMessage(error) })
  }
})

app.listen(PORT, () => {
  console.log(`Mrityunjay AI API running on port ${PORT}`)
})

function createFirestoreClient(): Firestore | null {
  try {
    return new Firestore()
  } catch {
    return null
  }
}

function createStorageClient(): Storage | null {
  try {
    return new Storage()
  } catch {
    return null
  }
}

async function saveCheckIn(record: StoredCheckIn): Promise<void> {
  if (firestore) {
    try {
      await firestore.collection(CHECKINS_COLLECTION).doc(record.id).set({
        ...record,
        createdAt: Timestamp.fromDate(new Date(record.createdAt)),
      })
      return
    } catch {
      // fall back to in-memory persistence for local development without GCP credentials
    }
  }

  const list = inMemoryCheckins.get(record.userId) ?? []
  list.push(record)
  inMemoryCheckins.set(record.userId, list)
}

async function getLatestCheckIn(userId: string): Promise<StoredCheckIn | null> {
  if (firestore) {
    try {
      const snapshot = await firestore
        .collection(CHECKINS_COLLECTION)
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get()

      const doc = snapshot.docs[0]
      if (!doc) return null
      const data = doc.data() as Record<string, unknown>

      return {
        id: doc.id,
        userId: String(data.userId ?? ''),
        age: Number(data.age ?? 0),
        weight: Number(data.weight ?? 0),
        steps: Number(data.steps ?? 0),
        walkingVideoPath: data.walkingVideoPath ? String(data.walkingVideoPath) : undefined,
        createdAt: extractTimestamp(data.createdAt),
      }
    } catch {
      // fall back to in-memory persistence for local development without GCP credentials
    }
  }

  const list = inMemoryCheckins.get(userId) ?? []
  return list.at(-1) ?? null
}

async function getCheckInsForPastDays(userId: string, days: number): Promise<StoredCheckIn[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  if (firestore) {
    try {
      const snapshot = await firestore
        .collection(CHECKINS_COLLECTION)
        .where('userId', '==', userId)
        .where('createdAt', '>=', Timestamp.fromDate(since))
        .orderBy('createdAt', 'desc')
        .get()

      return snapshot.docs.map((doc) => {
        const data = doc.data() as Record<string, unknown>
        return {
          id: doc.id,
          userId: String(data.userId ?? ''),
          age: Number(data.age ?? 0),
          weight: Number(data.weight ?? 0),
          steps: Number(data.steps ?? 0),
          walkingVideoPath: data.walkingVideoPath ? String(data.walkingVideoPath) : undefined,
          createdAt: extractTimestamp(data.createdAt),
        }
      })
    } catch {
      // fall back to in-memory persistence for local development without GCP credentials
    }
  }

  return (inMemoryCheckins.get(userId) ?? []).filter((entry) => new Date(entry.createdAt) >= since)
}

async function generateDailyPlan(checkIn: StoredCheckIn): Promise<string> {
  if (!gemini) {
    return fallbackDailyPlan(checkIn)
  }

  try {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Create a concise daily wellness and recovery plan for an older adult based on this check-in:\n${JSON.stringify(checkIn, null, 2)}`,
      config: {
        systemInstruction:
          'You are a wellness and recovery coach. Never provide diagnosis, treatment, medication instructions, or emergency directives. Keep language simple and supportive.',
      },
    })

    return response.text || fallbackDailyPlan(checkIn)
  } catch {
    return fallbackDailyPlan(checkIn)
  }
}

async function generateWeeklySummary(checkIns: StoredCheckIn[]): Promise<string> {
  if (!gemini) {
    return fallbackWeeklySummary(checkIns)
  }

  try {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Summarize this user's last 7 days of wellness check-ins and suggest safe, non-medical focus areas for next week:\n${JSON.stringify(checkIns, null, 2)}`,
      config: {
        systemInstruction:
          'You are a wellness and recovery coach. Focus on trends in steps, consistency, and gentle lifestyle suggestions. Do not diagnose or prescribe treatment.',
      },
    })

    return response.text || fallbackWeeklySummary(checkIns)
  } catch {
    return fallbackWeeklySummary(checkIns)
  }
}

function fallbackDailyPlan(checkIn: StoredCheckIn): string {
  const hydrationGoal = Math.max(6, Math.min(10, Math.round(checkIn.weight / 12)))
  const stepGoal = Math.max(1500, checkIn.steps + 250)

  return [
    `Today's recovery plan: take ${stepGoal} gentle steps split across 3 short walks.`,
    `Hydration target: ${hydrationGoal} glasses of water through the day.`,
    'Add one low-impact mobility routine (10-15 minutes) and pause if discomfort increases.',
    'Keep meals balanced with protein, fiber, and colorful vegetables for steady energy.',
  ].join(' ')
}

function fallbackWeeklySummary(checkIns: StoredCheckIn[]): string {
  const avgSteps = Math.round(checkIns.reduce((sum, entry) => sum + entry.steps, 0) / checkIns.length)
  const highestSteps = Math.max(...checkIns.map((entry) => entry.steps))

  return [
    `Weekly summary: ${checkIns.length} check-ins logged with an average of ${avgSteps} steps/day.`,
    `Your highest step day reached ${highestSteps} steps.`,
    'Focus next week on consistency: maintain daily movement, hydration, and gradual progression.',
  ].join(' ')
}

function extractTimestamp(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString()
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  return new Date().toISOString()
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'Unknown error'
}
