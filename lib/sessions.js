import { persona, formatResponse } from './responses.js'

export const activeSessions = new Map()

export function startSession(chatId, lastUser) {
  const session = {
    chatId,
    lastUser,
    lastActivity: Date.now(),
    timeout: 10 * 60 * 1000, // 10 minutes
    timer: null
  }
  
  if (activeSessions.has(chatId)) {
    clearTimeout(activeSessions.get(chatId).timer)
  }
  
  activeSessions.set(chatId, session)
  return session
}

export function updateSession(chatId, user) {
  if (activeSessions.has(chatId)) {
    const session = activeSessions.get(chatId)
    session.lastActivity = Date.now()
    session.lastUser = user
    return true
  }
  return false
}

export function endSession(chatId) {
  if (activeSessions.has(chatId)) {
    const session = activeSessions.get(chatId)
    clearTimeout(session.timer)
    activeSessions.delete(chatId)
    return true
  }
  return false
}

export function isSessionActive(chatId) {
  return activeSessions.has(chatId)
}

export function setupTimeout(chatId, conn) {
  if (!activeSessions.has(chatId)) return
  
  const session = activeSessions.get(chatId)
  if (session.timer) clearTimeout(session.timer)
  
  session.timer = setTimeout(async () => {
    const lastUser = session.lastUser
    const message = persona.messages.timeout(lastUser)
    
    await conn.sendMessage(chatId, { 
      text: formatResponse(message),
      mentions: [lastUser]
    })
    
    activeSessions.delete(chatId)
  }, session.timeout)
}
