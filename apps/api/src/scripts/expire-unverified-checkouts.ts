import 'dotenv/config';
import { prisma } from '../db';
import { loadEnv } from '../env';
import { createStripePaymentProvider } from '../payments/stripe';
import { expireUnverifiedPendingCheckouts } from '../registrations/checkout';

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV !== 'production' || env.PAYMENT_PROVIDER !== 'stripe') {
    throw new Error('Checkout cutover requires NODE_ENV=production and PAYMENT_PROVIDER=stripe');
  }
  const payment = createStripePaymentProvider({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET });
  const result = await expireUnverifiedPendingCheckouts(prisma, payment);
  console.log(`checkout cutover: found ${result.found}; marked expired ${result.markedExpired}; unresolved ${result.unresolved.length}`);
  if (result.unresolved.length > 0) {
    console.error(`checkout cutover: reconcile these registration IDs before starting the new API: ${result.unresolved.join(', ')}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Checkout cutover failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
