process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '1'
import './config.js'

import dotenv from 'dotenv'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, watch } from 'fs'
import { createRequire } from 'module'
import path, { join } from 'path'
import { platform } from 'process'
import { fileURLToPath, pathToFileURL } from 'url'
import * as ws from 'ws'
import { useMongoDBAuthState } from './lib/auth/mongo-auth.js'
import * as mongoStore from './lib/auth/mongo-store.js'
import NodeCache from 'node-cache'
import { MongoDB } from './lib/mongoDB.js'

global.__filename = function filename(pathURL = import.meta.url, rmPrefix = platform !== 'win32') {
  return rmPrefix
    ? /file:\/\/\//.test(pathURL)
      ? fileURLToPath(pathURL)
      : pathURL
    : pathToFileURL(pathURL).toString()
}
global.__dirname = function dirname(pathURL) {
  return path.dirname(global.__filename(pathURL, true))
}
global.__require = function require(dir = import.meta.url) {
  return createRequire(dir)
}
global.cotanabot = 'https://api.cotana.tech/api' // Placeholder for Cotana API

import chalk from 'chalk'
import { spawn } from 'child_process'
import lodash from 'lodash'
import { default as Pino, default as pino } from 'pino'
import syntaxerror from 'syntax-error'
import { format } from 'util'
import yargs from 'yargs'
import { makeWASocket, protoType, serialize } from './lib/simple.js'

import makeWASocketPackage, * as baileys from '@whiskeysockets/baileys'
const pkg = { ...baileys, default: makeWASocketPackage }
const {
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
  proto,
  delay,
  useMultiFileAuthState
} = pkg

const makeWASocketDefault = pkg.default || pkg
// Re-map delay to maintain compatibility
const MessageRetryMap = {} 


dotenv.config()

const groupMetadataCache = new NodeCache({ stdTTL: 5 * 60, useClones: false })

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'cotana_bot'

const globalDB = new MongoDB(MONGODB_URI)

global.db = globalDB

global.loadDatabase = async function loadDatabase() {
  try {
    await global.db.read()
    global.db.data = {
      users: {},
      chats: {},
      settings: {},
      stats: {},
      ...(global.db.data || {})
    }
  } catch (error) {
    console.warn(
      chalk.yellow(`MongoDB data store unavailable; using in-memory data store: ${error.message}`)
    )
    global.db = {
      data: {
        users: {},
        chats: {},
        settings: {},
        stats: {}
      },
      async read() {
        return this.data
      },
      async write(data = this.data) {
        this.data = data
        return true
      },
      async close() {}
    }
  }
}

setInterval(async () => {
  await writeDatabaseIfConnected()
}, 60 * 1000)

await global.loadDatabase()

const MAIN_LOGGER = pino({ timestamp: () => `,"time":"${new Date().toJSON()}"` })

const logger = MAIN_LOGGER.child({})
logger.level = 'fatal'

const msgRetryCounterCache = new NodeCache()

const { CONNECTING } = ws
const { chain } = lodash
const PORT = process.env.PORT || process.env.SERVER_PORT || 3000

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs)
    })
  ])
}

protoType()
serialize()

global.API = (name, path = '/', query = {}) =>
  name + path + (query ? '?' + new URLSearchParams(Object.entries(query)) : '')
global.timestamp = {
  start: new Date(),
}

const __dirname = global.__dirname(import.meta.url)
const SESSION_DIR = join(__dirname, 'session')
global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse())
global.prefix = new RegExp(
  '^[' +
    (process.env.PREFIX || '*/i!#$%+£¢€¥^°=¶∆×÷π√✓©®:;?&.\\-.@').replace(
      /[|\\{}()[\]^$+*?.\-\^]/g,
      '\\$&'
    ) +
    ']'
)
global.opts['db'] = process.env.MONGODB_URI

function isPartialUnregisteredSession(creds) {
  return Boolean(
    creds &&
      !creds.registered &&
      (creds.me || creds.account || creds.pairingCode || creds.pairingEphemeralKeyPair)
  )
}

function quarantineLocalSession(reason = 'partial') {
  if (!existsSync(SESSION_DIR)) return false

  const backupDir = join(__dirname, `session-${reason}-${Date.now()}`)
  renameSync(SESSION_DIR, backupDir)
  console.warn(chalk.yellow(`Moved stale local auth session to ${backupDir}`))
  return true
}

let authState
let usingLocalAuth = false
try {
  authState = await useMongoDBAuthState(MONGODB_URI, DB_NAME)
} catch (error) {
  console.warn(
    chalk.yellow(`MongoDB auth store unavailable; using local session files: ${error.message}`)
  )
  usingLocalAuth = true
  mkdirSync(SESSION_DIR, { recursive: true })
  authState = await useMultiFileAuthState(SESSION_DIR)
  if (isPartialUnregisteredSession(authState.state.creds)) {
    await authState.closeConnection?.()
    quarantineLocalSession('partial')
    mkdirSync(SESSION_DIR, { recursive: true })
    authState = await useMultiFileAuthState(SESSION_DIR)
  }
}

const {
  state,
  saveCreds,
  closeConnection = async () => {}
} = authState

const { version: waWebVersion } = await withTimeout(
  fetchLatestBaileysVersion(),
  10000,
  'Timed out fetching latest Baileys version'
).catch(async error => {
  console.warn(
    chalk.yellow(`Unable to fetch latest Baileys version; trying WhatsApp Web version: ${error.message}`)
  )
  return withTimeout(
    fetchLatestWaWebVersion(),
    10000,
    'Timed out fetching latest WhatsApp Web version'
  ).catch(waError => {
    console.warn(
      chalk.yellow(`Unable to fetch latest WhatsApp Web version; using bundled fallback: ${waError.message}`)
    )
    return { version: [2, 3000, 1015901307] }
  })
})

const connectionOptions = {
  logger: Pino({
    level: 'fatal',
  }),
  printQRInTerminal: false,
  version: waWebVersion,
  browser: ['Ubuntu', 'Chrome', '20.0.04'],
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(
      state.keys,
      Pino().child({
        level: 'fatal',
        stream: 'store',
      })
    ),
  },
  markOnlineOnConnect: true,
  generateHighQualityLinkPreview: true,
  cachedGroupMetadata: async (jid) => {
    const cached = groupMetadataCache.get(jid)
    if (cached) return cached
    try {
      const mongoMeta = await mongoStore.groupMetadata(jid, DB_NAME)
      if (mongoMeta) groupMetadataCache.set(jid, mongoMeta)
      return mongoMeta || null
    } catch (e) {
      return null
    }
  },
  getMessage: async key => {
    let jid = jidNormalizedUser(key.remoteJid)
    let msg = await mongoStore.loadMessage(key.id, jid, DB_NAME)
    return msg?.message || ''
  },
  patchMessageBeforeSending: message => {
    const requiresPatch = !!(
      message.buttonsMessage ||
      message.templateMessage ||
      message.listMessage
    )
    if (requiresPatch) {
      message = {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadataVersion: 2,
              deviceListMetadata: {},
            },
            ...message,
          },
        },
      }
    }

    return message
  },
  msgRetryCounterCache,
  defaultQueryTimeoutMs: undefined,
  connectTimeoutMs: 60000,
  syncFullHistory: false,
}

global.conn = makeWASocket(connectionOptions)
conn.isInit = false

let pairingAttempts = 0
let pairingRequestInFlight = false
let pendingPairingRequest = null
let isWhatsAppConnected = false

async function writeDatabaseIfConnected(data = global.db?.data) {
  if (!isWhatsAppConnected || !global.db?.data) return false

  try {
    await global.db.write(data)
    return true
  } catch (error) {
    console.warn(chalk.yellow(`Database write skipped: ${error.message}`))
    return false
  }
}

function cleanPairingPhoneNumber(phoneNumber) {
  return phoneNumber?.replace(/[^0-9]/g, '')
}

function formatPairingCode(code) {
  return code?.replace(/[^0-9A-Za-z]/g, '')?.match(/.{1,4}/g)?.join('-') || code
}

async function saveCredsWhenValid() {
  const creds = global.conn?.authState?.creds
  if (!isWhatsAppConnected && !creds?.registered) return
  await saveCreds()
}

async function fulfillPendingPairingCode(trigger = 'connection.update') {
  if (!pendingPairingRequest || pairingRequestInFlight) return false

  const { phoneNumber, resolve, reject, timeout } = pendingPairingRequest
  const activeConn = global.conn

  if (!activeConn || activeConn.authState.creds.registered) {
    clearTimeout(timeout)
    pendingPairingRequest = null
    pairingRequestInFlight = false
    reject(new Error('Already registered'))
    return false
  }

  pairingRequestInFlight = true
  pairingAttempts += 1

  try {
    const code = await activeConn.requestPairingCode(phoneNumber)
    const formattedCode = formatPairingCode(code)

    global.pairingCode = formattedCode
    console.log(chalk.bold.greenBright(`Your Pairing Code (${trigger}):`) + ' ' + chalk.bgGreenBright(chalk.black(formattedCode)))

    clearTimeout(timeout)
    pendingPairingRequest = null
    resolve(code)
    return true
  } catch (error) {
    clearTimeout(timeout)
    pendingPairingRequest = null
    console.log(
      chalk.bgBlack(chalk.redBright(`Failed to generate pairing code after ${trigger}:`)),
      error
    )
    reject(error)
    return false
  } finally {
    pairingRequestInFlight = false
  }
}

global.requestPairingCode = async function requestPairingCode(phoneNumber) {
  const cleanNumber = cleanPairingPhoneNumber(phoneNumber)

  if (!cleanNumber || cleanNumber.length < 8) throw new Error('Invalid phone number')
  if (global.conn.authState.creds.registered) throw new Error('Already registered')
  if (pendingPairingRequest || pairingRequestInFlight) throw new Error('Pairing request already in progress')

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingPairingRequest = null
      pairingRequestInFlight = false
      reject(new Error('Timed out waiting for socket pairing state'))
    }, 60000)

    pendingPairingRequest = {
      phoneNumber: cleanNumber,
      resolve,
      reject,
      timeout
    }

    try {
      if (global.reloadHandler) await global.reloadHandler(true)
    } catch (error) {
      clearTimeout(timeout)
      pendingPairingRequest = null
      reject(error)
    }
  })
}

conn.logger.info('\nWaiting For Login\n')

if (!opts['test']) {
  if (global.db) {
    setInterval(async () => {
      await writeDatabaseIfConnected()
    }, 30 * 1000)
  }
}

if (opts['server']) (await import('./server.js')).default(global.conn, PORT)

async function connectionUpdate(update) {
  const { connection, lastDisconnect, isNewLogin, qr } = update
  const activeConn = this || global.conn
  const isRegistered = activeConn?.authState?.creds?.registered
  global.stopped = connection

  if (isNewLogin) conn.isInit = true

  if (
    pendingPairingRequest &&
    !isRegistered &&
    qr
  ) {
    await fulfillPendingPairingCode('qr')
  }

  const code =
    lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode

  if (!isRegistered && code === 428) {
    if (process.send) {
      process.send({
        type: 'connection-status',
        connected: false
      })
    }
    conn.logger.error(chalk.yellow('\nConnection closed while waiting for requested pairing'))
    return
  }

  if (code && code !== DisconnectReason.loggedOut && activeConn?.ws.socket == null) {
    try {
      conn.logger.info(await global.reloadHandler(true))
    } catch (error) {
      console.error('Error reloading handler:', error)
    }
  }

  if (code && code === DisconnectReason.restartRequired) {
    conn.logger.info(chalk.yellow('\n🚩 Restart Required... Preparing for restart'))
    
    try {
      if (global.db.data) {
        conn.logger.info(chalk.blue('Saving database before restart...'))
        await writeDatabaseIfConnected()
        conn.logger.info(chalk.green('Database saved successfully'))
      }
    } catch (error) {
      console.error('Error saving database before restart:', error)
    }
    
    if (process.send) {
      process.send('reset')
    } else {
      conn.logger.info(chalk.yellow('Reloading handler...'))
      await global.reloadHandler(true)
    }
  }

  if (global.db.data == null) loadDatabase()

  if (connection === 'open') {
    isWhatsAppConnected = true
    await saveCredsWhenValid()

    if (process.send) {
      process.send({ 
        type: 'connection-status', 
        connected: true 
      })
    }
    
    const { jid, name } = conn.user
    
    try {
      const dashboardStats = await generateDatabaseStats()
      conn.logger.info(chalk.cyan('\n' + dashboardStats + '\n'))
      
      const welcomeMessage = `*🤖 COTANA-BOT DASHBOARD*\n\nHai ${name}, your bot is now online!\n\n${dashboardStats}`

      await conn.sendMessage(jid, { text: welcomeMessage }, { quoted: null })
    } catch (error) {
      console.error('Error generating dashboard:', error)
      const msg = `Hai🤩 ${name}, Congrats you have successfully deployed COTANA-BOT`
      await conn.sendMessage(jid, { text: msg, mentions: [jid] }, { quoted: null })
    }

    conn.logger.info(chalk.yellow('\n🚩 R E A D Y'))
  }

  if (connection === 'close') {
    isWhatsAppConnected = false
    pairingRequestInFlight = false
    if (process.send) {
      process.send({ 
        type: 'connection-status', 
        connected: false 
      })
    }
    conn.logger.error(chalk.yellow(`\nConnection closed... Get a new session`))
  }
}

conn.ev.on('messaging-history.set', ({ messages }) => {
  if (!isWhatsAppConnected) return
  if (messages && messages.length > 0) {
    mongoStore.saveMessages({ messages, type: 'append' }, DB_NAME)
  }
})
conn.ev.on('contacts.update', async (contacts) => {
  if (!isWhatsAppConnected) return
  for (const contact of contacts) await mongoStore.saveContact(contact, DB_NAME)
})
conn.ev.on('contacts.upsert', async (contacts) => {
  if (!isWhatsAppConnected) return
  for (const contact of contacts) await mongoStore.saveContact(contact, DB_NAME)
})
conn.ev.on('messages.upsert', ({ messages }) => {
  if (!isWhatsAppConnected) return
  mongoStore.saveMessages({ messages, type: 'upsert' }, DB_NAME)
})
conn.ev.on('messages.update', async (messageUpdates) => {
  if (!isWhatsAppConnected) return
  mongoStore.saveMessages({ messages: messageUpdates, type: 'update' }, DB_NAME)
})
conn.ev.on('message-receipt.update', async (messageReceipts) => {
  if (!isWhatsAppConnected) return
  mongoStore.saveReceipts(messageReceipts, DB_NAME)
})
conn.ev.on('groups.update', async ([event]) => {
  if (!isWhatsAppConnected) return
  if (event.id) {
    const metadata = await conn.groupMetadata(event.id)
    if (metadata) {
      groupMetadataCache.set(event.id, metadata)
      await mongoStore.saveGroupMetadata(event.id, metadata, DB_NAME).catch(() => {})
    }
  }
})
conn.ev.on('group-participants.update', async (event) => {
  if (!isWhatsAppConnected) return
  if (event.id) {
    const metadata = await conn.groupMetadata(event.id)
    if (metadata) {
      groupMetadataCache.set(event.id, metadata)
      await mongoStore.saveGroupMetadata(event.id, metadata, DB_NAME).catch(() => {})
    }
  }
})

process.on('exit', async () => { await closeConnection() })
process.on('SIGINT', async () => { await closeConnection(); process.exit(0) })
process.on('SIGTERM', async () => { await closeConnection(); process.exit(0) })

process.on('uncaughtException', console.error)

let isInit = true
let handler = await import('./handler.js')
global.reloadHandler = async function (restatConn) {
  try {
    const Handler = await import(`./handler.js?update=${Date.now()}`).catch(console.error)
    if (Object.keys(Handler || {}).length) handler = Handler
  } catch (error) {
    console.error
  }
  if (restatConn) {
    const oldChats = global.conn.chats
    const oldConn = global.conn
    try {
      oldConn.ws.close()
    } catch {}
    oldConn.ev.removeAllListeners()
    global.conn = makeWASocket(connectionOptions, {
      chats: oldChats,
    })
    isInit = true
  }
  const activeConn = global.conn
  if (!isInit) {
    activeConn.ev.off('messages.upsert', activeConn.handler)
    activeConn.ev.off('messages.update', activeConn.pollUpdate)
    activeConn.ev.off('group-participants.update', activeConn.participantsUpdate)
    activeConn.ev.off('groups.update', activeConn.groupsUpdate)
    activeConn.ev.off('message.delete', activeConn.onDelete)
    activeConn.ev.off('presence.update', activeConn.presenceUpdate)
    activeConn.ev.off('connection.update', activeConn.connectionUpdate)
    activeConn.ev.off('creds.update', activeConn.credsUpdate)
  }

  activeConn.welcome = ` Hello @user!\n\n🎉 *WELCOME* to the group @group!\n\n📜 Please read the *DESCRIPTION* @desc.`
  activeConn.bye = `👋GOODBYE @user \n\nSee you later!`
  activeConn.spromote = `*@user* has been promoted to an admin!`
  activeConn.sdemote = `*@user* is no longer an admin.`

  activeConn.handler = handler.handler.bind(activeConn)
  activeConn.pollUpdate = handler.pollUpdate.bind(activeConn)
  activeConn.participantsUpdate = handler.participantsUpdate.bind(activeConn)
  activeConn.groupsUpdate = handler.groupsUpdate.bind(activeConn)
  activeConn.onDelete = handler.deleteUpdate.bind(activeConn)
  activeConn.presenceUpdate = handler.presenceUpdate.bind(activeConn)
  activeConn.connectionUpdate = connectionUpdate.bind(activeConn)
  activeConn.credsUpdate = saveCredsWhenValid.bind(activeConn)

  activeConn.ev.on('messages.upsert', activeConn.handler)
  activeConn.ev.on('messages.update', activeConn.pollUpdate)
  activeConn.ev.on('group-participants.update', activeConn.participantsUpdate)
  activeConn.ev.on('groups.update', activeConn.groupsUpdate)
  activeConn.ev.on('message.delete', activeConn.onDelete)
  activeConn.ev.on('presence.update', activeConn.presenceUpdate)
  activeConn.ev.on('connection.update', activeConn.connectionUpdate)
  activeConn.ev.on('creds.update', activeConn.credsUpdate)
  isInit = false
  return true
}

if (process.on) {
  process.on('message', async (data) => {
    if (typeof data === 'object' && data.type === 'request-pairing-code') {
      try {
        const code = await global.requestPairingCode(data.phoneNumber)
        if (process.send) {
          process.send({
            type: 'pairing-code',
            code,
            error: false
          })
        }
      } catch (error) {
        if (process.send) {
          process.send({
            type: 'pairing-code',
            code: error.message || 'Failed to generate pairing code',
            error: true
          })
        }
      }
    } else if (typeof data === 'object' && data.type === 'request-stats') {
      try {
        const stats = await generateStatsData()
        if (process.send) {
          process.send({ 
            type: 'stats', 
            stats: stats 
          })
        }
      } catch (error) {
        console.error('Error generating stats for parent process:', error)
      }
    }
  })
}

async function generateStatsData() {
  try {
    if (!global.db.data) await global.loadDatabase()
    
    return {
      users: Object.keys(global.db.data.users || {}).length,
      groups: Object.keys(global.db.data.chats || {}).filter(id => id.endsWith('@g.us')).length,
      uptime: formatUptime(process.uptime()),
      memoryUsage: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
    }
  } catch (error) {
    console.error("Error generating stats data:", error)
    return { error: "Failed to generate statistics" }
  }
}

const pluginFolder = join(__dirname, 'plugins')
const pluginFilter = filename => /\.js$/.test(filename)
global.plugins = {}
async function filesInit() {
  for (const filename of readdirSync(pluginFolder).filter(pluginFilter)) {
    try {
      const file = global.__filename(join(pluginFolder, filename))
      const module = await import(file)
      global.plugins[filename] = module.default || module
    } catch (e) {
      conn.logger.error(e)
      delete global.plugins[filename]
    }
  }
}
filesInit()
  .then(_ => Object.keys(global.plugins))
  .catch(console.error)

global.reload = async (_ev, filename) => {
  if (pluginFilter(filename)) {
    const dir = global.__filename(join(pluginFolder, filename), true)
    if (filename in global.plugins) {
      if (existsSync(dir)) conn.logger.info(`\nUpdated plugin - '${filename}'`)
      else {
        conn.logger.warn(`\nDeleted plugin - '${filename}'`)
        return delete global.plugins[filename]
      }
    } else conn.logger.info(`\nNew plugin - '${filename}'`)
    const err = syntaxerror(readFileSync(dir), filename, {
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
    })
    if (err) conn.logger.error(`\nSyntax error while loading '${filename}'\n${format(err)}`)
    else {
      try {
        const module = await import(`${global.__filename(dir)}?update=${Date.now()}`)
        global.plugins[filename] = module.default || module
      } catch (e) {
        conn.logger.error(`\nError require plugin '${filename}\n${format(e)}'`)
      } finally {
        global.plugins = Object.fromEntries(
          Object.entries(global.plugins).sort(([a], [b]) => a.localeCompare(b))
        )
      }
    }
  }
}
Object.freeze(global.reload)
watch(pluginFolder, global.reload)
await global.reloadHandler()

async function generateDatabaseStats() {
  try {
    if (!global.db.data) await global.loadDatabase()
    
    const stats = {
      users: Object.keys(global.db.data.users || {}).length,
      groups: Object.keys(global.db.data.chats || {}).filter(id => id.endsWith('@g.us')).length,
      uptime: formatUptime(process.uptime()),
      memoryUsage: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
    }
    
    return `
┌─────────────────────────────┐
│   🤖 COTANA-BOT DASHBOARD 🤖 │
├─────────────────────────────┤
│                             │
│ 👥 Users: ${padRight(stats.users, 19)} │
│ 👥 Groups: ${padRight(stats.groups, 18)} │
│                             │
│ ⏱️ Uptime: ${padRight(stats.uptime, 18)} │
│ 💾 Memory: ${padRight(stats.memoryUsage, 18)} │
│                             │
└─────────────────────────────┘
    `.trim()
  } catch (error) {
    console.error("Error generating dashboard:", error)
    return "Error generating dashboard statistics"
  }
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / (3600 * 24))
  const hours = Math.floor((seconds % (3600 * 24)) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  let result = ''
  if (days > 0) result += `${days}d `
  if (hours > 0) result += `${hours}h `
  result += `${minutes}m`
  
  return result
}

function padRight(text, length) {
  return String(text).padEnd(length)
}
