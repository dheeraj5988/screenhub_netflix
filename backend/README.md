# Netflix Household Updater - Backend API

Node.js + Express backend for fetching Netflix verification emails from Gmail via IMAP.

## Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the `backend` directory:

```env
# Gmail IMAP Configuration
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-16-digit-app-password

# Server Configuration
PORT=5000

# Frontend URL for CORS
FRONTEND_URL=http://localhost:3000
```

### 3. Gmail App Password Setup

1. Go to your Google Account settings
2. Enable 2-Step Verification
3. Go to App Passwords: https://myaccount.google.com/apppasswords
4. Generate a new app password for "Mail"
5. Copy the 16-digit password to `GMAIL_APP_PASSWORD` in `.env`

### 4. Run the Server

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

The server will start on `http://localhost:5000` (or the PORT specified in `.env`).

## API Endpoints

### GET /api/health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "message": "Backend is running",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### GET /api/latest-netflix-link

Fetches the most recent Netflix verification email from Gmail and extracts the verification link.

**Query Parameters:**
- `minutes` (optional): Search within last N minutes (default: 30)

**Success Response:**
```json
{
  "success": true,
  "link": "https://www.netflix.com/account/travel/...",
  "emailDate": "2024-01-01T00:00:00.000Z",
  "subject": "Verify your Netflix device",
  "from": "info@account.netflix.com"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "No recent verification email found",
  "message": "No emails found from Netflix in the last 30 minutes"
}
```

## How It Works

1. **IMAP Connection**: Connects to Gmail using IMAP (port 993, TLS)
2. **Email Search**: Searches for emails from Netflix (`info@account.netflix.com` or `noreply@netflix.com`)
3. **Filtering**: Looks for emails with subjects containing "household", "verify", or "device"
4. **Time Window**: Searches within the last 30 minutes (configurable)
5. **Parsing**: Extracts HTML/text content and parses for Netflix verification URLs
6. **Link Extraction**: Finds URLs matching Netflix patterns:
   - `netflix.com/account/travel/*`
   - `netflix.com/household/*`
   - `netflix.com/verify/*`
   - Any Netflix URL with verification-related query parameters

## Error Handling

The API handles various error scenarios:
- Missing environment variables
- Gmail authentication failures
- Connection timeouts
- No emails found
- Email parsing errors
- Missing verification links

## Project Structure

```
backend/
├── src/
│   ├── server.js           # Express server setup
│   ├── routes/
│   │   ├── health.js       # Health check endpoint
│   │   └── netflix.js      # Netflix link endpoint
│   ├── services/
│   │   └── gmailService.js # Gmail IMAP service
│   └── utils/
│       └── emailParser.js  # Email parsing utilities
├── .env                    # Environment variables (not in git)
├── .env.example           # Example environment file
├── .gitignore
├── package.json
└── README.md
```

## Troubleshooting

### Connection Issues
- Verify Gmail IMAP is enabled in your Google Account
- Check that your app password is correct (16 digits, no spaces)
- Ensure your email address matches exactly in `.env`

### No Emails Found
- Check that Netflix has sent you a verification email recently
- Increase the `minutes` query parameter
- Verify the email is in your inbox (not spam/archived)

### Authentication Errors
- Regenerate your app password
- Ensure 2-Step Verification is enabled
- Check that `GMAIL_USER` is your full email address

## Deployment to Vercel

See Vercel documentation for deploying Node.js applications. You'll need to:
1. Set environment variables in Vercel dashboard
2. Configure build settings
3. Set up serverless functions if needed


