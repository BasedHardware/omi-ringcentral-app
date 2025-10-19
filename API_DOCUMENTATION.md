# 🔌 RingCentral Integration API Documentation

External API endpoints for interacting with RingCentral on behalf of authenticated OMI users.

## 📋 Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Endpoints](#endpoints)
  - [Create Task](#post-apicreate-task)
  - [Send Chat Message](#post-apisend-chat-message)
- [Error Handling](#error-handling)
- [Examples](#examples)

---

## Overview

This API allows external applications to create tasks and send messages to RingCentral on behalf of users who have authenticated through the OMI integration.

**Base URL:** `https://omi-ringcentral.up.railway.app`

**Authentication:** All endpoints require a valid `uid` (user ID) parameter.

**CORS:** ✅ Enabled - All origins are allowed, making it easy to call from web applications, mobile apps, and server-side code.

---

## Authentication

All API requests must include a `uid` parameter identifying the authenticated user.

### Methods to Include UID:

**Option 1: Query Parameter**
```bash
POST https://omi-ringcentral.up.railway.app/api/create-task?uid=USER_ID
```

**Option 2: Request Body**
```json
{
  "uid": "USER_ID",
  "title": "Task title"
}
```

### Getting a User ID

Users receive their `uid` when they authenticate with RingCentral through the OMI app. The UID is persistent and tied to their OMI account.

---

## Endpoints

### POST `/api/create-task`

Creates a task in RingCentral with automatic assignee matching.

#### Request

**URL:** `https://omi-ringcentral.up.railway.app/api/create-task?uid=USER_ID`

**Method:** `POST`

**Headers:**
```
Content-Type: application/json
```

**Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uid` | string | Yes* | User ID (*if not in query string) |
| `title` | string | Yes | Task title (min 3 characters) |
| `assigneeName` | string | No | Name of assignee (fuzzy matched) |
| `dueDate` | string | No | Due date in YYYY-MM-DD format |
| `dueTime` | string | No | Due time in HH:MM format (24-hour) |

#### Example Request

```bash
curl -X POST "https://omi-ringcentral.up.railway.app/api/create-task?uid=GPW9BKkHYWMkGTv3iSndMRAPS2B2" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Review quarterly report",
    "assigneeName": "Sarah Lopez",
    "dueDate": "2025-10-25",
    "dueTime": "15:00"
  }'
```

#### Response (200 OK)

```json
{
  "success": true,
  "task": {
    "title": "Review quarterly report",
    "assignee": "Sarah Lopez",
    "assigneeMatched": true,
    "dueDate": "2025-10-25",
    "dueTime": "15:00",
    "timezone": "America/Los_Angeles"
  },
  "message": "✅ Task created: Review quarterly report for Sarah Lopez (due 2025-10-25 at 15:00)"
}
```

#### Assignee Fuzzy Matching

The API automatically matches assignee names to team members:

- **Exact match:** "Sarah Lopez" → "Sarah Lopez" ✅
- **First name:** "Sarah" → "Sarah Lopez" ✅
- **Last name:** "Lopez" → "Sarah Lopez" ✅
- **Partial:** "Sar" → "Sarah Lopez" ✅
- **Case insensitive:** "sarah lopez" → "Sarah Lopez" ✅

If no match is found, the task is created without an assignee.

#### Features

✅ **Smart assignee matching** - Fuzzy name matching to team members  
✅ **Timezone aware** - Uses user's configured timezone  
✅ **OMI notifications** - User receives push notification  
✅ **Optional fields** - All fields except title are optional  

---

### POST `/api/send-chat-message`

Sends a detailed message (markdown supported) to a specific RingCentral chat.

#### Request

**URL:** `https://omi-ringcentral.up.railway.app/api/send-chat-message?uid=USER_ID`

**Method:** `POST`

**Headers:**
```
Content-Type: application/json
```

**Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uid` | string | Yes* | User ID (*if not in query string) |
| `chatName` | string | Yes | Name of chat/channel (fuzzy matched) |
| `message` | string | Yes | Message text (markdown supported) |

#### Example Request

```bash
curl -X POST "https://omi-ringcentral.up.railway.app/api/send-chat-message?uid=GPW9BKkHYWMkGTv3iSndMRAPS2B2" \
  -H "Content-Type: application/json" \
  -d '{
    "chatName": "General",
    "message": "## Meeting Summary\n\n- Discussed Q4 goals\n- Action items assigned\n- Next meeting: Friday at 2pm\n\n**Status:** Complete ✅"
  }'
```

#### Response (200 OK)

```json
{
  "success": true,
  "chat": {
    "name": "General",
    "id": "1234567890"
  },
  "message": "## Meeting Summary\n\n- Discussed Q4 goals...",
  "notification": "✅ Message sent to General"
}
```

#### Chat Name Fuzzy Matching

The API automatically matches chat names to available chats:

- **Exact match:** "General" → "General" ✅
- **Partial:** "gen" → "General" ✅
- **Case insensitive:** "general" → "General" ✅
- **DM matching:** "Sarah" → DM with Sarah Lopez ✅
- **Contains:** "Marketing Team" → "Marketing" ✅

If no match is found, returns a 404 with list of available chats.

#### Markdown Support

RingCentral supports markdown formatting:

```markdown
## Headers
**Bold text**
*Italic text*
- Bullet lists
1. Numbered lists
[Links](https://example.com)
`code`
```

#### Features

✅ **Smart chat matching** - Fuzzy matching to available chats  
✅ **Markdown formatting** - Full markdown support  
✅ **Works everywhere** - DMs, channels, group chats  
✅ **OMI notifications** - User receives push notification  
✅ **Helpful errors** - Returns available chats if not found  

---

## Error Handling

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Missing or invalid UID |
| 404 | Not Found - Chat not found |
| 500 | Internal Server Error |

### Error Response Format

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

### Common Errors

#### 400 Bad Request

**Missing required field:**
```json
{
  "success": false,
  "error": "Task title is required and must be at least 3 characters."
}
```

**Invalid message:**
```json
{
  "success": false,
  "error": "Message text is required."
}
```

#### 401 Unauthorized

**Missing UID:**
```json
{
  "success": false,
  "error": "Missing uid parameter. Include in query string or request body."
}
```

**Not authenticated:**
```json
{
  "success": false,
  "error": "User not authenticated. Please authenticate with RingCentral first."
}
```

#### 404 Not Found

**Chat not found:**
```json
{
  "success": false,
  "error": "Chat not found: GeneralX",
  "availableChats": [
    {
      "name": "General",
      "type": "Team",
      "id": "123456789"
    },
    {
      "name": "Marketing",
      "type": "Team",
      "id": "987654321"
    },
    {
      "name": "Sarah Lopez",
      "type": "Direct",
      "id": "555555555"
    }
  ]
}
```

---

## Examples

### JavaScript (Browser)

#### Create Task with Fetch API

```javascript
async function createTask(uid, taskData) {
  try {
    const response = await fetch(
      `https://omi-ringcentral.up.railway.app/api/create-task?uid=${uid}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: taskData.title,
          assigneeName: taskData.assignee,
          dueDate: taskData.dueDate,
          dueTime: taskData.dueTime
        })
      }
    );
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to create task');
    }
    
    console.log('Task created:', data);
    return data;
  } catch (error) {
    console.error('Error creating task:', error);
    throw error;
  }
}

// Usage
createTask('GPW9BKkHYWMkGTv3iSndMRAPS2B2', {
  title: 'Review quarterly report',
  assignee: 'Sarah Lopez',
  dueDate: '2025-10-25',
  dueTime: '15:00'
});
```

#### Send Message with Fetch API

```javascript
async function sendChatMessage(uid, chatName, message) {
  try {
    const response = await fetch(
      `https://omi-ringcentral.up.railway.app/api/send-chat-message?uid=${uid}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chatName: chatName,
          message: message
        })
      }
    );
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to send message');
    }
    
    console.log('Message sent:', data);
    return data;
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
}

// Usage
sendChatMessage(
  'GPW9BKkHYWMkGTv3iSndMRAPS2B2',
  'General',
  '## Meeting Summary\n\n- Q4 goals discussed\n- Action items assigned'
);
```

### JavaScript / Node.js

#### Create Task with Axios

```javascript
const axios = require('axios');

async function createTask(uid, taskData) {
  try {
    const response = await axios.post(
      `https://omi-ringcentral.up.railway.app/api/create-task?uid=${uid}`,
      {
        title: taskData.title,
        assigneeName: taskData.assignee,
        dueDate: taskData.dueDate,
        dueTime: taskData.dueTime
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Task created:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error creating task:', error.response?.data || error.message);
    throw error;
  }
}

// Usage
createTask('GPW9BKkHYWMkGTv3iSndMRAPS2B2', {
  title: 'Review quarterly report',
  assignee: 'Sarah Lopez',
  dueDate: '2025-10-25',
  dueTime: '15:00'
});
```

#### Send Message

```javascript
async function sendChatMessage(uid, chatName, message) {
  try {
    const response = await axios.post(
      `https://omi-ringcentral.up.railway.app/api/send-chat-message?uid=${uid}`,
      {
        chatName: chatName,
        message: message
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Message sent:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
    throw error;
  }
}

// Usage
sendChatMessage(
  'GPW9BKkHYWMkGTv3iSndMRAPS2B2',
  'General',
  '## Meeting Summary\n\n- Q4 goals discussed\n- Action items assigned'
);
```

### Python

#### Create Task

```python
import requests

def create_task(uid, task_data):
    url = f"https://omi-ringcentral.up.railway.app/api/create-task?uid={uid}"
    
    payload = {
        "title": task_data["title"],
        "assigneeName": task_data.get("assignee"),
        "dueDate": task_data.get("dueDate"),
        "dueTime": task_data.get("dueTime")
    }
    
    headers = {
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        print("Task created:", response.json())
        return response.json()
    except requests.exceptions.RequestException as e:
        print("Error creating task:", e)
        raise

# Usage
create_task("GPW9BKkHYWMkGTv3iSndMRAPS2B2", {
    "title": "Review quarterly report",
    "assignee": "Sarah Lopez",
    "dueDate": "2025-10-25",
    "dueTime": "15:00"
})
```

#### Send Message

```python
def send_chat_message(uid, chat_name, message):
    url = f"https://omi-ringcentral.up.railway.app/api/send-chat-message?uid={uid}"
    
    payload = {
        "chatName": chat_name,
        "message": message
    }
    
    headers = {
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        print("Message sent:", response.json())
        return response.json()
    except requests.exceptions.RequestException as e:
        print("Error sending message:", e)
        raise

# Usage
send_chat_message(
    "GPW9BKkHYWMkGTv3iSndMRAPS2B2",
    "General",
    "## Meeting Summary\n\n- Q4 goals discussed\n- Action items assigned"
)
```

### cURL

#### Create Task

```bash
curl -X POST "https://omi-ringcentral.up.railway.app/api/create-task?uid=GPW9BKkHYWMkGTv3iSndMRAPS2B2" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Review quarterly report",
    "assigneeName": "Sarah Lopez",
    "dueDate": "2025-10-25",
    "dueTime": "15:00"
  }'
```

#### Send Message

```bash
curl -X POST "https://omi-ringcentral.up.railway.app/api/send-chat-message?uid=GPW9BKkHYWMkGTv3iSndMRAPS2B2" \
  -H "Content-Type: application/json" \
  -d '{
    "chatName": "General",
    "message": "## Meeting Summary\n\n- Discussed Q4 goals\n- Action items assigned\n- Next meeting: Friday"
  }'
```

---

## Use Cases

### 📊 Analytics Dashboard

Send automated reports to teams:

```javascript
// Daily analytics report
sendChatMessage(uid, 'Analytics Team', `
## Daily Analytics Report - ${new Date().toLocaleDateString()}

**Key Metrics:**
- Active Users: 1,234 (+5.2%)
- Revenue: $12,345 (+8.1%)
- Conversion Rate: 3.2% (+0.3%)

**Top Performing Pages:**
1. Homepage - 5,432 visits
2. Product Page - 3,211 visits
3. Checkout - 1,876 visits

**Action Items:**
- Investigate drop-off on checkout page
- Optimize mobile experience
`);
```

### 🤖 Automation System

Create tasks from monitoring alerts:

```python
# System monitoring alert
if cpu_usage > 90:
    create_task(uid, {
        "title": "Investigate high CPU usage on production server",
        "assignee": "DevOps Team",
        "dueDate": datetime.now().strftime("%Y-%m-%d"),
        "dueTime": "16:00"
    })
```

### 📅 Meeting Bot

Send meeting summaries:

```javascript
// After meeting ends
sendChatMessage(uid, 'Project Alpha', `
## Project Alpha - Sprint Planning Meeting

**Date:** ${meetingDate}
**Attendees:** Sarah, John, Mike

**Decisions Made:**
- Sprint duration: 2 weeks
- Focus: User authentication feature
- Launch target: End of month

**Action Items:**
1. Sarah: Design mockups (Due: Wednesday)
2. John: API implementation (Due: Friday)
3. Mike: Database schema (Due: Tomorrow)

**Next Meeting:** Friday at 2pm
`);
```

### 📈 Project Management Integration

Sync tasks from other tools:

```python
# Sync Jira tasks to RingCentral
for jira_task in pending_tasks:
    create_task(uid, {
        "title": f"[JIRA-{jira_task.id}] {jira_task.summary}",
        "assignee": jira_task.assignee.name,
        "dueDate": jira_task.due_date.strftime("%Y-%m-%d")
    })
```

---

## Rate Limits

No explicit rate limits are currently enforced, but please be respectful:

- **Recommended:** Max 10 requests per second per user
- **Burst:** Up to 50 requests per minute
- Excessive usage may result in temporary throttling

---

## Support

- **Documentation:** https://github.com/your-repo/ringcentral-integration
- **Issues:** https://github.com/your-repo/ringcentral-integration/issues
- **OMI Support:** https://docs.omi.me

---

## Changelog

### v1.0.0 (2025-10-19)

- ✅ Initial release
- ✅ `/api/create-task` endpoint
- ✅ `/api/send-chat-message` endpoint
- ✅ Fuzzy matching for assignees and chats
- ✅ Markdown support for messages
- ✅ OMI notification integration

---

**Made with ❤️ for the OMI ecosystem**

