import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StrictMode } from 'react';
import { ScanPage } from './ScanPage';
import { CheckInLayout } from './CheckInLayout';

const scanner = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    decodeFromVideoDevice(...args: any[]) { return scanner.decode(...args); }
  },
}));

let decoded: ((result: { getText(): string } | undefined) => void) | undefined;
let controls: { stop: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  decoded = undefined;
  controls = { stop: vi.fn() };
  scanner.decode.mockImplementation((_device: unknown, _video: unknown, callback: typeof decoded) => {
    decoded = callback;
    return Promise.resolve(controls);
  });
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function result(overrides: Record<string, unknown> = {}) {
  return { result: 'checked_in', registrationId: 'registration-1', playerName: 'Ada Lovelace', bibNumber: 7, referToCommittee: true, ...overrides };
}

async function waitForDecoder() {
  await waitFor(() => expect(decoded).toBeTypeOf('function'));
}

describe('ScanPage', () => {
  it('retries a failed token and explicitly re-arms the same QR after undo', async () => {
    const client = {
      scan: vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(result()),
      undoCheckIn: vi.fn().mockResolvedValue(undefined),
    };
    render(<MemoryRouter><ScanPage client={client as any} /></MemoryRouter>);
    await waitForDecoder();
    await act(async () => { decoded!({ getText: () => 'same-qr-token' }); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/scan failed/i);
    fireEvent.click(screen.getByRole('button', { name: /retry scan/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('Ada Lovelace, Number 7 — Refer to committee');
    expect(client.scan.mock.calls.map(([token]) => token)).toEqual(['same-qr-token', 'same-qr-token']);
    fireEvent.click(screen.getByRole('button', { name: /undo last check-in/i }));
    await waitFor(() => expect(client.undoCheckIn).toHaveBeenCalledWith('registration-1'));
    expect(await screen.findByRole('status')).toHaveTextContent(/check-in undone/i);

    await act(async () => { decoded!({ getText: () => 'same-qr-token' }); });
    expect(client.scan).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Scan same code again' }));
    await act(async () => { decoded!({ getText: () => 'same-qr-token' }); });
    expect(await screen.findByRole('status')).toHaveTextContent('Ada Lovelace, Number 7 — Refer to committee');
    await act(async () => { decoded!({ getText: () => 'different-qr-token' }); });
    expect(client.scan.mock.calls.map(([token]) => token)).toEqual([
      'same-qr-token', 'same-qr-token', 'same-qr-token', 'different-qr-token',
    ]);
  });

  it('refreshes the live arrival count after a QR check-in', async () => {
    const client = {
      checkInSummary: vi.fn()
        .mockResolvedValueOnce({ eventId: 'e1', eventName: 'Trials', registered: 1, checkedIn: 0, closed: false })
        .mockResolvedValueOnce({ eventId: 'e1', eventName: 'Trials', registered: 1, checkedIn: 1, closed: false }),
      scan: vi.fn().mockResolvedValue(result({ referToCommittee: false })),
    };
    render(<MemoryRouter><CheckInLayout client={client as any} /><ScanPage client={client as any} /></MemoryRouter>);
    expect(await screen.findByText('0 of 1 arrived')).toBeInTheDocument();
    await waitForDecoder();
    await act(async () => { decoded!({ getText: () => 'qr-arrival' }); });
    expect(await screen.findByText('1 of 1 arrived')).toBeInTheDocument();
  });

  it('reports camera permission failure and provides the manual fallback', async () => {
    scanner.decode.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    render(<MemoryRouter><ScanPage client={{ scan: vi.fn() } as any} /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/camera unavailable/i);
    expect(screen.getByRole('link', { name: /look up by name/i })).toHaveAttribute('href', '/check-in/lookup');
  });

  it('closes its audio context after feedback and stops camera controls on unmount', async () => {
    const oscillator = {
      frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), onended: null as null | (() => void),
      stop: vi.fn(function (this: { onended: null | (() => void) }) { this.onended?.(); }),
    };
    let audioContext: MockAudioContext | undefined;
    class MockAudioContext {
      currentTime = 0;
      destination = {};
      state = 'running';
      createOscillator() { return oscillator; }
      close = vi.fn(async () => { this.state = 'closed'; });
      constructor() { audioContext = this; }
    }
    vi.stubGlobal('AudioContext', MockAudioContext);
    const client = { scan: vi.fn().mockResolvedValue(result({ referToCommittee: false })), undoCheckIn: vi.fn() };
    const view = render(<MemoryRouter><ScanPage client={client as any} /></MemoryRouter>);
    await waitForDecoder();
    await act(async () => { decoded!({ getText: () => 'audio-token' }); });
    expect(await screen.findByRole('status')).toHaveTextContent('Ada Lovelace, Number 7');
    expect(oscillator.stop).toHaveBeenCalled();
    expect(audioContext?.close).toHaveBeenCalledOnce();
    view.unmount();
    await waitFor(() => expect(controls.stop).toHaveBeenCalled());
  });

  it('stops camera controls returned after the component has unmounted', async () => {
    let resolveStartup!: (value: { stop: ReturnType<typeof vi.fn> }) => void;
    scanner.decode.mockImplementation((_device: unknown, _video: unknown, callback: typeof decoded) => {
      decoded = callback;
      return new Promise((resolve) => { resolveStartup = resolve; });
    });
    const stop = vi.fn();
    const view = render(<MemoryRouter><ScanPage client={{ scan: vi.fn() } as any} /></MemoryRouter>);
    await waitFor(() => expect(scanner.decode).toHaveBeenCalled());
    view.unmount();
    await act(async () => { resolveStartup({ stop }); await Promise.resolve(); });
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not start the camera after Strict Mode cleanup has already run', async () => {
    const view = render(<StrictMode><MemoryRouter><ScanPage client={{ scan: vi.fn() } as any} /></MemoryRouter></StrictMode>);
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scanner.decode).not.toHaveBeenCalled();
  });
});
