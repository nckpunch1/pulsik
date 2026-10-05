'use strict';
const { event } = require('./observability');
const API_URL = 'https://admin.pulseiq.com.au/api/public/upcoming-sessions';
let cache;
async function getUpcomingSessions({ deadline = Date.now() + 8000, fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 300000) return cache.data;
  // Schedule reads are safe to retry. All attempts share one deadline;
  // publishing must never substitute cached data for a failed fresh check.
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 100) break;
    const started = Date.now();
    try {
      const response = await fetch(API_URL, { cache: 'no-store', signal: AbortSignal.timeout(Math.min(5000, remaining)) });
      if (!response.ok) {
        event('SCHEDULE_FETCH_FAILED', { code: `http_${response.status}`, durationMs: Date.now() - started });
        if (response.status < 500) return null;
        continue;
      }
      const json = await response.json();
      const sessions = Array.isArray(json) ? json : json?.sessions;
      if (!Array.isArray(sessions) || sessions.some(s => !s || typeof s !== 'object')) {
        event('SCHEDULE_FETCH_FAILED', { code: 'invalid_schema' }); return null;
      }
      const result = sessions.slice(0, 5);
      cache = { data: result, at: Date.now() }; return result;
    } catch (err) {
      event('SCHEDULE_FETCH_FAILED', { code: ['TimeoutError', 'AbortError'].includes(err.name) ? 'timeout' : 'network_or_json', durationMs: Date.now() - started });
    }
  }
  return null;
}
module.exports = { getUpcomingSessions };
