'use strict';

const API_URL = 'https://admin.pulseiq.com.au/api/public/upcoming-sessions';
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = { data: null, fetchedAt: 0 };

async function getUpcomingSessions() {
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }
  try {
    const res = await fetch(API_URL);
    if (!res.ok) return [];
    const json = await res.json();
    const sessions = Array.isArray(json) ? json : (json.sessions || json.data || []);
    cache = { data: sessions, fetchedAt: Date.now() };
    return sessions;
  } catch {
    return [];
  }
}

module.exports = { getUpcomingSessions };
