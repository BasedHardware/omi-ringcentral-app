# RingCentral App Configuration Guide

## Important: Required Setup Before First Run

Before you can use this application, you **must** configure your RingCentral app with the correct OAuth redirect URI.

## Step-by-Step Instructions

### 1. Access RingCentral Developer Console

Go to: https://developers.ringcentral.com/console

### 2. Select Your Application

- Log in with your RingCentral credentials
- Find your application (Client ID: `YwoCK0yilEdfxb2lzvhxMQ`)
- Click on it to open the settings

### 3. Configure OAuth Settings

1. Navigate to **"Settings"** or **"OAuth Settings"** tab
2. Find the **"OAuth Redirect URI"** section
3. Add this URI:
   ```
   http://localhost:3000/oauth/callback
   ```
4. Click **"Add"** or **"Save"**

### 4. Verify Permissions

Make sure your app has these permissions enabled:
- ✅ **Team Messaging** - Read and write access
- ✅ **Glip** (if available) - For team messaging

Common permission scopes needed:
- `Glip` or `TeamMessaging`
- `ReadMessages`
- `EditMessages`

### 5. Save Changes

- Click **"Save"** or **"Update"** at the bottom of the page
- Your app is now configured!

## What This Does

The redirect URI tells RingCentral where to send users after they authorize your application. Without this configured correctly, the OAuth flow will fail with an error.

## Testing the Setup

Once configured, you can test the authentication:

1. Start the server: `npm start`
2. Open: `http://localhost:3000`
3. Click "Login with RingCentral"
4. You should be redirected to RingCentral login
5. After login, you'll be redirected back to `http://localhost:3000/oauth/callback`
6. The app will complete authentication and show the message interface

## Common Issues

**Error: "Invalid redirect_uri"**
- Solution: Make sure you added `http://localhost:3000/oauth/callback` to your RingCentral app settings

**Error: "Invalid client credentials"**
- Solution: Verify your Client ID and Secret in the `.env` file

**Error: "Insufficient permissions"**
- Solution: Enable Team Messaging permissions in your RingCentral app settings

## Production Deployment

When deploying to production:

1. Update your `.env` with the production URL:
   ```
   REDIRECT_URI=https://yourdomain.com/oauth/callback
   ```

2. Add the production redirect URI to RingCentral app settings:
   ```
   https://yourdomain.com/oauth/callback
   ```

3. Use HTTPS for all production URLs

## Need Help?

- [RingCentral API Reference](https://developers.ringcentral.com/api-reference)
- [RingCentral Team Messaging API](https://developers.ringcentral.com/api-reference/Posts)
- [OAuth 2.0 Guide](https://developers.ringcentral.com/guide/authentication)

