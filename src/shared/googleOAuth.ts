export const googleCalendarConnectionExpiredMessage = 'Google Calendar 연결이 만료되었습니다. 다시 연결해 주세요.'

export interface GoogleOAuthErrorLike {
  code?: string
  description?: string
  message?: string
}

export function isUnusableGoogleRefreshTokenError(error: unknown): boolean {
  const candidate = error as GoogleOAuthErrorLike
  const code = candidate?.code?.toLowerCase()
  const description = candidate?.description?.toLowerCase() ?? ''
  const message = candidate?.message?.toLowerCase() ?? ''
  const text = `${description} ${message}`

  return code === 'invalid_grant'
    || (text.includes('token') && text.includes('expired'))
    || (text.includes('token') && text.includes('revoked'))
}
