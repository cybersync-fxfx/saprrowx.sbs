const fs = require('fs');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
const logFilePath = args[0];

if (!logFilePath) {
  console.error('Usage: node ai-analyze.js <path_to_log_file>');
  process.exit(1);
}

if (!fs.existsSync(logFilePath)) {
  console.error(`Log file not found: ${logFilePath}`);
  process.exit(1);
}

const logContent = fs.readFileSync(logFilePath, 'utf8');

if (!logContent.trim()) {
  console.log('Log file is empty.');
  process.exit(0);
}

async function getApiKey() {
  let apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) return apiKey;

  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/^GEMINI_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('\x1b[33m[!] GEMINI_API_KEY not found. Enter your Gemini API Key: \x1b[0m', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function run() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error('Error: API key is required to use AI features.');
    process.exit(1);
  }

  console.log('\x1b[36m\n[AI] Contacting Gemini for threat analysis...\x1b[0m');

  const prompt = `You are an expert cybersecurity analyst. Analyze the following server attack logs. 
Identify the attack vectors, the severity, what the attackers are attempting, and provide actionable hardening recommendations.
Be concise and use clear headings.

Logs:
\`\`\`
${logContent}
\`\`\``;

  const models = ['gemini-1.5-flash', 'gemini-1.5-pro'];
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const analysisText = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!analysisText) {
        throw new Error('No analysis returned from Gemini.');
      }

      console.log('\x1b[32m\n=================================================================');
      console.log('  AI ATTACK ANALYSIS & INTELLIGENCE REPORT');
      console.log('=================================================================\x1b[0m\n');
      console.log(analysisText);
      console.log('\x1b[32m\n=================================================================\x1b[0m');
      
      return; // Success, exit the loop

    } catch (error) {
      lastError = error;
      console.log(`\x1b[33m[!] Model ${model} failed, trying next...\x1b[0m`);
    }
  }

  console.error('\x1b[31m\n[Error] Failed to generate AI report:\x1b[0m', lastError?.message);
  process.exit(1);
}

run();
