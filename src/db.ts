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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const isRetryableError = (error: any): boolean => {
  if (error?.code === 'SERVER_ERROR' || error?.status === 502 || error?.status === 503) {
    return true
  }
  if (error?.message?.includes('502') || error?.message?.includes('503')) {
    return true
  }
  if (error?.message?.includes('network') || error?.message?.includes('timeout')) {
    return true
  }
  return false
}

const withRetry = async <T>(operation: () => Promise<T>, operationName: string, maxRetries = 3): Promise<T> => {
  let lastError: any
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      
      console.error(`Database operation '${operationName}' failed (attempt ${attempt}/${maxRetries}):`, {
        error: error instanceof Error ? error.message : String(error),
        code: (error as any)?.code,
        status: (error as any)?.status
      })
      
      if (attempt === maxRetries || !isRetryableError(error)) {
        break
      }
      
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
      console.log(`Retrying in ${delayMs}ms...`)
      await sleep(delayMs)
    }
  }
  
  console.error(`Database operation '${operationName}' failed after ${maxRetries} attempts. Last error:`, lastError)
  throw lastError
}

export const initDatabase = async () => {
  try {
    await withRetry(async () => {
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
    }, 'initDatabase')
    console.log('Database initialized successfully')
  } catch (error) {
    console.error('Failed to initialize database:', error)
    throw error
  }
}


export const addMessage = async (eventId: string, threadId: string, userId: string, message: string, isThreadStarter = false) => {
  try {
    await withRetry(async () => {
      await client.execute({
        sql: 'INSERT INTO messages (event_id, thread_id, user_id, message, is_thread_starter) VALUES (?, ?, ?, ?, ?)',
        args: [eventId, threadId, userId, message, isThreadStarter],
      })
    }, `addMessage(eventId: ${eventId}, threadId: ${threadId})`)
  } catch (error) {
    console.error('Failed to add message:', {
      eventId,
      threadId,
      userId: userId.slice(0, 8) + '...',
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

export const getContext = async (threadId: string): Promise<Context | null> => {
  try {
    const messagesResult = await withRetry(async () => {
      return await client.execute({
        sql: 'SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC',
        args: [threadId],
      })
    }, `getContext(threadId: ${threadId})`)

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
  } catch (error) {
    console.error('Failed to get context:', {
      threadId,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

export const threadExists = async (threadId: string): Promise<boolean> => {
  try {
    const result = await withRetry(async () => {
      return await client.execute({
        sql: 'SELECT 1 FROM messages WHERE thread_id = ? LIMIT 1',
        args: [threadId],
      })
    }, `threadExists(threadId: ${threadId})`)
    
    return result.rows.length > 0
  } catch (error) {
    console.error('Failed to check if thread exists:', {
      threadId,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

export const getFirstMessageOfThread = async (threadId: string) => {
  try {
    // First try to find a message marked as thread starter with this event_id
    const starterResult = await withRetry(async () => {
      return await client.execute({
        sql: 'SELECT * FROM messages WHERE event_id = ? AND is_thread_starter = true LIMIT 1',
        args: [threadId],
      })
    }, `getFirstMessageOfThread-starter(threadId: ${threadId})`)
    
    if (starterResult.rows.length > 0) {
      return starterResult.rows[0]
    }
    
    // Fallback: look for the first message in an existing thread
    const result = await withRetry(async () => {
      return await client.execute({
        sql: 'SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT 1',
        args: [threadId],
      })
    }, `getFirstMessageOfThread-fallback(threadId: ${threadId})`)
    
    return result.rows.length > 0 ? result.rows[0] : null
  } catch (error) {
    console.error('Failed to get first message of thread:', {
      threadId,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

export const createThreadFromFirstMessage = async (threadId: string) => {
  try {
    const firstMessage = await getFirstMessageOfThread(threadId)
    if (!firstMessage) {
      throw new Error(`No messages found for thread ${threadId}`)
    }
    
    // Update the original message's thread_id if it was stored with its own event_id as thread_id
    if (firstMessage.thread_id === firstMessage.event_id) {
      await withRetry(async () => {
        await client.execute({
          sql: 'UPDATE messages SET thread_id = ? WHERE event_id = ?',
          args: [threadId, firstMessage.event_id],
        })
      }, `createThreadFromFirstMessage-update(threadId: ${threadId})`)
    }
  } catch (error) {
    console.error('Failed to create thread from first message:', {
      threadId,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}