import Imap from 'imap';
import { simpleParser } from 'mailparser';

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
        reject(new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set in environment variables'));
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
  searchEmails(minutesAgo = 20) {
    return new Promise((resolve, reject) => {
      const since = new Date();
      since.setMinutes(since.getMinutes() - minutesAgo);

      // Subject patterns to prioritize
      const subjectPatterns = [
        'Important: How to update your Netflix household',
        'update your Netflix household',
        'Did you request to update',
      ];

      // Try subject-specific searches first, then fall back
      const criteriaList = [
        // Primary subject match
        [
          ['FROM', 'info@account.netflix.com'],
          ['SINCE', since],
          ['SUBJECT', subjectPatterns[0]],
        ],
        // Secondary subject matches
        [
          ['FROM', 'info@account.netflix.com'],
          ['SINCE', since],
          ['SUBJECT', subjectPatterns[1]],
        ],
        [
          ['FROM', 'info@account.netflix.com'],
          ['SINCE', since],
          ['SUBJECT', subjectPatterns[2]],
        ],
        // Fallback to sender only
        [
          ['FROM', 'info@account.netflix.com'],
          ['SINCE', since],
        ],
        [
          ['FROM', 'noreply@netflix.com'],
          ['SINCE', since],
        ],
      ];

      const trySearch = (index = 0) => {
        if (index >= criteriaList.length) {
          resolve([]);
          return;
        }

        const criteria = criteriaList[index];
        this.imap.search(criteria, (err, results) => {
          if (err) {
            reject(err);
            return;
          }

          if (results && results.length > 0) {
            resolve(results);
            return;
          }

          // Try next criteria
          trySearch(index + 1);
        });
      };

      trySearch();
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
  async getLatestNetflixEmail(minutesAgo = 20) {
    let connection = null;

    try {
      connection = await this.createConnection();
      await this.openInbox();
      const emailIds = await this.searchEmails(minutesAgo);

      if (!emailIds || emailIds.length === 0) {
        await this.closeConnection();
        return null;
      }

      const latestEmailId = emailIds[emailIds.length - 1];
      const email = await this.fetchEmail(latestEmailId);
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

