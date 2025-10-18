const fs = require('fs');
const path = require('path');

// Storage file paths - use Railway volume if available, otherwise current directory
const STORAGE_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH)
    : __dirname;

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const USERS_FILE = path.join(STORAGE_DIR, 'users_data.json');
const SESSIONS_FILE = path.join(STORAGE_DIR, 'sessions_data.json');

console.log(`💾 Storage location: ${STORAGE_DIR}`);

// In-memory storage
let users = {};
let sessions = {};

// Load from file on startup
function loadStorage() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            console.log(`✅ Loaded ${Object.keys(users).length} users from storage`);
        }
    } catch (error) {
        console.error(`⚠️  Could not load users: ${error}`);
    }
    
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
            console.log(`✅ Loaded ${Object.keys(sessions).length} sessions from storage`);
        }
    } catch (error) {
        console.error(`⚠️  Could not load sessions: ${error}`);
    }
}

function saveUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (error) {
        console.error(`⚠️  Could not save users: ${error}`);
    }
}

function saveSessions() {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    } catch (error) {
        console.error(`⚠️  Could not save sessions: ${error}`);
    }
}

// Load on module import
loadStorage();

class SimpleUserStorage {
    static saveUser(uid, tokens, chats = null) {
        if (!users[uid]) {
            users[uid] = {
                uid,
                created_at: new Date().toISOString()
            };
        }
        
        users[uid] = {
            ...users[uid],
            tokens,
            updated_at: new Date().toISOString()
        };
        
        if (chats) {
            users[uid].available_chats = chats;
        }
        
        saveUsers();
        console.log(`💾 Saved data for user ${uid.substring(0, 10)}...`);
    }
    
    static getUser(uid) {
        return users[uid] || null;
    }
    
    static isAuthenticated(uid) {
        const user = users[uid];
        return user && user.tokens && user.tokens.access_token;
    }
    
    static deleteUser(uid) {
        if (users[uid]) {
            delete users[uid];
            saveUsers();
            return true;
        }
        return false;
    }
    
    static updateUserSettings(uid, settings) {
        if (users[uid]) {
            users[uid].settings = {
                ...users[uid].settings,
                ...settings,
                updated_at: new Date().toISOString()
            };
            saveUsers();
            console.log(`⚙️  Updated settings for user ${uid.substring(0, 10)}...`);
            return true;
        }
        return false;
    }
    
    static getUserSettings(uid) {
        const user = users[uid];
        if (user && user.settings) {
            return user.settings;
        }
        // Return defaults
        return {
            timezone: 'America/Los_Angeles' // Default to PT
        };
    }
}

class SimpleSessionStorage {
    static getOrCreateSession(sessionId, uid) {
        if (!sessions[sessionId]) {
            sessions[sessionId] = {
                session_id: sessionId,
                uid,
                message_mode: "idle", // idle, recording, processing
                segments_count: 0,
                accumulated_text: "",
                target_chat: null,
                created_at: new Date().toISOString()
            };
            console.log(`🆕 Created new session: ${sessionId}`);
        }
        return sessions[sessionId];
    }
    
    static updateSession(sessionId, updates) {
        if (sessions[sessionId]) {
            updates.last_segment_at = new Date().toISOString();
            Object.assign(sessions[sessionId], updates);
            console.log(`💾 Updated session ${sessionId}:`, updates);
        } else {
            console.error(`⚠️  Session ${sessionId} not found for update!`);
        }
    }
    
    static getSessionIdleTime(sessionId) {
        if (!sessions[sessionId]) {
            return null;
        }
        
        const lastSegment = sessions[sessionId].last_segment_at;
        if (!lastSegment) {
            return null;
        }
        
        try {
            const lastTime = new Date(lastSegment);
            const idleSeconds = (Date.now() - lastTime.getTime()) / 1000;
            return idleSeconds;
        } catch (error) {
            return null;
        }
    }
    
    static resetSession(sessionId) {
        if (sessions[sessionId]) {
            sessions[sessionId].message_mode = "idle";
            sessions[sessionId].segments_count = 0;
            sessions[sessionId].accumulated_text = "";
            sessions[sessionId].target_chat = null;
            console.log(`🔄 Reset session ${sessionId}`);
        }
    }
    
    static getAllSessions() {
        return sessions;
    }
}

module.exports = {
    SimpleUserStorage,
    SimpleSessionStorage,
    users,
    sessions,
    saveUsers,
    saveSessions
};

