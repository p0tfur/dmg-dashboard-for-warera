import { getFederationData } from '../utils/wareraService'
import type { Period } from '~~/shared/types/warera'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const period = (query.period as Period) || 'week'
  if (!['week', 'all'].includes(period)) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowy period (week|all)' })
  }
  // Krótki cache HTTP dla CDN/przeglądarki (dane i tak trzymają SWR na serwerze).
  setHeader(event, 'Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
  return getFederationData(period)
})
