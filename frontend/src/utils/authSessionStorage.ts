const AUTH_SESSION_KEYS = [
  'access_token',
  'refresh_token',
  'user',
  'portfolio_id',
  'admin_own_portfolio_id',
  'admin_view_as',
  'auth_session_generation',
] as const

export interface AuthSessionSnapshot {
  accessToken: string | null
  refreshToken: string | null
  generation: string | null
}

type SessionLockManager = {
  request: <T>(name: string, callback: () => Promise<T> | T) => Promise<T>
}

let sameTabQueue: Promise<void> = Promise.resolve()

async function withAuthSessionLock<T>(callback: () => Promise<T> | T): Promise<T> {
  const locks = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { locks?: SessionLockManager }).locks
  if (locks) return locks.request('tradersdesk-auth-session', callback)

  // This fallback serializes mutations in one tab. Web Locks coordinates tabs when available.
  const previous = sameTabQueue
  let release: () => void = () => {}
  sameTabQueue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    return await callback()
  } finally {
    release()
  }
}

function newSessionGeneration(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function removeAuthSessionStorage(): void {
  AUTH_SESSION_KEYS.forEach((key) => localStorage.removeItem(key))
}

export async function saveAuthSession(
  accessToken: string,
  refreshToken: string,
  user: unknown,
): Promise<string> {
  return withAuthSessionLock(() => {
    const generation = newSessionGeneration()
    localStorage.setItem('access_token', accessToken)
    localStorage.setItem('refresh_token', refreshToken)
    localStorage.setItem('user', JSON.stringify(user))
    localStorage.setItem('auth_session_generation', generation)
    return generation
  })
}

export async function getAuthSessionSnapshot(): Promise<AuthSessionSnapshot> {
  return withAuthSessionLock(() => {
    const accessToken = localStorage.getItem('access_token')
    const refreshToken = localStorage.getItem('refresh_token')
    let generation = localStorage.getItem('auth_session_generation')
    if ((accessToken || refreshToken) && !generation) {
      generation = newSessionGeneration()
      localStorage.setItem('auth_session_generation', generation)
    }
    return { accessToken, refreshToken, generation }
  })
}

export async function isAuthSessionGenerationCurrent(expectedGeneration: string): Promise<boolean> {
  return withAuthSessionLock(() => localStorage.getItem('auth_session_generation') === expectedGeneration)
}

export async function runIfAuthSessionGenerationMatches(
  expectedGeneration: string,
  callback: () => void,
): Promise<boolean> {
  return withAuthSessionLock(() => {
    if (localStorage.getItem('auth_session_generation') !== expectedGeneration) return false
    callback()
    return true
  })
}

export async function persistAuthUserIfGenerationMatches(expectedGeneration: string, user: unknown): Promise<boolean> {
  return withAuthSessionLock(() => {
    if (localStorage.getItem('auth_session_generation') !== expectedGeneration) return false
    localStorage.setItem('user', JSON.stringify(user))
    return true
  })
}

export async function clearAuthSessionStorage(): Promise<void> {
  await withAuthSessionLock(removeAuthSessionStorage)
}

export async function clearAuthSessionIfGenerationMatches(expectedGeneration: string): Promise<boolean> {
  return withAuthSessionLock(() => {
    if (localStorage.getItem('auth_session_generation') !== expectedGeneration) return false
    removeAuthSessionStorage()
    return true
  })
}

export async function updateAccessTokenIfGenerationMatches(
  expectedGeneration: string,
  accessToken: string,
): Promise<boolean> {
  return withAuthSessionLock(() => {
    if (localStorage.getItem('auth_session_generation') !== expectedGeneration) return false
    localStorage.setItem('access_token', accessToken)
    return true
  })
}
