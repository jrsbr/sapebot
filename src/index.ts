// Inicialização do servidor: webhook + agendador.
import express from 'express';
import { env } from './config';
import { logger } from './logger';
import { webhookRouter } from './webhook';
import { startScheduler } from './scheduler';

function createApp() {
  const app = express();

  // Captura o corpo bruto para validar a assinatura do webhook (X-Hub-Signature-256).
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      },
    }),
  );

  app.get('/health', (_req, res) =>
    res.status(200).json({ status: 'ok', time: new Date().toISOString() }),
  );

  app.use('/', webhookRouter);

  return app;
}

function main() {
  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`Servidor ouvindo na porta ${env.PORT}`);
    startScheduler();
  });
}

main();