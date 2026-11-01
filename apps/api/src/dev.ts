import 'dotenv/config';

process.env.NODE_ENV ??= 'development';
process.env.APP_ENV ??= 'testing';
process.env.PAYMENT_PROVIDER ??= 'fake';

await import('./index');
