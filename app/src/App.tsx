import { useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type CheckInForm = {
  userId: string
  age: string
  weight: string
  steps: string
}

type ApiResponse = {
  error?: string
  details?: string
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

function App() {
  const [form, setForm] = useState<CheckInForm>({ userId: '', age: '', weight: '', steps: '' })
  const [walkingVideo, setWalkingVideo] = useState<File | null>(null)
  const [dailyPlan, setDailyPlan] = useState('')
  const [weeklySummary, setWeeklySummary] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('Saving your check-in...')
    setError('')

    try {
      let walkingVideoPath: string | undefined

      if (walkingVideo) {
        setStatus('Preparing secure walking video upload...')
        const uploadRes = await fetch(`${API_BASE_URL}/api/uploads/walking-video-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: form.userId.trim(),
            fileName: walkingVideo.name,
            mimeType: walkingVideo.type || 'video/mp4',
          }),
        })

        const uploadPayload = (await uploadRes.json()) as
          | { uploadUrl: string; objectPath: string }
          | ApiResponse
        if (!uploadRes.ok || !('uploadUrl' in uploadPayload)) {
          const apiError = (uploadPayload as ApiResponse).error
          throw new Error(apiError ?? 'Unable to prepare video upload')
        }

        setStatus('Uploading walking video...')
        const uploadPut = await fetch(uploadPayload.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': walkingVideo.type || 'video/mp4' },
          body: walkingVideo,
        })

        if (!uploadPut.ok) {
          throw new Error('Failed to upload walking video')
        }

        walkingVideoPath = uploadPayload.objectPath
      }

      setStatus('Creating your daily check-in...')
      const checkinRes = await fetch(`${API_BASE_URL}/api/checkins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: form.userId.trim(),
          age: Number(form.age),
          weight: Number(form.weight),
          steps: Number(form.steps),
          walkingVideoPath,
        }),
      })

      const checkinPayload = (await checkinRes.json()) as ApiResponse
      if (!checkinRes.ok) {
        throw new Error(checkinPayload.error ?? 'Unable to save check-in')
      }

      setStatus('Generating your daily wellness plan...')
      const planRes = await fetch(`${API_BASE_URL}/api/plans/daily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: form.userId.trim() }),
      })
      const planPayload = (await planRes.json()) as { plan?: string } & ApiResponse
      if (!planRes.ok) {
        throw new Error(planPayload.error ?? 'Unable to generate daily plan')
      }

      setStatus('Creating your weekly summary...')
      const summaryRes = await fetch(`${API_BASE_URL}/api/summaries/weekly/${encodeURIComponent(form.userId.trim())}`)
      const summaryPayload = (await summaryRes.json()) as { summary?: string } & ApiResponse
      if (!summaryRes.ok) {
        throw new Error(summaryPayload.error ?? 'Unable to generate weekly summary')
      }

      setDailyPlan(planPayload.plan ?? '')
      setWeeklySummary(summaryPayload.summary ?? '')
      setStatus('Done! Your wellness updates are ready.')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Something went wrong')
      setStatus('')
    }
  }

  return (
    <main className="container">
      <header>
        <h1>Mrityunjay AI</h1>
        <p>
          A wellness and recovery coach for older adults and people healing after injury.
          <strong> This is not a medical diagnosis app.</strong>
        </p>
      </header>

      <form className="card" onSubmit={onSubmit}>
        <h2>Daily Check-In</h2>
        <label>
          User ID
          <input
            required
            value={form.userId}
            onChange={(event) => setForm((prev) => ({ ...prev, userId: event.target.value }))}
            placeholder="e.g. user-001"
          />
        </label>
        <label>
          Age
          <input
            type="number"
            required
            min={50}
            max={120}
            value={form.age}
            onChange={(event) => setForm((prev) => ({ ...prev, age: event.target.value }))}
          />
        </label>
        <label>
          Weight (kg)
          <input
            type="number"
            required
            min={20}
            max={400}
            step="0.1"
            value={form.weight}
            onChange={(event) => setForm((prev) => ({ ...prev, weight: event.target.value }))}
          />
        </label>
        <label>
          Steps Today
          <input
            type="number"
            required
            min={0}
            max={100000}
            value={form.steps}
            onChange={(event) => setForm((prev) => ({ ...prev, steps: event.target.value }))}
          />
        </label>
        <label>
          Walking Video (optional)
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            onChange={(event) => setWalkingVideo(event.target.files?.[0] ?? null)}
          />
        </label>

        <button type="submit">Save Check-In & Generate Coaching</button>
        {status && <p className="status">{status}</p>}
        {error && <p className="error">{error}</p>}
      </form>

      <section className="card results">
        <h2>AI Daily Plan</h2>
        <p>{dailyPlan || 'Your daily plan will appear here after your first check-in.'}</p>
      </section>

      <section className="card results">
        <h2>Weekly Summary</h2>
        <p>{weeklySummary || 'Your weekly trend summary will appear here once check-ins are logged.'}</p>
      </section>
    </main>
  )
}

export default App
