import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CheckInResult } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';
import { announceResult, resultLabel } from './feedback';
import { notifyCheckInUpdated } from './refresh';
import { checkInSessionEnded } from './session';

function announce(result: CheckInResult, contexts: Set<AudioContext>) {
  announceResult(result, {
    beep: (ok) => {
      let context: AudioContext | null = null;
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        context = new Ctx();
        contexts.add(context);
        const oscillator = context.createOscillator();
        oscillator.frequency.value = ok ? 880 : 440;
        oscillator.connect(context.destination);
        oscillator.onended = () => {
          contexts.delete(context!);
          void context?.close().catch(() => undefined);
        };
        oscillator.start();
        oscillator.stop(context.currentTime + 0.12);
      } catch {
        if (context) {
          contexts.delete(context);
          void context.close().catch(() => undefined);
        }
      }
    },
    vibrate: (pattern) => {
      try { navigator.vibrate?.(pattern); } catch { /* best effort */ }
    },
  });
}

export function ScanPage({ client }: { client: Client }) {
  const navigate = useNavigate();
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [undoableId, setUndoableId] = useState<string | null>(null);
  const [canRescanLastToken, setCanRescanLastToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const lastToken = useRef('');
  const busyRef = useRef(false);
  const sessionIsActive = useRef<(() => boolean) | null>(null);
  const audioContexts = useRef(new Set<AudioContext>());

  const processToken = useCallback(async (token: string, isActive: () => boolean) => {
    if (busyRef.current || !isActive()) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    setResult(null);
    try {
      const scanned = await client.scan(token);
      if (!isActive()) return;
      setResult(scanned);
      setCanRescanLastToken(true);
      setUndoableId(scanned.result === 'checked_in' ? scanned.registrationId ?? null : null);
      if (scanned.result === 'checked_in') notifyCheckInUpdated();
      announce(scanned, audioContexts.current);
    } catch (error) {
      if (!isActive()) return;
      if (checkInSessionEnded(error)) navigate('/check-in', { replace: true });
      else setError('Scan failed. Check the connection, then retry this code or use manual lookup.');
    } finally {
      if (isActive()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [client, navigate]);

  useEffect(() => {
    let stopped = false;
    let controls: { stop: () => void } | undefined;
    const isActive = () => !stopped;
    sessionIsActive.current = isActive;

    void (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (stopped) return;
        const reader = new BrowserMultiFormatReader();
        const video = document.getElementById('scan-video') as HTMLVideoElement | null;
        if (!video) return;
        const started = await reader.decodeFromVideoDevice(undefined, video, (decoded) => {
          const token = decoded?.getText() ?? '';
          if (!token || stopped || busyRef.current || token === lastToken.current) return;
          lastToken.current = token;
          setCanRescanLastToken(false);
          void processToken(token, isActive);
        });
        if (stopped) {
          started.stop();
          return;
        }
        controls = started;
        setCameraReady(true);
      } catch {
        if (!stopped) setError('Camera unavailable. Check browser permission or use manual lookup.');
      }
    })();

    return () => {
      stopped = true;
      sessionIsActive.current = null;
      busyRef.current = false;
      try { controls?.stop(); } catch { /* best effort */ }
      for (const context of audioContexts.current) {
        if (context.state !== 'closed') void context.close().catch(() => undefined);
      }
      audioContexts.current.clear();
    };
  }, [processToken]);

  function rearmLastToken() {
    if (!lastToken.current || busyRef.current) return;
    lastToken.current = '';
    setCanRescanLastToken(false);
    setMessage(null);
    setResult(null);
  }

  async function retryScan() {
    if (!lastToken.current || !sessionIsActive.current) return;
    await processToken(lastToken.current, sessionIsActive.current);
  }

  async function undo() {
    const isActive = sessionIsActive.current;
    if (!undoableId || busyRef.current || !isActive?.()) return;
    // Block camera decodes until the undo settles.
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await client.undoCheckIn(undoableId);
      if (!isActive()) return;
      setUndoableId(null);
      setResult(null);
      setCanRescanLastToken(true);
      setMessage('Check-in undone. The player may now be checked in again.');
      notifyCheckInUpdated();
    } catch (error) {
      if (!isActive()) return;
      if (checkInSessionEnded(error)) navigate('/check-in', { replace: true });
      else setError('Could not undo the check-in. Refresh and try again.');
    } finally {
      if (isActive()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  const label = result ? resultLabel(result) : null;

  return (
    <section className="scan-panel">
      <h1>Scan</h1>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {!result && !message && !error && !busy ? (
        <p role="status" className="scan-instruction">
          {cameraReady
            ? "Camera ready. Hold the player's QR code steady in the frame."
            : 'Starting camera. Allow access if prompted.'}
        </p>
      ) : null}
      <video id="scan-video" muted playsInline aria-label="Camera view for scanning player QR codes" />
      {label ? <p role="status" className="scan-result" data-tone={label.tone}>{label.text}</p> : null}
      {error && lastToken.current ? <button type="button" disabled={busy} onClick={retryScan}>{busy ? 'Retrying...' : 'Retry scan'}</button> : null}
      {canRescanLastToken ? <button type="button" disabled={busy} onClick={rearmLastToken}>Scan same code again</button> : null}
      {undoableId ? <button type="button" disabled={busy} onClick={undo}>Undo last check-in</button> : null}
      <p><Link to="/check-in/lookup">Look up by name instead</Link></p>
    </section>
  );
}
