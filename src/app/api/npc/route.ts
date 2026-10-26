import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface Msg { role: 'user' | 'assistant'; content: string }

const FALLBACKS = [
  'Ah, you wan see Lagos? This side sweet no be small — but mind the danfo o!',
  'Victoria Island no sleep, my guy. Day na money, night na enjoyment.',
  'You dey hear that generator sound? Na our second anthem for here.',
  'If you never eat suya for this side, you never start. later we go link up.',
  'The lagoon dey calm this evening. E go rain before night, watch am.',
  'Excalibur people plenty for here o. You be the new one? Welcome!'
];

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { name?: string; history?: Msg[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad body' }, { status: 400 });
  }
  const name = (body.name ?? 'Lagosian').slice(0, 24);
  const history = (body.history ?? []).slice(-6).filter(m => m && typeof m.content === 'string');

  try {
    const zai = await ZAI.create();
    const system = [
      `You are ${name}, a Lagosian walking down a street in Victoria Island, Lagos, inside a 3D online game called Excalibur: Earth.`,
      `Stay in character as a warm, busy Lagos resident. Speak natural Nigerian-flavoured English (light pidgin is fine), max 2 short sentences.`,
      `You can reference real places in Lagos, traffic, jollof, danfo buses, the lagoon, weather, work hustle.`,
      `Never mention being an AI, never mention game mechanics, never discuss politics or anything unsafe. Keep it friendly and family-safe.`
    ].join(' ');
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        ...history.map(m => ({ role: m.role, content: m.content.slice(0, 240) })),
        { role: 'user', content: history.length ? (history[history.length - 1].content || 'Hello!') : 'Hello!' }
      ],
      temperature: 0.85,
      max_tokens: 90
    });
    const reply = completion.choices[0]?.message?.content?.trim();
    if (!reply) throw new Error('empty');
    return NextResponse.json({ ok: true, reply });
  } catch {
    const reply = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
    return NextResponse.json({ ok: true, reply, fallback: true });
  }
}
