/**
 * Utility functions for validity calculation, parsing, and formatting.
 */

export function calculateExpiryDate(startDateStr: string, validityStr: string): string {
  if (!startDateStr) {
    startDateStr = new Date().toISOString().slice(0, 10);
  }

  // Parse start date (supports YYYY-MM-DD or DD/MM/YYYY)
  let year: number;
  let month: number; // 0-indexed
  let day: number;

  if (startDateStr.includes('/')) {
    const parts = startDateStr.split('/').map((p) => parseInt(p, 10));
    if (parts.length === 3) {
      if (parts[2] > 1000) {
        // DD/MM/YYYY
        day = parts[0];
        month = parts[1] - 1;
        year = parts[2];
      } else {
        // MM/DD/YY
        month = parts[0] - 1;
        day = parts[1];
        year = parts[2] < 100 ? 2000 + parts[2] : parts[2];
      }
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth();
      day = now.getDate();
    }
  } else if (startDateStr.includes('-')) {
    const parts = startDateStr.split('-').map((p) => parseInt(p, 10));
    if (parts.length === 3) {
      if (parts[0] > 1000) {
        // YYYY-MM-DD
        year = parts[0];
        month = parts[1] - 1;
        day = parts[2];
      } else {
        // DD-MM-YYYY
        day = parts[0];
        month = parts[1] - 1;
        year = parts[2];
      }
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth();
      day = now.getDate();
    }
  } else {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
    day = now.getDate();
  }

  const d = new Date(year, month, day);

  const val = (validityStr || '1 Month').toLowerCase().trim();

  // Match years: e.g. "1 year", "2 years"
  const yearMatch = val.match(/^(\d+)\s*(?:year|yr|years|yrs)/i);
  if (yearMatch) {
    const num = parseInt(yearMatch[1], 10);
    d.setFullYear(d.getFullYear() + num);
    return formatIsoDate(d);
  }

  // Match months: e.g. "1 month", "3 months", "6 months"
  const monthMatch = val.match(/^(\d+)\s*(?:month|mo|months|mos)/i);
  if (monthMatch) {
    const num = parseInt(monthMatch[1], 10);
    d.setMonth(d.getMonth() + num);
    return formatIsoDate(d);
  }

  // Match days: e.g. "28 days", "30 days"
  const dayMatch = val.match(/^(\d+)\s*(?:day|days|d)/i);
  if (dayMatch) {
    const num = parseInt(dayMatch[1], 10);
    d.setDate(d.getDate() + num);
    return formatIsoDate(d);
  }

  // Default fallback: 1 month
  d.setMonth(d.getMonth() + 1);
  return formatIsoDate(d);
}

function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function isExpired(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const today = new Date().toISOString().slice(0, 10);
  return iso < today;
}

export function daysRemaining(iso: string | null | undefined): number {
  if (!iso) return 0;
  const d = new Date(iso).getTime();
  const now = new Date().getTime();
  return Math.ceil((d - now) / (1000 * 60 * 60 * 24));
}

export interface ParsedRow {
  mobile: string;
  subscriptionDate: string;
  validity: string;
  expiryDate: string;
}

/**
 * Parses lines pasted from spreadsheets or uploaded CSV files.
 * Handles headers, UTF-8 BOM, tab-separated, comma-separated, and space-separated lines.
 */
export function parseBulkSubscribers(text: string): ParsedRow[] {
  // Remove BOM if present
  const cleanText = text.replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: ParsedRow[] = [];

  for (const line of lines) {
    // Skip header line if detected
    if (/^(mobile|phone|number|subscriber|date|validity)/i.test(line)) {
      continue;
    }

    // Split by comma or tab or semicolon
    let tokens = line.split(/[,\t;]+/).map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

    let mobile = '';
    let subDate = '';
    let validity = '1 Month';
    let expDate = '';

    if (tokens.length >= 2) {
      for (const t of tokens) {
        const cleanDigits = t.replace(/\D/g, '');
        // Phone number detection (8 to 15 digits)
        if (cleanDigits.length >= 8 && cleanDigits.length <= 15 && !mobile) {
          mobile = cleanDigits;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(t) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) {
          if (!subDate) {
            subDate = t;
          } else {
            expDate = t;
          }
        } else if (/(month|year|day)/i.test(t)) {
          validity = t;
        }
      }
    } else {
      // Space separated line
      const spaceTokens = line.split(/\s+/).map((t) => t.trim()).filter(Boolean);
      for (let i = 0; i < spaceTokens.length; i++) {
        const t = spaceTokens[i];
        const cleanDigits = t.replace(/\D/g, '');
        if (cleanDigits.length >= 8 && cleanDigits.length <= 15 && !mobile) {
          mobile = cleanDigits;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(t) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) {
          if (!subDate) {
            subDate = t;
          } else {
            expDate = t;
          }
        }
      }

      // Find validity by looking for number followed by Month/Year/Days
      const valMatch = line.match(/(\d+\s*(?:month|months|year|years|day|days))/i);
      if (valMatch) {
        validity = valMatch[1];
      }
    }

    if (mobile) {
      // Normalize subscription date to YYYY-MM-DD
      const normalizedSubDate = normalizeToIso(subDate || new Date().toISOString().slice(0, 10));
      const calculatedExp = expDate ? normalizeToIso(expDate) : calculateExpiryDate(normalizedSubDate, validity);

      rows.push({
        mobile,
        subscriptionDate: normalizedSubDate,
        validity: validity || '1 Month',
        expiryDate: calculatedExp,
      });
    }
  }

  return rows;
}

function normalizeToIso(dStr: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return dStr;
  if (dStr.includes('/')) {
    const parts = dStr.split('/').map((p) => parseInt(p, 10));
    if (parts.length === 3) {
      if (parts[2] > 1000) {
        const y = parts[2];
        const m = String(parts[1]).padStart(2, '0');
        const d = String(parts[0]).padStart(2, '0');
        return `${y}-${m}-${d}`;
      } else {
        const y = parts[2] < 100 ? 2000 + parts[2] : parts[2];
        const m = String(parts[1]).padStart(2, '0');
        const d = String(parts[0]).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    }
  }
  return new Date().toISOString().slice(0, 10);
}
