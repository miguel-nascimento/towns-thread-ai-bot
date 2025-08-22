import { createClient } from '@libsql/client'

export type Context = {
  initialPrompt: string
  userId: string
  conversation: { userId: string; message: string }[]
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

export const initDatabase = async () => {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      event_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      message TEXT NOT NULL,
      is_thread_starter BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}


export const addMessage = async (eventId: string, threadId: string, userId: string, message: string, isThreadStarter = false) => {
  await client.execute({
    sql: 'INSERT INTO messages (event_id, thread_id, user_id, message, is_thread_starter) VALUES (?, ?, ?, ?, ?)',
    args: [eventId, threadId, userId, message, isThreadStarter],
  })
}

export const getContext = async (threadId: string): Promise<Context | null> => {
  // Get all messages for this thread
  const messagesResult = await client.execute({
    sql: 'SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC',
    args: [threadId],
  })

  if (messagesResult.rows.length === 0) {
    return null
  }

  // Find the thread starter message
  const starterMessage = messagesResult.rows.find(row => row.is_thread_starter === 1)
  if (!starterMessage) {
    return null
  }

  const conversation = messagesResult.rows.map(row => ({
    userId: row.user_id as string,
    message: row.message as string,
  }))

  return {
    initialPrompt: starterMessage.message as string,
    userId: starterMessage.user_id as string,
    conversation,
  }
}

export const threadExists = async (threadId: string): Promise<boolean> => {
  const result = await client.execute({
    sql: 'SELECT 1 FROM messages WHERE thread_id = ? LIMIT 1',
    args: [threadId],
  })
  
  return result.rows.length > 0
}

export const getFirstMessageOfThread = async (threadId: string) => {
  // First try to find a message marked as thread starter with this event_id
  const starterResult = await client.execute({
    sql: 'SELECT * FROM messages WHERE event_id = ? AND is_thread_starter = true LIMIT 1',
    args: [threadId],
  })
  
  if (starterResult.rows.length > 0) {
    return starterResult.rows[0]
  }
  
  // Fallback: look for the first message in an existing thread
  const result = await client.execute({
    sql: 'SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT 1',
    args: [threadId],
  })
  
  return result.rows.length > 0 ? result.rows[0] : null
}

export const createThreadFromFirstMessage = async (threadId: string) => {
  const firstMessage = await getFirstMessageOfThread(threadId)
  if (!firstMessage) {
    throw new Error(`No messages found for thread ${threadId}`)
  }
  
  // Update the original message's thread_id if it was stored with its own event_id as thread_id
  if (firstMessage.thread_id === firstMessage.event_id) {
    await client.execute({
      sql: 'UPDATE messages SET thread_id = ? WHERE event_id = ?',
      args: [threadId, firstMessage.event_id],
    })
  }
}