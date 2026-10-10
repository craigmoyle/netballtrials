import { prisma } from '../db';
import { createDevMailer } from '../mail/dev-mailer';
import { sendDueReminders } from '../messages/reminders';

async function main(): Promise<void> {
  // No production mail provider exists yet, so this mirrors createApp's default.
  const mailer = createDevMailer([]);
  const result = await sendDueReminders({ prisma, mailer }, new Date());
  console.log(
    `reminders: ${result.sent} sent, ${result.failed} failed, ${result.events} events due`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
