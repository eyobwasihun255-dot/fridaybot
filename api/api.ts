// Frontend API configuration 
// Uses Vite environment variables (must be prefixed with VITE_)

export const API_CONFIG = {
  // Force the backend server URL to the Render deployment
  SERVER_URL: 'https://fridaybot-c47n.onrender.com',

  // API base path
  API_BASE: '/api',
};

// Helper to get full API URL
export function getApiUrl(endpoint) {
  if (endpoint.startsWith('http')) return endpoint;

  if (endpoint.startsWith('/')) {
    return `${API_CONFIG.SERVER_URL}${endpoint}`;
  }

  return `${API_CONFIG.SERVER_URL}${API_CONFIG.API_BASE}/${endpoint}`;
}

// Helper to get Socket.IO URL
export function getSocketUrl() {
  return API_CONFIG.SERVER_URL;
}
