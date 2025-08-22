# Thread AI Bot

A bot that responds to mentions with AI-powered responses using OpenAI's GPT model, with persistent conversation context stored in Turso database.

## Features

- Responds only when mentioned (not to regular messages)
- Creates new threads when mentioned outside of threads
- Responds in existing threads when mentioned within threads
- Maintains conversation context within threads using Turso database
- Uses OpenAI API for intelligent responses
- Stores complete conversation history for context

## Setup

1. Copy `.env.sample` to `.env` and fill in your credentials
2. Install dependencies: `bun install`
3. Run the bot: `bun dev`

## Environment Variables

- `APP_PRIVATE_DATA_BASE64`: Your Towns app private data
- `JWT_SECRET`: JWT secret for authentication
- `PORT`: Port to run the bot on (default: 5123)
- `OPENAI_API_KEY`: Your OpenAI API key
- `TURSO_DATABASE_URL`: Your Turso database URL
- `TURSO_AUTH_TOKEN`: Your Turso authentication token

## Usage

- **Mention outside thread**: Bot creates a new thread and responds
- **Mention inside thread**: Bot responds with full conversation context
- **Regular messages**: Bot ignores (only responds to mentions)

## Database Schema

The bot uses Turso SQLite database with:
- `threads` table: Stores thread metadata and initial prompts
- `messages` table: Stores all messages for conversation context
