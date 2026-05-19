/** Normalize list responses: { data: [] } | { results: [] } | [] */
export function extractList<T>(res: { data: Record<string, unknown> }): T[] {
  const body = res.data
  const raw = body.data ?? body.results ?? body
  return Array.isArray(raw) ? raw : []
}

/** Normalize single-object responses: { data: {} } | {} */
export function extractData<T>(res: { data: Record<string, unknown> }): T {
  const body = res.data
  return (body.data ?? body) as T
}

export function getApiErrorMessage(err: unknown, fallback: string): string {
  const ax = err as {
    response?: { data?: { message?: string; detail?: string } }
    message?: string
  }
  return (
    ax.response?.data?.message ||
    ax.response?.data?.detail ||
    (ax.message?.includes('Network Error')
      ? 'Cannot reach API — check backend is running'
      : fallback)
  )
}
