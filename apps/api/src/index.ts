import 'dotenv/config';
import { createApp } from './app';

const app = createApp();

app
  .listen({ port: app.testDeps.env.PORT, host: '0.0.0.0' })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
