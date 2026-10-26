import {
  clearAuthSessionIfGenerationMatches,
  getAuthSessionSnapshot,
  updateAccessTokenIfGenerationMatches,
} from './authSessionStorage.ts'

export type RefreshResult =
  | { status: 'refreshed'; accessToken: string }
  | { status: 'failed'; error: unknown; sessionCleared: boolean }
  | { status: 'stale-session' }

export async function refreshSessionForGeneration(
  expectedGeneration: string,
  requestRefresh: (refreshToken: string) => Promise<string>,
): Promise<RefreshResult> {
  const session = await getAuthSessionSnapshot()
  if (session.generation !== expectedGeneration) {
    return { status: 'stale-session' }
  }
  if (!session.refreshToken) {
    const sessionCleared = await clearAuthSessionIfGenerationMatches(expectedGeneration)
    return { status: 'failed', error: new Error('The active session has no refresh token.'), sessionCleared }
  }

  let accessToken: string
  try {
    accessToken = await requestRefresh(session.refreshToken)
  } catch (error) {
    const sessionCleared = await clearAuthSessionIfGenerationMatches(expectedGeneration)
    return { status: 'failed', error, sessionCleared }
  }

  const updated = await updateAccessTokenIfGenerationMatches(expectedGeneration, accessToken)
  return updated ? { status: 'refreshed', accessToken } : { status: 'stale-session' }
}
