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
    CREATE TABLE IF NOT EXISTS threads (
      thread_id TEXT PRIMARY KEY,
      original_event_id TEXT NOT NULL,
      initial_prompt TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await client.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      event_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (thread_id) REFERENCES threads(thread_id)
    )
  `)
}

export const createThread = async (threadId: string, originalEventId: string, userId: string, initialPrompt: string) => {
  await client.execute({
    sql: 'INSERT INTO threads (thread_id, original_event_id, user_id, initial_prompt) VALUES (?, ?, ?, ?)',
    args: [threadId, originalEventId, userId, initialPrompt],
  })
}

export const addMessage = async (eventId: string, threadId: string, userId: string, message: string) => {
  await client.execute({
    sql: 'INSERT INTO messages (event_id, thread_id, user_id, message) VALUES (?, ?, ?, ?)',
    args: [eventId, threadId, userId, message],
  })
}

export const getContext = async (threadId: string): Promise<Context | null> => {
  const threadResult = await client.execute({
    sql: 'SELECT * FROM threads WHERE thread_id = ?',
    args: [threadId],
  })

  if (threadResult.rows.length === 0) {
    return null
  }

  const thread = threadResult.rows[0]
  const messagesResult = await client.execute({
    sql: 'SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC',
    args: [threadId],
  })

  const conversation = messagesResult.rows.map(row => ({
    userId: row.user_id as string,
    message: row.message as string,
  }))

  return {
    initialPrompt: thread.initial_prompt as string,
    userId: thread.user_id as string,
    conversation,
  }
}

export const threadExists = async (threadId: string): Promise<boolean> => {
  const result = await client.execute({
    sql: 'SELECT 1 FROM threads WHERE thread_id = ? LIMIT 1',
    args: [threadId],
  })
  
  return result.rows.length > 0
}

export const getFirstMessageOfThread = async (threadId: string) => {
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
  
  await createThread(
    threadId,
    firstMessage.event_id as string,
    firstMessage.user_id as string,
    firstMessage.message as string
  )
}