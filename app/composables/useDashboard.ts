import type {
  FederationResponse,
  FederationSupportResponse,
  JusticeResponse,
  MetaResponse,
  Period,
} from '~~/shared/types/warera'

const PERIODS: Period[] = ['week', 'month', 'all']
const REFRESH_MS = 60_000

export function useDashboard() {
  const period = useState<Period>('period', () => 'week')
  const live = useState<boolean>('live', () => true)
  const lastUpdated = useState<string | null>('lastUpdated', () => null)

  const fedPeriod = computed<Period>(() => (period.value === 'month' ? 'all' : period.value))

  const meta = useFetch<MetaResponse | null>('/api/meta', {
    key: 'meta',
    default: () => null,
  })

  const federation = useFetch<FederationResponse | null>('/api/federation', {
    key: 'federation',
    query: { period: fedPeriod },
    default: () => null,
    watch: [fedPeriod],
  })

  const federationSupport = useFetch<FederationSupportResponse | null>(
    '/api/federationSupport',
    {
      key: 'federationSupport',
      query: { period: fedPeriod },
      default: () => null,
      watch: [fedPeriod],
    },
  )

  // The support aggregate can take minutes to build on the server (background
  // scan). When the server returns `building: true`, poll every 15s until the
  // real data is ready — without blocking the other panels.
  let supportTimer: ReturnType<typeof setInterval> | null = null
  watch(
    () => federationSupport.data.value?.building,
    (building) => {
      if (building && !supportTimer) {
        supportTimer = setInterval(() => {
          if (federationSupport.data.value?.building) {
            federationSupport.refresh()
          } else if (supportTimer) {
            clearInterval(supportTimer)
            supportTimer = null
          }
        }, 15_000)
      } else if (!building && supportTimer) {
        clearInterval(supportTimer)
        supportTimer = null
      }
    },
    { immediate: true },
  )

  const justice = useFetch<JusticeResponse | null>('/api/justice', {
    key: 'justice',
    query: { period },
    default: () => null,
    watch: [period],
  })

  async function refresh() {
    await Promise.all([
      meta.refresh(),
      federation.refresh(),
      federationSupport.refresh(),
      justice.refresh(),
    ])
    lastUpdated.value = new Date().toISOString()
  }

  // auto-refresh when "live" is enabled
  let timer: ReturnType<typeof setInterval> | null = null
  onMounted(() => {
    lastUpdated.value = new Date().toISOString()
    timer = setInterval(async () => {
      if (live.value) await refresh()
    }, REFRESH_MS)
  })
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
    if (supportTimer) clearInterval(supportTimer)
  })

  return { period, fedPeriod, live, lastUpdated, meta, federation, federationSupport, justice, refresh }
}

export { PERIODS }
