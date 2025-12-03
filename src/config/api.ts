// Frontend API configuration
// Uses Vite environment variables (must be prefixed with VITE_)

export const API_CONFIG = {
  // Server URL for Socket.IO and API calls
  // Defaults to localhost for development, or current origin if not set
  SERVER_URL: import.meta.env.VITE_SERVER_URL || 
              (import.meta.env.DEV 
                ? 'http://localhost:5000'  // Default backend port for development
                : (typeof window !== 'undefined' ? window.location.origin : 'https://fridaybot-9jrb.onrender.com')),
  
  // API base path (relative or absolute)
  API_BASE: import.meta.env.VITE_API_BASE || '/api',
} as const;

// Helper to get full API URL
export const getApiUrl = (endpoint: string): string => {
  if (endpoint.startsWith('http')) return endpoint;
  if (endpoint.startsWith('/')) {
    // If SERVER_URL is set, use it; otherwise use relative path
    return API_CONFIG.SERVER_URL !== window.location.origin 
      ? `${API_CONFIG.SERVER_URL}${endpoint}`
      : endpoint;
  }
  return `${API_CONFIG.API_BASE}/${endpoint}`;
};

// Helper to get Socket.IO URL
export const getSocketUrl = (): string => {
  return API_CONFIG.SERVER_URL;
};

