import { getFederationSupportData } from '../utils/wareraService'
import type { Period } from '~~/shared/types/warera'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const period = (query.period as Period) || 'week'
  if (!['week', 'all'].includes(period)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid period (week|all)', })
  }
  // Aggregation is expensive — allow the CDN/browser to hold it longer than
  // the main federation response. SWR on the server keeps a fresh-enough copy.
  setHeader(event, 'Cache-Control', 'public, max-age=120, stale-while-revalidate=600')
  return getFederationSupportData(period)
})
