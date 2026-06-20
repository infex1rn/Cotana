import fs from 'fs'
import path from 'path'
import ffmpegPath from 'ffmpeg-static'
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
  if (normalized === 'mp3') return 'audio/mpeg'
  if (normalized === 'webm') return 'audio/webm'
  return 'audio/mp4'
}

function findDownloadedFile(dir, marker) {
  const markerText = `_${marker}.`

  const matches = fs.readdirSync(dir)
    .filter(name => name.includes(markerText))
    .map(name => path.join(dir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)

  return matches[0] || null
}

function commonFlags() {
  const cookieFile = getYtDlpCookieFile()
  if (!cookieFile) throw new Error('No valid YouTube cookies were found')
  const proxy = process.env.YTDLP_PROXY?.trim()

  return {
    cookies: cookieFile,
    jsRuntimes: 'node',
    noPlaylist: true,
    noWarnings: true,
    restrictFilenames: true,
    ...(proxy ? { proxy } : {})
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
  const marker = Date.now()
  const output = path.join(tmpDir, `%(title).100B_${marker}.%(ext)s`)
  const isVideo = kind === 'video'
  const format = isVideo
    ? 'best[ext=mp4][vcodec!=none][acodec!=none][height<=720]/18/best[vcodec!=none][acodec!=none][height<=720]/best'
    : 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best'

  await youtubeDl(url, {
    ...commonFlags(),
    format,
    output,
    ...(!isVideo ? {
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 0,
      ...(ffmpegPath ? { ffmpegLocation: ffmpegPath } : {})
    } : {})
  }, { timeout: 180_000 })

  const filePath = findDownloadedFile(tmpDir, marker)
  if (!filePath) throw new Error('yt-dlp finished but no downloaded file was found')

  const ext = path.extname(filePath).replace('.', '') || (kind === 'video' ? 'mp4' : 'm4a')
  const title = path.basename(filePath, path.extname(filePath)).replace(new RegExp(`_${marker}$`), '')

  return {
    title: title || kind,
    filePath,
    fileName: `${safeFileBase(title, kind)}.${ext}`,
    mimetype: mimeFor(ext, kind)
  }
}

export function downloadYouTubeAudio(url, tmpDir) {
  return downloadYouTube(url, tmpDir, 'audio')
}

export function downloadYouTubeVideo(url, tmpDir) {
  return downloadYouTube(url, tmpDir, 'video')
}
