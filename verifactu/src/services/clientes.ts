// Clientes de la API (cada uno con su API key) y sus emisores.

import { createHash, randomBytes } from 'node:crypto';
import type { ClienteRow, Db, EmisorRow } from '../db.js';

const hashKey = (k: string) => createHash('sha256').update(k).digest('hex');

export function crearCliente(db: Db, nombre: string, webhookUrl?: string): { cliente: ClienteRow; apiKey: string } {
  const apiKey = `vf_${randomBytes(24).toString('base64url')}`;
  const r = db
    .prepare('INSERT INTO clientes (nombre, api_key_hash, webhook_url) VALUES (?, ?, ?)')
    .run(nombre, hashKey(apiKey), webhookUrl ?? null);
  const cliente = db
    .prepare('SELECT id, nombre, webhook_url FROM clientes WHERE id = ?')
    .get(r.lastInsertRowid) as unknown as ClienteRow;
  return { cliente, apiKey };
}

export function clientePorApiKey(db: Db, apiKey: string): ClienteRow | undefined {
  return db
    .prepare('SELECT id, nombre, webhook_url FROM clientes WHERE api_key_hash = ?')
    .get(hashKey(apiKey)) as unknown as ClienteRow | undefined;
}

export function clientePorId(db: Db, id: number): ClienteRow | undefined {
  return db.prepare('SELECT id, nombre, webhook_url FROM clientes WHERE id = ?').get(id) as unknown as
    | ClienteRow
    | undefined;
}

export class ErrorNegocio extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function crearEmisor(db: Db, clienteId: number, nif: string, nombreRazon: string): EmisorRow {
  const existente = db.prepare('SELECT * FROM emisores WHERE nif = ?').get(nif) as unknown as EmisorRow | undefined;
  if (existente) {
    if (existente.cliente_id !== clienteId) throw new ErrorNegocio(409, 'El NIF ya está dado de alta por otro cliente');
    return existente;
  }
  db.prepare('INSERT INTO emisores (nif, cliente_id, nombre_razon) VALUES (?, ?, ?)').run(nif, clienteId, nombreRazon);
  return db.prepare('SELECT * FROM emisores WHERE nif = ?').get(nif) as unknown as EmisorRow;
}

export function emisorDeCliente(db: Db, clienteId: number, nif: string): EmisorRow {
  const e = db.prepare('SELECT * FROM emisores WHERE nif = ? AND cliente_id = ?').get(nif, clienteId) as unknown as
    | EmisorRow
    | undefined;
  if (!e) throw new ErrorNegocio(404, `Emisor ${nif} no dado de alta para este cliente`);
  return e;
}

export function listarEmisores(db: Db, clienteId: number): EmisorRow[] {
  return db.prepare('SELECT * FROM emisores WHERE cliente_id = ? ORDER BY nif').all(clienteId) as unknown as EmisorRow[];
}
