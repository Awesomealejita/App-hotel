// Persistencia en SQLite (node:sqlite). Para producción con varias instancias
// conviene migrar a PostgreSQL manteniendo el bloqueo por emisor (SELECT ... FOR UPDATE).

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export type EstadoRegistroDb =
  | 'pendiente' // en cola para enviar a la AEAT
  | 'correcto'
  | 'aceptado_con_errores'
  | 'incorrecto';

export interface ClienteRow {
  id: number;
  nombre: string;
  webhook_url: string | null;
}

export interface EmisorRow {
  nif: string;
  cliente_id: number;
  nombre_razon: string;
  ultima_huella: string | null;
  ultimo_num_serie: string | null;
  ultima_fecha: string | null;
  siguiente_envio_ms: number;
}

export interface RegistroRow {
  id: number;
  cliente_id: number;
  emisor_nif: string;
  tipo: 'alta' | 'anulacion';
  num_serie: string;
  fecha_expedicion: string; // dd-mm-aaaa
  referencia_externa: string | null;
  datos_json: string;
  huella: string;
  qr_url: string | null;
  estado: EstadoRegistroDb;
  intentos: number;
  codigo_error: string | null;
  descripcion_error: string | null;
  csv: string | null;
  creado_en: string;
  actualizado_en: string;
}

export function abrirDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      api_key_hash TEXT NOT NULL UNIQUE,
      webhook_url TEXT,
      creado_en TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Un emisor (obligado tributario) y el estado de su cadena de registros.
    CREATE TABLE IF NOT EXISTS emisores (
      nif TEXT PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      nombre_razon TEXT NOT NULL,
      ultima_huella TEXT,
      ultimo_num_serie TEXT,
      ultima_fecha TEXT,
      siguiente_envio_ms INTEGER NOT NULL DEFAULT 0
    );

    -- Registros de facturación. Son inalterables una vez creados: solo cambia
    -- el estado de envío. Las correcciones se hacen con nuevos registros.
    CREATE TABLE IF NOT EXISTS registros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      emisor_nif TEXT NOT NULL REFERENCES emisores(nif),
      tipo TEXT NOT NULL CHECK (tipo IN ('alta', 'anulacion')),
      num_serie TEXT NOT NULL,
      fecha_expedicion TEXT NOT NULL,
      referencia_externa TEXT,
      datos_json TEXT NOT NULL,
      huella TEXT NOT NULL,
      qr_url TEXT,
      estado TEXT NOT NULL DEFAULT 'pendiente',
      intentos INTEGER NOT NULL DEFAULT 0,
      codigo_error TEXT,
      descripcion_error TEXT,
      csv TEXT,
      creado_en TEXT NOT NULL DEFAULT (datetime('now')),
      actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_registros_pendientes ON registros (emisor_nif, estado, id);
    CREATE INDEX IF NOT EXISTS idx_registros_factura ON registros (emisor_nif, num_serie, fecha_expedicion);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_registros_ref ON registros (cliente_id, referencia_externa)
      WHERE referencia_externa IS NOT NULL;
  `);
  return db;
}

/** Ejecuta fn en una transacción exclusiva (serializa la cadena de huellas). */
export function transaccion<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
