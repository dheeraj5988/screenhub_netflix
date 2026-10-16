# Quick Setup Guide

## Step 1: Install Dependencies

```bash
cd backend
npm install
```

## Step 2: Configure Gmail

1. **Enable 2-Step Verification** on your Google Account
2. **Generate App Password**:
   - Go to: https://myaccount.google.com/apppasswords
   - Select "Mail" and your device
   - Copy the 16-digit password (no spaces)

## Step 3: Create .env File

Create a `.env` file in the `backend` folder:

```env
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-16-digit-app-password
PORT=5000
FRONTEND_URL=http://localhost:3000
```

**Important**: Replace the placeholder values with your actual Gmail credentials!

## Step 4: Run the Server

```bash
# Development mode (auto-reload on changes)
npm run dev

# Production mode
npm start
```

## Step 5: Test the API

1. **Health Check**:
   ```bash
   curl http://localhost:5000/api/health
   ```

2. **Get Netflix Link**:
   ```bash
   curl http://localhost:5000/api/latest-netflix-link
   ```

## Troubleshooting

### "GMAIL_USER and GMAIL_APP_PASSWORD must be set"
- Make sure your `.env` file exists in the `backend` folder
- Check that variable names match exactly (no typos)
- Ensure there are no spaces around the `=` sign

### "Authentication failed"
- Verify your app password is correct (16 digits, no spaces)
- Make sure 2-Step Verification is enabled
- Regenerate the app password if needed

### "No recent verification email found"
- Check that Netflix has sent you a verification email
- Try increasing the time window: `?minutes=60`
- Verify the email is in your inbox (not spam/archived)

### Port already in use
- Change `PORT` in `.env` to a different number (e.g., 5001)
- Or stop the process using port 5000


