import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { prisma } from '../db';
import { createApp } from '../app';
import { createDevMailer } from '../mail/dev-mailer';
import { createFakePaymentProvider } from '../payments/fake';
import { hashPin } from '../checkin/pin';
import { e2eBindHost } from './e2e-runtime';
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
  await prisma.memberAssociation.create({ data: {
    name: 'MENA', active: true,
    primaryContactName: 'E2E Association Contact', primaryContactEmail: 'association@example.test',
  } });

  const mainEvent = await prisma.event.create({
    data: { ...eventFixture({
      name: 'E2E 15/U Ladies', status: 'OPEN', eventDate: new Date('2027-09-12T00:00:00Z'),
      courts: 3, nextBibNumber: 70, rank1Min: 2, rank2Min: 1, rank3Min: 1,
      checkInPinHash: await hashPin('482193'),
    }) },
  });
  const [white, black, grey, orange] = await Promise.all(['White', 'Black', 'Grey', 'Orange'].map((name) =>
    prisma.bibColor.findUniqueOrThrow({ where: { name }, select: { id: true } }),
  ));
  await prisma.eventCourtColor.createMany({ data: [
    { eventId: mainEvent.id, court: 1, teamAColorId: white.id, teamBColorId: black.id },
    { eventId: mainEvent.id, court: 2, teamAColorId: grey.id, teamBColorId: orange.id },
    { eventId: mainEvent.id, court: 3, teamAColorId: white.id, teamBColorId: orange.id },
  ] });
  const ticketToken = 'e2e-parent-ticket-token-0123456789abcdef';
  for (let index = 0; index < 70; index++) {
    const isTicketPlayer = index === 69;
    const isWaiting = index === 0;
    const playerFirstName = isTicketPlayer ? 'Ada' : `Player${index + 1}`;
    const playerLastName = isTicketPlayer ? 'Ticket' : 'Trial';
    await prisma.registration.create({
      data: registrationFixture(mainEvent.id, {
        playerFirstName,
        playerLastName,
        playerNameNormalized: `${playerFirstName} ${playerLastName}`.toLowerCase(),
        parentName: `Parent ${index + 1}`,
        parentEmail: isTicketPlayer ? 'PARENT1@example.test' : `parent${index + 1}@example.test`,
        dateOfBirth: new Date('2012-04-02T00:00:00Z'),
        memberAssociation: 'MENA',
        rank1Position: COURT_POSITIONS[index % COURT_POSITIONS.length],
        rank2Position: COURT_POSITIONS[(index + 2) % COURT_POSITIONS.length],
        rank3Position: COURT_POSITIONS[(index + 4) % COURT_POSITIONS.length],
        optInExtraPositions: false,
        status: 'PAID',
        ageFlagged: index < 2,
        qrToken: isTicketPlayer ? ticketToken : `e2e-main-token-${index}-abcdefghijklmnopqrstuvwxyz`,
        checkedInAt: isWaiting ? null : new Date(),
        checkedInBy: isWaiting ? null : 'E2E volunteer',
        bibNumber: isWaiting ? null : index,
      }),
    });
  }

  const adminEmail = `e2e-admin-${++adminSequence}@example.test`;
  await prisma.staffUser.create({ data: { email: adminEmail } });
  fixtures = { mainEventId: mainEvent.id, ticketToken, adminEmail };
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
const bindHost = e2eBindHost();
await app.listen({ port: Number(process.env.PORT ?? 3000), host: bindHost });
await new Promise<void>((resolve) => control.listen(Number(process.env.E2E_CONTROL_PORT ?? 3001), bindHost, resolve));

async function close(): Promise<void> {
  await new Promise<void>((resolve, reject) => control.close((error) => error ? reject(error) : resolve()));
  await app.close();
  await prisma.$disconnect();
}

process.on('SIGTERM', () => { void close().finally(() => process.exit(0)); });
process.on('SIGINT', () => { void close().finally(() => process.exit(0)); });
