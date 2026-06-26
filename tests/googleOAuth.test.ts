import { describe, expect, it } from 'vitest'

import { isUnusableGoogleRefreshTokenError } from '../src/shared/googleOAuth'

describe('googleOAuth', () => {
  it('treats invalid_grant as an unusable refresh token', () => {
    expect(isUnusableGoogleRefreshTokenError({
      code: 'invalid_grant',
      description: 'Token has been expired or revoked.',
      message: 'Token has been expired or revoked.',
    })).toBe(true)
  })

  it('recognizes expired or revoked token messages without a code', () => {
    expect(isUnusableGoogleRefreshTokenError(new Error('Token has been expired or revoked.'))).toBe(true)
  })

  it('does not treat unrelated OAuth errors as refresh token expiration', () => {
    expect(isUnusableGoogleRefreshTokenError({
      code: 'invalid_client',
      description: 'client_secret is missing.',
    })).toBe(false)
  })
})
