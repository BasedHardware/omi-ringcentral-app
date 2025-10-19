require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const RingCentral = require('@ringcentral/sdk').SDK;
const path = require('path');
const MessageDetector = require('./message_detector');
const { SimpleUserStorage, SimpleSessionStorage } = require('./simple_storage');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize RingCentral SDK
console.log('🔧 REDIRECT_URI configured as:', process.env.REDIRECT_URI);
const rcsdk = new RingCentral({
  server: process.env.RINGCENTRAL_SERVER_URL,
  clientId: process.env.RINGCENTRAL_CLIENT_ID,
  clientSecret: process.env.RINGCENTRAL_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI
});

// Initialize Message Detector
const messageDetector = new MessageDetector(process.env.OPENAI_API_KEY);

// Helper function to send OMI notification to user's mobile app
async function sendOmiNotification(userId, message) {
    const appId = process.env.OMI_APP_ID;
    const appSecret = process.env.OMI_APP_SECRET;

    if (!appId || !appSecret) {
        console.log('⚠️  OMI credentials not configured, skipping notification');
        return null;
    }

    const https = require('https');
    
    const options = {
        hostname: 'api.omi.me',
        path: `/v2/integrations/${appId}/notification?uid=${encodeURIComponent(userId)}&message=${encodeURIComponent(message)}`,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${appSecret}`,
            'Content-Type': 'application/json',
            'Content-Length': 0
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`📲 OMI notification sent to user ${userId.substring(0, 10)}...`);
                    try {
                        resolve(data ? JSON.parse(data) : {});
                    } catch (e) {
                        resolve({ raw: data });
                    }
                } else {
                    console.error(`❌ OMI notification failed (${res.statusCode}): ${data}`);
                    reject(new Error(`API Error (${res.statusCode}): ${data}`));
                }
            });
        });
        req.on('error', (error) => {
            console.error(`❌ OMI notification error: ${error.message}`);
            reject(error);
        });
        req.end();
    });
}

// CORS Configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow all origins for API endpoints
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 86400 // 24 hours
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));
app.use(express.static('public'));

// Store OAuth states temporarily
const oauthStates = {};

// Background task for timeout monitoring
let timeoutMonitorInterval = null;

// Helper function to enrich chats with member names for DMs
async function enrichChatsWithMemberNames(platform, chats) {
    const enrichedChats = [];
    
    // Get current user's ID first
    let currentUserId = null;
    try {
        const authData = await platform.auth().data();
        currentUserId = authData.owner_id ? authData.owner_id.toString() : null;
        console.log(`👤 Current user ID: ${currentUserId}`);
    } catch (err) {
        console.error(`❌ Could not get current user ID: ${err.message}`);
    }
    
    for (const chat of chats) {
        const enrichedChat = { ...chat };
        
        // For Direct messages, fetch member details to get names
        if (chat.type === 'Direct' && chat.members && chat.members.length > 0) {
            try {
                // For DMs, fetch both members and find the OTHER person (not me)
                const memberData = [];
                
                for (const member of chat.members) {
                    // Skip bot/system accounts (glip- prefix)
                    const memberId = member.id.toString();
                    if (memberId.startsWith('glip-')) {
                        console.log(`⏭️  Skipping bot/system account: ${memberId}`);
                        continue;
                    }
                    
                    try {
                        console.log(`🔍 Fetching details for member ${memberId}...`);
                        const userResponse = await platform.get(`/team-messaging/v1/persons/${memberId}`);
                        const userData = await userResponse.json();
                        
                        const name = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email || null;
                        if (name) {
                            memberData.push({
                                id: memberId,
                                name: name
                            });
                        }
                    } catch (err) {
                        // Silently skip members we can't fetch (likely bots or deleted users)
                        if (!err.message.includes('404')) {
                            console.log(`⚠️  Could not fetch member ${memberId}: ${err.message}`);
                        }
                    }
                }
                
                // Find the member that is NOT the current user
                if (currentUserId && memberData.length > 0) {
                    const otherPerson = memberData.find(m => m.id !== currentUserId);
                    if (otherPerson) {
                        enrichedChat.displayName = otherPerson.name;
                        enrichedChat.dmPersonName = otherPerson.name;
                        console.log(`✅ DM enriched: ${otherPerson.name}`);
                    } else if (memberData.length === 1) {
                        // Fallback to the only name we found
                        enrichedChat.displayName = memberData[0].name;
                        enrichedChat.dmPersonName = memberData[0].name;
                        console.log(`✅ DM enriched: ${memberData[0].name}`);
                    }
                } else if (memberData.length > 0) {
                    // If we don't know current user, pick the first one
                    enrichedChat.displayName = memberData[0].name;
                    enrichedChat.dmPersonName = memberData[0].name;
                    console.log(`✅ DM enriched: ${memberData[0].name}`);
                }
                
                // If no displayName set, use a generic fallback
                if (!enrichedChat.displayName) {
                    const realMembers = chat.members.filter(m => !m.id.toString().startsWith('glip-'));
                    if (realMembers.length > 0) {
                        enrichedChat.displayName = `DM ${chat.id}`;
                    } else {
                        enrichedChat.displayName = `Bot/System Chat ${chat.id}`;
                    }
                }
            } catch (err) {
                console.log(`⚠️  Could not enrich DM chat ${chat.id}: ${err.message}`);
                enrichedChat.displayName = `DM ${chat.id}`;
            }
        } else if (chat.type === 'Team') {
            enrichedChat.displayName = chat.name || chat.description || `Team Chat ${chat.id}`;
        } else if (chat.type === 'Personal') {
            enrichedChat.displayName = 'Personal Notes';
        } else {
            enrichedChat.displayName = chat.name || chat.description || `Chat ${chat.id}`;
        }
        
        enrichedChats.push(enrichedChat);
    }
    
    return enrichedChats;
}

function startTimeoutMonitor() {
    if (timeoutMonitorInterval) return;
    
    console.log('🕐 Timeout monitor started');
    
    timeoutMonitorInterval = setInterval(async () => {
        try {
            const allSessions = SimpleSessionStorage.getAllSessions();
            
            for (const [sessionId, session] of Object.entries(allSessions)) {
                if (session.message_mode !== "recording") continue;
                
                const idleTime = SimpleSessionStorage.getSessionIdleTime(sessionId);
                
                if (idleTime && idleTime > 7) {
                    const segmentsCount = session.segments_count || 0;
                    const accumulated = session.accumulated_text || "";
                    const triggerType = session.trigger_type || 'message';
                    
                    console.log(`⏰ TIMEOUT MONITOR: Processing ${triggerType} for session ${sessionId} after ${idleTime.toFixed(1)}s idle (${segmentsCount} segment(s))`);
                    
                    const uid = session.uid;
                    const user = SimpleUserStorage.getUser(uid);
                    
                    if (user && user.tokens) {
                        SimpleSessionStorage.updateSession(sessionId, {
                            message_mode: "processing"
                        });
                        
                        try {
                            // Get user's platform
                            const platform = rcsdk.platform();
                            await platform.auth().setData(user.tokens);
                            
                            if (triggerType === 'event') {
                                // Handle event creation
                                console.log(`⏰ Creating event (timeout)...`);
                                
                                // AI extracts event details
                                const { name, startDate, startTime, duration, notes } = await messageDetector.aiExtractEventDetails(accumulated);
                                
                                if (name && name.trim().length >= 3) {
                                    console.log(`⏰ Creating event: "${name}" on ${startDate || 'TBD'} at ${startTime || 'TBD'}`);
                                    
                                    try {
                                        const userSettings = SimpleUserStorage.getUserSettings(uid);
                                        await createRingCentralEvent(platform, name, startDate, startTime, duration, notes, userSettings.timezone);
                                        console.log(`⏰ SUCCESS! Event created via timeout: ${name}`);
                                        
                                        // Send OMI notification to user's mobile app
                                        const eventInfo = startDate ? ` on ${startDate}${startTime ? ` at ${startTime}` : ''}` : '';
                                        const notificationMsg = `✅ Event created: ${name}${eventInfo}`;
                                        try {
                                            await sendOmiNotification(uid, notificationMsg);
                                        } catch (notifError) {
                                            console.log(`⚠️  Notification failed but event was created: ${notifError.message}`);
                                        }
                                    } catch (error) {
                                        console.error(`⏰ Failed to create event: ${error.message}`);
                                    }
                                } else {
                                    console.log(`⏰ Insufficient content for event (name: '${name ? name.substring(0, 50) : 'None'}...')`);
                                }
                            } else if (triggerType === 'task') {
                                // Handle task creation
                                console.log(`⏰ Creating task (timeout)...`);
                                
                                // Fetch team members (using same method as message matching for consistency)
                                const enrichedMembers = await getEnrichedTeamMembers(platform);
                                
                                // AI extracts task details
                                const { title, assigneeId, assigneeName, dueDate, dueTime } = await messageDetector.aiExtractTaskDetails(
                                    accumulated,
                                    enrichedMembers
                                );
                                
                                if (title && title.trim().length >= 3) {
                                    console.log(`⏰ Creating task: "${title}" ${assigneeName ? `for ${assigneeName}` : ''}`);
                                    
                                    try {
                                        const userSettings = SimpleUserStorage.getUserSettings(uid);
                                        await createRingCentralTask(platform, title, assigneeId, assigneeName, dueDate, dueTime, userSettings.timezone);
                                        console.log(`⏰ SUCCESS! Task created via timeout: ${title}`);
                                        
                                        // Send OMI notification to user's mobile app
                                        const dueInfo = dueDate ? ` (due ${dueDate}${dueTime ? ` at ${dueTime}` : ''})` : '';
                                        const notificationMsg = `✅ Task created: ${title}${assigneeName ? ` for ${assigneeName}` : ''}${dueInfo}`;
                                        try {
                                            await sendOmiNotification(uid, notificationMsg);
                                        } catch (notifError) {
                                            console.log(`⚠️  Notification failed but task was created: ${notifError.message}`);
                                        }
                                    } catch (error) {
                                        console.error(`⏰ Failed to create task: ${error.message}`);
                                    }
                                } else {
                                    console.log(`⏰ Insufficient content for task (title: '${title ? title.substring(0, 50) : 'None'}...')`);
                                }
                            } else {
                                // Handle message sending
                                console.log(`⏰ Sending message (timeout)...`);
                                
                                // Fetch fresh chats
                                const chatsResponse = await platform.get('/team-messaging/v1/chats');
                                const chatsData = await chatsResponse.json();
                                let chats = chatsData.records || chatsData || [];
                                
                                // Enrich chats with member names for DMs (only for message sending)
                                console.log(`🔄 Enriching chats for message sending (timeout)...`);
                                chats = await enrichChatsWithMemberNames(platform, chats);
                                
                                // AI extracts chat and message
                                const { chatId, chatName, message } = await messageDetector.aiExtractMessageAndChannel(
                                    accumulated,
                                    chats
                                );
                                
                                if (chatId && message && message.trim().length >= 3) {
                                    console.log(`⏰ Sending timeout message to ${chatName}`);
                                    
                                    await platform.post(
                                        `/team-messaging/v1/chats/${chatId}/posts`,
                                        { text: message }
                                    );
                                    
                                    console.log(`⏰ SUCCESS! Timeout message sent to ${chatName}`);
                                    
                                    // Send OMI notification to user's mobile app
                                    const notificationMsg = `✅ Message sent to ${chatName}: ${message}`;
                                    try {
                                        await sendOmiNotification(uid, notificationMsg);
                                    } catch (notifError) {
                                        console.log(`⚠️  Notification failed but message was sent: ${notifError.message}`);
                                    }
                                } else {
                                    console.log(`⏰ Insufficient content to send (message: '${message ? message.substring(0, 50) : 'None'}...')`);
                                }
                            }
                            
                            SimpleSessionStorage.resetSession(sessionId);
                            
                        } catch (error) {
                            console.error(`⏰ Error processing timeout: ${error}`);
                            SimpleSessionStorage.resetSession(sessionId);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`❌ Timeout monitor error: ${error}`);
        }
    }, 1000); // Check every second
}

// Helper function to fetch and enrich team members (same as chat enrichment for consistency)
async function getEnrichedTeamMembers(platform) {
    const chatsResponse = await platform.get('/team-messaging/v1/chats');
    const chatsData = await chatsResponse.json();
    const chats = chatsData.records || [];
    
    // Extract unique members from all chats and enrich with names
    const memberIds = new Set();
    const enrichedMembers = [];
    
    for (const chat of chats) {
        if (chat.members) {
            for (const member of chat.members) {
                const memberId = member.id.toString();
                
                // Skip bot/system accounts and already processed members
                if (memberId.startsWith('glip-') || memberIds.has(memberId)) {
                    continue;
                }
                
                try {
                    // Fetch member details
                    const userResponse = await platform.get(`/team-messaging/v1/persons/${memberId}`);
                    const userData = await userResponse.json();
                    
                    const displayName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email || null;
                    if (displayName) {
                        enrichedMembers.push({
                            id: memberId,
                            name: displayName,
                            displayName: displayName,
                            email: userData.email,
                            firstName: userData.firstName,
                            lastName: userData.lastName
                        });
                        memberIds.add(memberId);
                    }
                } catch (err) {
                    // Skip members we can't fetch
                    if (!err.message.includes('404')) {
                        console.log(`⚠️  Could not fetch member ${memberId}: ${err.message}`);
                    }
                }
            }
        }
    }
    
    console.log(`✓ Found ${enrichedMembers.length} team members`);
    return enrichedMembers;
}

// Helper function to convert date/time to user's timezone and then to UTC
function convertToUserTimezone(dueDate, dueTime, userTimezone) {
    // Create a date string in the user's timezone
    let dateTimeStr = dueDate;
    if (dueTime) {
        dateTimeStr = `${dueDate}T${dueTime}:00`;
    } else {
        dateTimeStr = `${dueDate}T23:59:59`;
    }
    
    // Parse as if it's in the user's timezone
    // Since we don't have a timezone library, we'll use a simple offset approach
    // This is a simplified version - for production, use a library like moment-timezone
    const date = new Date(dateTimeStr);
    
    // Get timezone offset in hours from a lookup table
    const timezoneOffsets = {
        'America/Los_Angeles': -7,  // PDT (summer)
        'America/Denver': -6,        // MDT
        'America/Chicago': -5,       // CDT
        'America/New_York': -4,      // EDT
        'America/Phoenix': -7,       // MST (no DST)
        'UTC': 0,
        'Europe/London': 1,          // BST
        'Europe/Paris': 2,           // CEST
        'Asia/Tokyo': 9,
        'Australia/Sydney': 10       // AEST
    };
    
    const offsetHours = timezoneOffsets[userTimezone] || -7; // Default to PT
    
    // Adjust the date by the offset to convert to UTC
    const utcDate = new Date(date.getTime() - (offsetHours * 60 * 60 * 1000));
    
    // Return in ISO format with Z
    return utcDate.toISOString();
}

// Helper function to create calendar event in RingCentral
async function createRingCentralEvent(platform, eventName, startDate, startTime, duration, notes, userTimezone = 'America/Los_Angeles') {
    // Build event start time in UTC
    let startDateTime = null;
    
    if (startDate && startTime) {
        // Convert to user's timezone then to UTC
        const dateTimeStr = `${startDate}T${startTime}:00`;
        startDateTime = convertToUserTimezone(startDate, startTime, userTimezone);
    } else if (startDate) {
        // No time specified, default to 9 AM
        startDateTime = convertToUserTimezone(startDate, '09:00', userTimezone);
    } else {
        // No date or time, default to tomorrow at 9 AM
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        startDateTime = convertToUserTimezone(tomorrowStr, '09:00', userTimezone);
    }
    
    // Calculate end time based on duration (in minutes)
    const startDateObj = new Date(startDateTime);
    const endDateObj = new Date(startDateObj.getTime() + (duration * 60 * 1000));
    const endDateTime = endDateObj.toISOString();
    
    console.log(`✓ Creating calendar event: ${eventName}`);
    console.log(`✓ Start: ${startDateTime} (${duration} minutes)`);
    
    // Build event body for Calendar Events API
    // Reference: https://developers.ringcentral.com/api-reference/Calendar-Events/createEventNew
    const eventBody = {
        title: eventName,
        startTime: startDateTime,
        endTime: endDateTime,
        allDay: false,
        color: 'Blue'
    };
    
    if (notes) {
        eventBody.description = notes;
    }
    
    // Create calendar event using Team Messaging Calendar Events API
    const response = await platform.post('/team-messaging/v1/events', eventBody);
    
    return await response.json();
}

// Helper function to create task in RingCentral
async function createRingCentralTask(platform, title, assigneeId, assigneeName, dueDate, dueTime, userTimezone = 'America/Los_Angeles') {
    // Get or create a chat for the task
    // If there's an assignee, find/create DM with them, otherwise use personal chat
    let taskChatId = null;
    
    if (assigneeId) {
        // Try to find existing DM with assignee
        const chatsResponse = await platform.get('/team-messaging/v1/chats?type=Direct');
        const chatsData = await chatsResponse.json();
        const chats = chatsData.records || [];
        
        // Get current user's ID to exclude from matching
        let currentUserId = null;
        try {
            const authData = await platform.auth().data();
            currentUserId = authData.owner_id ? authData.owner_id.toString() : null;
        } catch (err) {
            console.log(`⚠️  Could not get current user ID: ${err.message}`);
        }
        
        // Find DM with this specific person (not current user)
        // Convert IDs to strings for comparison
        const assigneeIdStr = assigneeId.toString();
        
        for (const chat of chats) {
            if (chat.members && chat.members.length > 0) {
                // For Direct chats, find the member that is NOT the current user
                const otherMembers = chat.members.filter(m => {
                    const memberId = m.id.toString();
                    return currentUserId ? memberId !== currentUserId : true;
                });
                
                // Check if the assignee is in the other members
                const hasAssignee = otherMembers.some(m => m.id.toString() === assigneeIdStr);
                
                if (hasAssignee) {
                    taskChatId = chat.id;
                    console.log(`✓ Found existing DM chat ${taskChatId} with ${assigneeName} (ID: ${assigneeIdStr})`);
                    break;
                }
            }
        }
        
        // If no DM exists, create one
        if (!taskChatId) {
            const createChatResponse = await platform.post('/team-messaging/v1/chats', {
                type: 'Direct',
                members: [{ id: assigneeId }]
            });
            const newChat = await createChatResponse.json();
            taskChatId = newChat.id;
            console.log(`✓ Created new DM chat ${taskChatId} with ${assigneeName} (ID: ${assigneeIdStr})`);
        }
    } else {
        // No assignee - use personal chat (create if needed)
        const chatsResponse = await platform.get('/team-messaging/v1/chats?type=Personal');
        const chatsData = await chatsResponse.json();
        const personalChats = chatsData.records || [];
        
        if (personalChats.length > 0) {
            taskChatId = personalChats[0].id;
            console.log(`✓ Using personal chat ${taskChatId} for unassigned task`);
        } else {
            // Create personal chat
            const createChatResponse = await platform.post('/team-messaging/v1/chats', {
                type: 'Personal'
            });
            const newChat = await createChatResponse.json();
            taskChatId = newChat.id;
            console.log(`✓ Created personal chat ${taskChatId}`);
        }
    }
    
    // Build task body
    const taskBody = {
        subject: title
    };
    
    if (assigneeId) {
        taskBody.assignees = [{ id: assigneeId }];
    }
    
    if (dueDate) {
        // Convert to user's timezone then to UTC
        const dueDateTimeUTC = convertToUserTimezone(dueDate, dueTime, userTimezone);
        taskBody.dueDate = dueDateTimeUTC;
        console.log(`✓ Due date in ${userTimezone}: ${dueDate}${dueTime ? ` ${dueTime}` : ' 23:59:59'} → UTC: ${dueDateTimeUTC}`);
    }
    
    // Create task in the chat
    console.log(`✓ Creating task in chat ${taskChatId}:`, taskBody);
    const response = await platform.post(`/restapi/v1.0/glip/chats/${taskChatId}/tasks`, taskBody);
    return await response.json();
}

// Start timeout monitor
startTimeoutMonitor();

// Root endpoint - Settings page
app.get('/', async (req, res) => {
    const { uid } = req.query;
    
    if (!uid) {
        // Show a simple landing page with instructions
        return res.send(getLandingPageHTML());
    }
    
    const user = SimpleUserStorage.getUser(uid);
    
    if (!user || !user.tokens) {
        // Not authenticated - show auth page
        const authUrl = `/auth?uid=${uid}`;
        return res.send(getNotAuthenticatedHTML(authUrl, uid));
    }
    
    // Authenticated - show settings page
    const chats = user.available_chats || [];
    return res.send(getAuthenticatedHTML(uid, chats));
});

// Settings endpoint (same as root for now)
app.get('/settings', async (req, res) => {
    const { uid } = req.query;
    
    if (!uid) {
        return res.send(getLandingPageHTML());
    }
    
    const user = SimpleUserStorage.getUser(uid);
    
    if (!user || !user.tokens) {
        const authUrl = `/auth?uid=${uid}`;
        return res.send(getNotAuthenticatedHTML(authUrl, uid));
    }
    
    const chats = user.available_chats || [];
    return res.send(getAuthenticatedHTML(uid, chats));
});

// OAuth start
app.get('/auth', (req, res) => {
    const { uid } = req.query;
    
    if (!uid) {
        return res.status(400).send('Missing uid parameter');
    }
    
    try {
        const state = Math.random().toString(36).substring(7);
        oauthStates[state] = uid;
        
        const platform = rcsdk.platform();
        const loginUrl = platform.loginUrl({
            redirectUri: process.env.REDIRECT_URI,
            state: state,
            brandId: '',
            display: '',
            prompt: ''
        });
        
        res.redirect(loginUrl);
    } catch (error) {
        console.error('OAuth start error:', error);
        res.status(500).send('OAuth initialization failed: ' + error.message);
    }
});

// OAuth callback
app.get('/oauth/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code || !state) {
        return res.status(400).send('Missing code or state parameter');
    }
    
    const uid = oauthStates[state];
    if (!uid) {
        return res.status(400).send('Invalid state parameter');
    }
    
    try {
        const platform = rcsdk.platform();
        
        await platform.login({
            code: code,
            redirectUri: process.env.REDIRECT_URI
        });
        
        const authData = await platform.auth().data();
        
        // Get chats
        const chatsResponse = await platform.get('/team-messaging/v1/chats');
        const chatsData = await chatsResponse.json();
        const chats = chatsData.records || chatsData || [];
        
        // Save user data (without enrichment - we'll enrich on-demand when sending)
        SimpleUserStorage.saveUser(uid, authData, chats);
        
        // Clean up state
        delete oauthStates[state];
        
        res.send(getSuccessHTML(uid, chats.length));
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).send('Authentication failed: ' + error.message);
    }
});

// Setup completed check
app.get('/setup-completed', (req, res) => {
    const { uid } = req.query;
    
    if (!uid) {
        return res.status(400).json({ error: 'Missing uid parameter' });
    }
    
    const isAuthenticated = SimpleUserStorage.isAuthenticated(uid);
    
    res.json({
        is_setup_completed: isAuthenticated
    });
});

// Refresh chats
app.post('/refresh-chats', async (req, res) => {
    const { uid } = req.query;
    
    try {
        const user = SimpleUserStorage.getUser(uid);
        if (!user || !user.tokens) {
            return res.json({ success: false, error: 'User not authenticated' });
        }
        
        const platform = rcsdk.platform();
        await platform.auth().setData(user.tokens);
        
        const chatsResponse = await platform.get('/team-messaging/v1/chats');
        const chatsData = await chatsResponse.json();
        const chats = chatsData.records || chatsData || [];
        
        SimpleUserStorage.saveUser(uid, user.tokens, chats);
        
        res.json({ success: true, chats_count: chats.length });
    } catch (error) {
        console.error('Error refreshing chats:', error);
        res.json({ success: false, error: error.message });
    }
});

// Update settings
app.post('/update-settings', async (req, res) => {
    const { uid } = req.query;
    const { timezone } = req.body;
    
    try {
        if (!uid) {
            return res.json({ success: false, error: 'Missing uid' });
        }
        
        const success = SimpleUserStorage.updateUserSettings(uid, { timezone });
        
        if (success) {
            res.json({ success: true, message: 'Settings updated' });
        } else {
            res.json({ success: false, error: 'User not found' });
        }
    } catch (error) {
        console.error('Settings update error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Logout
app.post('/logout', async (req, res) => {
    const { uid } = req.query;
    
    try {
        const user = SimpleUserStorage.getUser(uid);
        if (user && user.tokens) {
            const platform = rcsdk.platform();
            await platform.auth().setData(user.tokens);
            await platform.logout();
        }
        
        SimpleUserStorage.deleteUser(uid);
        console.log(`🚪 Logged out user ${uid.substring(0, 10)}...`);
        
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.json({ success: true, message: 'Logged out' });
    }
});

// Webhook endpoint - receives OMI transcripts (v2 - detailed logging)
app.post('/webhook', async (req, res) => {
    console.log('📥 WEBHOOK RECEIVED:', {
        query: req.query,
        body: req.body ? (Array.isArray(req.body) ? `Array[${req.body.length}]` : Object.keys(req.body)) : 'empty',
        headers: { 'content-type': req.headers['content-type'] }
    });
    
    const { uid, session_id } = req.query;
    
    if (!uid) {
        console.log('❌ WEBHOOK ERROR: No uid provided');
        return res.status(401).json({
            message: "User ID required",
            setup_required: true
        });
    }
    
    const sessionId = session_id || `omi_session_${uid}`;
    
    const user = SimpleUserStorage.getUser(uid);
    
    if (!user || !user.tokens) {
        return res.status(401).json({
            message: "User not authenticated. Please complete setup first.",
            setup_required: true
        });
    }
    
    try {
        const payload = req.body;
        console.log('📦 FULL PAYLOAD:', JSON.stringify(payload, null, 2));
        
        let segments = [];
        
        if (Array.isArray(payload)) {
            segments = payload;
        } else if (payload.segments) {
            segments = payload.segments;
        }
        
        console.log(`📥 Received ${segments.length} segment(s) from OMI`);
        if (segments.length > 0) {
            segments.slice(0, 3).forEach((seg, i) => {
                const text = seg.text || seg;
                console.log(`   Segment ${i}: ${typeof text === 'string' ? text.substring(0, 100) : JSON.stringify(text)}`);
            });
        }
        
        if (!segments || segments.length === 0) {
            return res.json({ status: "ok" });
        }
        
        const session = SimpleSessionStorage.getOrCreateSession(sessionId, uid);
        console.log(`📊 Session state: mode=${session.message_mode}, count=${session.segments_count || 0}`);
        
        const responseMessage = await processSegments(session, segments, user);
        
        if (responseMessage && (responseMessage.includes('✅') || responseMessage.includes('❌'))) {
            console.log(`✉️  USER NOTIFICATION: ${responseMessage}`);
            return res.json({
                message: responseMessage,
                session_id: sessionId,
                processed_segments: segments.length
            });
        }
        
        console.log(`🔇 Silent response: ${responseMessage}`);
        res.json({ status: "ok" });
        
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

async function processSegments(session, segments, user) {
    const segmentTexts = segments.map(seg => seg.text || seg);
    const fullText = segmentTexts.join(' ');
    
    const sessionId = session.session_id;
    const isTestSession = sessionId.startsWith('test_session');
    
    console.log(`🔍 Received: '${fullText}'`);
    console.log(`📊 Session mode: ${session.message_mode}, Count: ${session.segments_count || 0}/5`);
    
    // Check for trigger phrase
    if (messageDetector.detectTrigger(fullText) && session.message_mode === "idle") {
        const triggerType = messageDetector.detectTriggerType(fullText);
        const content = messageDetector.extractMessageContent(fullText);
        
        console.log(`🎤 TRIGGER! Type: ${triggerType} ${isTestSession ? '[TEST MODE] Processing immediately...' : 'Starting segment collection...'}`);
        console.log(`   Content: '${content}'`);
        
        // TEST MODE: Process immediately
        if (isTestSession && content && content.length > 10) {
            console.log(`🧪 Test mode: Processing full text immediately...`);
            
            const platform = rcsdk.platform();
            await platform.auth().setData(user.tokens);
            
            if (triggerType === 'event') {
                // Handle event creation
                console.log(`📅 Creating event...`);
                
                // AI extracts event details
                const { name, startDate, startTime, duration, notes } = await messageDetector.aiExtractEventDetails(content);
                
                if (!name || name.trim().length < 3) {
                    SimpleSessionStorage.resetSession(sessionId);
                    return "❌ No valid event name found";
                }
                
                console.log(`📤 Creating event: "${name}" on ${startDate || 'TBD'} at ${startTime || 'TBD'}`);
                
                try {
                    const uid = session.uid;
                    const userSettings = SimpleUserStorage.getUserSettings(uid);
                    await createRingCentralEvent(platform, name, startDate, startTime, duration, notes, userSettings.timezone);
                    
                    SimpleSessionStorage.resetSession(sessionId);
                    console.log(`🎉 SUCCESS! Event created: ${name}`);
                    const eventInfo = startDate ? ` on ${startDate}${startTime ? ` at ${startTime}` : ''}` : '';
                    const notificationMsg = `✅ Event created: ${name}${eventInfo}`;
                    
                    // Send OMI notification to user's mobile app
                    try {
                        await sendOmiNotification(uid, notificationMsg);
                    } catch (notifError) {
                        console.log(`⚠️  Notification failed but event was created: ${notifError.message}`);
                    }
                    
                    return notificationMsg;
                } catch (error) {
                    SimpleSessionStorage.resetSession(sessionId);
                    console.error(`❌ FAILED: ${error.message}`);
                    return `❌ Failed to create event: ${error.message}`;
                }
            } else if (triggerType === 'task') {
                // Handle task creation
                console.log(`📋 Creating task...`);
                
                // Fetch team members (using same method as message matching for consistency)
                const enrichedMembers = await getEnrichedTeamMembers(platform);
                
                // AI extracts task details
                const { title, assigneeId, assigneeName, dueDate, dueTime } = await messageDetector.aiExtractTaskDetails(
                    content,
                    enrichedMembers
                );
                
                if (!title || title.trim().length < 3) {
                    SimpleSessionStorage.resetSession(sessionId);
                    return "❌ No valid task title found";
                }
                
                console.log(`📤 Creating task: "${title}" ${assigneeName ? `for ${assigneeName}` : ''}`);
                
                try {
                    const uid = session.uid;
                    const userSettings = SimpleUserStorage.getUserSettings(uid);
                    await createRingCentralTask(platform, title, assigneeId, assigneeName, dueDate, dueTime, userSettings.timezone);
                    
                    SimpleSessionStorage.resetSession(sessionId);
                    console.log(`🎉 SUCCESS! Task created: ${title}`);
                    const dueInfo = dueDate ? ` (due ${dueDate}${dueTime ? ` at ${dueTime}` : ''})` : '';
                    const notificationMsg = `✅ Task created: ${title}${assigneeName ? ` for ${assigneeName}` : ''}${dueInfo}`;
                    
                    // Send OMI notification to user's mobile app
                    try {
                        await sendOmiNotification(uid, notificationMsg);
                    } catch (notifError) {
                        console.log(`⚠️  Notification failed but task was created: ${notifError.message}`);
                    }
                    
                    return notificationMsg;
                } catch (error) {
                    SimpleSessionStorage.resetSession(sessionId);
                    console.error(`❌ FAILED: ${error.message}`);
                    return `❌ Failed to create task: ${error.message}`;
                }
            } else {
                // Handle message sending (original logic)
                console.log(`🔄 Fetching fresh chat list...`);
                const chatsResponse = await platform.get('/team-messaging/v1/chats');
                const chatsData = await chatsResponse.json();
                let chats = chatsData.records || chatsData || [];
                
                // Enrich chats with member names for DMs (only for message sending)
                console.log(`🔄 Enriching chats for message sending (test mode)...`);
                chats = await enrichChatsWithMemberNames(platform, chats);
                
                // AI extracts chat and message
                const { chatId, chatName, message } = await messageDetector.aiExtractMessageAndChannel(
                    content,
                    chats
                );
                
                if (!chatId) {
                    SimpleSessionStorage.resetSession(sessionId);
                    return "❌ No chat specified and no default chat set";
                }
                
                if (!message) {
                    SimpleSessionStorage.resetSession(sessionId);
                    return "❌ No message content found";
                }
                
                console.log(`📤 Sending to ${chatName}: '${message}'`);
                
                try {
                    await platform.post(
                        `/team-messaging/v1/chats/${chatId}/posts`,
                        { text: message }
                    );
                    
                    SimpleSessionStorage.resetSession(sessionId);
                    console.log(`🎉 SUCCESS! Message sent to ${chatName}`);
                    const notificationMsg = `✅ Message sent to ${chatName}: ${message}`;
                    
                    // Send OMI notification to user's mobile app
                    const uid = session.uid;
                    try {
                        await sendOmiNotification(uid, notificationMsg);
                    } catch (notifError) {
                        console.log(`⚠️  Notification failed but message was sent: ${notifError.message}`);
                    }
                    
                    return notificationMsg;
                } catch (error) {
                    SimpleSessionStorage.resetSession(sessionId);
                    console.error(`❌ FAILED: ${error.message}`);
                    return `❌ Failed: ${error.message}`;
                }
            }
        }
        
        // REAL MODE: Start collecting segments
        SimpleSessionStorage.updateSession(sessionId, {
            message_mode: "recording",
            trigger_type: triggerType,
            accumulated_text: content || fullText,
            segments_count: 1
        });
        
        return "collecting_1";
    }
    
    // If in recording mode, collect more segments
    else if (session.message_mode === "recording") {
        let accumulated = session.accumulated_text || "";
        let segmentsCount = session.segments_count || 0;
        
        accumulated += " " + fullText;
        segmentsCount += 1;
        
        console.log(`📝 Segment ${segmentsCount}/5: '${fullText}'`);
        console.log(`📚 Full accumulated: '${accumulated.substring(0, 150)}...'`);
        
        SimpleSessionStorage.updateSession(sessionId, {
            accumulated_text: accumulated,
            segments_count: segmentsCount
        });
        
        // Process if we hit max 5 segments
        if (segmentsCount >= 5) {
            console.log(`✅ Max segments reached (${segmentsCount})! Processing...`);
            
            const triggerType = session.trigger_type || 'message';
            
            SimpleSessionStorage.updateSession(sessionId, {
                message_mode: "processing"
            });
            
            const platform = rcsdk.platform();
            await platform.auth().setData(user.tokens);
            
            if (triggerType === 'event') {
                // Handle event creation
                console.log(`📅 Creating event from accumulated segments...`);
                
                // AI extracts event details
                const { name, startDate, startTime, duration, notes } = await messageDetector.aiExtractEventDetails(accumulated);
                
                if (!name || name.trim().length < 3) {
                    SimpleSessionStorage.resetSession(sessionId);
                    console.log(`⚠️  No valid event name found`);
                    return "❌ No valid event name found";
                }
                
                console.log(`📤 Creating event: "${name}" on ${startDate || 'TBD'} at ${startTime || 'TBD'}`);
                
                try {
                    const uid = session.uid;
                    const userSettings = SimpleUserStorage.getUserSettings(uid);
                    await createRingCentralEvent(platform, name, startDate, startTime, duration, notes, userSettings.timezone);
                    
                    SimpleSessionStorage.resetSession(sessionId);
                    console.log(`🎉 SUCCESS! Event created: ${name}`);
                    const eventInfo = startDate ? ` on ${startDate}${startTime ? ` at ${startTime}` : ''}` : '';
                    const notificationMsg = `✅ Event created: ${name}${eventInfo}`;
                    
                    // Send OMI notification to user's mobile app
                    try {
                        await sendOmiNotification(uid, notificationMsg);
                    } catch (notifError) {
                        console.log(`⚠️  Notification failed but event was created: ${notifError.message}`);
                    }
                    
                    return notificationMsg;
                } catch (error) {
                    SimpleSessionStorage.resetSession(sessionId);
                    console.error(`❌ FAILED: ${error.message}`);
                    return `❌ Failed to create event: ${error.message}`;
                }
            } else if (triggerType === 'task') {
                // Handle task creation
                console.log(`📋 Creating task from accumulated segments...`);
                
                // Fetch team members (using same method as message matching for consistency)
                const enrichedMembers = await getEnrichedTeamMembers(platform);
                
                // AI extracts task details
                const { title, assigneeId, assigneeName, dueDate, dueTime } = await messageDetector.aiExtractTaskDetails(
                    accumulated,
                    enrichedMembers
                );
                
                if (!title || title.trim().length < 3) {
                    SimpleSessionStorage.resetSession(sessionId);
                    console.log(`⚠️  No valid task title found`);
                    return "❌ No valid task title found";
                }
                
                console.log(`📤 Creating task: "${title}" ${assigneeName ? `for ${assigneeName}` : ''}`);
                
                try {
                    const uid = session.uid;
                    const userSettings = SimpleUserStorage.getUserSettings(uid);
                    await createRingCentralTask(platform, title, assigneeId, assigneeName, dueDate, dueTime, userSettings.timezone);
                    
                    SimpleSessionStorage.resetSession(sessionId);
                    console.log(`🎉 SUCCESS! Task created: ${title}`);
                    const dueInfo = dueDate ? ` (due ${dueDate}${dueTime ? ` at ${dueTime}` : ''})` : '';
                    const notificationMsg = `✅ Task created: ${title}${assigneeName ? ` for ${assigneeName}` : ''}${dueInfo}`;
                    
                    // Send OMI notification to user's mobile app
                    try {
                        await sendOmiNotification(uid, notificationMsg);
                    } catch (notifError) {
                        console.log(`⚠️  Notification failed but task was created: ${notifError.message}`);
                    }
                    
                    return notificationMsg;
                } catch (error) {
                    SimpleSessionStorage.resetSession(sessionId);
                    console.error(`❌ FAILED: ${error.message}`);
                    return `❌ Failed to create task: ${error.message}`;
                }
            } else {
                // Handle message sending (original logic)
                console.log(`🔄 Fetching fresh chat list...`);
                const chatsResponse = await platform.get('/team-messaging/v1/chats');
                const chatsData = await chatsResponse.json();
                let chats = chatsData.records || chatsData || [];
                
                // Enrich chats with member names for DMs (only for message sending)
                console.log(`🔄 Enriching chats for message sending (webhook)...`);
                chats = await enrichChatsWithMemberNames(platform, chats);
                
                // AI extracts chat and message
                const { chatId, chatName, message } = await messageDetector.aiExtractMessageAndChannel(
                    accumulated,
                    chats
                );
                
                if (!chatId || !message || message.trim().length < 3) {
                    SimpleSessionStorage.resetSession(sessionId);
                    console.log(`⚠️  No valid message content`);
                    return "❌ No valid message content";
                }
                
                console.log(`📤 Sending to ${chatName}: '${message}'`);
                
                try {
                    await platform.post(
                        `/team-messaging/v1/chats/${chatId}/posts`,
                        { text: message }
                    );
                    
                    SimpleSessionStorage.resetSession(sessionId);
                    console.log(`🎉 SUCCESS! Message sent to ${chatName}`);
                    const notificationMsg = `✅ Message sent to ${chatName}: ${message}`;
                    
                    // Send OMI notification to user's mobile app
                    const uid = session.uid;
                    try {
                        await sendOmiNotification(uid, notificationMsg);
                    } catch (notifError) {
                        console.log(`⚠️  Notification failed but message was sent: ${notifError.message}`);
                    }
                    
                    return notificationMsg;
                } catch (error) {
                    SimpleSessionStorage.resetSession(sessionId);
                    console.error(`❌ FAILED: ${error.message}`);
                    return `❌ Failed: ${error.message}`;
                }
            }
        } else {
            console.log(`⏳ Collecting more segments (${segmentsCount}/5)... [Background monitor will handle timeout]`);
            return `collecting_${segmentsCount}`;
        }
    }
    
    // If already processing, ignore
    else if (session.message_mode === "processing") {
        console.log(`⏳ Already processing message, ignoring this segment`);
        return "processing";
    }
    
    return "listening";
}

// Test interface
app.get('/test', (req, res) => {
    const { uid = 'test_user_123', dev } = req.query;
    
    if (!dev || dev !== 'true') {
        return res.status(404).send('Not found');
    }
    
    res.send(getTestHTML(uid));
});

// API endpoint to get chats for public interface
app.get('/api/chats', async (req, res) => {
    try {
        const uid = req.query.uid;
        if (!uid) {
            return res.json({ success: false, error: 'Not authenticated' });
        }
        
        const user = SimpleUserStorage.getUser(uid);
        if (!user || !user.tokens) {
            return res.json({ success: false, error: 'Not authenticated' });
        }
        
        // Refresh chats
        const platform = rcsdk.platform();
        await platform.auth().setData(user.tokens);
        const chatsResponse = await platform.get('/team-messaging/v1/chats');
        const chatsData = await chatsResponse.json();
        const chats = chatsData.records || chatsData || [];
        
        SimpleUserStorage.saveUser(uid, user.tokens, chats);
        
        res.json({ success: true, chats });
    } catch (error) {
        console.error('API /api/chats error:', error);
        res.json({ success: false, error: error.message });
    }
});

// API endpoint to send message from public interface
app.post('/api/send-message', async (req, res) => {
    try {
        const uid = req.query.uid || req.body.uid;
        if (!uid) {
            return res.json({ success: false, error: 'Not authenticated' });
        }
        
        const user = SimpleUserStorage.getUser(uid);
        if (!user || !user.tokens) {
            return res.json({ success: false, error: 'Not authenticated' });
        }
        
        const { naturalLanguageText } = req.body;
        if (!naturalLanguageText) {
            return res.json({ success: false, error: 'No message provided' });
        }
        
        const platform = rcsdk.platform();
        await platform.auth().setData(user.tokens);
        
        // Fetch fresh chats
        const chatsResponse = await platform.get('/team-messaging/v1/chats');
        const chatsData = await chatsResponse.json();
        let chats = chatsData.records || chatsData || [];
        
        if (chats.length > 0) {
            SimpleUserStorage.saveUser(uid, user.tokens, chats);
        }
        
        // Enrich chats with member names for DMs (only when sending message)
        console.log(`🔄 Enriching chats for message sending...`);
        chats = await enrichChatsWithMemberNames(platform, chats);
        
        // Use AI to extract message and channel
        const { chatId, chatName, message } = await messageDetector.aiExtractMessageAndChannel(
            naturalLanguageText,
            chats
        );
        
        if (!chatId) {
            return res.json({ 
                success: false, 
                error: 'Could not determine which chat to send to',
                availableChats: chats.map(c => c.name || c.description || c.id)
            });
        }
        
        if (!message || message.trim().length < 3) {
            return res.json({ success: false, error: 'No valid message content found' });
        }
        
        // Send the message
        await platform.post(`/team-messaging/v1/chats/${chatId}/posts`, { text: message });
        
        res.json({ 
            success: true, 
            actualChannel: chatName,
            parsedMessage: message
        });
    } catch (error) {
        console.error('API /api/send-message error:', error);
        res.json({ success: false, error: error.message });
    }
});

// API endpoint to create task (for external apps)
app.post('/api/create-task', async (req, res) => {
    try {
        const uid = req.query.uid || req.body.uid;
        if (!uid) {
            return res.status(401).json({ 
                success: false, 
                error: 'Missing uid parameter. Include in query string or request body.' 
            });
        }
        
        const user = SimpleUserStorage.getUser(uid);
        if (!user || !user.tokens) {
            return res.status(401).json({ 
                success: false, 
                error: 'User not authenticated. Please authenticate with RingCentral first.' 
            });
        }
        
        const { title, dueDate, dueTime, assigneeName } = req.body;
        
        if (!title || title.trim().length < 3) {
            return res.status(400).json({ 
                success: false, 
                error: 'Task title is required and must be at least 3 characters.' 
            });
        }
        
        console.log(`📋 API: Creating task "${title}" ${assigneeName ? `for ${assigneeName}` : ''}`);
        
        const platform = rcsdk.platform();
        await platform.auth().setData(user.tokens);
        
        // Fetch team members for assignee matching
        const enrichedMembers = await getEnrichedTeamMembers(platform);
        
        // Match assignee by name (fuzzy matching)
        let assigneeId = null;
        let matchedAssigneeName = assigneeName;
        
        if (assigneeName) {
            // Try exact match first
            for (const member of enrichedMembers) {
                const memberName = member.displayName || member.name || member.email;
                if (memberName && memberName.toLowerCase() === assigneeName.toLowerCase()) {
                    assigneeId = member.id;
                    matchedAssigneeName = memberName;
                    console.log(`✅ Exact match: ${assigneeName} → ${memberName}`);
                    break;
                }
            }
            
            // Try fuzzy match if no exact match
            if (!assigneeId) {
                for (const member of enrichedMembers) {
                    const memberName = member.displayName || member.name || member.email;
                    if (memberName && (
                        memberName.toLowerCase().includes(assigneeName.toLowerCase()) ||
                        assigneeName.toLowerCase().includes(memberName.toLowerCase())
                    )) {
                        assigneeId = member.id;
                        matchedAssigneeName = memberName;
                        console.log(`🔍 Fuzzy match: ${assigneeName} → ${memberName}`);
                        break;
                    }
                }
            }
            
            if (!assigneeId) {
                console.log(`⚠️  No match found for assignee: ${assigneeName}`);
            }
        }
        
        // Get user settings for timezone
        const userSettings = SimpleUserStorage.getUserSettings(uid);
        
        // Create task
        const result = await createRingCentralTask(
            platform, 
            title, 
            assigneeId, 
            matchedAssigneeName, 
            dueDate, 
            dueTime, 
            userSettings.timezone
        );
        
        console.log(`✅ Task created successfully: ${title}`);
        
        // Send OMI notification
        const dueInfo = dueDate ? ` (due ${dueDate}${dueTime ? ` at ${dueTime}` : ''})` : '';
        const notificationMsg = `✅ Task created: ${title}${matchedAssigneeName ? ` for ${matchedAssigneeName}` : ''}${dueInfo}`;
        try {
            await sendOmiNotification(uid, notificationMsg);
        } catch (notifError) {
            console.log(`⚠️  Notification failed but task was created: ${notifError.message}`);
        }
        
        res.json({ 
            success: true,
            task: {
                title: title,
                assignee: matchedAssigneeName,
                assigneeMatched: !!assigneeId,
                dueDate: dueDate,
                dueTime: dueTime,
                timezone: userSettings.timezone
            },
            message: notificationMsg
        });
        
    } catch (error) {
        console.error('API /api/create-task error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to create task' 
        });
    }
});

// API endpoint to send detailed message to chat (for external apps)
app.post('/api/send-chat-message', async (req, res) => {
    try {
        const uid = req.query.uid || req.body.uid;
        if (!uid) {
            return res.status(401).json({ 
                success: false, 
                error: 'Missing uid parameter. Include in query string or request body.' 
            });
        }
        
        const user = SimpleUserStorage.getUser(uid);
        if (!user || !user.tokens) {
            return res.status(401).json({ 
                success: false, 
                error: 'User not authenticated. Please authenticate with RingCentral first.' 
            });
        }
        
        const { message, chatName } = req.body;
        
        if (!message || message.trim().length < 1) {
            return res.status(400).json({ 
                success: false, 
                error: 'Message text is required.' 
            });
        }
        
        if (!chatName) {
            return res.status(400).json({ 
                success: false, 
                error: 'Chat name is required. Specify which chat to send the message to.' 
            });
        }
        
        console.log(`💬 API: Sending message to "${chatName}"`);
        
        const platform = rcsdk.platform();
        await platform.auth().setData(user.tokens);
        
        // Fetch fresh chats
        const chatsResponse = await platform.get('/team-messaging/v1/chats');
        const chatsData = await chatsResponse.json();
        let chats = chatsData.records || chatsData || [];
        
        // Enrich chats with member names for DMs
        console.log(`🔄 Enriching chats for message sending...`);
        chats = await enrichChatsWithMemberNames(platform, chats);
        
        // Find chat by name (fuzzy matching)
        let chatId = null;
        let matchedChatName = null;
        
        // Try exact match first
        for (const chat of chats) {
            const displayName = chat.displayName || chat.name || chat.description;
            if (displayName && displayName.toLowerCase() === chatName.toLowerCase()) {
                chatId = chat.id;
                matchedChatName = displayName;
                console.log(`✅ Exact match: ${chatName} → ${displayName}`);
                break;
            }
        }
        
        // Try fuzzy match if no exact match
        if (!chatId) {
            for (const chat of chats) {
                const displayName = chat.displayName || chat.name || chat.description;
                if (displayName && (
                    displayName.toLowerCase().includes(chatName.toLowerCase()) ||
                    chatName.toLowerCase().includes(displayName.toLowerCase())
                )) {
                    chatId = chat.id;
                    matchedChatName = displayName;
                    console.log(`🔍 Fuzzy match: ${chatName} → ${displayName}`);
                    break;
                }
            }
        }
        
        if (!chatId) {
            return res.status(404).json({ 
                success: false, 
                error: `Chat not found: ${chatName}`,
                availableChats: chats.map(c => ({
                    name: c.displayName || c.name || c.description,
                    type: c.type,
                    id: c.id
                })).slice(0, 20)
            });
        }
        
        // Send the message
        await platform.post(`/team-messaging/v1/chats/${chatId}/posts`, { 
            text: message 
        });
        
        console.log(`✅ Message sent to ${matchedChatName}`);
        
        // Send OMI notification
        const notificationMsg = `✅ Message sent to ${matchedChatName}`;
        try {
            await sendOmiNotification(uid, notificationMsg);
        } catch (notifError) {
            console.log(`⚠️  Notification failed but message was sent: ${notifError.message}`);
        }
        
        res.json({ 
            success: true,
            chat: {
                name: matchedChatName,
                id: chatId
            },
            message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
            notification: notificationMsg
        });
        
    } catch (error) {
        console.error('API /api/send-chat-message error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to send message' 
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: "healthy", service: "omi-ringcentral-integration" });
});

// Webhook test endpoint (GET)
app.get('/webhook', (req, res) => {
    console.log('🔍 WEBHOOK GET TEST:', req.query);
    res.json({ 
        status: "webhook_ready",
        message: "Webhook endpoint is active. Use POST to send transcripts.",
        query_params: req.query
    });
});

// HTML templates
function getLandingPageHTML() {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>RingCentral Voice Integration</title>
    <style>${getModernCSS()}</style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="header-content">
                <h1>🔊 Ring Voice</h1>
                <p class="subtitle">Voice-powered RingCentral messaging & tasks</p>
            </div>
        </header>

        <div class="settings-card">
            <h2>ℹ️ How to Access Settings</h2>
            <p style="margin-bottom: 20px; color: #6b7280;">
                This app is designed to work with the OMI mobile app. To access your settings and manage your integration:
            </p>
            
            <div class="examples" style="margin-bottom: 24px;">
                <div class="example-item">
                    <span class="example-label">From OMI App:</span>
                    <code>Open the RingCentral integration in your OMI app → Settings</code>
                </div>
                <div class="example-item">
                    <span class="example-label">Direct URL:</span>
                    <code>https://omi-ringcentral.up.railway.app/?uid=YOUR_USER_ID</code>
                </div>
            </div>

            <h3 style="font-size: 18px; margin-bottom: 12px; color: #374151;">✨ Features</h3>
            <ul style="color: #6b7280; line-height: 2;">
                <li>💬 Send messages to any RingCentral chat with your voice</li>
                <li>📋 Create tasks with smart assignee matching</li>
                <li>⏰ Set timezone for accurate task due dates</li>
                <li>🎤 Natural voice commands powered by AI</li>
            </ul>

            <div style="margin-top: 24px; padding: 16px; background: #fef3c7; border-radius: 8px; border: 1px solid #fbbf24;">
                <strong style="color: #92400e;">💡 Tip:</strong>
                <p style="color: #78350f; margin-top: 8px; font-size: 14px;">
                    Get your User ID (uid) from the OMI mobile app when you set up this integration.
                    The homepage with settings will load automatically when you access via OMI.
                </p>
            </div>
        </div>
    </div>
</body>
</html>
    `;
}

function getNotAuthenticatedHTML(authUrl, uid) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>RingCentral Voice Integration</title>
    <style>${getCSS()}</style>
</head>
<body>
    <div class="container">
        <div class="icon">📞→💬</div>
        <h1>Voice to RingCentral Messages</h1>
        <p style="font-size: 18px;">Send RingCentral messages with your voice through OMI</p>
        
        <a href="${authUrl}" class="btn btn-primary btn-block" style="font-size: 17px; padding: 16px;">
            🔐 Connect RingCentral Account
        </a>
        
        <div class="card">
            <h3>✨ How It Works</h3>
            <div class="steps">
                <div class="step">
                    <div class="step-number">1</div>
                    <div class="step-content">
                        <strong>Connect</strong> your RingCentral account securely
                    </div>
                </div>
                <div class="step">
                    <div class="step-number">2</div>
                    <div class="step-content">
                        <strong>Speak</strong> your message naturally
                    </div>
                </div>
                <div class="step">
                    <div class="step-number">3</div>
                    <div class="step-content">
                        <strong>Done!</strong> Message posted to RingCentral instantly
                    </div>
                </div>
            </div>
        </div>
        
        <div class="card">
            <h3>🎯 Example Commands</h3>
            <div class="example">
                "Send ring message to general saying hello team!"
            </div>
            <div class="example">
                "Send ringcentral message to marketing that campaign is live"
            </div>
            <div class="example">
                "Post ring message to john saying can we meet tomorrow"
            </div>
        </div>
        
        <div class="footer">
            <p>Powered by <strong>OMI</strong> × <strong>AI</strong></p>
        </div>
    </div>
</body>
</html>
    `;
}

function getAuthenticatedHTML(uid, chats) {
    const user = SimpleUserStorage.getUser(uid);
    const settings = SimpleUserStorage.getUserSettings(uid);
    const currentTimezone = settings.timezone || 'America/Los_Angeles';
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>RingCentral Voice Integration</title>
    <style>${getModernCSS()}</style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="header-content">
                <h1>🔊 Ring Voice</h1>
                <p class="subtitle">Voice-powered messaging & task management</p>
            </div>
            <div class="connection-badge">
                <div class="status-dot"></div>
                Connected
            </div>
        </header>

        <div class="feature-grid">
            <div class="feature-card messages">
                <div class="feature-icon">💬</div>
                <h3>Send Messages</h3>
                <p class="feature-desc">Voice-activated messaging to any chat</p>
                <div class="examples">
                    <div class="example-item">
                        <span class="example-label">Try saying:</span>
                        <code>"Send ring message to general saying hello team"</code>
                    </div>
                    <div class="example-item">
                        <code>"Send ringcentral message to John that meeting is at 3pm"</code>
                    </div>
                </div>
                <div class="feature-stats">
                    <span class="stat">${chats.length} chats available</span>
                </div>
            </div>

            <div class="feature-card tasks">
                <div class="feature-icon">📋</div>
                <h3>Create Tasks</h3>
                <p class="feature-desc">AI-powered task creation with smart assignment</p>
                <div class="examples">
                    <div class="example-item">
                        <span class="example-label">Try saying:</span>
                        <code>"Create ring task for Lopez due tomorrow at 3pm review proposal"</code>
                    </div>
                    <div class="example-item">
                        <code>"Add ring task finish report by Friday"</code>
                    </div>
                </div>
                <div class="feature-stats">
                    <span class="stat">Smart date & time parsing</span>
                </div>
            </div>

            <div class="feature-card events">
                <div class="feature-icon">📅</div>
                <h3>Create Events</h3>
                <p class="feature-desc">Schedule calendar events with voice commands</p>
                <div class="examples">
                    <div class="example-item">
                        <span class="example-label">Try saying:</span>
                        <code>"Add ring event team meeting tomorrow at 2pm"</code>
                    </div>
                    <div class="example-item">
                        <code>"Schedule ring event client presentation on Friday at 10am for 90 minutes"</code>
                    </div>
                </div>
                <div class="feature-stats">
                    <span class="stat">Auto-syncs to RingCentral calendar</span>
                </div>
            </div>
        </div>

        <div class="settings-card">
            <h2>⚙️ Settings</h2>
            
            <div class="setting-group">
                <label for="timezone">Timezone (for task due dates)</label>
                <select id="timezone" class="setting-select">
                    <option value="America/Los_Angeles" ${currentTimezone === 'America/Los_Angeles' ? 'selected' : ''}>Pacific Time (PT)</option>
                    <option value="America/Denver" ${currentTimezone === 'America/Denver' ? 'selected' : ''}>Mountain Time (MT)</option>
                    <option value="America/Chicago" ${currentTimezone === 'America/Chicago' ? 'selected' : ''}>Central Time (CT)</option>
                    <option value="America/New_York" ${currentTimezone === 'America/New_York' ? 'selected' : ''}>Eastern Time (ET)</option>
                    <option value="America/Phoenix" ${currentTimezone === 'America/Phoenix' ? 'selected' : ''}>Arizona (MST)</option>
                    <option value="UTC" ${currentTimezone === 'UTC' ? 'selected' : ''}>UTC</option>
                    <option value="Europe/London" ${currentTimezone === 'Europe/London' ? 'selected' : ''}>London (GMT/BST)</option>
                    <option value="Europe/Paris" ${currentTimezone === 'Europe/Paris' ? 'selected' : ''}>Paris (CET/CEST)</option>
                    <option value="Asia/Tokyo" ${currentTimezone === 'Asia/Tokyo' ? 'selected' : ''}>Tokyo (JST)</option>
                    <option value="Australia/Sydney" ${currentTimezone === 'Australia/Sydney' ? 'selected' : ''}>Sydney (AEST)</option>
                </select>
                <button class="btn-primary" onclick="saveTimezone()">Save Timezone</button>
            </div>

            <div class="setting-actions">
                <button class="btn-secondary" onclick="refreshChats()">
                    🔄 Refresh Chats
                </button>
                <button class="btn-danger" onclick="logoutUser()">
                    🚪 Logout
                </button>
            </div>
        </div>
    </div>
    
    <script>
        async function saveTimezone() {
            const timezone = document.getElementById('timezone').value;
            try {
                const response = await fetch('/update-settings?uid=${uid}', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ timezone })
                });
                const data = await response.json();
                
                if (data.success) {
                    alert('✅ Timezone updated!');
                } else {
                    alert('❌ Failed: ' + data.error);
                }
            } catch (error) {
                alert('❌ Error: ' + error.message);
            }
        }

        async function refreshChats() {
            try {
                const response = await fetch('/refresh-chats?uid=${uid}', {
                    method: 'POST'
                });
                const data = await response.json();
                
                if (data.success) {
                    alert('✅ Chats refreshed!');
                    window.location.reload();
                } else {
                    alert('❌ Failed: ' + data.error);
                }
            } catch (error) {
                alert('❌ Error: ' + error.message);
            }
        }
        
        async function logoutUser() {
            if (!confirm('Are you sure you want to logout?')) return;
            
            try {
                const response = await fetch('/logout?uid=${uid}', {
                    method: 'POST'
                });
                const data = await response.json();
                
                if (data.success) {
                    window.location.href = '/?uid=${uid}';
                } else {
                    alert('❌ Logout failed: ' + data.error);
                }
            } catch (error) {
                alert('❌ Error: ' + error.message);
            }
        }
    </script>
</body>
</html>
    `;
}

function getSuccessHTML(uid, chatsCount) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Connected Successfully!</title>
    <style>${getCSS()}</style>
</head>
<body>
    <div class="container">
        <div class="success-box" style="padding: 40px 24px;">
            <div class="icon" style="font-size: 72px; animation: pulse 1.5s infinite;">🎉</div>
            <h2 style="font-size: 28px; margin: 16px 0;">Successfully Connected!</h2>
            <p style="font-size: 17px; margin: 12px 0;">
                Your RingCentral account is now linked
            </p>
            <p style="font-size: 16px; margin: 8px 0;">
                Found <strong>${chatsCount}</strong> ${chatsCount === 1 ? 'chat' : 'chats'}
            </p>
        </div>
        
        <a href="/?uid=${uid}" class="btn btn-primary btn-block" style="font-size: 17px; padding: 16px; margin-top: 24px;">
            Continue to Settings →
        </a>
        
        <div class="card" style="margin-top: 20px; text-align: center;">
            <h3 style="margin-bottom: 16px;">🎤 Ready to Go!</h3>
            <p style="font-size: 16px; line-height: 1.8;">
                You can now send RingCentral messages just by speaking to your OMI device.
                <br><br>
                Try saying:<br>
                <strong style="font-size: 17px;">"Send ring message to general saying hello!"</strong>
            </p>
        </div>
    </div>
</body>
</html>
    `;
}

function getTestHTML(uid) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>RingCentral Test Interface</title>
    <style>${getCSS()}</style>
</head>
<body>
    <div class="container">
        <div class="header-success">
            <h1>🧪 Test Interface</h1>
            <p>Test RingCentral messaging without OMI device</p>
        </div>

        <div class="card">
            <h2>Authentication</h2>
            <div class="input-group">
                <label>User ID (UID):</label>
                <input type="text" id="uid" value="${uid}">
            </div>
            <button class="btn btn-primary" onclick="authenticate()">🔐 Authenticate RingCentral</button>
            <button class="btn btn-secondary" onclick="checkAuth()">🔍 Check Auth Status</button>
            <button class="btn btn-secondary" onclick="logoutUser()" style="border-color: #e01e5a; color: #e01e5a;">🚪 Logout</button>
            <div id="authStatus" style="margin-top: 10px;"></div>
        </div>

        <div class="card">
            <h2>Test Voice Commands</h2>
            <div class="input-group">
                <label>What would you say to OMI:</label>
                <textarea id="voiceInput" rows="5" placeholder='Example: "Send ring message to general saying hello team, hope everyone is doing great!"'></textarea>
            </div>
            <button class="btn btn-primary" onclick="sendCommand()">🎤 Send Command</button>
            <button class="btn btn-secondary" onclick="clearLogs()">🗑️ Clear Logs</button>
            
            <div id="status" class="status"></div>
        </div>

        <div class="card">
            <h3>Quick Examples (Click to use)</h3>
            <h4 style="margin-top: 0; color: #ff7700; font-size: 16px;">💬 Messages:</h4>
            <div class="example" onclick="useExample(this)">
                Send ring message to general saying hello team, great work on the project!
            </div>
            <div class="example" onclick="useExample(this)">
                Send ringcentral message to marketing that the new campaign is now live!
            </div>
            
            <h4 style="margin-top: 20px; color: #ff7700; font-size: 16px;">📋 Tasks:</h4>
            <div class="example" onclick="useExample(this)">
                Create ring task for Lopez due tomorrow at 3pm review the quarterly report
            </div>
            <div class="example" onclick="useExample(this)">
                Add ring task finish the client presentation by Friday
            </div>
            
            <h4 style="margin-top: 20px; color: #ff7700; font-size: 16px;">📅 Events:</h4>
            <div class="example" onclick="useExample(this)">
                Add ring event team meeting tomorrow at 2pm
            </div>
            <div class="example" onclick="useExample(this)">
                Schedule ring event client presentation on Friday at 10am for 90 minutes about quarterly results
            </div>
            <div class="example" onclick="useExample(this)">
                Create ring event lunch with Sarah next Monday at noon
            </div>
        </div>

        <div class="card">
            <h2>Activity Log</h2>
            <div id="log" class="log">
                <div class="log-entry">
                    <span class="timestamp">Ready</span>
                    <span>Waiting for commands...</span>
                </div>
            </div>
        </div>
    </div>

    <script>
        const sessionId = 'test_session_' + Date.now();
        
        function addLog(message) {
            const log = document.getElementById('log');
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            const time = new Date().toLocaleTimeString();
            entry.innerHTML = \`<span class="timestamp">[\${time}]</span><span>\${message}</span>\`;
            log.insertBefore(entry, log.firstChild);
        }
        
        function setStatus(message, type = 'info') {
            const status = document.getElementById('status');
            status.textContent = message;
            status.className = 'status ' + type;
            status.style.display = 'block';
        }
        
        async function checkAuth() {
            const uid = document.getElementById('uid').value;
            try {
                const response = await fetch(\`/setup-completed?uid=\${uid}\`);
                const data = await response.json();
                
                const authStatus = document.getElementById('authStatus');
                if (data.is_setup_completed) {
                    authStatus.innerHTML = '<div class="success-box">✅ Connected to RingCentral</div>';
                    addLog('✅ Authentication verified');
                } else {
                    authStatus.innerHTML = '<div class="error-box">❌ Not connected</div>';
                    addLog('❌ Not authenticated');
                }
            } catch (error) {
                addLog('❌ Error: ' + error.message);
            }
        }
        
        function authenticate() {
            const uid = document.getElementById('uid').value;
            addLog('Opening RingCentral authentication...');
            window.open(\`/auth?uid=\${uid}\`, '_blank');
            setTimeout(() => addLog('After authenticating, click "Check Auth Status"'), 1000);
        }
        
        async function sendCommand() {
            const uid = document.getElementById('uid').value;
            const voiceInput = document.getElementById('voiceInput').value;
            
            if (!uid || !voiceInput) {
                alert('Please enter both User ID and voice command');
                return;
            }
            
            setStatus('🎤 Processing command...', 'recording');
            addLog('📤 Sending: "' + voiceInput.substring(0, 100) + '..."');
            
            try {
                const segments = [{
                    text: voiceInput,
                    speaker: "SPEAKER_00",
                    speakerId: 0,
                    is_user: true,
                    start: 0.0,
                    end: 5.0
                }];
                
                const response = await fetch(\`/webhook?session_id=\${sessionId}&uid=\${uid}\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(segments)
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    if (data.message && data.message.includes('✅')) {
                        setStatus(data.message, 'success');
                        addLog('✅ ' + data.message);
                    } else if (data.message && data.message.includes('❌')) {
                        setStatus(data.message, 'error');
                        addLog('❌ ' + data.message);
                    } else {
                        setStatus('Processing...', 'recording');
                        addLog('📝 ' + (data.message || 'Processing...'));
                    }
                } else {
                    setStatus('❌ Error: ' + (data.message || 'Unknown error'), 'error');
                    addLog('❌ Error: ' + (data.message || 'Unknown error'));
                }
            } catch (error) {
                setStatus('❌ Network error', 'error');
                addLog('❌ Network error: ' + error.message);
            }
        }
        
        function useExample(element) {
            document.getElementById('voiceInput').value = element.textContent.trim();
            addLog('📝 Example loaded');
        }
        
        function clearLogs() {
            document.getElementById('log').innerHTML = '<div class="log-entry"><span class="timestamp">Cleared</span><span>Logs cleared</span></div>';
            setStatus('');
        }
        
        async function logoutUser() {
            const uid = document.getElementById('uid').value;
            
            try {
                addLog('Logging out...');
                const response = await fetch(\`/logout?uid=\${uid}\`, {
                    method: 'POST'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    addLog('✅ Logged out successfully');
                    setTimeout(() => checkAuth(), 500);
                } else {
                    addLog('❌ Logout failed: ' + data.error);
                }
            } catch (error) {
                addLog('❌ Error: ' + error.message);
            }
        }
        
        window.onload = () => checkAuth();
    </script>
</body>
</html>
    `;
}

function getModernCSS() {
    return `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 900px;
            margin: 0 auto;
        }
        
        .header {
            background: white;
            border-radius: 16px;
            padding: 32px;
            margin-bottom: 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        
        .header-content h1 {
            font-size: 32px;
            font-weight: 800;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 4px;
        }
        
        .subtitle {
            color: #6b7280;
            font-size: 14px;
        }
        
        .connection-badge {
            display: flex;
            align-items: center;
            gap: 8px;
            background: #10b981;
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
        }
        
        .status-dot {
            width: 8px;
            height: 8px;
            background: white;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        
        .feature-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
        }
        
        .feature-card {
            background: white;
            border-radius: 16px;
            padding: 28px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        .feature-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 15px 40px rgba(0,0,0,0.15);
        }
        
        .feature-card.messages {
            border-top: 4px solid #3b82f6;
        }
        
        .feature-card.tasks {
            border-top: 4px solid #8b5cf6;
        }
        
        .feature-card.events {
            border-top: 4px solid #10b981;
        }
        
        .feature-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }
        
        .feature-card h3 {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 8px;
            color: #1f2937;
        }
        
        .feature-desc {
            color: #6b7280;
            font-size: 14px;
            margin-bottom: 20px;
        }
        
        .examples {
            background: #f9fafb;
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 16px;
        }
        
        .example-item {
            margin-bottom: 12px;
        }
        
        .example-item:last-child {
            margin-bottom: 0;
        }
        
        .example-label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: #6b7280;
            margin-bottom: 6px;
        }
        
        .example-item code {
            display: block;
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 10px 12px;
            font-size: 13px;
            color: #374151;
            font-family: 'Monaco', 'Courier New', monospace;
            line-height: 1.5;
        }
        
        .feature-stats {
            padding-top: 12px;
            border-top: 1px solid #e5e7eb;
        }
        
        .stat {
            font-size: 13px;
            color: #6b7280;
            font-weight: 500;
        }
        
        .settings-card {
            background: white;
            border-radius: 16px;
            padding: 32px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        
        .settings-card h2 {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 24px;
            color: #1f2937;
        }
        
        .setting-group {
            margin-bottom: 24px;
        }
        
        .setting-group label {
            display: block;
            font-size: 14px;
            font-weight: 600;
            color: #374151;
            margin-bottom: 8px;
        }
        
        .setting-select {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            font-size: 15px;
            color: #1f2937;
            background: white;
            transition: border-color 0.2s;
            margin-bottom: 12px;
        }
        
        .setting-select:focus {
            outline: none;
            border-color: #667eea;
        }
        
        .setting-actions {
            display: flex;
            gap: 12px;
            margin-top: 24px;
            padding-top: 24px;
            border-top: 1px solid #e5e7eb;
        }
        
        button {
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            flex: 1;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
        }
        
        .btn-secondary {
            background: #f3f4f6;
            color: #374151;
        }
        
        .btn-secondary:hover {
            background: #e5e7eb;
        }
        
        .btn-danger {
            background: #fee2e2;
            color: #dc2626;
        }
        
        .btn-danger:hover {
            background: #fecaca;
        }
        
        @media (max-width: 768px) {
            .feature-grid {
                grid-template-columns: 1fr;
            }
            
            .header {
                flex-direction: column;
                text-align: center;
                gap: 16px;
            }
            
            .setting-actions {
                flex-direction: column;
            }
        }
    `;
}

function getCSS() {
    return `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
            background: #1a1d21;
            color: #d1d2d3;
            min-height: 100vh;
            padding: 20px;
            line-height: 1.6;
            animation: fadeIn 0.5s ease-out;
        }
        
        .container {
            max-width: 650px;
            margin: 0 auto;
            animation: fadeIn 0.6s ease-out;
        }
        
        .icon {
            font-size: 64px;
            text-align: center;
            margin-bottom: 20px;
            animation: pulse 2s infinite;
            filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));
        }
        
        h1 {
            color: #ffffff;
            font-size: 32px;
            font-weight: 700;
            text-align: center;
            margin-bottom: 12px;
        }
        
        h2 {
            color: #ffffff;
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 15px;
            border-bottom: 1px solid #2c2d30;
            padding-bottom: 10px;
        }
        
        h3 {
            color: #ffffff;
            font-size: 19px;
            font-weight: 700;
            margin-bottom: 12px;
        }
        
        p {
            color: #9ca0a5;
            text-align: center;
            margin-bottom: 24px;
            font-size: 16px;
        }
        
        .username {
            color: #ff7700;
            font-weight: 700;
            font-size: 18px;
        }
        
        .header-success {
            background: #232529;
            padding: 40px 24px;
            border-radius: 8px;
            margin-bottom: 24px;
            border: 1px solid #2c2d30;
        }
        
        .card {
            background: #232529;
            border-radius: 8px;
            padding: 24px;
            margin-bottom: 16px;
            border: 1px solid #2c2d30;
            transition: border-color 0.2s;
        }
        
        .card:hover {
            border-color: #ff7700;
        }
        
        .btn {
            display: inline-block;
            padding: 10px 20px;
            border-radius: 4px;
            text-decoration: none;
            font-weight: 700;
            font-size: 15px;
            border: none;
            cursor: pointer;
            transition: all 0.2s ease-in-out;
            margin: 8px 8px 8px 0;
            text-align: center;
            line-height: 20px;
        }
        
        .btn-primary {
            background: #ff7700;
            color: #ffffff;
        }
        
        .btn-primary:hover {
            background: #ff8c1a;
        }
        
        .btn-secondary {
            background: transparent;
            color: #d1d2d3;
            border: 1px solid #545454;
        }
        
        .btn-secondary:hover {
            background: #2c2d30;
        }
        
        .btn-block {
            display: block;
            width: 100%;
            text-align: center;
        }
        
        input[type="text"], textarea {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #545454;
            border-radius: 4px;
            font-size: 15px;
            font-family: inherit;
            background: #1a1d21;
            color: #d1d2d3;
            transition: all 0.2s;
        }
        
        input[type="text"]:focus, textarea:focus {
            outline: none;
            border-color: #ff7700;
            box-shadow: 0 0 0 3px rgba(255, 119, 0, 0.3);
        }
        
        textarea {
            resize: vertical;
            min-height: 100px;
        }
        
        .input-group {
            margin-bottom: 15px;
        }
        
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 700;
            color: #d1d2d3;
            font-size: 15px;
        }
        
        .example {
            background: #1a1d21;
            padding: 16px 18px;
            border-radius: 6px;
            margin: 12px 0;
            font-size: 15px;
            cursor: pointer;
            border: 1px solid #2c2d30;
            color: #d1d2d3;
            transition: all 0.2s;
            line-height: 1.6;
        }
        
        .example:hover {
            border-color: #ff7700;
            background: #232529;
        }
        
        .steps {
            margin: 20px 0;
        }
        
        .step {
            display: flex;
            margin: 18px 0;
            align-items: flex-start;
            padding: 12px;
            border-radius: 6px;
            transition: background 0.2s;
        }
        
        .step:hover {
            background: #2c2d30;
        }
        
        .step-number {
            background: #ff7700;
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            margin-right: 14px;
            flex-shrink: 0;
            font-size: 15px;
        }
        
        .step-content {
            flex: 1;
            padding-top: 4px;
            font-size: 15px;
            line-height: 1.6;
            color: #9ca0a5;
        }
        
        .step-content strong {
            color: #d1d2d3;
        }
        
        .success-box {
            background: rgba(255, 119, 0, 0.15);
            color: #ff8c1a;
            padding: 24px;
            border-radius: 8px;
            margin: 18px 0;
            text-align: center;
            border: 1px solid #ff7700;
        }
        
        .error-box {
            background: rgba(224, 30, 90, 0.15);
            color: #e01e5a;
            padding: 18px;
            border-radius: 8px;
            margin: 14px 0;
            border: 1px solid #e01e5a;
        }
        
        .status {
            padding: 15px;
            border-radius: 6px;
            margin: 15px 0;
            font-weight: 500;
            display: none;
            border: 1px solid;
        }
        
        .status.info {
            background: rgba(29, 155, 209, 0.15);
            color: #1d9bd1;
            border-color: #1d9bd1;
        }
        
        .status.recording {
            background: rgba(236, 178, 46, 0.15);
            color: #ecb22e;
            border-color: #ecb22e;
        }
        
        .status.success {
            background: rgba(255, 119, 0, 0.15);
            color: #ff8c1a;
            border-color: #ff7700;
        }
        
        .status.error {
            background: rgba(224, 30, 90, 0.15);
            color: #e01e5a;
            border-color: #e01e5a;
        }
        
        ul {
            list-style: none;
            padding: 0;
        }
        
        li {
            padding: 10px;
            border-bottom: 1px solid #2c2d30;
            color: #9ca0a5;
        }
        
        li:last-child {
            border-bottom: none;
        }
        
        strong {
            color: #d1d2d3;
            font-weight: 700;
        }
        
        .footer {
            text-align: center;
            color: #9ca0a5;
            margin-top: 40px;
            padding: 20px;
            font-size: 14px;
            border-top: 1px solid #2c2d30;
        }
        
        .footer strong {
            color: #ff7700;
        }
        
        .log {
            background: #1a1d21;
            border: 1px solid #2c2d30;
            border-radius: 6px;
            padding: 15px;
            max-height: 300px;
            overflow-y: auto;
            font-family: 'Monaco', 'Courier New', monospace;
            font-size: 13px;
            margin-top: 15px;
        }
        
        .log-entry {
            padding: 5px 0;
            border-bottom: 1px solid #2c2d30;
            color: #d1d2d3;
        }
        
        .timestamp {
            color: #9ca0a5;
            margin-right: 10px;
        }
        
        @media (max-width: 480px) {
            body {
                padding: 12px;
            }
            
            .card {
                padding: 18px;
            }
            
            h1 {
                font-size: 26px;
            }
            
            .btn {
                display: block;
                width: 100%;
                margin: 10px 0;
            }
            
            .icon {
                font-size: 52px;
            }
        }
    `;
}

// Start server
app.listen(PORT, () => {
    console.log('💬 OMI RingCentral Integration');
    console.log('='.repeat(50));
    console.log('✅ Using file-based storage');
    console.log(`🚀 Starting on http://localhost:${PORT}`);
    console.log('='.repeat(50));
});
