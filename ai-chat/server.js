import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_KEY) console.warn('Brak OPENAI_API_KEY!');

const sessions = new Map();
const MAX_HISTORY = 40;

function ensureSession(req, res) {
  let sid = req.cookies.sid;
  if (!sid) {
    sid = crypto.randomBytes(16).toString('hex');
    res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax' });
  }
  if (!sessions.has(sid)) {
    sessions.set(sid, [
      {
        role: 'system',
        content: `Jesteś inteligentnym asystentem konwersacyjnym. Analizujesz emocje użytkownika i odpowiadasz empatycznie. `
      }
    ]);
  }
  return sid;
}

function trimHistory(arr) {
  if (arr.length > MAX_HISTORY) arr.splice(0, arr.length - MAX_HISTORY);
}

// Endpoint czatu
app.post('/api/chat', async (req, res) => {
  try {
    const sid = ensureSession(req, res);
    const userMsg = (req.body?.message || '').trim();
    if (!userMsg) return res.status(400).json({ error: 'Empty message' });

    const mem = sessions.get(sid);
    mem.push({ role: 'user', content: userMsg });
    trimHistory(mem);

    // Wywołanie OpenAI
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: mem.slice(-MAX_HISTORY),
        temperature: 0.8,
        max_tokens: 800
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(500).json({ error: 'OpenAI API error', detail: text });
    }

    const data = await resp.json();
    const assistantText = data.choices?.[0]?.message?.content ?? '';

    mem.push({ role: 'assistant', content: assistantText });
    trimHistory(mem);

    // Analiza emocji użytkownika
    const classResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Klasyfikator emocji: joy, sadness, anger, fear, surprise, neutral, disgust, tired' },
          { role: 'user', content: `Tekst użytkownika: "${userMsg}"` }
        ],
        temperature: 0,
        max_tokens: 10
      })
    });

    let emotion = 'neutral';
    if (classResp.ok) {
      const cdata = await classResp.json();
      emotion = (cdata.choices?.[0]?.message?.content || 'neutral').replace(/[^a-zA-Z]/g, '').toLowerCase();
    }

    res.json({ reply: assistantText, emotion });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', detail: err.message || String(err) });
  }
});

// Wyczyszczenie pamięci sesji
app.post('/api/clear', (req, res) => {
  const sid = req.cookies.sid;
  if (sid && sessions.has(sid)) sessions.set(sid, sessions.get(sid).slice(0,1));
  res.json({ ok:true });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
