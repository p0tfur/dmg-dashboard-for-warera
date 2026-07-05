import { getFederationSupportBreakdown } from '../utils/wareraService'
import type { Period } from '~~/shared/types/warera'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const countryId = String(query.countryId || '').trim()
  const period = (query.period as Period) || 'week'

  if (!countryId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing countryId' })
  }
  if (!['week', 'all'].includes(period)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid period (week|all)' })
  }

  const data = await getFederationSupportBreakdown(countryId, period)
  setHeader(event, 'Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
  return data
})
