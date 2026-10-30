export const SCHEME_CATALOGUE_PAGE_SIZE = 100

export type SchemeCatalogueListParams = Record<string, string | number>

export function buildSchemeCatalogueListParams(
  page: number,
  search: string,
  filters: Record<string, string>,
): SchemeCatalogueListParams {
  const params: SchemeCatalogueListParams = {
    page,
    page_size: SCHEME_CATALOGUE_PAGE_SIZE,
  }
  if (search) params.search = search
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params[key] = value
  })
  return params
}

export function getSchemeCataloguePageCount(count: number): number {
  return Math.max(1, Math.ceil(count / SCHEME_CATALOGUE_PAGE_SIZE))
}
