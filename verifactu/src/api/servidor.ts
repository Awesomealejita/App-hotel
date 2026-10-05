// API REST (JSON) que consume el sistema de facturación del cliente.

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import type { Config } from '../config.js';
import type { ClienteRow, Db } from '../db.js';
import { facturaAltaSchema, facturaAnulacionSchema } from '../domain/factura.js';
import { LEYENDA_VERIFACTU, qrDataUrl, qrPng } from '../domain/qr.js';
import { clientePorApiKey, crearCliente, crearEmisor, ErrorNegocio, listarEmisores } from '../services/clientes.js';
import { registroPublico } from '../services/envios.js';
import { listarRegistros, obtenerRegistro, registrarAlta, registrarAnulacion } from '../services/registros.js';

declare module 'fastify' {
  interface FastifyRequest {
    cliente: ClienteRow;
  }
}

export function crearServidor(db: Db, cfg: Config, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'Datos no válidos', detalles: err.issues });
    }
    if (err instanceof ErrorNegocio) return reply.status(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({ error: status >= 500 ? 'Error interno' : (err as Error).message });
  });

  app.get('/health', async () => ({ ok: true, entorno: cfg.entorno, envioActivo: cfg.envioActivo }));

  // --- Administración (alta de clientes de la API) ---
  app.post('/admin/clientes', async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${cfg.adminToken}`) {
      return reply.status(401).send({ error: 'No autorizado' });
    }
    const body = z
      .object({ nombre: z.string().min(1), webhookUrl: z.string().url().optional() })
      .parse(req.body);
    const { cliente, apiKey } = crearCliente(db, body.nombre, body.webhookUrl);
    // La API key solo se muestra una vez.
    return reply.status(201).send({ ...cliente, apiKey });
  });

  // --- API para clientes (cabecera x-api-key) ---
  app.register(async (v1) => {
    v1.addHook('onRequest', async (req: FastifyRequest, reply) => {
      const key = req.headers['x-api-key'];
      const cliente = typeof key === 'string' ? clientePorApiKey(db, key) : undefined;
      if (!cliente) return reply.status(401).send({ error: 'API key no válida' });
      req.cliente = cliente;
    });

    v1.post('/emisores', async (req, reply) => {
      const body = z
        .object({ nif: z.string().trim().length(9).toUpperCase(), nombreRazon: z.string().trim().min(1).max(120) })
        .parse(req.body);
      return reply.status(201).send(crearEmisor(db, req.cliente.id, body.nif, body.nombreRazon));
    });

    v1.get('/emisores', async (req) => listarEmisores(db, req.cliente.id));

    v1.post('/facturas', async (req, reply) => {
      const f = facturaAltaSchema.parse(req.body);
      const { registro, duplicado } = registrarAlta(db, cfg, req.cliente.id, f);
      return reply.status(duplicado ? 200 : 202).send({
        ...registroPublico(registro),
        duplicado,
        qr: { url: registro.qr_url, png: await qrDataUrl(registro.qr_url!), leyenda: 'VERI*FACTU' },
        leyenda: LEYENDA_VERIFACTU,
      });
    });

    v1.post('/facturas/anulaciones', async (req, reply) => {
      const f = facturaAnulacionSchema.parse(req.body);
      return reply.status(202).send(registroPublico(registrarAnulacion(db, req.cliente.id, f)));
    });

    v1.get('/facturas', async (req) => {
      const q = z
        .object({
          emisorNif: z.string().optional(),
          estado: z.enum(['pendiente', 'correcto', 'aceptado_con_errores', 'incorrecto']).optional(),
          limite: z.coerce.number().int().positive().optional(),
        })
        .parse(req.query);
      return listarRegistros(db, req.cliente.id, q).map(registroPublico);
    });

    v1.get('/facturas/:id', async (req) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
      return registroPublico(obtenerRegistro(db, req.cliente.id, id));
    });

    v1.get('/facturas/:id/qr.png', async (req, reply) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
      const r = obtenerRegistro(db, req.cliente.id, id);
      if (!r.qr_url) throw new ErrorNegocio(404, 'Este registro no tiene QR');
      return reply.type('image/png').send(await qrPng(r.qr_url));
    });
  }, { prefix: '/v1' });

  return app;
}
