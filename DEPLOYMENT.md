# Railway Deployment Guide

## Prerequisites
- Railway account (https://railway.app)
- GitHub account (for deployment)

## Step 1: Prepare Your Repository

1. Initialize git (if not already done):
```bash
git init
git add .
git commit -m "Initial commit"
```

2. Push to GitHub:
```bash
git remote add origin <your-github-repo-url>
git branch -M main
git push -u origin main
```

## Step 2: Deploy to Railway

### Option A: Deploy via Railway Dashboard

1. Go to https://railway.app/new
2. Click "Deploy from GitHub repo"
3. Select your repository
4. Railway will auto-detect the Node.js project

### Option B: Deploy via Railway CLI

1. Install Railway CLI:
```bash
npm install -g @railway/cli
```

2. Login:
```bash
railway login
```

3. Initialize project:
```bash
railway init
```

4. Deploy:
```bash
railway up
```

## Step 3: Configure Environment Variables

In Railway Dashboard → Your Project → Variables, add:

```
RINGCENTRAL_CLIENT_ID=<your-client-id>
RINGCENTRAL_CLIENT_SECRET=<your-client-secret>
RINGCENTRAL_SERVER_URL=https://platform.ringcentral.com
OPENAI_API_KEY=<your-openai-key>
PORT=3000
REDIRECT_URI=https://<your-railway-domain>/oauth/callback
SESSION_SECRET=<generate-random-secret>
```

**Important:** Update `REDIRECT_URI` with your Railway domain after deployment!

## Step 4: Set Up Persistent Storage (Volume)

Railway now uses volumes for persistent storage:

1. In Railway Dashboard → Your Service → Settings
2. Scroll to "Volumes"
3. Click "New Volume"
4. Configure:
   - **Mount Path:** `/app/data`
   - **Size:** 1GB (should be plenty)
5. Click "Add"

## Step 5: Update Storage Path in Code

The app will automatically use the volume path. Files will be stored in:
- `/app/data/users_data.json`
- `/app/data/sessions_data.json`

## Step 6: Get Your Deployment URL

1. After deployment, Railway assigns a URL like: `your-app-name.up.railway.app`
2. You can also add a custom domain in Settings → Networking

## Step 7: Update RingCentral OAuth Settings

1. Go to RingCentral Developer Console
2. Update OAuth Redirect URI to:
   ```
   https://your-app-name.up.railway.app/oauth/callback
   ```

## Step 8: Test Your Deployment

Visit:
```
https://your-app-name.up.railway.app/
```

You should see the RingCentral Voice Integration homepage!

## Monitoring

- **Logs:** Railway Dashboard → Your Service → Deployments → View Logs
- **Metrics:** Railway Dashboard → Your Service → Metrics
- **Health Check:** `https://your-app-name.up.railway.app/health`

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `RINGCENTRAL_CLIENT_ID` | RingCentral App Client ID | `YwoCK0yilE...` |
| `RINGCENTRAL_CLIENT_SECRET` | RingCentral App Secret | `7vgcVkdcNn...` |
| `RINGCENTRAL_SERVER_URL` | RingCentral API Server | `https://platform.ringcentral.com` |
| `OPENAI_API_KEY` | OpenAI API Key for AI parsing | `sk-proj-...` |
| `PORT` | Server port (Railway sets this) | `3000` |
| `REDIRECT_URI` | OAuth callback URL | `https://your-app.railway.app/oauth/callback` |
| `SESSION_SECRET` | Session encryption key | Generate random string |

## Troubleshooting

### Issue: "Cannot find module"
**Solution:** Make sure `package.json` has all dependencies listed

### Issue: "ENOENT: no such file or directory"
**Solution:** Check that volume is mounted at `/app/data`

### Issue: OAuth redirect mismatch
**Solution:** Update `REDIRECT_URI` env var and RingCentral app settings

### Issue: Port binding error
**Solution:** Railway sets PORT automatically, don't hardcode it

## Useful Commands

```bash
# View logs
railway logs

# Check environment variables
railway variables

# Open in browser
railway open

# Link to existing project
railway link

# Deploy changes
git push origin main  # Auto-deploys if connected to GitHub
```

## Volume Backup

To backup your data:

1. In Railway Dashboard → Your Service → Data
2. Click on the volume
3. Download or export data

Or use Railway CLI:
```bash
railway run bash
cd /app/data
cat users_data.json  # View your data
```

## Scaling

Railway automatically scales based on:
- CPU usage
- Memory usage
- Request volume

For high traffic, consider:
1. Upgrading to Railway Pro plan
2. Adding Redis for session storage
3. Implementing rate limiting

## Cost Estimate

- **Hobby Plan:** $5/month (includes 500 hrs execution + 100GB egress)
- **Pro Plan:** Usage-based (pay for what you use)

Your app should stay well within Hobby plan limits!

## Security Notes

1. ✅ Never commit `.env` file
2. ✅ Use strong `SESSION_SECRET`
3. ✅ Keep API keys secure in Railway variables
4. ✅ Enable HTTPS (Railway provides this automatically)
5. ✅ Review RingCentral app permissions regularly

## Support

- Railway Docs: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- RingCentral Support: https://developers.ringcentral.com/support

---

**Deployed! 🚀** Your RingCentral Voice Integration is now live on Railway!

