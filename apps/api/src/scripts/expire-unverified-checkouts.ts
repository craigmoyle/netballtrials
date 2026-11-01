import 'dotenv/config';
import { prisma } from '../db';
import { createApp } from '../app';
import { expireUnverifiedPendingCheckouts } from '../registrations/checkout';

async function main(): Promise<void> {
  const app = createApp();
  try {
    if (app.testDeps.env.APP_ENV !== 'production' || app.testDeps.env.NODE_ENV !== 'production' || app.testDeps.env.PAYMENT_PROVIDER !== 'stripe') {
      throw new Error('Checkout cutover requires APP_ENV=production, NODE_ENV=production and PAYMENT_PROVIDER=stripe');
    }
    if (app.testDeps.integrationSettings?.mode === 'infisical') await app.testDeps.reloadIntegrations?.();
    if ('checkouts' in app.testDeps.payment) throw new Error('Stripe credentials are not configured');
    const result = await expireUnverifiedPendingCheckouts(prisma, app.testDeps.payment);
    console.log(`checkout cutover: found ${result.found}; marked expired ${result.markedExpired}; unresolved ${result.unresolved.length}`);
    if (result.unresolved.length > 0) {
      console.error(`checkout cutover: reconcile these registration IDs before starting the new API: ${result.unresolved.join(', ')}`);
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Checkout cutover failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
