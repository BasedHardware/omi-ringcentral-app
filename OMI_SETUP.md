# 🔔 OMI RingCentral App - Setup Guide

## ✅ Current Status

This RingCentral app is now an OMI integration, working just like the Slack app!

---

## 🚀 Quick Start

### Step 1: Start the Server

```bash
cd /Users/aaravgarg/omi-ai/Code/apps/ringcentral
npm start
```

The server will start on `http://localhost:3000`

### Step 2: Start ngrok (in a new terminal)

```bash
ngrok http 3000
```

You'll get a public URL like: `https://abc123.ngrok-free.app`

---

## 📱 OMI App Configuration

### **Use These URLs in OMI Developer Settings:**

Replace `https://your-ngrok-url.ngrok-free.app` with your actual ngrok URL:

```
App Home URL:
https://your-ngrok-url.ngrok-free.app/

Auth URL:
https://your-ngrok-url.ngrok-free.app/auth

Webhook URL:
https://your-ngrok-url.ngrok-free.app/webhook

Setup Completed URL:
https://your-ngrok-url.ngrok-free.app/setup-completed
```

---

## 🎯 Trigger Phrases (ONLY these 4)

1. **"Send ring message"**
   - Example: "Send ring message to general saying hello team"

2. **"Send ringcentral message"**
   - Example: "Send ringcentral message to marketing that campaign is live"

3. **"Post ring message"**
   - Example: "Post ring message to john saying can we meet tomorrow"

4. **"Post ringcentral message"**
   - Example: "Post ringcentral message in support saying customer needs help"

---

## ⚙️ How It Works

### **Segment Collection:**
- **Max:** 5 segments (including trigger)
- **Timeout:** 5 seconds of silence → processes immediately
- **Minimum:** 2 segments (trigger + content)

### **Chat Detection:**
- Automatically fetches fresh chats every time
- New chats work immediately (no refresh needed!)
- AI fuzzy matches spoken names to workspace chats
- Works with channels, groups, and direct messages

### **Example Flow:**

```
You: "Send ring message to general saying quick update"
     [Segment 1 - collecting...]
     
You: "the new feature is ready to launch"
     [Segment 2 - collecting...]
     
     [5+ second pause detected]
     
     → Processing 2 segments...
     → Chat: General (auto-fetched)
     → Message: "Quick update, the new feature is ready to launch."
     → ✅ Sent!
```

---

## 🚀 Features

### ✨ **Smart Features:**
- **Auto-refresh chats** - Always up-to-date, no manual refresh
- **Fuzzy chat matching** - AI matches imperfect pronunciations
- **5-second timeout** - Process early if you pause
- **Max 5 segments** - Prevents runaway collection
- **Direct messages** - Works with DMs, not just channels
- **Group chats** - Supports all RingCentral chat types

### 🎤 **Voice Examples:**

**Quick message (2 segments + timeout):**
```
"Send ring message to general saying hello"
[pause 5 seconds]
→ Sends immediately
```

**Longer message (up to 5 segments):**
```
"Send ringcentral message to marketing that the new campaign is live"
[continue speaking...]
"and all the materials are ready to go"
[continue speaking...]
"team did an amazing job on this"
→ Collects all 5 segments then sends
```

**Direct message:**
```
"Send ring message to john saying can we schedule a meeting"
[pause or continue...]
→ Sends DM to John
```

---

## 🛠️ Settings Page Features

Visit: **https://your-ngrok-url.ngrok-free.app/?uid=YOUR_USER_ID**

1. **View Available Chats** - See all accessible chats/channels
2. **Refresh Chats** - Manually refresh if needed
3. **Logout** - Clear data and re-authenticate

---

## 📊 What's Different from Slack App

1. **Different trigger phrases** - RingCentral-specific triggers
2. **Direct messages supported** - Can message individuals directly
3. **Group chats** - Full support for all chat types
4. **RingCentral OAuth** - Different auth flow than Slack

---

## ⚠️ Important Notes

### **Keep Both Running:**
- ✅ Node server: `npm start`
- ✅ ngrok: `ngrok http 3000`

### **ngrok URL Changes:**
- Free ngrok URLs change on restart
- Update OMI app URLs if you restart ngrok
- For permanent URL, deploy to production (Railway, etc.)

### **Testing Locally:**
- Use the test interface: `http://localhost:3000/test?dev=true`
- Authenticate and try voice commands via the web interface

---

## 🧪 Testing Checklist

Before connecting OMI, verify:

1. ✅ Server running: `http://localhost:3000/health`
2. ✅ ngrok working: Visit your ngrok URL
3. ✅ Test interface works: `https://your-ngrok-url.ngrok-free.app/test?dev=true`
4. ✅ RingCentral authenticated
5. ✅ Messages sending successfully
6. ✅ New chats auto-detected

---

## 🎉 Ready to Connect OMI!

1. **Add URLs to OMI app** (copy from top of this doc)
2. **Enable the integration**
3. **Say:** "Send ring message to general saying testing from OMI!"
4. **Watch it work!** 🚀

---

## 💡 Pro Tips for OMI Usage

- **Be clear with chat names** - "general", "marketing", "john"
- **Pause 5+ seconds** to trigger early processing
- **Speak naturally** - AI cleans up filler words
- **New chats work immediately** - No manual refresh needed!
- **Direct messages** - Just say the person's name

---

## 🔧 Troubleshooting

### "User not authenticated"
- Complete RingCentral OAuth flow
- Check logs for auth errors
- Re-authenticate if needed

### "No chat specified"
- Say the chat/person name clearly
- Use "Refresh Chats" to see available names
- Check pronunciation

### "Message not sending"
- Check server logs for errors
- Verify chat exists and you have access
- Ensure RingCentral app has correct permissions

### "ngrok not working"
- Make sure ngrok is running
- Check if URL changed after restart
- Update OMI app URLs with new ngrok URL

---

**Your RingCentral voice messaging app is ready!** 📞✨


