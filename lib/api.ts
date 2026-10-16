/**
 * API Configuration and Helper Functions
 * Handles all backend API calls
 */

// Use relative URLs for same-origin requests (Vercel deployment)
// Falls back to localhost for local development
const API_BASE_URL = 
  typeof window !== 'undefined' 
    ? '' // Use relative URLs in browser (same origin)
    : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'; // Server-side fallback

/**
 * Fetch the latest Netflix verification link from backend
 * @param minutesAgo - Search within last N minutes (default: 30)
 * @returns Promise with API response
 */
export async function fetchLatestNetflixLink(mobile: string, minutesAgo: number = 30) {
  try {
    // Use relative URL for same-origin requests (works in Vercel)
    const url = '/api/latest-netflix-link';
    
    // Debug logging
    console.log('🔗 Fetching from:', url);
    
    // Create an AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ mobile, minutes: minutesAgo }),
      cache: 'no-store',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    console.log('📡 Response status:', response.status, response.statusText);

    // Check if response is ok
    if (!response.ok) {
      let errorMessage = `HTTP error! status: ${response.status}`;
      
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch (parseError) {
        // If JSON parsing fails, use status text
        errorMessage = response.statusText || errorMessage;
      }
      
      throw new Error(errorMessage);
    }

    // Parse response
    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      throw new Error('Invalid JSON response from server');
    }

    return data;
  } catch (error) {
    console.error('❌ API Error:', error);
    
    // Handle abort/timeout errors
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out. The Gmail connection is taking too long. Please try again.');
    }
    
    // Handle network errors
    if (error instanceof TypeError) {
      if (error.message.includes('fetch') || error.message.includes('Failed to fetch')) {
        throw new Error('Failed to connect to server. Please check your internet connection and try again.');
      }
    }
    
    // Handle other errors
    if (error instanceof Error) {
      throw error;
    }
    
    // Fallback for unknown errors
    throw new Error('An unexpected error occurred while fetching the Netflix link');
  }
}

/**
 * Health check endpoint
 */
export async function checkBackendHealth() {
  try {
    const response = await fetch('/api/health', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Backend health check failed:', error);
    throw error;
  }
}

