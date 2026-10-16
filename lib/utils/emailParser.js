import * as cheerio from 'cheerio';

/**
 * Decode HTML entities in a string
 */
function decodeHtmlEntities(str) {
  if (!str) return str;
  
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };
  
  let decoded = str;
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, 'gi'), char);
  }
  
  decoded = decoded.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
  decoded = decoded.replace(/&#x([a-f\d]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
  
  return decoded;
}

/**
 * Validate the extracted Netflix link
 */
function validateLink(link) {
  if (!link) return false;
  const startsWithHttps = link.startsWith('https://');
  const hasNetflixDomain = /netflix\.com/i.test(link);
  const hasToken = link.includes('token=');
  const hasMinLength = link.length >= 50;
  return startsWithHttps && hasNetflixDomain && hasToken && hasMinLength;
}

/**
 * Extract Netflix verification URL from email content
 */
export function extractNetflixLink(email) {
  if (!email) return null;

  const html = email.html || '';
  const text = email.text || '';

  let verificationLink = null;

  if (html) {
    const $ = cheerio.load(html);

    // Look for the specific button text first
    $('a').each((_, elem) => {
      const linkText = $(elem).text().trim();
      const href = $(elem).attr('href');

      if (
        linkText.toLowerCase().includes('yes, this was me') &&
        href
      ) {
        verificationLink = decodeHtmlEntities(href);
        return false; // break
      }
    });

    // Fallback: look for URL pattern with token
    if (!verificationLink) {
      $('a').each((_, elem) => {
        const href = $(elem).attr('href');
        if (
          href &&
          (href.includes('/account/travel/verify') || href.includes('/household/')) &&
          href.includes('token=')
        ) {
          verificationLink = decodeHtmlEntities(href);
          return false;
        }
      });
    }
  }

  // Fallback to text content if needed
  if (!verificationLink && text) {
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const candidates = text.match(urlRegex) || [];
    for (const candidate of candidates) {
      const decoded = decodeHtmlEntities(candidate);
      if (
        (decoded.includes('/account/travel/verify') || decoded.includes('/household/')) &&
        decoded.includes('token=')
      ) {
        verificationLink = decoded;
        break;
      }
    }
  }

  // Validate
  if (verificationLink && validateLink(verificationLink)) {
    return verificationLink;
  }

  // As last resort, return the candidate even if validation failed (caller can decide)
  return verificationLink;
}

/**
 * Check if email is a Netflix verification email
 */
export function isNetflixVerificationEmail(email) {
  if (!email) return false;

  const from = email.from?.value?.[0]?.address || '';
  const subject = email.subject || '';
  const text = email.text || '';
  const html = email.html || '';

  const isFromNetflix =
    from.includes('netflix.com') ||
    from.includes('account.netflix.com') ||
    from.includes('noreply@netflix.com');

  const subjectKeywords = [
    'Important: How to update your Netflix household',
    'update your Netflix household',
    'Did you request to update',
    'household',
    'verify',
    'device',
    'travel',
    'verification',
  ];
  const hasSubjectKeyword = subjectKeywords.some((keyword) =>
    subject.toLowerCase().includes(keyword.toLowerCase())
  );

  const contentKeywords = ['household', 'verify', 'device', 'click here', 'verify your'];
  const content = (text + ' ' + html).toLowerCase();
  const hasContentKeyword = contentKeywords.some((keyword) => content.includes(keyword));

  return isFromNetflix && (hasSubjectKeyword || hasContentKeyword);
}

