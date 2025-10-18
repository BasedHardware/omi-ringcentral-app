# Quick Start Guide

## Getting Started in 3 Steps

### 1. Configure RingCentral OAuth Redirect URI

Before running the app, you need to add the redirect URI to your RingCentral application settings:

1. Go to [RingCentral Developer Console](https://developers.ringcentral.com/console)
2. Select your application
3. Go to "Settings" → "OAuth Settings"
4. Add this redirect URI:
   ```
   http://localhost:3000/oauth/callback
   ```
5. Save your changes

### 2. Start the Application

```bash
npm start
```

You should see:
```
Server running on http://localhost:3000
RingCentral Message Sender is ready!
Visit http://localhost:3000 to get started
```

### 3. Use the App

1. Open your browser to `http://localhost:3000`
2. Click **"Login with RingCentral"**
3. Authorize the application
4. Start sending messages!

## Example Commands

Try these natural language commands:

```
Send ringcentral message to general channel hello everyone

Send to engineering team we need to discuss the new feature

Message support channel new customer inquiry received

Send to marketing team campaign is ready for review
```

## Tips

- Click **"Load My Channels"** to see all available channels
- Be specific with channel names for better accuracy
- The app uses OpenAI to understand your natural language input

## Troubleshooting

**Can't authenticate?**
- Make sure you added the redirect URI to your RingCentral app settings
- Check that your credentials in `.env` are correct

**Channel not found?**
- Click "Load My Channels" to see available channels
- Use the exact channel name from the list

**Need help?**
- Check the main README.md for detailed documentation
- Review the console logs for error messages

## Development Mode

For auto-reloading during development:

```bash
npm run dev
```

This requires `nodemon` which is already included in the dependencies.

