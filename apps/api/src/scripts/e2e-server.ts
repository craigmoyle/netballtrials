import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { prisma } from '../db';
import { createApp } from '../app';
import { createDevMailer } from '../mail/dev-mailer';
import { createFakePaymentProvider } from '../payments/fake';
import { hashPin } from '../checkin/pin';
import { COURT_POSITIONS } from '../planner/types';
import { eventFixture, registrationFixture } from '../tests/helpers/fixtures';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL?.endsWith('_test')) {
  throw new Error('E2E server requires NODE_ENV=test and a DATABASE_URL ending in _test');
}
execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: process.cwd(), env: process.env, stdio: 'inherit' });

const mailer = createDevMailer([]);
const payment = createFakePaymentProvider();
const app = createApp({ mailer, payment });
let fixtures: Record<string, string> = {};
let adminSequence = 0;

async function resetFixtures(): Promise<Record<string, string>> {
  await prisma.event.deleteMany();
  await prisma.memberAssociation.deleteMany();
  await prisma.processedStripeEvent.deleteMany();
  await prisma.requestRateLimitBucket.deleteMany();
  await prisma.staffUser.deleteMany();
  mailer.sent.splice(0);
  payment.checkouts.splice(0);
  await prisma.memberAssociation.create({ data: { name: 'MENA', active: true } });

  const mainEvent = await prisma.event.create({
    data: { ...eventFixture({
      name: 'E2E 15/U Ladies', status: 'OPEN', eventDate: new Date('2027-09-12T00:00:00Z'),
      courts: 2, rank1Min: 1, rank2Min: 0, rank3Min: 0,
    }) },
  });
  for (let index = 0; index < 28; index++) {
    const parentEmail = index === 27 ? 'PARENT1@example.test' : `parent${index + 1}@example.test`;
    await prisma.registration.create({
      data: registrationFixture(mainEvent.id, {
        playerFirstName: `Player${index + 1}`,
        playerLastName: 'Trial',
        playerNameNormalized: `player${index + 1} trial`,
        parentName: `Parent ${index + 1}`,
        parentEmail,
        dateOfBirth: new Date('2012-04-02T00:00:00Z'),
        memberAssociation: 'MENA',
        rank1Position: COURT_POSITIONS[index % COURT_POSITIONS.length],
        optInExtraPositions: true,
        status: 'PAID',
        ageFlagged: index < 2,
        qrToken: `e2e-main-token-${index}-abcdefghijklmnopqrstuvwxyz`,
        checkedInAt: new Date(),
        checkedInBy: 'E2E volunteer',
        bibNumber: index + 1,
      }),
    });
  }
  const ticketToken = 'e2e-parent-ticket-token-0123456789abcdef';
  await prisma.registration.create({
    data: registrationFixture(mainEvent.id, {
      playerFirstName: 'Ada', playerLastName: 'Ticket', playerNameNormalized: 'ada ticket',
      parentName: 'Parent 1', parentEmail: 'parent1@example.test', memberAssociation: 'MENA',
      status: 'PAID', qrToken: ticketToken, checkedInAt: null, checkedInBy: null, bibNumber: null,
    }),
  });

  const checkInEvent = await prisma.event.create({
    data: { ...eventFixture({
      name: 'E2E Check-in', status: 'OPEN', eventDate: new Date('2027-09-19T00:00:00Z'),
      courts: 1, rank1Min: 0, rank2Min: 0, rank3Min: 0, checkInPinHash: await hashPin('4821'),
    }) },
  });
  for (let index = 0; index < 14; index++) {
    await prisma.registration.create({
      data: registrationFixture(checkInEvent.id, {
        playerFirstName: `Checkin${index + 1}`, playerLastName: 'Trial', playerNameNormalized: `checkin${index + 1} trial`,
        parentEmail: `checkin${index + 1}@example.test`, memberAssociation: 'MENA', rank1Position: 'GS',
        status: 'PAID', ageFlagged: index === 0, qrToken: `e2e-checkin-token-${index}-abcdefghijklmnopqrstuvwxyz`,
      }),
    });
  }

  const draftEvent = await prisma.event.create({
    data: { ...eventFixture({ name: 'E2E Draft event', status: 'DRAFT', eventDate: new Date('2027-10-01T00:00:00Z'), courts: 1 }) },
  });
  const adminEmail = `e2e-admin-${++adminSequence}@example.test`;
  await prisma.staffUser.create({ data: { email: adminEmail } });
  fixtures = { mainEventId: mainEvent.id, checkInEventId: checkInEvent.id, draftEventId: draftEvent.id, ticketToken, adminEmail };
  return fixtures;
}

const control = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:3001');
  response.setHeader('content-type', 'application/json');
  if (request.method === 'GET' && url.pathname === '/__test/ready') {
    response.end(JSON.stringify({ status: 'ready' }));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/__test/reset') {
    try {
      response.end(JSON.stringify(await resetFixtures()));
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'reset_failed' }));
    }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/__test/outbox') {
    const to = url.searchParams.get('to')?.toLowerCase();
    response.end(JSON.stringify({ messages: mailer.sent.filter((message) => !to || message.to.toLowerCase() === to) }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: 'not_found' }));
});

await resetFixtures();
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '127.0.0.1' });
await new Promise<void>((resolve) => control.listen(Number(process.env.E2E_CONTROL_PORT ?? 3001), '127.0.0.1', resolve));

async function close(): Promise<void> {
  await new Promise<void>((resolve, reject) => control.close((error) => error ? reject(error) : resolve()));
  await app.close();
  await prisma.$disconnect();
}

process.on('SIGTERM', () => { void close().finally(() => process.exit(0)); });
process.on('SIGINT', () => { void close().finally(() => process.exit(0)); });
