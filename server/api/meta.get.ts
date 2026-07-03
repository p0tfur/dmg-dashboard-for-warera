import { getMeta } from '../utils/wareraService'

export default defineEventHandler(async () => {
  return getMeta()
})
