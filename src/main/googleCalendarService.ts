import type {
  GoogleCalendarConnectionStatus,
  GoogleCalendarListItem,
} from '../shared/types'
import type { GoogleCalendarEvent } from '../shared/googleCalendarSchedule'
import type { AppStore } from './store'

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { app, safeStorage, shell } from 'electron'

const credentialsFileName = 'google-calendar-credentials.json'
const calendarReadonlyScope = 'https://www.googleapis.com/auth/calendar.readonly'
const authEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth'
const tokenEndpoint = 'https://oauth2.googleapis.com/token'

interface StoredCredentials {
  encryptedRefreshToken: string
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  error?: string
  error_description?: string
}

interface CalendarListResponse {
  items?: Array<{
    id?: string
    summary?: string
    primary?: boolean
  }>
  error?: {
    message?: string
  }
}

interface EventsResponse {
  items?: GoogleCalendarEvent[]
  error?: {
    message?: string
  }
}

interface LoopbackSession {
  redirectUri: string
  waitForCode: () => Promise<string>
  cancel: (message?: string) => void
}

function clientId(): string {
  return process.env.YOBU_GOOGLE_CLIENT_ID?.trim() ?? ''
}

function clientSecret(): string {
  return process.env.YOBU_GOOGLE_CLIENT_SECRET?.trim() ?? ''
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function codeChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest())
}

function googleErrorMessage(data: TokenResponse | CalendarListResponse | EventsResponse, fallback: string): string {
  if ('error_description' in data && data.error_description === 'client_secret is missing.' && !clientSecret()) {
    return 'OAuth Client가 Web application 타입이라 client_secret을 요구합니다. GCP에서 Desktop app OAuth Client ID를 새로 만들거나, .env에 YOBU_GOOGLE_CLIENT_SECRET을 추가한 뒤 다시 빌드하세요.'
  }
  if ('error_description' in data && data.error_description) {
    return data.error_description
  }
  if ('error' in data && typeof data.error === 'object' && data.error?.message) {
    return data.error.message
  }
  if ('error' in data && typeof data.error === 'string') {
    return data.error
  }
  return fallback
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function tokenRequestBody(body: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams(body)
  const secret = clientSecret()
  if (secret) {
    params.set('client_secret', secret)
  }
  return params
}

function oauthSuccessHtml(): string {
  return [
    '<!doctype html>',
    '<html lang="ko">',
    '<meta charset="utf-8">',
    '<title>Yobu Google Calendar 연결</title>',
    '<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:40px;color:#202124">',
    '<h1>연결되었습니다.</h1>',
    '<p>이 창을 닫고 Yobu로 돌아가세요.</p>',
    '</body>',
  ].join('')
}

function oauthFailureHtml(message: string): string {
  return [
    '<!doctype html>',
    '<html lang="ko">',
    '<meta charset="utf-8">',
    '<title>Yobu Google Calendar 연결 실패</title>',
    '<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:40px;color:#202124">',
    '<h1>연결할 수 없습니다.</h1>',
    `<p>${escapeHtml(message)}</p>`,
    '</body>',
  ].join('')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8')
    return true
  }
  catch {
    return false
  }
}

export class GoogleCalendarService {
  private readonly store: AppStore
  private readonly credentialsPath: string
  private accessToken: { value: string, expiresAt: number } | null = null
  private pendingLoopbackSession: LoopbackSession | null = null

  constructor(store: AppStore) {
    this.store = store
    this.credentialsPath = join(app.getPath('userData'), credentialsFileName)
  }

  async getStatus(): Promise<GoogleCalendarConnectionStatus> {
    const metadata = this.store.getState().calendarConnection
    const configured = Boolean(clientId())

    if (!configured) {
      return {
        configured: false,
        connected: false,
        error: 'Google Client ID가 설정되지 않았습니다.',
        ...metadata,
      }
    }

    if (!safeStorage.isEncryptionAvailable()) {
      return {
        configured: true,
        connected: false,
        error: '토큰 암호화를 사용할 수 없습니다.',
        ...metadata,
      }
    }

    const connected = await pathExists(this.credentialsPath)
    return {
      configured: true,
      connected,
      ...metadata,
    }
  }

  async connect(): Promise<GoogleCalendarConnectionStatus> {
    if (!clientId()) {
      throw new Error('Google Client ID가 설정되지 않았습니다.')
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('토큰 암호화를 사용할 수 없습니다.')
    }

    this.cancelPendingConnect('새 Google 연결 요청으로 이전 연결 대기를 중단했습니다.')

    const state = base64Url(randomBytes(24))
    const verifier = base64Url(randomBytes(48))
    const session = await this.startLoopbackServer(state)
    this.pendingLoopbackSession = session

    try {
      const authUrl = new URL(authEndpoint)
      authUrl.searchParams.set('client_id', clientId())
      authUrl.searchParams.set('redirect_uri', session.redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', calendarReadonlyScope)
      authUrl.searchParams.set('access_type', 'offline')
      authUrl.searchParams.set('prompt', 'consent')
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('code_challenge', codeChallenge(verifier))
      authUrl.searchParams.set('state', state)

      await shell.openExternal(authUrl.toString())
      const code = await session.waitForCode()
      const token = await this.requestToken({
        client_id: clientId(),
        code,
        code_verifier: verifier,
        redirect_uri: session.redirectUri,
        grant_type: 'authorization_code',
      })

      if (!token.refresh_token) {
        throw new Error('refresh token을 받지 못했습니다. 다시 연결해 주세요.')
      }
      if (!token.access_token) {
        throw new Error('access token을 받지 못했습니다.')
      }

      await this.writeRefreshToken(token.refresh_token)
      this.accessToken = {
        value: token.access_token,
        expiresAt: Date.now() + Math.max(60, (token.expires_in ?? 3600) - 60) * 1000,
      }

      const calendars = await this.fetchCalendarList(token.access_token)
      const primary = calendars.find(calendar => calendar.primary) ?? calendars[0]
      const metadata = {
        connectedAt: new Date().toISOString(),
        accountLabel: primary?.id || primary?.summary || 'Google Calendar',
        primaryCalendarId: primary?.id,
      }
      await this.store.updateCalendarConnection(metadata)

      return this.getStatus()
    }
    finally {
      if (this.pendingLoopbackSession === session) {
        this.pendingLoopbackSession = null
      }
    }
  }

  async disconnect(): Promise<GoogleCalendarConnectionStatus> {
    this.accessToken = null
    await rm(this.credentialsPath, { force: true })
    await this.store.updateCalendarConnection(undefined)
    return this.getStatus()
  }

  async listCalendars(): Promise<GoogleCalendarListItem[]> {
    const accessToken = await this.getAccessToken()
    return this.fetchCalendarList(accessToken)
  }

  async fetchEvents(calendarId: string, timeMin: Date, timeMax: Date): Promise<GoogleCalendarEvent[]> {
    const accessToken = await this.getAccessToken()
    return this.fetchEventsWithAccessToken(accessToken, calendarId, timeMin, timeMax)
  }

  private cancelPendingConnect(message?: string): void {
    this.pendingLoopbackSession?.cancel(message)
    this.pendingLoopbackSession = null
  }

  private async startLoopbackServer(expectedState: string): Promise<LoopbackSession> {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    let resolveCode: (code: string) => void = () => {}
    let rejectCode: (error: Error) => void = () => {}

    const codePromise = new Promise<string>((resolve, reject) => {
      resolveCode = resolve
      rejectCode = reject
    })

    function settle(action: () => void): void {
      if (settled) {
        return
      }

      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      action()
      server.close()
    }

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/oauth/callback') {
        response.writeHead(404)
        response.end()
        return
      }

      const returnedState = url.searchParams.get('state')
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      if (error) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(oauthFailureHtml(error))
        settle(() => rejectCode(new Error(error)))
      }
      else if (!code || returnedState !== expectedState) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(oauthFailureHtml('인증 응답이 올바르지 않습니다.'))
        settle(() => rejectCode(new Error('인증 응답이 올바르지 않습니다.')))
      }
      else {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(oauthSuccessHtml())
        settle(() => resolveCode(code))
      }
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })

    timeout = setTimeout(() => {
      settle(() => rejectCode(new Error('Google 연결 시간이 초과되었습니다.')))
    }, 5 * 60_000)

    const address = server.address() as AddressInfo
    return {
      redirectUri: `http://127.0.0.1:${address.port}/oauth/callback`,
      waitForCode: () => codePromise,
      cancel: (message = 'Google 연결을 취소했습니다.') => {
        settle(() => rejectCode(new Error(message)))
      },
    }
  }

  private async requestToken(body: Record<string, string>): Promise<TokenResponse> {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenRequestBody(body),
    })
    const data = await response.json() as TokenResponse
    if (!response.ok) {
      throw new Error(googleErrorMessage(data, 'Google token 요청에 실패했습니다.'))
    }
    return data
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now()) {
      return this.accessToken.value
    }

    const refreshToken = await this.readRefreshToken()
    const token = await this.requestToken({
      client_id: clientId(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })

    if (!token.access_token) {
      throw new Error('Google access token을 갱신할 수 없습니다.')
    }

    this.accessToken = {
      value: token.access_token,
      expiresAt: Date.now() + Math.max(60, (token.expires_in ?? 3600) - 60) * 1000,
    }
    return this.accessToken.value
  }

  private async fetchCalendarList(accessToken: string): Promise<GoogleCalendarListItem[]> {
    const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
    const data = await response.json() as CalendarListResponse
    if (!response.ok) {
      throw new Error(googleErrorMessage(data, '캘린더 목록을 불러올 수 없습니다.'))
    }

    return (data.items ?? [])
      .filter(item => item.id && item.summary)
      .map(item => ({
        id: item.id!,
        summary: item.summary!,
        primary: item.primary === true,
      }))
  }

  private async fetchEventsWithAccessToken(
    accessToken: string,
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<GoogleCalendarEvent[]> {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`)
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('orderBy', 'startTime')
    url.searchParams.set('timeMin', timeMin.toISOString())
    url.searchParams.set('timeMax', timeMax.toISOString())
    url.searchParams.set('maxResults', '250')

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
    const data = await response.json() as EventsResponse
    if (!response.ok) {
      throw new Error(googleErrorMessage(data, '캘린더 일정을 불러올 수 없습니다.'))
    }

    return data.items ?? []
  }

  private async readRefreshToken(): Promise<string> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('토큰 암호화를 사용할 수 없습니다.')
    }

    const raw = await readFile(this.credentialsPath, 'utf8')
    const parsed = JSON.parse(raw) as StoredCredentials
    return safeStorage.decryptString(Buffer.from(parsed.encryptedRefreshToken, 'base64'))
  }

  private async writeRefreshToken(refreshToken: string): Promise<void> {
    const encryptedRefreshToken = safeStorage.encryptString(refreshToken).toString('base64')
    await writeFile(this.credentialsPath, `${JSON.stringify({ encryptedRefreshToken }, null, 2)}\n`, 'utf8')
  }
}
