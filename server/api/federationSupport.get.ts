import { getFederationSupportData } from '../utils/wareraService'
import type { Period } from '~~/shared/types/warera'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const period = (query.period as Period) || 'week'
  if (!['week', 'all'].includes(period)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid period (week|all)', })
  }
  // Per-country scan is expensive (~1-2 min) and covers comprehensive history.
  // Match the 2h SWR cache so the browser/CDN hold the response equally long
  // and never trigger a re-fetch storm on the server.
  setHeader(event, 'Cache-Control', 'public, max-age=7200, stale-while-revalidate=14400')
  return getFederationSupportData(period)
})
