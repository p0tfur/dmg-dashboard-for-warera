import { getFederationData } from '../utils/wareraService'
import type { Period } from '~~/shared/types/warera'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const period = (query.period as Period) || 'week'
  if (!['week', 'all'].includes(period)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid period (week|all)', })
  }
  // "all" is cumulative & stable → let the CDN/browser hold it much longer.
  if (period === 'all') {
    setHeader(event, 'Cache-Control', 'public, max-age=1800, stale-while-revalidate=3600')
  } else {
    setHeader(event, 'Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
  }
  return getFederationData(period)
})
