import { loadManufacturingCatalog } from '../utils/manufacturingCatalog.js'

const CATALOG_URL = '/industry/manufacturing-scope.json'
const ONE_HOUR = 60 * 60 * 1000

// Public static data only: reuse within this document, and revalidate against
// the server's ETag on an actual fetch. Nothing is persisted across identities
// or documents, and a failed/aborted read never becomes successful cache data.
export function manufacturingCatalogQuery(fetchImpl = fetch) {
  return {
    queryKey: ['manufacturing', 'catalog', CATALOG_URL],
    staleTime: ONE_HOUR,
    gcTime: ONE_HOUR,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const response = await fetchImpl(CATALOG_URL, { cache: 'no-cache', signal })
      if (!response.ok) throw new Error(`catalog ${response.status}`)
      const source = await response.json()
      signal?.throwIfAborted()
      return loadManufacturingCatalog(source)
    },
  }
}
