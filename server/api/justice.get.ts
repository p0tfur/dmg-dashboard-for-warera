import { getJusticeData } from '../utils/wareraService'
import type { Period } from '~~/shared/types/warera'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const period = (query.period as Period) || 'week'
  if (!['week', 'month', 'all'].includes(period)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid period (week|month|all)', })
  }
  // "all" = cumulative (very stable). "month" resets monthly. "week" = active.
  if (period === 'all') {
    setHeader(event, 'Cache-Control', 'public, max-age=1800, stale-while-revalidate=3600')
  } else if (period === 'month') {
    setHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  } else {
    setHeader(event, 'Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
  }
  return getJusticeData(period)
})
