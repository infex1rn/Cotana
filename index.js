import chalk from 'chalk'
import { spawn } from 'child_process'
import express from 'express'
import figlet from 'figlet'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import bodyParser from 'body-parser'
import dotenv from 'dotenv'

dotenv.config()

let pairingCode = null
let displayPairingCode = null
let isConnected = false
let botProcess = null
let botStats = null
let pendingPairingRequest = null
const mongodbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017'
const pairingState = {
  pendingRequest: null,
  pairingCode: null,
  phoneNumber: null,
  status: 'idle',
  error: null,
  connectedUser: null
}

figlet(
  'COTANA OS',
  {
    font: 'Slant',
    horizontalLayout: 'default',
    verticalLayout: 'default',
  },
  (err, data) => {
    if (err) {
      console.error(chalk.red('Figlet error:', err))
      return
    }
    console.log(chalk.cyan(data))
  }
)

figlet(
  'Automation Engine',
  {
    horizontalLayout: 'default',
    verticalLayout: 'default',
  },
  (err, data) => {
    if (err) {
      console.error(chalk.red('Figlet error:', err))
      return
    }
    console.log(chalk.blue(data))
  }
)

import rateLimit from 'express-rate-limit'
const app = express()
app.set('trust proxy', 1)
const port = process.env.PORT || 5000

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(express.static(path.join(__dirname, 'Assets')))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

const homeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
})

app.get('/', homeLimiter, (req, res) => {
  if (fs.existsSync(path.join(__dirname, 'Assets', 'cotana.html'))) {
    res.sendFile(path.join(__dirname, 'Assets', 'cotana.html'))
  } else {
    res.send('<h1>COTANA BOT</h1><p>Bot is starting...</p>')
  }
})

app.get('/pairing-status', (req, res) => {
  res.json({
    pairingCode: pairingState.pairingCode || pairingCode,
    displayCode: displayPairingCode,
    connected: isConnected,
    status: pairingState.status,
    error: pairingState.error,
    phoneNumber: pairingState.phoneNumber,
    stats: isConnected ? botStats : null
  })
})

app.get('/api/status', (req, res) => {
  res.json({
    bot: process.env.BOTNAME || 'COTANA',
    version: '1.0.0',
    connected: isConnected,
    pairing: {
      status: pairingState.status,
      code: pairingState.pairingCode,
      displayCode: displayPairingCode,
      phoneNumber: pairingState.phoneNumber
    }
  })
})

app.post('/api/pair', async (req, res) => {
  try {
    const { phoneNumber } = req.body

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' })
    }

    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '')

    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
      return res.status(400).json({
        error: 'Invalid phone number. Use format: 1234567890 (10-15 digits with country code)'
      })
    }

    if (isConnected) {
      return res.json({
        success: true,
        alreadyConnected: true,
        message: 'Bot is already connected'
      })
    }

    pairingState.status = 'pending'
    pairingState.phoneNumber = cleanNumber
    pairingState.pairingCode = null
    pairingState.error = null

    try {
      const code = await requestPairingCode(cleanNumber)
      const rawCode = normalizePairingCode(code)
      const formattedCode = formatPairingCode(rawCode)

      pairingState.pairingCode = rawCode
      pairingState.status = 'ready'
      pairingCode = rawCode
      displayPairingCode = formattedCode

      res.json({
        success: true,
        pairingCode: rawCode,
        displayCode: formattedCode,
        phoneNumber: cleanNumber,
        instructions: [
          'Open WhatsApp on your phone',
          'Go to Settings > Linked Devices',
          'Tap "Link a Device"',
          `Enter the code: ${rawCode}`
        ],
        expiresIn: '120 seconds'
      })
    } catch (error) {
      pairingState.status = 'error'
      pairingState.error = error.message
      res.status(500).json({ error: error.message })
    }
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' })
  }
})

app.get('/api/pair/status', (req, res) => {
  res.json({
    status: pairingState.status,
    pairingCode: pairingState.pairingCode,
    displayCode: displayPairingCode,
    phoneNumber: pairingState.phoneNumber,
    error: pairingState.error,
    connected: isConnected,
    user: pairingState.connectedUser
  })
})

app.get('/bot-stats', (req, res) => {
  if (botStats) {
    res.json(botStats)
  } else {
    requestBotStats()
    res.status(503).json({ error: 'Bot statistics not available yet' })
  }
})

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename

if (isMainModule) {
  app.listen(port, () => {
    console.log(chalk.green(`Server running on port ${port}`))
    console.log(chalk.cyan('Open your browser and navigate to:'))
    console.log(chalk.yellow(`http://localhost:${port}`))

    startBot()

    setInterval(requestBotStats, 30000)
  })
}

function startBot() {
  if (botProcess) return

  console.log(chalk.blue('Starting COTANA Bot with:'))
  console.log(chalk.blue(`MongoDB URI:`))
  console.log(chalk.blue('Pairing code will be requested on demand'))

  if (!mongodbUri) {
    console.error(chalk.red('MONGODB_URI environment variable is required!'))
    return
  }

  const args = [path.join(__dirname, 'Cotana.js'), ...process.argv.slice(2)]

  const env = {
    ...process.env,
    MONGODB_URI: mongodbUri,
    PHONE_NUMBER: ''
  }

  botProcess = spawn(process.argv[0], args, {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env
  })

  botProcess.on('message', data => {
    console.log(chalk.cyan(`✔️RECEIVED ${JSON.stringify(data)}`))

    if (typeof data === 'object' && data.type === 'pairing-code') {
      const rawCode = data.error ? null : normalizePairingCode(data.code)
      pairingCode = rawCode || data.code
      displayPairingCode = rawCode ? formatPairingCode(rawCode) : null
      pairingState.pairingCode = rawCode
      pairingState.status = data.error ? 'error' : 'ready'
      pairingState.error = data.error ? data.code : null
      console.log(chalk.green(`Pairing code received: ${pairingCode}`))

      if (pendingPairingRequest) {
        const { resolve, reject, timeout } = pendingPairingRequest
        clearTimeout(timeout)
        pendingPairingRequest = null
        if (data.error) reject(new Error(data.code || 'Failed to generate pairing code'))
        else resolve(rawCode)
      }
    } else if (typeof data === 'object' && data.type === 'connection-status') {
      isConnected = data.connected
      if (isConnected) pairingState.status = 'connected'
      console.log(chalk.green(`Connection status: ${isConnected ? 'Connected' : 'Disconnected'}`))
    } else if (typeof data === 'object' && data.type === 'stats') {
      botStats = data.stats
      console.log(chalk.green(`Bot statistics updated`))
    } else {
      switch (data) {
        case 'reset':
          botProcess.kill()
          botProcess = null
          startBot()
          break
        case 'uptime':
          botProcess.send(process.uptime())
          break
      }
    }
  })

  botProcess.on('exit', code => {
    botProcess = null
    console.error(chalk.red(`❌Bot exited with code: ${code}`))

    if (pendingPairingRequest) {
      const { reject, timeout } = pendingPairingRequest
      clearTimeout(timeout)
      pendingPairingRequest = null
      pairingState.status = 'error'
      pairingState.error = 'Bot exited before generating pairing code'
      reject(new Error(pairingState.error))
    }

    if (code === 0) return

    setTimeout(() => {
      console.log(chalk.yellow('Attempting to restart bot...'))
      startBot()
    }, 5000)
  })

  botProcess.on('error', err => {
    console.error(chalk.red(`Error: ${err}`))
    botProcess.kill()
    botProcess = null

    setTimeout(() => {
      console.log(chalk.yellow('Attempting to restart bot after error...'))
      startBot()
    }, 5000)
  })
}

function requestBotStats() {
  if (botProcess && isConnected) {
    botProcess.send({ type: 'request-stats' })
  }
}

function requestPairingCode(cleanNumber) {
  if (pendingPairingRequest) {
    return Promise.reject(new Error('Pairing request already in progress'))
  }

  if (!botProcess) startBot()

  if (!botProcess || !botProcess.connected) {
    return Promise.reject(new Error('Bot process is not ready'))
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingPairingRequest = null
      pairingState.status = 'error'
      pairingState.error = 'Timed out generating pairing code'
      reject(new Error(pairingState.error))
    }, 120000)

    pendingPairingRequest = { resolve, reject, timeout }
    botProcess.send({ type: 'request-pairing-code', phoneNumber: cleanNumber })
  })
}

function normalizePairingCode(code) {
  const compactCode = code?.replace(/[^0-9A-Za-z]/g, '')
  return compactCode || code
}

function formatPairingCode(code) {
  const compactCode = normalizePairingCode(code)
  return compactCode?.match(/.{1,4}/g)?.join('-') || code
}

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red(`Unhandled promise rejection: ${reason}`))
  console.error(chalk.red(`Bot will restart...`))
  if (botProcess) {
    botProcess.kill()
    botProcess = null
  }
  startBot()
})

process.on('exit', code => {
  console.error(chalk.red(`Exiting with code: ${code}`))
  if (botProcess) {
    botProcess.kill()
  }
})
