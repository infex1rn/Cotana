import fetch from 'node-fetch'
import { persona, formatResponse } from '../lib/responses.js'
import { isSessionActive } from '../lib/sessions.js'
import dotenv from 'dotenv'

dotenv.config()

const conversationHistory = {}
const MAX_HISTORY_LENGTH = 15
const API_KEY_ENV_NAMES = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'AI_API_KEY']
const DEFAULT_MODEL = 'gemini-3.1-flash-lite'
const FALLBACK_MODELS = [DEFAULT_MODEL, 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-1.5-flash']

function getApiKey() {
  return API_KEY_ENV_NAMES.map(name => process.env[name]?.trim()).find(Boolean)
}

function getCandidateModels() {
  return [...new Set([process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL, ...FALLBACK_MODELS].filter(Boolean))]
}

function shouldTryFallback(errorMessage) {
  if (process.env.GEMINI_MODEL?.trim()) return false
  return /not found|not supported|not exist|404|model/i.test(errorMessage || '')
}

function formatUserRoleContext({
  conn,
  m,
  participants = [],
  groupMetadata = {},
  isROwner = false,
  isOwner = false,
  isMods = false,
  isAdmin = false,
  isBotAdmin = false
} = {}) {
  const ownerNames = (global.owner || [])
    .map(([, name]) => name)
    .filter(Boolean)
    .join(', ') || global.ownername || persona.creator
  const botName = global.botname || conn?.user?.name || persona.name
  const chatType = m?.isGroup ? 'group' : 'private'
  const groupName = m?.isGroup ? (groupMetadata?.subject || 'Unknown group') : 'private chat'
  const participantCount = m?.isGroup ? participants.length : 1

  return [
    `Runtime context:`,
    `- Bot name: ${botName}`,
    `- Creator/owner: ${persona.creator}`,
    `- Configured owner names: ${ownerNames}`,
    `- Chat type: ${chatType}`,
    `- Chat/group name: ${groupName}`,
    `- Group participant count: ${participantCount}`,
    `- The current sender is bot owner: ${isOwner || isROwner ? 'yes' : 'no'}`,
    `- The current sender is a moderator: ${isMods ? 'yes' : 'no'}`,
    `- The current sender is group admin: ${isAdmin ? 'yes' : 'no'}`,
    `- The bot is group admin: ${isBotAdmin ? 'yes' : 'no'}`,
    `Use this runtime context when asked who owns you, who is admin, whether you can moderate, or what chat you are in. Do not claim unknown admin/owner status when the context says otherwise.`
  ].join('\n')
}

let handler = async (m, {
  conn,
  text,
  usedPrefix,
  command,
  participants,
  groupMetadata,
  isROwner,
  isOwner,
  isMods,
  isAdmin,
  isBotAdmin
}) => {
  const chatText = text || m.text
  const apiKey = getApiKey()
  
  if (!apiKey) {
    return m.reply(formatResponse(`Ugh, I need an API key to talk! Set one of these env vars: ${API_KEY_ENV_NAMES.join(', ')}.`))
  }

  if (!chatText && command !== 'resetai') {
    return m.reply(formatResponse(`What do you want, darling? 💅✨\n\nExample: *${usedPrefix}chat* Hey you...`))
  }
  
  const userId = m.sender

  if (command === 'resetai') {
    delete conversationHistory[userId]
    return m.reply(formatResponse("Fine, I forgot everything. We're starting fresh, but don't be boring this time! 😈🍭"))
  }
  
  try {
    await conn.sendPresenceUpdate('composing', m.chat)
    await m.react?.('😈')
    
    if (!conversationHistory[userId]) {
      conversationHistory[userId] = []
    }
    
    // Format history for Gemini
    const contents = []
    
    // System instruction as a "user" role or in the system instruction field (Gemini 1.5 supports system instructions)
    // For simplicity with fetch, we'll put it in the prompt or use the system_instruction field if supported.
    
    conversationHistory[userId].forEach(exchange => {
      contents.push({ role: 'user', parts: [{ text: exchange.user }] })
      contents.push({ role: 'model', parts: [{ text: exchange.assistant }] })
    })
    
    contents.push({ role: 'user', parts: [{ text: chatText }] })
    
    const payload = {
      contents: contents,
      system_instruction: {
        parts: [{
          text: `${persona.systemPrompts.main}\n\n${formatUserRoleContext({
            conn,
            m,
            participants,
            groupMetadata,
            isROwner,
            isOwner,
            isMods,
            isAdmin,
            isBotAdmin
          })}`
        }]
      },
      generationConfig: {
        temperature: 0.9,
        topK: 1,
        topP: 1,
        maxOutputTokens: 768,
      }
    }

    let data
    let modelUsed
    let lastError

    for (const model of getCandidateModels()) {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      data = await response.json()

      if (response.ok) {
        modelUsed = model
        break
      }

      const errorMessage = data.error?.message || `Gemini API Error (${response.status})`
      console.error(`Gemini API Error with ${model}:`, data)
      lastError = new Error(errorMessage)
      if (!shouldTryFallback(errorMessage)) throw lastError
    }

    if (!modelUsed) throw lastError || new Error('Gemini API Error')
    
    if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
      throw new Error("I'm speechless... literally. (Invalid response) 🍭")
    }
    
    const aiResponse = data.candidates[0].content.parts[0].text.trim()
    
    conversationHistory[userId].push({
      user: chatText,
      assistant: aiResponse
    })
    
    if (conversationHistory[userId].length > MAX_HISTORY_LENGTH) {
      conversationHistory[userId].shift()
    }
    
    // Protocol B: Contextual User Target Tagging
    const mention = `@${m.sender.split('@')[0]}`
    const finalResponse = `${mention} ${aiResponse}`
    
    await conn.sendMessage(m.chat, {
      text: formatResponse(finalResponse),
      mentions: [m.sender]
    }, { quoted: m })
    
    await m.react?.('🍒')
    
  } catch (error) {
    console.error('AI Chat Error:', error)
    await m.react?.('❌')
    m.reply(formatResponse(`Oops! 🐍 ${error.message}`))
  }
}

handler.help = ['chat <message>', 'resetai']
handler.tags = ['tools']
handler.command = /^(ai|chat|resetai|cotana)$/i

// Custom matching for sessions
handler.before = async function (m, { conn }) {
  if (isSessionActive(m.chat) && !m.isBaileys && !m.fromMe && !global.prefix.test(m.text)) {
    const text = m.text
    if (!text) return false
    await handler(m, { conn, text, usedPrefix: '', command: 'ai' })
    return true
  }
}

export default handler
