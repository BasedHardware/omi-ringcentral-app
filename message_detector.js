const OpenAI = require('openai');

class MessageDetector {
    static TRIGGER_PHRASES = [
        "send ring message",
        "send ringcentral message",
        "post ring message",
        "post ringcentral message"
    ];

    constructor(apiKey) {
        this.openai = new OpenAI({ apiKey });
    }

    detectTrigger(text) {
        const normalized = text.toLowerCase().trim();
        return MessageDetector.TRIGGER_PHRASES.some(trigger => normalized.includes(trigger));
    }

    extractMessageContent(text) {
        const normalized = text.toLowerCase();
        
        // Find the trigger phrase
        let triggerIndex = -1;
        let matchedTrigger = null;
        
        for (const trigger of MessageDetector.TRIGGER_PHRASES) {
            const idx = normalized.indexOf(trigger);
            if (idx !== -1) {
                triggerIndex = idx;
                matchedTrigger = trigger;
                break;
            }
        }
        
        if (triggerIndex === -1) {
            return null;
        }
        
        // Extract content after trigger
        const startIndex = triggerIndex + matchedTrigger.length;
        const content = text.substring(startIndex).trim();
        
        return content || null;
    }

    async aiExtractMessageAndChannel(allSegmentsText, availableChats) {
        // Use displayName for DMs, otherwise name/description
        const chatNames = availableChats.map(chat => {
            if (chat.displayName) return chat.displayName;
            return chat.name || chat.description || `Chat ${chat.id}`;
        });
        
        const chatMap = {};
        availableChats.forEach(chat => {
            // For DMs, use displayName (person's name) as the key
            const name = chat.displayName || chat.name || chat.description;
            if (name) chatMap[name] = chat.id;
        });

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: `You are a RingCentral message parser. Extract the chat/channel name and message content from voice commands.

Available chats: ${chatNames.join(', ')}

The user said something like "send message to [chat] saying [message]" or "message [person] that [message]"

Your job:
1. Identify which chat/channel/person name the user mentioned (fuzzy match from available chats)
2. Extract the message content they want to send
3. Clean up the message (remove filler words, fix grammar)

Important:
- Chat names might be said imperfectly (e.g., "general" for "General", "marketing team" for "Marketing")
- Match to the CLOSEST available chat name
- If no clear chat mentioned, return "UNKNOWN" for chat
- Message should be clean and natural

Respond in this EXACT format:
CHAT: <chat_name or UNKNOWN>
MESSAGE: <cleaned message content>

Examples:

Input: "to general saying hello team how are you doing today"
Output:
CHAT: general
MESSAGE: Hello team, how are you doing today?

Input: "to marketing team that the new campaign is live"
Output:
CHAT: marketing
MESSAGE: The new campaign is live

Input: "message john saying can we meet tomorrow"
Output:
CHAT: john
MESSAGE: Can we meet tomorrow?

Input: "hello everyone this is a test message"
Output:
CHAT: UNKNOWN
MESSAGE: Hello everyone, this is a test message`
                    },
                    {
                        role: "user",
                        content: `Voice command after trigger: ${allSegmentsText}\n\nExtract chat and message:`
                    }
                ],
                temperature: 0.3,
                max_tokens: 200
            });

            const result = response.choices[0].message.content.trim();
            
            // Parse response
            let chatName = null;
            let message = null;
            
            for (const line of result.split('\n')) {
                if (line.startsWith("CHAT:")) {
                    chatName = line.replace("CHAT:", "").trim();
                } else if (line.startsWith("MESSAGE:")) {
                    message = line.replace("MESSAGE:", "").trim();
                }
            }
            
            // Handle unknown chat
            if (!chatName || chatName.toUpperCase() === "UNKNOWN") {
                console.log("⚠️  No chat identified in message");
                return { chatId: null, chatName: null, message };
            }
            
            // Get chat ID from map (case insensitive)
            let chatId = null;
            for (const [name, id] of Object.entries(chatMap)) {
                if (name.toLowerCase() === chatName.toLowerCase()) {
                    chatId = id;
                    chatName = name;
                    break;
                }
            }
            
            if (!chatId) {
                // Try fuzzy match
                for (const [name, id] of Object.entries(chatMap)) {
                    if (chatName.toLowerCase().includes(name.toLowerCase()) || 
                        name.toLowerCase().includes(chatName.toLowerCase())) {
                        chatId = id;
                        chatName = name;
                        console.log(`🔍 Fuzzy matched '${chatName}' to '${name}'`);
                        break;
                    }
                }
            }
            
            if (!chatId) {
                console.log(`⚠️  Chat '${chatName}' not found in workspace`);
                return { chatId: null, chatName, message };
            }
            
            console.log(`✅ Extracted - Chat: ${chatName}, Message: '${message}'`);
            return { chatId, chatName, message };
            
        } catch (error) {
            console.error(`⚠️  AI extraction failed: ${error}`);
            return { chatId: null, chatName: null, message: allSegmentsText };
        }
    }
}

module.exports = MessageDetector;

