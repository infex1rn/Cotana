import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import ytdl from '@distube/ytdl-core'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cookieFiles = [
  'youtube-cookie.txt',
  'cookie.txt',
  'cookies.txt',
  path.join('Assets', 'youtube-cookie.txt'),
  path.join('Assets', 'cookies.json')
]

let cachedAgent
let cachedSourceKey
let cachedYtDlpCookieFile
const defaultPlayerClients = ['IOS', 'ANDROID', 'TV']

function boolFromCell(value) {
  if (typeof value === 'boolean') return value
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'true' || normalized === 'yes' || normalized === '✓'
}

function sameSiteFromCell(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (['strict', 'lax', 'none'].includes(normalized)) return normalized
  return undefined
}

function expirationFromCell(value) {
  if (!value) return undefined
  const raw = String(value).trim()
  if (!raw || raw.toLowerCase() === 'session') return undefined

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw)
    return numeric > 1e12 ? Math.floor(numeric / 1000) : numeric
  }

  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000)
}

function parseBrowserTableRow(parts) {
  const [name, value, domain, cookiePath, expires, , httpOnly, secure, sameSite] = parts
  if (!name || !value || !domain) return null

  return {
    name,
    value,
    domain,
    path: cookiePath || '/',
    expirationDate: expirationFromCell(expires),
    httpOnly: boolFromCell(httpOnly),
    secure: boolFromCell(secure),
    sameSite: sameSiteFromCell(sameSite)
  }
}

function parseNetscapeRow(parts) {
  const [domain, , cookiePath, secure, expires, name, value] = parts
  if (!name || !value || !domain) return null

  return {
    name,
    value,
    domain,
    path: cookiePath || '/',
    expirationDate: expirationFromCell(expires),
    secure: boolFromCell(secure)
  }
}

function parseTextCookies(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const parts = line.split('\t').map(part => part.trim())
      if (parts[0]?.toLowerCase() === 'name') return null
      if (parts.length >= 7 && /^(true|false)$/i.test(parts[1])) return parseNetscapeRow(parts)
      return parseBrowserTableRow(parts)
    })
    .filter(Boolean)
}

function normalizeJsonCookies(cookies) {
  if (!Array.isArray(cookies)) return []
  return cookies
    .map(cookie => {
      if (!cookie?.name || !cookie?.value) return null
      return {
        ...cookie,
        expirationDate: cookie.expirationDate ?? expirationFromCell(cookie.expires ?? cookie.expiration)
      }
    })
    .filter(Boolean)
}

function isYouTubeCookie(cookie) {
  const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase()
  return domain === 'youtube.com' || domain.endsWith('.youtube.com')
}

function isCurrentCookie(cookie) {
  return !cookie.expirationDate || cookie.expirationDate > Math.floor(Date.now() / 1000)
}

function findCookieFile() {
  for (const relativePath of cookieFiles) {
    const absolutePath = path.resolve(rootDir, relativePath)
    if (fs.existsSync(absolutePath)) return absolutePath
  }
  return null
}

function loadCookies(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8')
  if (filePath.toLowerCase().endsWith('.json')) return normalizeJsonCookies(JSON.parse(text))
  return parseTextCookies(text)
}

function sourceKeyFor(filePath) {
  const stat = fs.statSync(filePath)
  return `${filePath}:${stat.mtimeMs}:${stat.size}`
}

function toNetscapeCookie(cookie) {
  const domain = String(cookie.domain || '').trim()
  const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE'
  const cookiePath = cookie.path || '/'
  const secure = cookie.secure ? 'TRUE' : 'FALSE'
  const expires = cookie.expirationDate ? String(cookie.expirationDate) : '0'
  const httpOnlyPrefix = cookie.httpOnly ? '#HttpOnly_' : ''

  return [
    `${httpOnlyPrefix}${domain}`,
    includeSubdomains,
    cookiePath,
    secure,
    expires,
    cookie.name,
    cookie.value
  ].join('\t')
}

export function getParsedYouTubeCookies({ youtubeOnly = false } = {}) {
  const filePath = findCookieFile()
  if (!filePath) return { cookies: [], filePath: null, sourceKey: null }

  const cookies = loadCookies(filePath).filter(isCurrentCookie)
  const filteredCookies = youtubeOnly ? cookies.filter(isYouTubeCookie) : cookies

  return {
    cookies: filteredCookies,
    filePath,
    sourceKey: sourceKeyFor(filePath),
    skipped: cookies.length - filteredCookies.length
  }
}

export function getYtDlpCookieFile() {
  const { cookies, filePath, sourceKey, skipped } = getParsedYouTubeCookies({ youtubeOnly: true })
  if (!filePath || !cookies.length) return null

  if (cachedYtDlpCookieFile?.sourceKey === sourceKey && fs.existsSync(cachedYtDlpCookieFile.filePath)) {
    return cachedYtDlpCookieFile.filePath
  }

  const cookieFile = path.join(os.tmpdir(), 'cotana-youtube-cookies.txt')
  const body = ['# Netscape HTTP Cookie File', ...cookies.map(toNetscapeCookie)].join('\n')
  fs.writeFileSync(cookieFile, `${body}\n`, { mode: 0o600 })

  cachedYtDlpCookieFile = { filePath: cookieFile, sourceKey }
  console.log(`Prepared yt-dlp cookies from ${path.relative(rootDir, filePath)}`)
  if (skipped) console.warn(`Skipped ${skipped} non-YouTube cookies from ${path.relative(rootDir, filePath)}`)
  return cookieFile
}

export function getYouTubeAgent() {
  const filePath = findCookieFile()
  if (!filePath) return undefined

  try {
    const sourceKey = sourceKeyFor(filePath)
    if (cachedAgent && cachedSourceKey === sourceKey) return cachedAgent

    const { cookies, skipped } = getParsedYouTubeCookies({ youtubeOnly: true })
    if (!cookies.length) {
      console.warn(`YouTube cookie file found but no valid cookies were parsed: ${path.relative(rootDir, filePath)}`)
      return undefined
    }
    if (skipped) {
      console.warn(`Skipped ${skipped} non-YouTube cookies from ${path.relative(rootDir, filePath)}`)
    }

    cachedAgent = ytdl.createAgent(cookies)
    cachedSourceKey = sourceKey
    console.log(`Loaded ${cookies.length} YouTube cookies from ${path.relative(rootDir, filePath)}`)
    return cachedAgent
  } catch (error) {
    console.error('Error loading YouTube cookies:', error)
    return undefined
  }
}

export function getYouTubeOptions(extraOptions = {}) {
  const agent = getYouTubeAgent()
  return {
    ...extraOptions,
    playerClients: extraOptions.playerClients || defaultPlayerClients,
    ...(agent ? { agent } : {})
  }
}
