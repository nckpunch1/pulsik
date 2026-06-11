'use strict';

const Groq = require('groq-sdk');

let client;

function getClient() {
  if (!client) client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return client;
}

async function generateReply(systemPrompt, userHistory, channelContext, userMessage) {
  const contextBlock = channelContext.length > 0
    ? '\n\nНедавние сообщения в чате:\n' +
      channelContext.map(m => `${m.username}: ${m.content}`).join('\n')
    : '';

  const messages = [
    { role: 'system', content: systemPrompt + contextBlock },
    ...userHistory.map(msg => ({ role: msg.role, content: msg.content })),
    { role: 'user', content: userMessage },
  ];

  const completion = await getClient().chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages,
  });

  return completion.choices[0].message.content;
}

module.exports = { generateReply };
