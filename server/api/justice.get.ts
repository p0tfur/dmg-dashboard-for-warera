import { getJusticeData } from '../utils/wareraService'
import type { Period } from '~~/shared/types/warera'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const period = (query.period as Period) || 'week'
  if (!['week', 'month', 'all'].includes(period)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid period (week|month|all)', })
  }
  setHeader(event, 'Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
  return getJusticeData(period)
})
