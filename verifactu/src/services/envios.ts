// Worker que envía a la AEAT los registros pendientes, agrupados por emisor.
//
// Reglas de la AEAT que se respetan aquí:
//  - Máximo 1000 registros por envío.
//  - Tras cada envío hay que esperar TiempoEsperaEnvio segundos (o juntar 1000
//    registros) antes del siguiente envío del mismo obligado.
//  - Los registros se envían en el orden en que se generaron (encadenamiento).
//  - Un registro ya generado nunca se modifica: si falla la conexión se reenvía
//    tal cual; si la AEAT lo rechaza, se corrige con un registro nuevo.

import type { Config } from '../config.js';
import type { Db, EmisorRow, EstadoRegistroDb, RegistroRow } from '../db.js';
import { ClienteAeat, FaultSoap, type RespuestaEnvio } from '../aeat/cliente.js';
import { sobreSoap, type RegistroData } from '../aeat/xml.js';
import { clientePorId } from './clientes.js';

const MAX_REGISTROS = 1000;
const ESPERA_ERROR_RED_MS = 60_000;

const ESTADOS: Record<string, EstadoRegistroDb> = {
  Correcto: 'correcto',
  AceptadoConErrores: 'aceptado_con_errores',
  Incorrecto: 'incorrecto',
};

export interface ResultadoCiclo {
  emisor: string;
  enviados: number;
  estadoEnvio?: string;
  error?: string;
}

export type Notificador = (clienteId: number, registros: RegistroRow[]) => void;

export class ServicioEnvios {
  constructor(
    private readonly db: Db,
    private readonly cfg: Config,
    private readonly aeat: ClienteAeat,
    private readonly notificar: Notificador = notificarWebhook(db),
    private readonly ahora: () => number = Date.now,
  ) {}

  /** Un ciclo: procesa cada emisor que tenga pendientes y cuya espera haya vencido. */
  async ciclo(): Promise<ResultadoCiclo[]> {
    const emisores = this.db
      .prepare(
        `SELECT e.* FROM emisores e
         WHERE EXISTS (SELECT 1 FROM registros r WHERE r.emisor_nif = e.nif AND r.estado = 'pendiente')`,
      )
      .all() as unknown as EmisorRow[];

    const resultados: ResultadoCiclo[] = [];
    for (const e of emisores) {
      const pendientes = this.pendientes(e.nif);
      const esperaVencida = this.ahora() >= e.siguiente_envio_ms;
      if (!esperaVencida && pendientes.length < MAX_REGISTROS) continue;
      resultados.push(await this.enviarEmisor(e, pendientes));
    }
    return resultados;
  }

  private pendientes(nif: string): RegistroRow[] {
    return this.db
      .prepare(`SELECT * FROM registros WHERE emisor_nif = ? AND estado = 'pendiente' ORDER BY id LIMIT ?`)
      .all(nif, MAX_REGISTROS) as unknown as RegistroRow[];
  }

  private async enviarEmisor(e: EmisorRow, registros: RegistroRow[]): Promise<ResultadoCiclo> {
    const datos = registros.map((r) => JSON.parse(r.datos_json) as RegistroData);
    const sobre = sobreSoap(
      { obligado: { nombreRazon: e.nombre_razon, nif: e.nif } },
      datos,
      this.cfg.sistemaInformatico,
    );

    let resp: RespuestaEnvio;
    try {
      resp = await this.aeat.enviar(sobre);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof FaultSoap) {
        // SOAP Fault: la AEAT rechaza el envío entero (p.ej. error de esquema).
        this.actualizar(registros, () => ({ estado: 'incorrecto', codigo: err.codigo, descripcion: msg }));
        this.programarSiguiente(e.nif, ESPERA_ERROR_RED_MS);
        this.notificar(e.cliente_id, this.recargar(registros));
        return { emisor: e.nif, enviados: registros.length, estadoEnvio: 'Fault', error: msg };
      }
      // Error de red/transporte: se queda pendiente y se reintenta más tarde.
      this.db
        .prepare(`UPDATE registros SET intentos = intentos + 1, descripcion_error = ? WHERE emisor_nif = ? AND estado = 'pendiente'`)
        .run(msg, e.nif);
      this.programarSiguiente(e.nif, ESPERA_ERROR_RED_MS);
      return { emisor: e.nif, enviados: 0, error: msg };
    }

    const porClave = new Map(resp.lineas.map((l) => [`${l.tipoOperacion}|${l.numSerieFactura}|${l.fechaExpedicionFactura}`, l]));
    this.actualizar(registros, (r) => {
      const linea = porClave.get(`${r.tipo === 'alta' ? 'Alta' : 'Anulacion'}|${r.num_serie}|${r.fecha_expedicion}`);
      if (!linea) {
        return resp.estadoEnvio === 'Correcto'
          ? { estado: 'correcto', csv: resp.csv }
          : { estado: 'incorrecto', descripcion: 'Sin respuesta de línea de la AEAT', csv: resp.csv };
      }
      return {
        estado: ESTADOS[linea.estadoRegistro] ?? 'incorrecto',
        codigo: linea.codigoError,
        descripcion: linea.descripcionError,
        csv: resp.csv,
      };
    });
    this.programarSiguiente(e.nif, resp.tiempoEsperaEnvio * 1000);
    this.notificar(e.cliente_id, this.recargar(registros));
    return { emisor: e.nif, enviados: registros.length, estadoEnvio: resp.estadoEnvio };
  }

  private actualizar(
    registros: RegistroRow[],
    fn: (r: RegistroRow) => { estado: EstadoRegistroDb; codigo?: string; descripcion?: string; csv?: string },
  ) {
    const stmt = this.db.prepare(
      `UPDATE registros SET estado = ?, codigo_error = ?, descripcion_error = ?, csv = ?,
              intentos = intentos + 1, actualizado_en = datetime('now') WHERE id = ?`,
    );
    for (const r of registros) {
      const u = fn(r);
      stmt.run(u.estado, u.codigo ?? null, u.descripcion ?? null, u.csv ?? null, r.id);
    }
  }

  private programarSiguiente(nif: string, esperaMs: number) {
    this.db.prepare('UPDATE emisores SET siguiente_envio_ms = ? WHERE nif = ?').run(this.ahora() + esperaMs, nif);
  }

  private recargar(registros: RegistroRow[]): RegistroRow[] {
    const stmt = this.db.prepare('SELECT * FROM registros WHERE id = ?');
    return registros.map((r) => stmt.get(r.id) as unknown as RegistroRow);
  }

  /** Arranca el bucle del worker. Devuelve una función para pararlo. */
  iniciar(intervaloMs: number, log: (msg: string, extra?: unknown) => void): () => void {
    let parado = false;
    let timer: NodeJS.Timeout;
    const tick = async () => {
      try {
        const res = await this.ciclo();
        if (res.length) log('Ciclo de envío a la AEAT', res);
      } catch (err) {
        log('Error en el worker de envíos', err);
      }
      if (!parado) timer = setTimeout(tick, intervaloMs);
    };
    timer = setTimeout(tick, intervaloMs);
    return () => {
      parado = true;
      clearTimeout(timer);
    };
  }
}

/** Avisa al sistema del cliente (si configuró webhook) del resultado de sus registros. */
export function notificarWebhook(db: Db): Notificador {
  return (clienteId, registros) => {
    const cliente = clientePorId(db, clienteId);
    if (!cliente?.webhook_url) return;
    fetch(cliente.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evento: 'registros.actualizados', registros: registros.map(registroPublico) }),
    }).catch(() => {
      /* TODO: reintentos de webhook con cola persistente */
    });
  };
}

/** Representación pública (API) de un registro. */
export function registroPublico(r: RegistroRow) {
  return {
    id: r.id,
    tipo: r.tipo,
    emisorNif: r.emisor_nif,
    numSerie: r.num_serie,
    fechaExpedicion: r.fecha_expedicion,
    referenciaExterna: r.referencia_externa,
    estado: r.estado,
    huella: r.huella,
    qrUrl: r.qr_url,
    csv: r.csv,
    error: r.codigo_error || r.descripcion_error ? { codigo: r.codigo_error, descripcion: r.descripcion_error } : null,
    intentos: r.intentos,
    creadoEn: r.creado_en,
    actualizadoEn: r.actualizado_en,
  };
}
