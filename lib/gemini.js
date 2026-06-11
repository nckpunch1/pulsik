'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI;

function getClient() {
  if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI;
}

async function generateReply(systemPrompt, userHistory, channelContext, userMessage) {
  const contextBlock = channelContext.length > 0
    ? '\n\nНедавние сообщения в чате:\n' +
      channelContext.map(m => `${m.username}: ${m.content}`).join('\n')
    : '';

  const model = getClient().getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    systemInstruction: systemPrompt + contextBlock,
  });

  // Map stored roles to Gemini roles ('assistant' → 'model')
  const history = userHistory.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(userMessage);
  return result.response.text();
}

module.exports = { generateReply };
