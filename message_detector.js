const OpenAI = require('openai');

class MessageDetector {
    static MESSAGE_TRIGGER_PHRASES = [
        "send ring message",
        "send ringcentral message",
        "post ring message",
        "post ringcentral message"
    ];

    static TASK_TRIGGER_PHRASES = [
        "create ring task",
        "create ringcentral task",
        "add ring task",
        "add ringcentral task",
        "make ring task",
        "make ringcentral task"
    ];

    static EVENT_TRIGGER_PHRASES = [
        "create ring event",
        "create ringcentral event",
        "add ring event",
        "add ringcentral event",
        "schedule ring event",
        "schedule ringcentral event",
        "add ring calendar event",
        "add ringcentral calendar event"
    ];

    constructor(apiKey) {
        this.openai = new OpenAI({ apiKey });
    }

    detectTrigger(text) {
        const normalized = text.toLowerCase().trim();
        return MessageDetector.MESSAGE_TRIGGER_PHRASES.some(trigger => normalized.includes(trigger)) ||
               MessageDetector.TASK_TRIGGER_PHRASES.some(trigger => normalized.includes(trigger)) ||
               MessageDetector.EVENT_TRIGGER_PHRASES.some(trigger => normalized.includes(trigger));
    }

    detectTriggerType(text) {
        const normalized = text.toLowerCase().trim();
        if (MessageDetector.EVENT_TRIGGER_PHRASES.some(trigger => normalized.includes(trigger))) {
            return 'event';
        }
        if (MessageDetector.TASK_TRIGGER_PHRASES.some(trigger => normalized.includes(trigger))) {
            return 'task';
        }
        if (MessageDetector.MESSAGE_TRIGGER_PHRASES.some(trigger => normalized.includes(trigger))) {
            return 'message';
        }
        return null;
    }

    extractMessageContent(text) {
        const normalized = text.toLowerCase();
        
        // Find the trigger phrase
        let triggerIndex = -1;
        let matchedTrigger = null;
        
        const allTriggers = [...MessageDetector.MESSAGE_TRIGGER_PHRASES, ...MessageDetector.TASK_TRIGGER_PHRASES, ...MessageDetector.EVENT_TRIGGER_PHRASES];
        
        for (const trigger of allTriggers) {
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

    async aiExtractTaskDetails(allSegmentsText, availableMembers) {
        // Create a list of member names for matching
        const memberNames = availableMembers.map(member => member.displayName || member.name || member.email);
        
        const memberMap = {};
        availableMembers.forEach(member => {
            const name = member.displayName || member.name || member.email;
            if (name) memberMap[name] = member.id;
        });

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: `You are a RingCentral task parser. Extract task details from voice commands.

Available team members: ${memberNames.length > 0 ? memberNames.join(', ') : 'None'}

The user said something like "create task for [person] due [date/time] [task description]"

Your job:
1. Extract the task title/description (REQUIRED)
2. Identify assignee if mentioned (fuzzy match from available members, or leave empty)
3. Extract due date if mentioned (format: YYYY-MM-DD, or RELATIVE like "tomorrow", "next monday")
4. Extract due time if mentioned (format: HH:MM in 24-hour format)

Important:
- Title is REQUIRED and should be clear and concise
- Assignee can be a person's name (match to closest available member) or NONE
- Due date can be relative ("tomorrow", "next week") or specific ("March 15")
- Due time should be in 24-hour format (e.g., "14:30" for 2:30 PM)
- If date/time/assignee not mentioned, use NONE

Respond in this EXACT format:
TITLE: <task title>
ASSIGNEE: <person name or NONE>
DUE_DATE: <YYYY-MM-DD or RELATIVE or NONE>
DUE_TIME: <HH:MM or NONE>

Examples:

Input: "for lopez due tomorrow at 3pm review the marketing proposal"
Output:
TITLE: Review the marketing proposal
ASSIGNEE: lopez
DUE_DATE: RELATIVE:tomorrow
DUE_TIME: 15:00

Input: "finish the budget report by friday"
Output:
TITLE: Finish the budget report
ASSIGNEE: NONE
DUE_DATE: RELATIVE:friday
DUE_TIME: NONE

Input: "for sarah update the website design"
Output:
TITLE: Update the website design
ASSIGNEE: sarah
DUE_DATE: NONE
DUE_TIME: NONE`
                    },
                    {
                        role: "user",
                        content: `Voice command after trigger: ${allSegmentsText}\n\nExtract task details:`
                    }
                ],
                temperature: 0.3,
                max_tokens: 300
            });

            const result = response.choices[0].message.content.trim();
            
            // Parse response
            let title = null;
            let assigneeName = null;
            let dueDate = null;
            let dueTime = null;
            
            for (const line of result.split('\n')) {
                if (line.startsWith("TITLE:")) {
                    title = line.replace("TITLE:", "").trim();
                } else if (line.startsWith("ASSIGNEE:")) {
                    assigneeName = line.replace("ASSIGNEE:", "").trim();
                } else if (line.startsWith("DUE_DATE:")) {
                    dueDate = line.replace("DUE_DATE:", "").trim();
                } else if (line.startsWith("DUE_TIME:")) {
                    dueTime = line.replace("DUE_TIME:", "").trim();
                }
            }

            // Handle NONE values
            if (assigneeName && assigneeName.toUpperCase() === "NONE") assigneeName = null;
            if (dueDate && dueDate.toUpperCase() === "NONE") dueDate = null;
            if (dueTime && dueTime.toUpperCase() === "NONE") dueTime = null;

            // Match assignee to actual member ID
            let assigneeId = null;
            if (assigneeName) {
                for (const [name, id] of Object.entries(memberMap)) {
                    if (name.toLowerCase() === assigneeName.toLowerCase()) {
                        assigneeId = id;
                        assigneeName = name;
                        break;
                    }
                }
                
                // Try fuzzy match if exact match not found
                if (!assigneeId) {
                    for (const [name, id] of Object.entries(memberMap)) {
                        if (assigneeName.toLowerCase().includes(name.toLowerCase()) || 
                            name.toLowerCase().includes(assigneeName.toLowerCase())) {
                            assigneeId = id;
                            assigneeName = name;
                            console.log(`🔍 Fuzzy matched assignee '${assigneeName}' to '${name}'`);
                            break;
                        }
                    }
                }
            }

            // Parse relative dates (basic implementation)
            if (dueDate && dueDate.startsWith('RELATIVE:')) {
                const relative = dueDate.replace('RELATIVE:', '').toLowerCase();
                const now = new Date();
                
                if (relative === 'today') {
                    dueDate = now.toISOString().split('T')[0];
                } else if (relative === 'tomorrow') {
                    now.setDate(now.getDate() + 1);
                    dueDate = now.toISOString().split('T')[0];
                } else if (relative.includes('monday') || relative.includes('tuesday') || 
                           relative.includes('wednesday') || relative.includes('thursday') ||
                           relative.includes('friday') || relative.includes('saturday') || 
                           relative.includes('sunday')) {
                    // Simple day-of-week logic (find next occurrence)
                    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                    const targetDay = days.findIndex(day => relative.includes(day));
                    if (targetDay !== -1) {
                        const currentDay = now.getDay();
                        let daysToAdd = targetDay - currentDay;
                        if (daysToAdd <= 0) daysToAdd += 7;
                        now.setDate(now.getDate() + daysToAdd);
                        dueDate = now.toISOString().split('T')[0];
                    }
                }
            }

            console.log(`✅ Extracted Task - Title: "${title}", Assignee: ${assigneeName || 'None'}, Due: ${dueDate || 'None'} ${dueTime || ''}`);
            
            return { 
                title, 
                assigneeId, 
                assigneeName, 
                dueDate, 
                dueTime 
            };
            
        } catch (error) {
            console.error(`⚠️  AI task extraction failed: ${error}`);
            return { 
                title: allSegmentsText, 
                assigneeId: null, 
                assigneeName: null, 
                dueDate: null, 
                dueTime: null 
            };
        }
    }

    async aiExtractEventDetails(allSegmentsText) {
        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: `You are a RingCentral calendar event parser. Extract event details from voice commands.

The user said something like "add event [event name] on [date] at [time] for [duration]"

Your job:
1. Extract the event name/title (REQUIRED)
2. Extract the start date (format: YYYY-MM-DD, or RELATIVE like "tomorrow", "next monday")
3. Extract the start time (format: HH:MM in 24-hour format)
4. Extract the duration in minutes (default: 60 if not specified)
5. Extract any notes/description (optional)

Important:
- Event name is REQUIRED and should be clear and concise
- Start date can be relative ("tomorrow", "next week") or specific ("March 15")
- Start time should be in 24-hour format (e.g., "14:30" for 2:30 PM)
- Duration should be in minutes (e.g., 30, 60, 90)
- If date/time/duration not mentioned, use NONE for date/time and 60 for duration

Respond in this EXACT format:
NAME: <event name>
START_DATE: <YYYY-MM-DD or RELATIVE or NONE>
START_TIME: <HH:MM or NONE>
DURATION: <minutes as number or 60>
NOTES: <any additional notes or NONE>

Examples:

Input: "team meeting tomorrow at 2pm"
Output:
NAME: Team meeting
START_DATE: RELATIVE:tomorrow
START_TIME: 14:00
DURATION: 60
NOTES: NONE

Input: "client presentation on friday at 10am for 90 minutes about quarterly results"
Output:
NAME: Client presentation
START_DATE: RELATIVE:friday
START_TIME: 10:00
DURATION: 90
NOTES: Quarterly results

Input: "lunch with sarah next monday at noon for 1 hour"
Output:
NAME: Lunch with Sarah
START_DATE: RELATIVE:monday
START_TIME: 12:00
DURATION: 60
NOTES: NONE`
                    },
                    {
                        role: "user",
                        content: `Voice command after trigger: ${allSegmentsText}\n\nExtract event details:`
                    }
                ],
                temperature: 0.3,
                max_tokens: 300
            });

            const result = response.choices[0].message.content.trim();
            
            // Parse response
            let name = null;
            let startDate = null;
            let startTime = null;
            let duration = 60;
            let notes = null;
            
            for (const line of result.split('\n')) {
                if (line.startsWith("NAME:")) {
                    name = line.replace("NAME:", "").trim();
                } else if (line.startsWith("START_DATE:")) {
                    startDate = line.replace("START_DATE:", "").trim();
                } else if (line.startsWith("START_TIME:")) {
                    startTime = line.replace("START_TIME:", "").trim();
                } else if (line.startsWith("DURATION:")) {
                    const durationStr = line.replace("DURATION:", "").trim();
                    duration = parseInt(durationStr) || 60;
                } else if (line.startsWith("NOTES:")) {
                    notes = line.replace("NOTES:", "").trim();
                }
            }

            // Handle NONE values
            if (startDate && startDate.toUpperCase() === "NONE") startDate = null;
            if (startTime && startTime.toUpperCase() === "NONE") startTime = null;
            if (notes && notes.toUpperCase() === "NONE") notes = null;

            // Parse relative dates (basic implementation)
            if (startDate && startDate.startsWith('RELATIVE:')) {
                const relative = startDate.replace('RELATIVE:', '').toLowerCase();
                const now = new Date();
                
                if (relative === 'today') {
                    startDate = now.toISOString().split('T')[0];
                } else if (relative === 'tomorrow') {
                    now.setDate(now.getDate() + 1);
                    startDate = now.toISOString().split('T')[0];
                } else if (relative.includes('monday') || relative.includes('tuesday') || 
                           relative.includes('wednesday') || relative.includes('thursday') ||
                           relative.includes('friday') || relative.includes('saturday') || 
                           relative.includes('sunday')) {
                    // Simple day-of-week logic (find next occurrence)
                    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                    const targetDay = days.findIndex(day => relative.includes(day));
                    if (targetDay !== -1) {
                        const currentDay = now.getDay();
                        let daysToAdd = targetDay - currentDay;
                        if (daysToAdd <= 0) daysToAdd += 7;
                        now.setDate(now.getDate() + daysToAdd);
                        startDate = now.toISOString().split('T')[0];
                    }
                }
            }

            console.log(`✅ Extracted Event - Name: "${name}", Date: ${startDate || 'None'}, Time: ${startTime || 'None'}, Duration: ${duration}min`);
            
            return { 
                name, 
                startDate, 
                startTime, 
                duration,
                notes 
            };
            
        } catch (error) {
            console.error(`⚠️  AI event extraction failed: ${error}`);
            return { 
                name: allSegmentsText, 
                startDate: null, 
                startTime: null, 
                duration: 60,
                notes: null 
            };
        }
    }
}

module.exports = MessageDetector;

