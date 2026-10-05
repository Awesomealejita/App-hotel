import { loadConfig } from './config.js';
import { abrirDb } from './db.js';
import { crearServidor } from './api/servidor.js';
import { ClienteAeat, transporteHttps } from './aeat/cliente.js';
import { ServicioEnvios } from './services/envios.js';

const cfg = loadConfig();
const db = abrirDb(cfg.dbPath);
const app = crearServidor(db, cfg, { logger: true });

let pararWorker: (() => void) | undefined;
if (cfg.envioActivo) {
  if (!cfg.certPath) throw new Error('AEAT_ENVIO_ACTIVO=true requiere AEAT_CERT_PATH');
  const aeat = new ClienteAeat(cfg.soapUrl, transporteHttps(cfg.certPath, cfg.certPassword));
  pararWorker = new ServicioEnvios(db, cfg, aeat).iniciar(cfg.intervaloWorkerMs, (msg, extra) =>
    app.log.info({ extra }, msg),
  );
  app.log.info(`Worker de envíos activo contra ${cfg.soapUrl}`);
} else {
  app.log.warn('AEAT_ENVIO_ACTIVO=false: los registros se generan pero no se envían a la AEAT');
}

await app.listen({ port: cfg.port, host: '0.0.0.0' });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    pararWorker?.();
    await app.close();
    db.close();
    process.exit(0);
  });
}
