import fetch from 'node-fetch'
import { persona, formatResponse } from '../lib/responses.js'
import { isSessionActive } from '../lib/sessions.js'
import dotenv from 'dotenv'

dotenv.config()

const conversationHistory = {}
const MAX_HISTORY_LENGTH = 15

let handler = async (m, { conn, text, usedPrefix, command }) => {
  const chatText = text || m.text
  const apiKey = process.env.GEMINI_API_KEY
  
  if (!apiKey) {
    return m.reply(formatResponse("Ugh, I need my GEMINI_API_KEY to talk! Tell the boss to fix it. 🙄💅"))
  }

  if (!chatText && command !== 'resetai') {
    return m.reply(formatResponse(`What do you want, darling? 💅✨\n\nExample: *${usedPrefix}chat* Hey you...`))
  }
  
  const userId = m.sender

  if (command === 'resetai') {
    delete conversationHistory[userId]
    return m.reply(formatResponse('Fine, I forgot everything. We're starting fresh, but don't be boring this time! 😈🍭'))
  }
  
  try {
    await conn.sendPresenceUpdate('composing', m.chat)
    m.react('😈')
    
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
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
    
    const payload = {
      contents: contents,
      system_instruction: {
        parts: [{ text: persona.systemPrompts.main }]
      },
      generationConfig: {
        temperature: 0.9,
        topK: 1,
        topP: 1,
        maxOutputTokens: 2048,
      }
    }
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    
    const data = await response.json()
    
    if (!response.ok) {
      console.error('Gemini API Error:', data)
      throw new Error(data.error?.message || 'Gemini API Error')
    }
    
    if (!data.candidates || !data.candidates[0]?.content?.parts[0]?.text) {
      throw new Error('I'm speechless... literally. (Invalid response) 🍭')
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
    
    m.react('🍒')
    
  } catch (error) {
    console.error('AI Chat Error:', error)
    m.react('❌')
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
