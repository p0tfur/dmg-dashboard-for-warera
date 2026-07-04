import { getJusticePlayerDaily } from '../utils/wareraService'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const userId = String(query.userId || '').trim()
  const days = Number(query.days ?? 7)

  if (!userId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing userId' })
  }

  if (!Number.isFinite(days) || days < 1 || days > 7) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid days (1-7)' })
  }

  const data = await getJusticePlayerDaily(userId, days)
  if (data.building) {
    setHeader(event, 'Cache-Control', 'no-store, max-age=0')
  } else {
    setHeader(event, 'Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
  }
  return data
})
