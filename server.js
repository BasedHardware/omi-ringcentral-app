require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
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
                
                if (idleTime && idleTime > 5) {
                    const segmentsCount = session.segments_count || 0;
                    const accumulated = session.accumulated_text || "";
                    
                    console.log(`⏰ TIMEOUT MONITOR: Processing session ${sessionId} after ${idleTime.toFixed(1)}s idle (${segmentsCount} segment(s))`);
                    
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
                            } else {
                                console.log(`⏰ Insufficient content to send (message: '${message ? message.substring(0, 50) : 'None'}...')`);
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

// Start timeout monitor
startTimeoutMonitor();

// Root endpoint - Settings page
app.get('/', async (req, res) => {
    const { uid } = req.query;
    
    if (!uid) {
        return res.json({
            app: "OMI RingCentral Integration",
            version: "1.0.0",
            status: "active",
            endpoints: {
                auth: "/auth?uid=<user_id>",
                webhook: "/webhook?session_id=<session>&uid=<user_id>",
                setup_check: "/setup-completed?uid=<user_id>"
            }
        });
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

// Webhook endpoint - receives OMI transcripts
app.post('/webhook', async (req, res) => {
    const { uid, session_id } = req.query;
    
    if (!uid) {
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
                console.log(`   Segment ${i}: ${text.substring(0, 100)}`);
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
        const messageContent = messageDetector.extractMessageContent(fullText);
        
        console.log(`🎤 TRIGGER! ${isTestSession ? '[TEST MODE] Processing immediately...' : 'Starting segment collection...'}`);
        console.log(`   Content: '${messageContent}'`);
        
        // TEST MODE: Process immediately
        if (isTestSession && messageContent && messageContent.length > 10) {
            console.log(`🧪 Test mode: Processing full text immediately...`);
            
            const platform = rcsdk.platform();
            await platform.auth().setData(user.tokens);
            
            // Fetch fresh chats
            console.log(`🔄 Fetching fresh chat list...`);
            const chatsResponse = await platform.get('/team-messaging/v1/chats');
            const chatsData = await chatsResponse.json();
            let chats = chatsData.records || chatsData || [];
            
            // Enrich chats with member names for DMs (only for message sending)
            console.log(`🔄 Enriching chats for message sending (test mode)...`);
            chats = await enrichChatsWithMemberNames(platform, chats);
            
            // AI extracts chat and message
            const { chatId, chatName, message } = await messageDetector.aiExtractMessageAndChannel(
                messageContent,
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
                return `✅ Message sent to ${chatName}: ${message}`;
            } catch (error) {
                SimpleSessionStorage.resetSession(sessionId);
                console.error(`❌ FAILED: ${error.message}`);
                return `❌ Failed: ${error.message}`;
            }
        }
        
        // REAL MODE: Start collecting segments
        SimpleSessionStorage.updateSession(sessionId, {
            message_mode: "recording",
            accumulated_text: messageContent || fullText,
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
            
            SimpleSessionStorage.updateSession(sessionId, {
                message_mode: "processing"
            });
            
            const platform = rcsdk.platform();
            await platform.auth().setData(user.tokens);
            
            // Fetch fresh chats
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
                return `✅ Message sent to ${chatName}: ${message}`;
            } catch (error) {
                SimpleSessionStorage.resetSession(sessionId);
                console.error(`❌ FAILED: ${error.message}`);
                return `❌ Failed: ${error.message}`;
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

// Health check
app.get('/health', (req, res) => {
    res.json({ status: "healthy", service: "omi-ringcentral-integration" });
});

// HTML templates
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
    const chatOptions = chats.map(chat => {
        const displayName = chat.displayName || chat.name || chat.description || `Chat ${chat.id}`;
        return `<li>${displayName} (${chat.id})</li>`;
    }).join('');
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>RingCentral Settings</title>
    <style>${getCSS()}</style>
</head>
<body>
    <div class="container">
        <div class="card" style="margin-top: 20px;">
            <h2>📞 RingCentral Settings</h2>
            <p style="text-align: left; font-size: 14px; margin-bottom: 8px; color: #8b949e;">
                Connected to <span class="username">RingCentral</span>
            </p>
            <p style="text-align: left; font-size: 14px; margin-bottom: 16px;">
                Found ${chats.length} available chat(s)
            </p>
            
            <button type="button" class="btn btn-secondary btn-block" onclick="refreshChats()">
                🔄 Refresh Chats
            </button>
            <button type="button" class="btn btn-secondary btn-block" onclick="logoutUser()" style="margin-top: 20px; border-color: #e01e5a; color: #e01e5a;">
                🚪 Logout & Clear Data
            </button>
        </div>
        
        <div class="card">
            <h3>💬 Available Chats</h3>
            <ul style="list-style: none; padding: 0; max-height: 300px; overflow-y: auto;">
                ${chatOptions || '<li>No chats found</li>'}
            </ul>
        </div>
        
        <div class="card">
            <h3>🎤 Using Voice Commands</h3>
            <p style="text-align: left; margin-bottom: 16px;">
                Simply speak to your OMI device:
            </p>
            <div class="steps">
                <div class="step">
                    <div class="step-number">1</div>
                    <div class="step-content">
                        Say <strong>"Send ring message"</strong> or <strong>"Send ringcentral message"</strong>
                    </div>
                </div>
                <div class="step">
                    <div class="step-number">2</div>
                    <div class="step-content">
                        Mention the chat/person and speak your message
                    </div>
                </div>
                <div class="step">
                    <div class="step-number">3</div>
                    <div class="step-content">
                        Message posted instantly!
                    </div>
                </div>
            </div>
        </div>
        
        <div class="footer">
            <p>Powered by <strong>OMI</strong> × <strong>AI</strong></p>
        </div>
    </div>
    
    <script>
        async function refreshChats() {
            try {
                const response = await fetch('/refresh-chats?uid=${uid}', {
                    method: 'POST'
                });
                const data = await response.json();
                
                if (data.success) {
                    alert('✅ Chats refreshed! Reloading...');
                    window.location.reload();
                } else {
                    alert('❌ Failed: ' + data.error);
                }
            } catch (error) {
                alert('❌ Error: ' + error.message);
            }
        }
        
        async function logoutUser() {
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
            <div class="example" onclick="useExample(this)">
                Send ring message to general saying hello team, great work on the project!
            </div>
            <div class="example" onclick="useExample(this)">
                Send ringcentral message to marketing that the new campaign is now live!
            </div>
            <div class="example" onclick="useExample(this)">
                Post ring message to support saying customer inquiry needs attention
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
