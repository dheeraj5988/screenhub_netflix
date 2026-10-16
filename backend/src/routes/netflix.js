import express from 'express';
import GmailService from '../services/gmailService.js';
import { extractNetflixLink, isNetflixVerificationEmail } from '../utils/emailParser.js';

const router = express.Router();
const gmailService = new GmailService();

/**
 * GET /api/latest-netflix-link
 * Fetches the most recent Netflix verification email and extracts the link
 */
router.get('/latest-netflix-link', async (req, res) => {
  try {
    const minutesAgo = parseInt(req.query.minutes || '30', 10);

    console.log(`🔍 Searching for Netflix emails from last ${minutesAgo} minutes...`);

    // Fetch the latest email
    const email = await gmailService.getLatestNetflixEmail(minutesAgo);

    if (!email) {
      return res.json({
        success: false,
        error: 'No recent verification email found',
        message: `No emails found from Netflix in the last ${minutesAgo} minutes`,
      });
    }

    // Verify it's a Netflix verification email
    if (!isNetflixVerificationEmail(email)) {
      console.log('⚠️ Email found but does not appear to be a verification email');
      return res.json({
        success: false,
        error: 'Email found but not a verification email',
        message: 'The email does not match Netflix verification email patterns',
      });
    }

    // Extract the verification link
    const link = extractNetflixLink(email);

    if (!link) {
      console.log('⚠️ Email found but no verification link could be extracted');
      return res.json({
        success: false,
        error: 'No verification link found in email',
        message: 'Could not extract a verification URL from the email content',
        emailDate: email.date?.toISOString() || null,
      });
    }

    console.log('✅ Successfully extracted Netflix verification link');

    // Return success with link
    res.json({
      success: true,
      link: link,
      emailDate: email.date?.toISOString() || null,
      subject: email.subject || null,
      from: email.from?.value?.[0]?.address || null,
    });
  } catch (error) {
    console.error('❌ Error fetching Netflix link:', error);

    // Handle specific error types
    if (error.message.includes('GMAIL_USER') || error.message.includes('GMAIL_APP_PASSWORD')) {
      return res.status(500).json({
        success: false,
        error: 'Gmail configuration error',
        message: error.message,
      });
    }

    if (error.message.includes('authentication') || error.message.includes('Invalid credentials')) {
      return res.status(401).json({
        success: false,
        error: 'Gmail authentication failed',
        message: 'Please check your Gmail credentials in .env file',
      });
    }

    if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
      return res.status(503).json({
        success: false,
        error: 'Connection timeout',
        message: 'Could not connect to Gmail. Please check your internet connection.',
      });
    }

    // Generic error
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Netflix link',
      message: error.message || 'An unexpected error occurred',
    });
  }
});

export default router;


