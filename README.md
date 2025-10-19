# 💬 RingCentral Voice Integration for OMI

Voice-activated RingCentral messaging, task creation, and calendar events through your OMI device. Simply say "Send ring message to [chat]", "Create ring task for [person]", or "Add ring event [event name]" and AI will automatically handle the rest!

## ✨ Features

- **🎤 Voice-Activated** - Say "Send ring message", "Create ring task", or "Add ring event" and speak naturally
- **🧠 AI-Powered Chat Matching** - AI intelligently matches spoken names to your workspace chats
- **📋 Task Creation** - Create and assign tasks with voice commands, including due dates and times
- **📅 Calendar Events** - Schedule events with natural language date/time parsing
- **📲 Mobile Notifications** - Instant push notifications to your OMI app when actions complete
- **🔐 OAuth Authentication** - Secure RingCentral OAuth 2.0 integration
- **💬 Direct Messages** - Works with DMs, channels, and group chats
- **⚙️ Flexible Settings** - Change settings anytime from mobile-first homepage
- **🤖 Smart Message Extraction** - AI cleans up filler words and formats professionally
- **🔕 Silent Collection** - Only notifies when message is sent
- **📱 Mobile-First UI** - Beautiful responsive RingCentral-themed design
- **🌍 Timezone Support** - Set your timezone for accurate event and task scheduling

## 🚀 Quick Start

### For OMI Users

1. **Install the app** in your OMI mobile app
2. **Authenticate** your RingCentral workspace (one-time)
3. **Start messaging, creating tasks, and scheduling events!**
   - Say: "Send ring message to general saying hello team!"
   - Say: "Post ringcentral message to marketing that the campaign is live"
   - Say: "Create ring task for Lopez due tomorrow at 3pm review the marketing proposal"
   - Say: "Add ring task finish the budget report by Friday"
   - Say: "Add ring event team meeting tomorrow at 2pm"
   - Say: "Schedule ring event client presentation on Friday at 10am for 90 minutes"

### Trigger Phrases

**For Messages:**
- **"Send ring message"** - "Send ring message to general saying..."
- **"Send ringcentral message"** - "Send ringcentral message to marketing that..."
- **"Post ring message"** - "Post ring message to support saying..."
- **"Post ringcentral message"** - "Post ringcentral message in engineering..."

**For Tasks:**
- **"Create ring task"** - "Create ring task for Lopez due tomorrow at 3pm..."
- **"Create ringcentral task"** - "Create ringcentral task review the proposal..."
- **"Add ring task"** - "Add ring task for Sarah finish the report by Friday..."
- **"Make ring task"** - "Make ring task update the website..."

**For Calendar Events:**
- **"Add ring event"** - "Add ring event team meeting tomorrow at 2pm..."
- **"Create ring event"** - "Create ring event client presentation on Friday..."
- **"Schedule ring event"** - "Schedule ring event lunch with Sarah next Monday at noon..."
- **"Add ringcentral event"** - "Add ringcentral event quarterly review..."

### How It Works

**The app intelligently processes your voice commands:**
1. Detects trigger phrase → Starts collecting
2. Collects up to 5 segments OR stops if 7+ second gap detected
3. AI extracts:
   - Chat name (fuzzy matches to your workspace chats)
   - Message content (cleaned and formatted)
4. Fetches fresh chat list automatically (new chats work immediately!)
5. Posts message to RingCentral
6. Notifies you with confirmation! 🎉

**Example:**
```
You: "Send ring message to general saying hello team"
     [collecting segment 1/5...]
You: "hope everyone is having a great day"
     [collecting segment 2/5...]
     [7+ second pause - timeout!]
     → AI processes 2 segments
     
AI Extracted:
Chat: General
Message: "Hello team, hope everyone is having a great day."

     → Message sent! 🔔
```

## 🎯 OMI App Configuration

| Field | Value |
|-------|-------|
| **Webhook URL** | `https://your-app.up.railway.app/webhook` |
| **App Home URL** | `https://your-app.up.railway.app/` ← **Settings are here!** |
| **Auth URL** | `https://your-app.up.railway.app/auth` |
| **Setup Completed URL** | `https://your-app.up.railway.app/setup-completed` |

**Accessing Settings:**
- From OMI app: Tap the integration → Opens homepage with settings automatically
- Direct link: `https://your-app.up.railway.app/?uid=YOUR_USER_ID`
- Settings include: Timezone selector, Chat refresh, Logout

## 🛠️ Development Setup

### Prerequisites

- Node.js (v18 or higher)
- RingCentral account with admin access
- OpenAI API key
- OMI device and app

### Installation

```bash
# Navigate to the directory
cd ringcentral

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys
```

### Configuration

Create `.env` file with:

```env
# RingCentral OAuth Credentials (from developers.ringcentral.com)
RINGCENTRAL_CLIENT_ID=your_client_id
RINGCENTRAL_CLIENT_SECRET=your_client_secret
RINGCENTRAL_SERVER_URL=https://platform.ringcentral.com

# OAuth Redirect URL
REDIRECT_URI=http://localhost:3000/oauth/callback

# OpenAI API Key (for AI chat matching & message extraction)
OPENAI_API_KEY=your_openai_key

# App Settings
PORT=3000
SESSION_SECRET=your-secret-key-change-this-in-production

# OMI API Credentials (for sending mobile notifications)
OMI_APP_ID=your_omi_app_id_here
OMI_APP_SECRET=your_omi_app_secret_here
```

**Get OMI Credentials:**
- `OMI_APP_ID` and `OMI_APP_SECRET` are provided when you create your app in the OMI Developer Portal
- These enable push notifications to the user's mobile device

### RingCentral App Setup

1. Go to [RingCentral Developer Console](https://developers.ringcentral.com/console)
2. Click "Create New App" → "REST API App"
3. Enter app name and select platform
4. Navigate to **OAuth Settings**
5. Add scopes:
   - `Team Messaging` - Read and write access (includes calendar events)
   - `Glip` - For tasks
6. Set redirect URL: `http://localhost:3000/oauth/callback`
7. Copy Client ID and Client Secret to `.env`

**Required Permissions:**
- ✅ **Team Messaging** - Send messages to chats AND create calendar events
- ✅ **Glip** - Create and manage tasks

**Note:** Calendar events use the Team Messaging scope - no separate calendar permission needed!

### Run Locally

```bash
npm start
```

Visit `http://localhost:3000` to test!

## ☁️ Railway Deployment

### Quick Deploy

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/omi-ringcentral-app.git
   git branch -M main
   git push -u origin main
   ```

2. **Deploy on Railway**
   - Go to [railway.app](https://railway.app)
   - New Project → Deploy from GitHub
   - Select your repo
   - Add environment variables (from your `.env`)

3. **Create Volume for Persistent Storage**
   - Settings → Volumes → New Volume
   - Mount path: `/app/data`
   - Size: 1GB

4. **Get your URL**
   - Settings → Networking → Generate Domain
   - You'll get: `your-app.up.railway.app`

5. **Update OAuth Redirect**
   - Railway Variables: `REDIRECT_URI=https://your-app.up.railway.app/oauth/callback`
   - RingCentral App: Update redirect URL to same

6. **Configure OMI**
   - Use your Railway URLs in OMI app settings

### Railway Environment Variables

Add these in Railway dashboard:

```
RINGCENTRAL_CLIENT_ID
RINGCENTRAL_CLIENT_SECRET
RINGCENTRAL_SERVER_URL=https://platform.ringcentral.com
OPENAI_API_KEY
REDIRECT_URI=https://your-app.up.railway.app/oauth/callback
PORT=3000
SESSION_SECRET=<generate-random-secret>
```

## 🧪 Testing

### Web Interface

Visit `https://your-app.up.railway.app/test?dev=true` to:
- Authenticate your RingCentral workspace
- Test voice commands by typing
- See real-time logs
- Verify messages are posting

### With OMI Device

1. Configure webhook URLs in OMI Developer Settings
2. Enable the integration
3. Authenticate RingCentral
4. Say: "Send ring message to general saying hello team!"
5. Wait for AI processing (silent)
6. Get notification with confirmation! 🎉

## 🧠 AI Processing

The app uses OpenAI for intelligent processing:

1. **Chat Matching** - Fuzzy matches spoken chat names to workspace chats
2. **Message Extraction** - Extracts clean message content from voice segments
3. **Cleanup** - Removes filler words, fixes grammar, proper formatting

**Example Transformation:**

```
Input (3 segments):
"to general saying um hello team hope you're all um doing great today"

AI Output:
Chat: General (matched from "general")
Message: "Hello team, hope you're all doing great today"
```

## 📊 How Segments Work

**OMI sends transcripts in segments** as you speak. The app:
- ✅ Detects trigger phrase (Send ring message / Send ringcentral message / Post ring message / Post ringcentral message)
- ✅ Collects up to 5 segments MAX
- ✅ Processes early if 7+ second gap detected (minimum 2 segments)
- ✅ Silent during collection (no spam)
- ✅ AI processes all collected segments together
- ✅ One notification on completion

**Smart Collection:**
- **Max segments:** 5 (including trigger)
- **Timeout:** 7 seconds of silence → processes immediately
- **Minimum:** 2 segments (trigger + content)
- **Duration:** ~5-20 seconds depending on speech
- **Auto-refresh:** Fetches latest chats every time (new chats work immediately!)

## 📋 Task Creation

Create tasks in RingCentral with natural voice commands! The AI will extract:
- **Task title** (required)
- **Assignee** (optional - matches to team members)
- **Due date** (optional - supports relative dates like "tomorrow", "Friday")
- **Due time** (optional - specify time for deadline)

### Task Examples

**Simple task (no assignee or due date):**
- "Create ring task update the website homepage"
- Result: Task created with title "Update the website homepage"

**Task with assignee:**
- "Create ring task for Lopez review the marketing proposal"
- Result: Task assigned to Lopez (fuzzy matched from team members)

**Task with due date:**
- "Add ring task finish the budget report by Friday"
- Result: Task with due date set to next Friday at 11:59 PM

**Task with everything:**
- "Create ring task for Sarah due tomorrow at 3pm update the client presentation"
- Result: Task assigned to Sarah, due tomorrow at 3:00 PM, title "Update the client presentation"

### How Task Matching Works

The AI will:
1. **Match assignee names** - Fuzzy matches spoken names to your RingCentral team members
2. **Parse dates** - Understands "today", "tomorrow", "Friday", "next Monday", etc.
3. **Extract time** - Converts "3pm", "2:30", "15:00" to proper time format
4. **Clean title** - Removes filler words and creates clear, concise task titles

## 📅 Calendar Event Creation

Create calendar events in RingCentral with natural voice commands! The AI will extract:
- **Event name** (required)
- **Start date** (optional - supports relative dates like "tomorrow", "Friday")
- **Start time** (optional - specify time for event start)
- **Duration** (optional - defaults to 60 minutes)
- **Notes/Description** (optional - additional event details)

### Event Examples

**Simple event (date and time):**
- "Add ring event team meeting tomorrow at 2pm"
- Result: Event created for tomorrow at 2:00 PM (60 min duration)

**Event with duration:**
- "Schedule ring event client presentation on Friday at 10am for 90 minutes"
- Result: Event on Friday from 10:00 AM to 11:30 AM

**Event with notes:**
- "Create ring event quarterly review next Monday at 3pm about Q4 results"
- Result: Event with description "Q4 results"

**Event with all details:**
- "Add ring event lunch with Sarah next Monday at noon for 1 hour to discuss project updates"
- Result: Event on next Monday, 12:00 PM - 1:00 PM, with notes about project discussion

### How Event Parsing Works

The AI will:
1. **Parse dates** - Understands "today", "tomorrow", "Friday", "next Monday", etc.
2. **Extract time** - Converts "2pm", "10am", "14:30" to proper time format
3. **Calculate duration** - Parses "90 minutes", "1 hour", "30 min"
4. **Extract notes** - Captures additional context as event description
5. **Timezone aware** - Uses your configured timezone for accurate scheduling

## 📱 Chat Management

### Direct Messages

AI automatically detects person names and sends DMs:
- "Send ring message to John saying can we meet tomorrow"
- "Message Sarah that the report is ready"

### Channels & Group Chats

Works with all RingCentral chat types:
- Public channels: "Send to general saying..."
- Private channels: "Message engineering team..."
- Group chats: "Send to project alpha group..."

### Auto-Refresh

The app **automatically fetches fresh chats** every time you send a message, so new chats work immediately without manual refresh!

You can also manually refresh:
- Click "Refresh Connection" button on homepage
- Or re-authenticate to get latest chats

## 🔐 Security & Privacy

- ✅ OAuth 2.0 authentication (no password storage)
- ✅ Tokens stored securely with file persistence
- ✅ Per-user token isolation
- ✅ HTTPS enforced in production
- ✅ State parameter for CSRF protection
- ✅ Secure scopes: minimal required permissions

## 🐛 Troubleshooting

### "User not authenticated"
- Complete RingCentral OAuth flow
- Check Railway logs for auth errors
- Re-authenticate if needed

### "No chat specified"
- Say the chat/person name clearly
- Use "Refresh Connection" to see available names
- Check pronunciation

### "Message not sending"
- Check Railway logs for errors
- Verify chat exists and you have access
- Ensure RingCentral app has correct scopes
- Check RingCentral API rate limits

### "ngrok not working" (local dev)
- Make sure ngrok is running
- Check if URL changed after restart
- Update OMI app URLs with new ngrok URL

### "Railway deployment fails"
- Verify all environment variables are set
- Check build logs for specific errors
- Ensure `REDIRECT_URI` matches RingCentral app

### "Event/Task creation fails"
- Verify `Team Messaging` and `Glip` scopes are enabled in RingCentral app
- Check if you have permission to create events/tasks in your workspace
- Events use the `/team-messaging/v1/events` endpoint (no separate calendar scope needed)
- Check Railway logs for specific API error messages (look for 400/403 errors)

## 📁 Project Structure

```
ringcentral/
├── server.js                   # Express server with RingCentral & OpenAI
├── message_detector.js         # AI-powered message & chat detection
├── simple_storage.js           # File-based storage (users & sessions)
├── package.json                # Node.js dependencies
├── railway.toml               # Railway deployment config
├── Procfile                   # Alternative deployment platforms
├── .env.example               # Environment template
├── .gitignore                 # Git ignore rules
├── .railwayignore             # Railway ignore rules
├── LICENSE                    # MIT License
├── README.md                  # This file
└── public/                    # Frontend files
    ├── index.html             # Main homepage
    ├── home.js                # Homepage logic
    ├── debug.html             # Debug interface
    ├── app.js                 # Debug interface logic
    └── style.css              # Unified styles
```

## 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Homepage with settings (mobile-first) |
| `/auth` | GET | Start RingCentral OAuth flow |
| `/oauth/callback` | GET | OAuth callback handler |
| `/setup-completed` | GET | Check if user authenticated |
| `/webhook` | POST | Real-time transcript processor |
| `/refresh-chats` | POST | Refresh chat list |
| `/logout` | POST | Logout and clear data |
| `/test` | GET | Web testing interface |
| `/health` | GET | Health check |

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🆘 Support

- **OMI Docs**: [docs.omi.me](https://docs.omi.me)
- **RingCentral API**: [developers.ringcentral.com](https://developers.ringcentral.com)

## 🎉 Credits

Built for the [OMI](https://omi.me) ecosystem.

- **OMI Team** - Amazing wearable AI platform
- **RingCentral** - Team communication platform
- **OpenAI** - Intelligent text processing

---

**Made with ❤️ for voice-first team communication**

**Features:**
- 🎤 Voice-activated RingCentral messaging
- 📋 Voice-activated task creation
- 📅 Voice-activated calendar events
- 🧠 AI-powered chat matching & date/time parsing
- 📱 Mobile-first workspace management
- 🔐 Secure RingCentral OAuth integration
- ⚡ Real-time processing with Railway deployment
- 🌍 Timezone-aware scheduling
