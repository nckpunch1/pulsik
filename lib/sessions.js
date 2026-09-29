'use strict';
const API_URL = 'https://admin.pulseiq.com.au/api/public/upcoming-sessions';
let cache;
async function getUpcomingSessions({ deadline = Date.now() + 2500, fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 300000) return cache.data;
  try {
    const remaining = deadline - Date.now();
    if (remaining < 100) return null;
    const response = await fetch(API_URL, { signal: AbortSignal.timeout(Math.min(2500, remaining)) });
    if (!response.ok) return null;
    const json = await response.json();
    const sessions = Array.isArray(json) ? json : json.sessions;
    if (!Array.isArray(sessions) || sessions.some(s => !s || typeof s !== 'object')) return null;
    const result = sessions.slice(0, 5);
    cache = { data: result, at: Date.now() }; return result;
  } catch { return null; }
}
module.exports = { getUpcomingSessions };
