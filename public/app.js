// Check authentication status on page load
async function checkAuthStatus() {
    try {
        const uid = localStorage.getItem('ringcentral_uid');
        if (!uid) {
            showNotAuthenticated();
            return;
        }
        
        const response = await fetch('/setup-completed?uid=' + uid);
        const data = await response.json();
        
        if (data.is_setup_completed) {
            showAuthenticated();
        } else {
            showNotAuthenticated();
        }
    } catch (error) {
        console.error('Error checking auth status:', error);
        showNotAuthenticated();
    }
}

function showAuthenticated() {
    document.getElementById('not-authenticated').style.display = 'none';
    document.getElementById('authenticated').style.display = 'block';
    document.getElementById('message-section').style.display = 'block';
}

function showNotAuthenticated() {
    document.getElementById('not-authenticated').style.display = 'block';
    document.getElementById('authenticated').style.display = 'none';
    document.getElementById('message-section').style.display = 'none';
}

// Login button
document.getElementById('login-btn').addEventListener('click', () => {
    // Get or generate a uid
    let uid = localStorage.getItem('ringcentral_uid');
    if (!uid) {
        uid = 'user_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('ringcentral_uid', uid);
    }
    window.location.href = '/auth?uid=' + uid;
});

// Logout button
document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
        const uid = localStorage.getItem('ringcentral_uid');
        if (uid) {
            await fetch('/logout?uid=' + uid, { method: 'POST' });
            localStorage.removeItem('ringcentral_uid');
        }
        window.location.reload();
    } catch (error) {
        console.error('Error logging out:', error);
    }
});

// Load chats button
document.getElementById('load-chats-btn').addEventListener('click', async () => {
    try {
        const uid = localStorage.getItem('ringcentral_uid');
        const response = await fetch('/api/chats?uid=' + uid);
        const data = await response.json();
        
        if (data.success && data.chats) {
            const chatsUl = document.getElementById('chats-ul');
            chatsUl.innerHTML = '';
            
            if (data.chats.length === 0) {
                chatsUl.innerHTML = '<li>No chats found</li>';
            } else {
                data.chats.forEach(chat => {
                    const li = document.createElement('li');
                    // Use displayName if available, otherwise fallback to name/description
                    const displayName = chat.displayName || chat.name || chat.description || `Chat ${chat.id}`;
                    li.textContent = `${displayName} (${chat.id})`;
                    chatsUl.appendChild(li);
                });
            }
            
            document.getElementById('chats-list').style.display = 'block';
        } else {
            showResult('Failed to load chats', 'error');
        }
    } catch (error) {
        console.error('Error loading chats:', error);
        showResult('Error loading chats: ' + error.message, 'error');
    }
});

// Message form submission
document.getElementById('message-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const textInput = document.getElementById('natural-language-input');
    const naturalLanguageText = textInput.value.trim();
    
    if (!naturalLanguageText) {
        showResult('Please enter a message', 'error');
        return;
    }
    
    // Show loading state
    const sendBtn = document.getElementById('send-btn');
    const sendBtnText = document.getElementById('send-btn-text');
    const sendBtnLoader = document.getElementById('send-btn-loader');
    
    sendBtn.disabled = true;
    sendBtnText.style.display = 'none';
    sendBtnLoader.style.display = 'inline';
    
    try {
        const uid = localStorage.getItem('ringcentral_uid');
        const response = await fetch('/api/send-message?uid=' + uid, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ naturalLanguageText })
        });
        
        const data = await response.json();
        
        if (data.success) {
            let channelInfo = '';
            if (data.usedDefault) {
                channelInfo = `<strong>Channel:</strong> ${data.actualChannel} <em>(default - no channel specified)</em><br>`;
            } else {
                channelInfo = `<strong>Channel:</strong> ${data.actualChannel}<br>`;
            }
            
            showResult(
                `✓ Message sent successfully!<br><br>` +
                channelInfo +
                `<strong>Message:</strong> ${data.parsedMessage}`,
                'success'
            );
            textInput.value = ''; // Clear input
        } else {
            let errorMessage = `✗ ${data.error}`;
            
            if (data.availableChats && data.availableChats.length > 0) {
                errorMessage += '<br><br><strong>Available channels:</strong><br>';
                errorMessage += data.availableChats.map(chat => `• ${chat}`).join('<br>');
            }
            
            showResult(errorMessage, 'error');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showResult('Error: ' + error.message, 'error');
    } finally {
        // Reset button state
        sendBtn.disabled = false;
        sendBtnText.style.display = 'inline';
        sendBtnLoader.style.display = 'none';
    }
});

function showResult(message, type) {
    const resultDiv = document.getElementById('result');
    resultDiv.innerHTML = message;
    resultDiv.className = type;
    resultDiv.style.display = 'block';
    
    // Scroll to result
    resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Check for auth callback
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('auth') === 'success') {
    // Clean URL
    window.history.replaceState({}, document.title, '/');
}

// Initialize on page load
checkAuthStatus();

