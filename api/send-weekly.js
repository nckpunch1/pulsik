'use strict';

const path = require('path');
const fs = require('fs');
const { sendMessage } = require('../lib/telegram');

const posts = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../content/posts.json'), 'utf8')
);

module.exports = async function handler(req, res) {
  // Protect endpoint: if CRON_SECRET is set, require it in the Authorization header
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // Rotate post index by week number — advances automatically each Thursday
  const weekNumber = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const index = weekNumber % posts.length;
  const post = posts[index];

  await sendMessage(post.content);

  return res.status(200).json({ ok: true, postId: post.id, index });
};
