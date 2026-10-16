import { NextRequest, NextResponse } from 'next/server';
import GmailService from '@/lib/services/gmailService';
import { extractNetflixLink, isNetflixVerificationEmail } from '@/lib/utils/emailParser';
import { checkCustomerEligibility, logActivation, normalizeMobile } from '@/lib/store';
import { clientIp, describeError, whatsappLink } from '@/lib/api-response';

export const maxDuration = 60; // 60 seconds for Vercel serverless functions

/**
 * Household update: only for a valid, active customer (checked here on the
 * server). Unlimited uses; each attempt is logged.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const raw = String(body?.mobile || '').replace(/\D/g, '');
  const mobile = normalizeMobile(raw);
  const minutesAgo = Math.min(120, Math.max(5, parseInt(String(body?.minutes || '30'), 10) || 30));

  if (!mobile) {
    const message = 'Please enter a valid 10-digit mobile number';
    return NextResponse.json({ success: false, message, whatsappUrl: whatsappLink(raw, message) }, { status: 400 });
  }

  let eligibility;
  try {
    eligibility = await checkCustomerEligibility(mobile, 'household_update');
  } catch (err) {
    const { status, message } = describeError(err);
    const shown = status === 503 ? 'Service temporarily unavailable. Please contact support on WhatsApp.' : message;
    return NextResponse.json({ success: false, message: shown, whatsappUrl: whatsappLink(mobile, shown) }, { status });
  }
  if (!eligibility.eligible || !eligibility.customer) {
    return NextResponse.json(
      { success: false, reason: eligibility.reason, message: eligibility.message, whatsappUrl: whatsappLink(mobile, eligibility.message) },
      { status: 403 }
    );
  }

  const customer = eligibility.customer;
  const ip = clientIp(request);
  const response = await findLink(minutesAgo);
  const payload = await response.clone().json().catch(() => ({}));

  try {
    await logActivation({
      subscriberId: customer.id,
      mobile,
      action: 'household_update',
      status: payload.success ? 'success' : 'failed',
      ip,
      notes: payload.success ? 'Household update link delivered' : String(payload.message || payload.error || 'No link found'),
    });
  } catch (err) {
    // The customer still gets the link; the failed log write is visible in Vercel logs.
    describeError(err);
  }

  if (!payload.success) {
    const message = String(payload.message || payload.error || 'Failed to fetch the Netflix update link');
    return NextResponse.json({ ...payload, message, whatsappUrl: whatsappLink(mobile, message) }, { status: response.status });
  }
  return response;
}

async function findLink(minutesAgo: number): Promise<NextResponse> {
  try {
    console.log(`🔍 Searching for Netflix emails from last ${minutesAgo} minutes...`);

    const gmailService = new GmailService();
    const email = await gmailService.getLatestNetflixEmail(minutesAgo);

    if (!email) {
      return NextResponse.json({
        success: false,
        error: 'No recent verification email found',
        message: `No emails found from Netflix in the last ${minutesAgo} minutes`,
      });
    }

    console.log('📧 Email found - Subject:', email.subject);
    console.log('📧 Email HTML length:', email.html?.length || 0);
    console.log('📧 From:', email.from?.value?.[0]?.address);

    if (!isNetflixVerificationEmail(email)) {
      console.log('⚠️ Email found but does not appear to be a verification email');
      return NextResponse.json({
        success: false,
        error: 'Email found but not a verification email',
        message: 'The email does not match Netflix verification email patterns',
      });
    }

    const link = extractNetflixLink(email);

    if (!link) {
      console.log('⚠️ Email found but no verification link could be extracted');
      console.log('🔎 Email HTML (first 500 chars):', (email.html || '').slice(0, 500));
      return NextResponse.json({
        success: false,
        error: 'No verification link found in email',
        message: "Found verification email but couldn't extract the 'Yes, this was me' link",
        emailDate: email.date?.toISOString() || null,
      });
    }

    console.log('✅ Successfully extracted Netflix verification link');
    console.log('🔗 Link contains token:', link.includes('token='));

    return NextResponse.json({
      success: true,
      link: link,
      emailDate: email.date?.toISOString() || null,
      subject: email.subject || null,
      from: email.from?.value?.[0]?.address || null,
      linkExpiry: '15 minutes from email receipt',
    });
  } catch (error: any) {
    console.error('❌ Error fetching Netflix link:', error);

    if (error.message?.includes('GMAIL_USER') || error.message?.includes('GMAIL_APP_PASSWORD')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Gmail configuration error',
          message: error.message,
        },
        { status: 500 }
      );
    }

    if (error.message?.includes('authentication') || error.message?.includes('Invalid credentials')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Gmail authentication failed',
          message: 'Please check your Gmail credentials in environment variables',
        },
        { status: 401 }
      );
    }

    if (error.message?.includes('timeout') || error.message?.includes('ECONNREFUSED')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Connection timeout',
          message: 'Could not connect to Gmail. Please check your internet connection.',
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch Netflix link',
        message: error.message || 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

