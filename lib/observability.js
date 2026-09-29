'use strict';
// Allowlisted metadata only: never log request bodies, provider errors, tokens or prompts.
function event(name, fields = {}) {
  const allowed = ['updateId', 'week', 'state', 'model', 'durationMs', 'code', 'count'];
  const safe = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
  console.log(JSON.stringify({ event: name, at: new Date().toISOString(), ...safe }));
}
module.exports = { event };
