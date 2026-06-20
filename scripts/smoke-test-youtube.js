import fs from 'fs'
import os from 'os'
import { downloadYouTubeVideo } from '../lib/youtube-downloader.js'

const url = process.argv[2] || 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
let downloadedFile

try {
  const video = await downloadYouTubeVideo(url, os.tmpdir())
  downloadedFile = video.filePath
  const size = fs.statSync(downloadedFile).size
  fs.unlinkSync(downloadedFile)

  if (size <= 0) throw new Error('Download stream produced no bytes')

  console.log(`YouTube smoke test passed: "${video.title}" (${size} bytes, ${video.mimetype})`)
} catch (error) {
  if (downloadedFile && fs.existsSync(downloadedFile)) fs.unlinkSync(downloadedFile)
  console.error(`YouTube smoke test failed: ${error.message}`)
  process.exitCode = 1
}
