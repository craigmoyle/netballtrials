import 'dotenv/config';
import { parseArgs } from 'node:util';
import { prisma } from '../db';
import { resolveStoppedDelivery } from '../mail/lifecycle';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'delivery-id': { type: 'string' },
      'expected-attempt': { type: 'string' },
      outcome: { type: 'string' },
      'acknowledge-worker-stopped': { type: 'boolean' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.outcome !== 'verified-sent' && values.outcome !== 'unknown') {
    throw new Error('Use --outcome verified-sent only with evidence of delivery, otherwise --outcome unknown');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set explicitly for operator recovery');
  const result = await resolveStoppedDelivery(prisma, {
    deliveryId: values['delivery-id'] ?? '',
    expectedAttempt: Number(values['expected-attempt']),
    outcome: values.outcome,
    acknowledgeWorkerStopped: values['acknowledge-worker-stopped'] === true,
  }, new Date());
  console.log(`mail: resolved event ${result.eventId}, delivery ${result.deliveryId}, attempt ${result.attempt} as ${result.status}; no email was sent. Rerun retention if it was deferred.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : 'Delivery reconciliation failed');
    await prisma.$disconnect();
    process.exitCode = 1;
  });
