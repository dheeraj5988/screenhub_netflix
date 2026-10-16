import Imap from 'imap';
import { simpleParser } from 'mailparser';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Gmail IMAP Service
 * Handles connection to Gmail and email fetching
 */
class GmailService {
  constructor() {
    this.imap = null;
  }

  /**
   * Create and configure IMAP connection
   */
  createConnection() {
    return new Promise((resolve, reject) => {
      const config = {
        user: process.env.GMAIL_USER,
        password: process.env.GMAIL_APP_PASSWORD,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 10000, // 10 seconds
        authTimeout: 5000, // 5 seconds
      };

      if (!config.user || !config.password) {
        reject(new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set in .env file'));
        return;
      }

      this.imap = new Imap(config);

      this.imap.once('ready', () => {
        console.log('✅ IMAP connection established');
        resolve(this.imap);
      });

      this.imap.once('error', (err) => {
        console.error('❌ IMAP connection error:', err);
        reject(err);
      });

      this.imap.once('end', () => {
        console.log('📧 IMAP connection ended');
      });

      this.imap.connect();
    });
  }

  /**
   * Open inbox mailbox
   */
  openInbox() {
    return new Promise((resolve, reject) => {
      this.imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(box);
      });
    });
  }

  /**
   * Search for emails matching criteria
   * @param {number} minutesAgo - Search emails from last N minutes
   */
  searchEmails(minutesAgo = 30) {
    return new Promise((resolve, reject) => {
      const since = new Date();
      since.setMinutes(since.getMinutes() - minutesAgo);

      // Search for emails from Netflix addresses within time window
      // Try multiple FROM addresses - IMAP doesn't support OR well, so we'll search separately
      const searchCriteria = [
        ['FROM', 'info@account.netflix.com'],
        ['SINCE', since],
      ];

      this.imap.search(searchCriteria, (err, results) => {
        if (err) {
          reject(err);
          return;
        }

        // If no results, try alternative FROM address
        if (!results || results.length === 0) {
          const altCriteria = [
            ['FROM', 'noreply@netflix.com'],
            ['SINCE', since],
          ];

          this.imap.search(altCriteria, (err2, results2) => {
            if (err2) {
              reject(err2);
              return;
            }
            resolve(results2 || []);
          });
          return;
        }

        resolve(results);
      });
    });
  }

  /**
   * Fetch email by UID
   * @param {number} uid - Email UID
   */
  fetchEmail(uid) {
    return new Promise((resolve, reject) => {
      const fetch = this.imap.fetch([uid], {
        bodies: '',
        struct: true,
      });

      let emailBuffer = Buffer.alloc(0);
      let hasData = false;

      fetch.on('message', (msg, seqno) => {
        msg.on('body', (stream, info) => {
          hasData = true;
          const chunks = [];

          stream.on('data', (chunk) => {
            chunks.push(chunk);
          });

          stream.once('end', () => {
            emailBuffer = Buffer.concat(chunks);
          });
        });

        msg.once('attributes', (attrs) => {
          // Store attributes if needed
        });

        msg.once('end', async () => {
          if (!hasData || emailBuffer.length === 0) {
            reject(new Error('No email body data received'));
            return;
          }

          try {
            const parsed = await simpleParser(emailBuffer);
            resolve(parsed);
          } catch (parseErr) {
            console.error('Error parsing email:', parseErr);
            reject(parseErr);
          }
        });
      });

      fetch.once('error', (err) => {
        reject(err);
      });

      fetch.once('end', () => {
        if (!hasData) {
          reject(new Error('No email data received'));
        }
      });
    });
  }

  /**
   * Close IMAP connection
   */
  closeConnection() {
    return new Promise((resolve) => {
      if (!this.imap) {
        resolve();
        return;
      }

      this.imap.end();
      this.imap.once('end', () => {
        console.log('📧 IMAP connection closed');
        resolve();
      });
    });
  }

  /**
   * Get the most recent Netflix verification email
   * @param {number} minutesAgo - Search within last N minutes (default: 30)
   */
  async getLatestNetflixEmail(minutesAgo = 30) {
    let connection = null;

    try {
      // Create connection
      connection = await this.createConnection();

      // Open inbox
      await this.openInbox();

      // Search for emails
      const emailIds = await this.searchEmails(minutesAgo);

      if (!emailIds || emailIds.length === 0) {
        await this.closeConnection();
        return null;
      }

      // Get the most recent email (last in array)
      const latestEmailId = emailIds[emailIds.length - 1];

      // Fetch email content
      const email = await this.fetchEmail(latestEmailId);

      // Close connection
      await this.closeConnection();

      return email;
    } catch (error) {
      console.error('Error fetching email:', error);
      if (connection) {
        await this.closeConnection().catch(() => {});
      }
      throw error;
    }
  }
}

export default GmailService;

