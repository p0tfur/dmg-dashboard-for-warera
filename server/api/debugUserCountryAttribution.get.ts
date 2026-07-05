import { debugUserCountryAttribution } from '../utils/wareraService'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const userId = String(query.userId || '').trim()
  const maxBattlePages = Number(query.maxBattlePages ?? 50)

  if (!userId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing userId' })
  }

  if (!Number.isFinite(maxBattlePages) || maxBattlePages < 1 || maxBattlePages > 50) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid maxBattlePages (1-50)' })
  }

  setHeader(event, 'Cache-Control', 'no-store, max-age=0')
  return await debugUserCountryAttribution(userId, maxBattlePages)
})
