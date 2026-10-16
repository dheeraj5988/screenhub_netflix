/**
 * Email Parser Utility
 * Extracts Netflix verification links from email content
 */

/**
 * Decode HTML entities in a string
 * @param {string} str - String with HTML entities
 * @returns {string} - Decoded string
 */
function decodeHtmlEntities(str) {
  if (!str) return str;
  
  // Common HTML entity replacements
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
  
  // Also handle numeric entities like &#38;
  decoded = decoded.replace(/&#(\d+);/g, (match, dec) => {
    return String.fromCharCode(dec);
  });
  
  // Handle hex entities like &#x26;
  decoded = decoded.replace(/&#x([a-f\d]+);/gi, (match, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
  
  return decoded;
}

/**
 * Extract Netflix verification URL from email content
 * @param {Object} email - Parsed email object from mailparser
 * @returns {string|null} - Extracted URL or null if not found
 */
export function extractNetflixLink(email) {
  if (!email) {
    return null;
  }

  // Priority: HTML > Text > All links
  let content = '';
  let links = [];

  // Try HTML first
  if (email.html) {
    content = email.html;
    // Extract all links from HTML
    const htmlLinkRegex = /href=["']([^"']+)["']/gi;
    const matches = content.matchAll(htmlLinkRegex);
    links = Array.from(matches, (m) => decodeHtmlEntities(m[1]));
  }

  // Fallback to text if no HTML links found
  if (links.length === 0 && email.text) {
    content = email.text;
    // Extract URLs from text
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const foundLinks = content.match(urlRegex) || [];
    links = foundLinks.map(link => decodeHtmlEntities(link));
  }

  // Also check email links array if available
  if (email.links && email.links.length > 0) {
    const emailLinks = email.links.map((link) => decodeHtmlEntities(link.href));
    links = [...links, ...emailLinks];
  }

  // Remove duplicates
  links = [...new Set(links)];

  // Patterns to match Netflix verification URLs (prioritize verification links)
  const verificationPatterns = [
    /https?:\/\/[^\/]*netflix\.com\/account\/travel[^\s]*/i,
    /https?:\/\/[^\/]*netflix\.com\/household[^\s]*/i,
    /https?:\/\/[^\/]*netflix\.com\/verify[^\s]*/i,
    /https?:\/\/[^\/]*netflix\.com\/.*(?:verify|household|device|travel)[^\s]*/i,
  ];

  // First, try to find verification-specific links
  for (const link of links) {
    for (const pattern of verificationPatterns) {
      if (pattern.test(link)) {
        // Clean up the URL (remove trailing punctuation, etc.)
        let cleanUrl = link.trim();
        // Remove common trailing characters
        cleanUrl = cleanUrl.replace(/[.,;:!?)\]}>]+$/, '');
        return cleanUrl;
      }
    }
  }

  // If no verification link found, look for any Netflix URL with query parameters
  for (const link of links) {
    if (
      /netflix\.com/i.test(link) &&
      (/\?/.test(link) || /\/verify/.test(link) || /\/household/.test(link) || /\/travel/.test(link))
    ) {
      let cleanUrl = link.trim();
      cleanUrl = cleanUrl.replace(/[.,;:!?)\]}>]+$/, '');
      return cleanUrl;
    }
  }

  // Last resort: return any Netflix URL found
  for (const link of links) {
    if (/netflix\.com/i.test(link)) {
      let cleanUrl = link.trim();
      cleanUrl = cleanUrl.replace(/[.,;:!?)\]}>]+$/, '');
      return cleanUrl;
    }
  }

  return null;
}

/**
 * Check if email is a Netflix verification email
 * @param {Object} email - Parsed email object
 * @returns {boolean}
 */
export function isNetflixVerificationEmail(email) {
  if (!email) {
    return false;
  }

  const from = email.from?.value?.[0]?.address || '';
  const subject = email.subject || '';
  const text = email.text || '';
  const html = email.html || '';

  // Check sender
  const isFromNetflix =
    from.includes('netflix.com') ||
    from.includes('account.netflix.com') ||
    from.includes('noreply@netflix.com');

  // Check subject
  const subjectKeywords = ['household', 'verify', 'device', 'travel', 'verification'];
  const hasSubjectKeyword = subjectKeywords.some((keyword) =>
    subject.toLowerCase().includes(keyword)
  );

  // Check content
  const contentKeywords = ['household', 'verify', 'device', 'click here', 'verify your'];
  const content = (text + ' ' + html).toLowerCase();
  const hasContentKeyword = contentKeywords.some((keyword) => content.includes(keyword));

  return isFromNetflix && (hasSubjectKeyword || hasContentKeyword);
}

