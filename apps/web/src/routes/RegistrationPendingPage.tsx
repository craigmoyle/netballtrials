import { useEffect, useState } from 'react';
import type { RegistrationStatus } from '@netball-trials/types';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

export function RegistrationPendingPage({
  client,
  registrationId,
}: {
  client: Client;
  registrationId: string;
}) {
  const [status, setStatus] = useState<RegistrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const result = await client.getRegistrationStatus(registrationId);
        if (!active) return;
        setStatus(result.status);
        if (result.status === 'PENDING' || result.status === 'EXPIRED') {
          timer = setTimeout(poll, 3000);
        }
      } catch {
        if (active) setError('Could not check the payment status.');
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [client, registrationId]);

  if (error) {
    return <p role="alert">{error}</p>;
  }

  if (status === 'PAID') {
    return (
      <section>
        <h2>Payment received</h2>
        <p>Check your email for the QR ticket and calendar invite.</p>
      </section>
    );
  }

  if (status === 'EXPIRED' || status === 'FAILED') {
    return (
      <section>
        <h2>Payment not completed</h2>
        <p>That checkout has closed. You can register again from the trial page.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Confirming your payment</h2>
      <p>This page updates automatically. You can also check your email.</p>
    </section>
  );
}
