#!/bin/bash

# Railway Deployment Setup Script
# This script helps you deploy to Railway

echo "🚂 Railway Deployment Setup"
echo "=============================="
echo ""

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null
then
    echo "❌ Railway CLI not found. Installing..."
    npm install -g @railway/cli
else
    echo "✅ Railway CLI already installed"
fi

echo ""
echo "📝 Next steps:"
echo ""
echo "1. Login to Railway:"
echo "   railway login"
echo ""
echo "2. Initialize your project:"
echo "   railway init"
echo ""
echo "3. Add environment variables (important!):"
echo "   railway variables set RINGCENTRAL_CLIENT_ID=<your-value>"
echo "   railway variables set RINGCENTRAL_CLIENT_SECRET=<your-value>"
echo "   railway variables set RINGCENTRAL_SERVER_URL=https://platform.ringcentral.com"
echo "   railway variables set OPENAI_API_KEY=<your-value>"
echo "   railway variables set SESSION_SECRET=<random-secret>"
echo ""
echo "4. Create a volume for persistent storage:"
echo "   Go to Railway Dashboard → Your Service → Settings → Volumes"
echo "   Click 'New Volume'"
echo "   Mount path: /app/data"
echo "   Size: 1GB"
echo ""
echo "5. Add RAILWAY_VOLUME_MOUNT_PATH variable:"
echo "   railway variables set RAILWAY_VOLUME_MOUNT_PATH=/app/data"
echo ""
echo "6. Deploy your app:"
echo "   railway up"
echo ""
echo "7. Get your deployment URL:"
echo "   railway open"
echo ""
echo "8. Update REDIRECT_URI variable with your Railway URL:"
echo "   railway variables set REDIRECT_URI=https://your-app.railway.app/oauth/callback"
echo ""
echo "9. Update RingCentral OAuth settings with your Railway URL"
echo ""
echo "📚 For detailed instructions, see DEPLOYMENT.md"
echo ""

