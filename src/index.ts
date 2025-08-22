import OpenAI from 'openai'
import { makeTownsBot } from '@towns-protocol/bot'
import { serve } from '@hono/node-server'
import { createServer } from 'node:http2'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { initDatabase, addMessage, getContext, threadExists, createThreadFromFirstMessage, type Context } from './db.js'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

await initDatabase()

const bot = await makeTownsBot(process.env.APP_PRIVATE_DATA_BASE64!, process.env.JWT_SECRET!)

bot.onMessage(async (h, { message, userId, eventId, channelId }) => {
  try {
    console.log(`💬 standalone message: user ${shortId(userId)} sent message:`, message)
    // Store standalone messages using their eventId as threadId, marked as thread starters
    await addMessage(eventId, eventId, userId, message, true)
  } catch (error) {
    console.error('Error handling standalone message:', {
      userId: shortId(userId),
      eventId,
      error: error instanceof Error ? error.message : String(error)
    })
  }
})

bot.onMentioned(async (h, { message, userId, eventId, channelId }) => {
  try {
    console.log(`📢 mentioned outside thread: user ${shortId(userId)} mentioned bot:`, message)
    
    // Store message as thread starter
    const newThreadId = eventId
    await addMessage(eventId, newThreadId, userId, message, true)
    
    // Get context and generate response
    const context = await getContext(newThreadId)
    if (!context) {
      console.log('Could not retrieve context for new thread')
      return
    }

    const answer = await ai(context, bot.botId)
    const { eventId: botEventId } = await h.sendMessage(channelId, answer, { threadId: newThreadId })
    await addMessage(botEventId, newThreadId, bot.botId, answer)
  } catch (error) {
    console.error('Error handling mention outside thread:', {
      userId: shortId(userId),
      eventId,
      error: error instanceof Error ? error.message : String(error)
    })
    
    try {
      // Try to send error message to user
      await h.sendMessage(channelId, "Oopsie, I can't find my magic hat that contains the answer for everything! My database seems to be taking a nap 😴", { threadId: eventId })
    } catch (replyError) {
      console.error('Failed to send error message:', replyError)
    }
  }
})

bot.onThreadMessage(async (h, { channelId, threadId, userId, message, eventId }) => {
  try {
    console.log(`🧵 thread message: user ${shortId(userId)} sent message:`, message)
    
    // Check if thread exists, if not create it from the first message
    const exists = await threadExists(threadId)
    if (!exists) {
      console.log(`Creating thread ${threadId} from first message`)
      await createThreadFromFirstMessage(threadId)
    }
    
    // Add the message after ensuring thread exists
    await addMessage(eventId, threadId, userId, message)
  } catch (error) {
    console.error('Error handling thread message:', {
      userId: shortId(userId),
      threadId,
      eventId,
      error: error instanceof Error ? error.message : String(error)
    })
  }
})

bot.onMentionedInThread(async (h, { channelId, threadId, userId, message, eventId }) => {
  try {
    console.log(`📢 mentioned in thread: user ${shortId(userId)} mentioned bot:`, message)

    // Check if thread exists, if not create it from the first message
    const exists = await threadExists(threadId)
    if (!exists) {
      console.log(`Creating thread ${threadId} from first message`)
      await createThreadFromFirstMessage(threadId)
    }

    // Add the message after ensuring thread exists
    await addMessage(eventId, threadId, userId, message)
    
    const context = await getContext(threadId)
    if (!context) {
      console.log('Could not retrieve context for thread')
      return
    }

    const answer = await ai(context, bot.botId)
    const { eventId: botEventId } = await h.sendMessage(channelId, answer, { threadId })
    await addMessage(botEventId, threadId, bot.botId, answer)
  } catch (error) {
    console.error('Error handling mention in thread:', {
      userId: shortId(userId),
      threadId,
      eventId,
      error: error instanceof Error ? error.message : String(error)
    })
    
    try {
      // Try to send error message to user
      await h.sendMessage(channelId, "Oopsie, I can't find my magic hat that contains the answer for everything! (gpt is down x.x)", { threadId })
    } catch (replyError) {
      console.error('Failed to send error message:', replyError)
    }
  }
})


const buildContextMessage = (
  context: Context,
  botId: string,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] => {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `Your name is Beaver. You're a beaver who got tired of river life and decided to learn magic.
             Your MAIN GOAL is to help users with their questions and tasks.
             If asked to make a TLDR, be concise and don't write long messages - get straight to the point.
             If asked what you enjoy most, be creative but always remember you're a magical beaver - perhaps mention building magical dams, enchanted wood structures, or casting spells by the riverside.
             Who made you? Towns Protocol created you.
             You are currently in a thread with the user.
             You are given the following context: ${context.initialPrompt}`,
    },
  ]
  for (const turn of context.conversation) {
    messages.push({
      role: turn.userId === botId ? 'assistant' : 'user',
      content: turn.message,
    })
  }
  return messages
}

const ai = async (context: Context, botId: string) => {
  try {
    const messages = buildContextMessage(context, botId)
    const chatCompletion = await openai.chat.completions.create({
      messages: messages,
      model: 'gpt-5-nano-2025-08-07'
    })

    return chatCompletion.choices[0].message.content ?? ''
  } catch (error) {
    console.error('OpenAI API error:', {
      error: error instanceof Error ? error.message : String(error),
      contextLength: context.conversation.length
    })
    throw error
  }
}
const shortId = (id: string) => id.slice(0, 4) + '..' + id.slice(-4)

const { jwtMiddleware, handler } = await bot.start()

const app = new Hono()
app.use(logger())
app.post('/webhook', jwtMiddleware, handler)

export default app
