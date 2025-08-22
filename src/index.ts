import OpenAI from 'openai'
import { makeTownsBot } from '@towns-protocol/bot'
import { serve } from '@hono/node-server'
import { createServer } from 'node:http2'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { initDatabase, createThread, addMessage, getContext, threadExists, createThreadFromFirstMessage, type Context } from './db.js'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

await initDatabase()

const bot = await makeTownsBot(process.env.APP_PRIVATE_DATA_BASE64!, process.env.JWT_SECRET!)

bot.onMessage(async (h, { message, userId, eventId, channelId }) => {
  console.log(`💬 standalone message: user ${shortId(userId)} sent message:`, message)
  // Just store the message, no thread creation for standalone messages
})

bot.onMentioned(async (h, { message, userId, eventId, channelId }) => {
  console.log(`📢 mentioned outside thread: user ${shortId(userId)} mentioned bot:`, message)
  
  // Create new thread with this message
  const newThreadId = eventId
  await createThread(newThreadId, eventId, userId, message)
  await addMessage(eventId, newThreadId, userId, message)
  
  // Get context and generate response
  const context = await getContext(newThreadId)
  if (!context) {
    console.log('Could not retrieve context for new thread')
    return
  }

  const answer = await ai(context, bot.botId)
  const { eventId: botEventId } = await h.sendMessage(channelId, answer, { threadId: newThreadId })
  await addMessage(botEventId, newThreadId, bot.botId, answer)
})

bot.onThreadMessage(async (h, { channelId, threadId, userId, message, eventId }) => {
  console.log(`🧵 thread message: user ${shortId(userId)} sent message:`, message)
  
  // First add the message
  await addMessage(eventId, threadId, userId, message)
  
  // Check if thread exists, if not create it from the first message
  const exists = await threadExists(threadId)
  if (!exists) {
    console.log(`Creating thread ${threadId} from first message`)
    await createThreadFromFirstMessage(threadId)
  }
})

bot.onMentionedInThread(async (h, { channelId, threadId, userId, message, eventId }) => {
  console.log(`📢 mentioned in thread: user ${shortId(userId)} mentioned bot:`, message)

  // First add the message
  await addMessage(eventId, threadId, userId, message)
  
  // Check if thread exists, if not create it from the first message
  const exists = await threadExists(threadId)
  if (!exists) {
    console.log(`Creating thread ${threadId} from first message`)
    await createThreadFromFirstMessage(threadId)
  }
  
  const context = await getContext(threadId)
  if (!context) {
    console.log('Could not retrieve context for thread')
    return
  }

  const answer = await ai(context, bot.botId)
  const { eventId: botEventId } = await h.sendMessage(channelId, answer, { threadId })
  await addMessage(botEventId, threadId, bot.botId, answer)
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
  const messages = buildContextMessage(context, botId)
  const chatCompletion = await openai.chat.completions.create({
    messages: messages,
    model: 'gpt-5-nano-2025-08-07'
  })

  return chatCompletion.choices[0].message.content ?? ''
}
const shortId = (id: string) => id.slice(0, 4) + '..' + id.slice(-4)

const { jwtMiddleware, handler } = await bot.start()

const app = new Hono()
app.use(logger())
app.post('/webhook', jwtMiddleware, handler)

export default app
