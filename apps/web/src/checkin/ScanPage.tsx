import { useEffect, useRef, useState } from 'react';
import type { CheckInResult } from '@netball-trials/types';
import type { apiClient } from '../api/client';
import { announceResult, resultLabel } from './feedback';

type Client = ReturnType<typeof apiClient>;

function announce(result: CheckInResult) {
  announceResult(result, {
    beep: (ok) => {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const context = new Ctx();
        const oscillator = context.createOscillator();
        oscillator.frequency.value = ok ? 880 : 440;
        oscillator.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.12);
      } catch {
        /* sound is best effort */
      }
    },
    vibrate: (pattern) => {
      try {
        navigator.vibrate?.(pattern);
      } catch {
        /* vibration is best effort */
      }
    },
  });
}

export function ScanPage({ client }: { client: Client }) {
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastToken = useRef('');
  const busy = useRef(false);

  useEffect(() => {
    let stopped = false;
    let reset: (() => void) | undefined;

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        const video = document.getElementById('scan-video') as HTMLVideoElement | null;
        if (!video) return;

        const controls = await reader.decodeFromVideoDevice(undefined, video, (decoded) => {
          const text = decoded ? decoded.getText() : '';
          if (!text || stopped || busy.current || text === lastToken.current) return;
          lastToken.current = text;
          busy.current = true;
          client
            .scan(text)
            .then((scanned) => {
              setResult(scanned);
              announce(scanned);
            })
            .catch(() => setError('Scan failed. Try again or use manual lookup.'))
            .finally(() => {
              setTimeout(() => {
                busy.current = false;
              }, 1500);
            });
        });
        reset = () => controls.stop();
      } catch {
        setError('Camera unavailable. Use manual lookup.');
      }
    })();

    return () => {
      stopped = true;
      try {
        reset?.();
      } catch {
        /* ignore */
      }
    };
  }, [client]);

  const label = result ? resultLabel(result) : null;

  return (
    <section>
      <h1>Scan</h1>
      {error ? <p role="alert">{error}</p> : null}
      <video id="scan-video" muted playsInline style={{ width: '100%', maxWidth: 480 }} />
      {label ? (
        <p role="status" data-tone={label.tone} style={{ fontSize: '1.5rem', fontWeight: 700 }}>
          {label.text}
        </p>
      ) : null}
      <p>
        <a href="/check-in/lookup">Look up by name instead</a>
      </p>
    </section>
  );
}
