// Home page - simplified version for production use

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
            loadChannelCount();
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
    document.getElementById('info-section').style.display = 'block';
}

function showNotAuthenticated() {
    document.getElementById('not-authenticated').style.display = 'block';
    document.getElementById('authenticated').style.display = 'none';
    document.getElementById('info-section').style.display = 'none';
}

async function loadChannelCount() {
    try {
        const uid = localStorage.getItem('ringcentral_uid');
        const response = await fetch('/api/chats?uid=' + uid);
        const data = await response.json();
        
        if (data.success && data.chats) {
            document.getElementById('channels-count').textContent = data.chats.length;
        }
    } catch (error) {
        document.getElementById('channels-count').textContent = 'N/A';
    }
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

// Refresh button
document.getElementById('refresh-btn')?.addEventListener('click', async () => {
    try {
        const uid = localStorage.getItem('ringcentral_uid');
        const response = await fetch('/refresh-chats?uid=' + uid, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            loadChannelCount();
            alert('✓ Connection refreshed successfully');
        } else {
            alert('✗ Failed to refresh: ' + data.error);
        }
    } catch (error) {
        alert('✗ Error: ' + error.message);
    }
});

// Logout button
document.getElementById('logout-btn')?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to disconnect your RingCentral account?')) {
        return;
    }
    
    try {
        const uid = localStorage.getItem('ringcentral_uid');
        if (uid) {
            await fetch('/logout?uid=' + uid, { method: 'POST' });
            localStorage.removeItem('ringcentral_uid');
        }
        window.location.reload();
    } catch (error) {
        console.error('Error logging out:', error);
        window.location.reload();
    }
});

// Check for auth callback
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('auth') === 'success') {
    // Clean URL
    window.history.replaceState({}, document.title, '/');
}

// Initialize on page load
checkAuthStatus();

