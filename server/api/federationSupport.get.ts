import { getFederationSupportData } from '../utils/wareraService'
import type { Period } from '~~/shared/types/warera'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const period = (query.period as Period) || 'week'
  if (!['week', 'all'].includes(period)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid period (week|all)' })
  }

  const data = await getFederationSupportData(period)

  // Critical: a `building: true` placeholder must NEVER be cached — otherwise
  // the browser/CDN serve it for hours and the frontend's polling never
  // reaches the server. Only cache real (built) data.
  if (data.building) {
    setHeader(event, 'Cache-Control', 'no-store, max-age=0')
  } else {
    setHeader(event, 'Cache-Control', 'public, max-age=7200, stale-while-revalidate=14400')
  }

  return data
})
