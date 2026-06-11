'use strict';

const TZ = 'Australia/Brisbane';

const fmtDayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: TZ });
const fmtWeekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', timeZone: TZ });
const fmtTime = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });

function parseSessionDate(session) {
  const raw = session.startsAt || session.date || session.datetime || session.start_time || session.startTime;
  if (!raw) return null;
  // If no timezone indicator, assume Brisbane local time (UTC+10)
  const iso = typeof raw === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(raw)
    ? raw + '+10:00'
    : raw;
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

function formatSessionsForPrompt(sessions) {
  if (!sessions || sessions.length === 0) return '';

  const lines = sessions.map(session => {
    const date = parseSessionDate(session);
    const datePart = date
      ? `${fmtDayMonth.format(date)}, ${fmtWeekday.format(date)}, ${fmtTime.format(date)}`
      : null;

    const name = session.name || session.title || '';

    let venue = '';
    if (typeof session.venue === 'string') {
      venue = session.venue;
    } else if (session.venue && typeof session.venue === 'object') {
      const parts = [session.venue.name, session.venue.suburb || session.venue.location].filter(Boolean);
      venue = parts.join(', ');
    }

    const left = datePart || '';
    const right = [name ? `"${name}"` : '', venue].filter(Boolean).join(', ');

    if (left && right) return `- ${left} — ${right}`;
    if (left) return `- ${left}`;
    if (right) return `- ${right}`;
    return null;
  }).filter(Boolean);

  if (lines.length === 0) return '';
  return `Ближайшие игры PulseIQ:\n${lines.join('\n')}`;
}

module.exports = { formatSessionsForPrompt };
