# RingCentral Message Sender

A web application that allows you to send RingCentral messages using natural language. Simply type commands like "Send ringcentral message to general channel hello everyone" and the app will parse your message using OpenAI and send it via RingCentral API.

## Features

- 🔐 OAuth authentication with RingCentral
- 🤖 Natural language processing using OpenAI GPT-4
- 💬 Send messages to RingCentral channels/chats
- 📋 View available channels
- ✨ Modern, responsive UI

## Prerequisites

- Node.js (v14 or higher)
- RingCentral account with API access
- OpenAI API key

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   
   The `.env` file is already configured with your credentials. Make sure it contains:
   ```
   RINGCENTRAL_CLIENT_ID=your_client_id
   RINGCENTRAL_CLIENT_SECRET=your_client_secret
   RINGCENTRAL_SERVER_URL=https://platform.ringcentral.com
   OPENAI_API_KEY=your_openai_key
   PORT=3000
   REDIRECT_URI=http://localhost:3000/oauth/callback
   SESSION_SECRET=your-secret-key-change-this-in-production
   ```

3. **Configure RingCentral OAuth Redirect URI:**
   
   In your RingCentral App settings, add the following redirect URI:
   ```
   http://localhost:3000/oauth/callback
   ```

## Running the Application

1. **Start the server:**
   ```bash
   npm start
   ```
   
   For development with auto-reload:
   ```bash
   npm run dev
   ```

2. **Open your browser:**
   ```
   http://localhost:3000
   ```

3. **Authenticate:**
   - Click "Login with RingCentral"
   - Authorize the application
   - You'll be redirected back to the app

4. **Send messages:**
   - Type naturally: "Send ringcentral message to general channel hello team"
   - The app will extract the channel name and message
   - Click "Send Message"

## Usage Examples

Here are some natural language examples you can use:

- `Send ringcentral message to general channel hello everyone`
- `Send to engineering team we have a bug in production`
- `Message support channel customer needs help with their account`
- `Send to marketing team new campaign is ready to launch`

## How It Works

1. **Natural Language Parsing**: Your input is sent to OpenAI GPT-4, which extracts:
   - Channel/team name
   - Message content

2. **Channel Lookup**: The app searches your RingCentral chats for a matching channel name

3. **Message Sending**: The message is sent to the identified channel via RingCentral API

## API Endpoints

- `GET /` - Main application page
- `GET /api/auth-status` - Check authentication status
- `GET /oauth/login` - Initiate OAuth login
- `GET /oauth/callback` - OAuth callback handler
- `GET /oauth/logout` - Logout endpoint
- `GET /api/chats` - Get available chats/channels
- `POST /api/send-message` - Parse and send message

## Project Structure

```
ringcentral/
├── server.js           # Express server with RingCentral & OpenAI integration
├── package.json        # Dependencies
├── .env               # Environment variables (not in git)
├── .gitignore         # Git ignore file
├── README.md          # This file
└── public/            # Frontend files
    ├── index.html     # Main HTML page
    ├── style.css      # Styles
    └── app.js         # Frontend JavaScript
```

## Security Notes

- Never commit `.env` file to version control
- In production, use HTTPS and set `cookie.secure: true` in session configuration
- Change `SESSION_SECRET` to a strong random value
- Consider using environment-specific redirect URIs

## Troubleshooting

**Authentication Issues:**
- Verify your RingCentral credentials in `.env`
- Check that the redirect URI matches in RingCentral app settings
- Ensure you have the necessary permissions in RingCentral

**Message Sending Issues:**
- Make sure you're authenticated
- Verify the channel name exists (use "Load My Channels" button)
- Check that you have permission to post in the channel

**OpenAI Parsing Issues:**
- Be clear about the channel name in your message
- Follow the example formats provided
- Check your OpenAI API key is valid

## License

MIT

