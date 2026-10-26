'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Engine, HudState } from '@/game/engine';

interface SheetMsg { role: 'you' | 'them'; text: string }

const BOOT_HUD: HudState = {
  mode: 'boot', readyPct: 0, clock: '—', location: 'Victoria Island · Lagos · Earth Server 1',
  nearNpc: null, fps: 0, lat: 6.4295, lon: 3.4265, hint: ''
};

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const mapRef = useRef<HTMLCanvasElement | null>(null);
  const joyRef = useRef<HTMLDivElement | null>(null);
  const [hud, setHud] = useState<HudState>(BOOT_HUD);
  const [sheet, setSheet] = useState<{ open: boolean; name: string; log: SheetMsg[]; busy: boolean }>({
    open: false, name: '', log: [], busy: false
  });
  const [draft, setDraft] = useState('');

  /* boot engine once */
  useEffect(() => {
    if (!canvasRef.current || engineRef.current) return;
    let EngineCtor: typeof Engine | null = null;
    let killed = false;
    (async () => {
      const mod = await import('@/game/engine');
      EngineCtor = mod.Engine;
      if (killed || !canvasRef.current) return;
      engineRef.current = new EngineCtor(canvasRef.current, {
        onHud: s => setHud(s),
        onNpcTalk: name => openSheet(name)
      });
    })();
    return () => { killed = true; engineRef.current?.dispose(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* minimap painter */
  useEffect(() => {
    if (hud.mode !== 'city' && hud.mode !== 'loading') return;
    let raf = 0;
    const paint = (): void => {
      const c = mapRef.current;
      if (c && engineRef.current) {
        const ctx = c.getContext('2d');
        if (ctx) engineRef.current.minimapDraw(ctx, c.width);
      }
      raf = requestAnimationFrame(paint) as unknown as number;
    };
    raf = requestAnimationFrame(paint) as unknown as number;
    return () => cancelAnimationFrame(raf);
  }, [hud.mode]);

  /* joystick */
  useEffect(() => {
    const zone = joyRef.current;
    if (!zone) return;
    const knob = zone.querySelector('.joy-knob') as HTMLDivElement;
    let active = false;
    const set = (dx: number, dy: number): void => {
      const R = 44;
      const v = { x: dx / R, z: dy / R };
      const m = Math.hypot(v.x, v.z);
      const k = m > 1 ? 1 / m : 1;
      engineRef.current?.setJoystick(v.x * k, v.z * k);
      knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
    };
    const fromEvent = (e: PointerEvent): void => {
      const r = zone.getBoundingClientRect();
      set(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    };
    const down = (e: PointerEvent): void => { active = true; zone.setPointerCapture(e.pointerId); fromEvent(e); };
    const move = (e: PointerEvent): void => { if (active) fromEvent(e); };
    const up = (): void => { active = false; set(0, 0); };
    zone.addEventListener('pointerdown', down);
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
    return () => {
      zone.removeEventListener('pointerdown', down);
      zone.removeEventListener('pointermove', move);
      zone.removeEventListener('pointerup', up);
      zone.removeEventListener('pointercancel', up);
    };
  }, []);

  const openSheet = useCallback((name: string) => {
    setSheet({ open: true, name, log: [{ role: 'them', text: `Yes! How I go help you?` }], busy: false });
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sheet.busy) return;
    const log = [...sheet.log, { role: 'you' as const, text }];
    setSheet(s => ({ ...s, log, busy: true, open: true }));
    setDraft('');
    try {
      const r = await fetch('/api/npc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sheet.name,
          history: log.slice(-5).map(m => ({ role: m.role === 'you' ? 'user' : 'assistant', content: m.text }))
        })
      });
      const j = await r.json();
      setSheet(s => ({ ...s, log: [...log, { role: 'them', text: j.reply ?? '…' }], busy: false }));
    } catch {
      setSheet(s => ({ ...s, log: [...log, { role: 'them', text: 'Network no gree — try again.' }], busy: false }));
    }
  }, [draft, sheet]);

  const inTitle = hud.mode === 'globe' || hud.mode === 'boot';
  const inCity = hud.mode === 'city' || hud.mode === 'loading';

  return (
    <main className="stage">
      <canvas ref={canvasRef} />

      {inTitle && (
        <div className="title-wrap">
          <div className="title-kicker">Earth is the server</div>
          <h1 className="title-word">EXCALIBUR</h1>
          <div className="title-sub">Earth Server · Online</div>
          <button
            className="enter-btn"
            onClick={() => engineRef.current?.requestEnter()}
            disabled={hud.mode === 'boot'}
          >
            ENTER LAGOS
          </button>
          <div className="orbit-hint">drag to orbit the planet · pinch or scroll to zoom</div>
        </div>
      )}

      {hud.mode === 'dive' && (
        <div className="load-wrap">
          <div className="load-ring" />
          <div className="load-txt">Entering Earth Server</div>
        </div>
      )}

      {hud.mode === 'loading' && (
        <div className="load-wrap">
          <div className="load-ring" />
          <div className="load-txt">Streaming Lagos</div>
          <div className="load-bar"><i style={{ width: `${Math.round(hud.readyPct * 100)}%` }} /></div>
        </div>
      )}

      {inCity && (
        <div className="hud">
          <div className="hud-top">
            <div className="hud-loc">
              <div className="l1">VICTORIA ISLAND · LAGOS</div>
              <div className="l2">{hud.clock} · {hud.lat}°N {hud.lon}°E</div>
            </div>
            <div className="hud-chips">
              <span className="chip">EARTH SERVER 1</span>
              <span className="chip">{hud.fps} FPS</span>
            </div>
          </div>

          <div className="minimap"><canvas ref={mapRef} width={248} height={248} /></div>

          {hud.hint && <div className="hint-toast">{hud.hint}</div>}

          <div className="joy" ref={joyRef}><div className="joy-knob" /></div>

          <div className="actions">
            {hud.nearNpc && (
              <button className="act-btn talk" onClick={() => openSheet(hud.nearNpc!)}>
                TALK
              </button>
            )}
            <button
              className={`act-btn ${hud.mode === 'city' ? '' : ''}`}
              onPointerDown={() => engineRef.current?.setSprint(true)}
              onPointerUp={() => engineRef.current?.setSprint(false)}
              onPointerLeave={() => engineRef.current?.setSprint(false)}
            >
              RUN
            </button>
            <button className="act-btn" onClick={() => engineRef.current?.jump()}>JUMP</button>
          </div>

          {sheet.open && (
            <div className="sheet">
              <div className="sheet-head">
                <span className="who">{sheet.name} · Lagosian</span>
                <button className="sheet-close" onClick={() => setSheet(s => ({ ...s, open: false }))}>✕</button>
              </div>
              <div className="sheet-log">
                {sheet.log.map((m, i) => (
                  <div key={i} className={`msg ${m.role === 'you' ? 'you' : 'them'}`}>{m.text}</div>
                ))}
                {sheet.busy && <div className="msg them">…</div>}
              </div>
              <div className="sheet-input">
                <input
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void send(); }}
                  placeholder={`Say something to ${sheet.name}…`}
                  maxLength={140}
                />
                <button onClick={() => void send()} disabled={sheet.busy || !draft.trim()}>Send</button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
