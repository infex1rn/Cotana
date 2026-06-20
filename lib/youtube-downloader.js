import fs from 'fs'
import path from 'path'
import youtubeDl from 'youtube-dl-exec'
import { getYtDlpCookieFile } from './youtube-cookies.js'

function safeFileBase(title, fallback = 'youtube') {
  return (title || fallback)
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 100) || fallback
}

function mimeFor(ext, kind) {
  const normalized = ext.toLowerCase()
  if (kind === 'video') return normalized === 'webm' ? 'video/webm' : 'video/mp4'
  if (normalized === 'webm') return 'audio/webm'
  if (normalized === 'mp3') return 'audio/mpeg'
  return 'audio/mp4'
}

function findDownloadedFile(basePath) {
  const dir = path.dirname(basePath)
  const baseName = path.basename(basePath)
  const prefix = `${baseName}.`

  const matches = fs.readdirSync(dir)
    .filter(name => name.startsWith(prefix))
    .map(name => path.join(dir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)

  return matches[0] || null
}

function commonFlags() {
  const cookieFile = getYtDlpCookieFile()
  if (!cookieFile) throw new Error('No valid YouTube cookies were found')

  return {
    cookies: cookieFile,
    jsRuntimes: 'node',
    noPlaylist: true,
    noWarnings: true,
    restrictFilenames: true
  }
}

export async function getYouTubeInfo(url) {
  return youtubeDl(url, {
    ...commonFlags(),
    dumpSingleJson: true,
    skipDownload: true
  }, { timeout: 60_000 })
}

async function downloadYouTube(url, tmpDir, kind) {
  const info = await getYouTubeInfo(url)
  const baseName = safeFileBase(info.title, kind)
  const basePath = path.join(tmpDir, `${baseName}_${Date.now()}`)
  const output = `${basePath}.%(ext)s`
  const format = kind === 'video'
    ? 'best[ext=mp4][vcodec!=none][acodec!=none][height<=720]/18/best[vcodec!=none][acodec!=none][height<=720]/best'
    : 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best'

  await youtubeDl(url, {
    ...commonFlags(),
    format,
    output
  }, { timeout: 180_000 })

  const filePath = findDownloadedFile(basePath)
  if (!filePath) throw new Error('yt-dlp finished but no downloaded file was found')

  const ext = path.extname(filePath).replace('.', '') || (kind === 'video' ? 'mp4' : 'm4a')
  return {
    title: info.title || baseName,
    filePath,
    fileName: `${safeFileBase(info.title, kind)}.${ext}`,
    mimetype: mimeFor(ext, kind)
  }
}

export function downloadYouTubeAudio(url, tmpDir) {
  return downloadYouTube(url, tmpDir, 'audio')
}

export function downloadYouTubeVideo(url, tmpDir) {
  return downloadYouTube(url, tmpDir, 'video')
}
