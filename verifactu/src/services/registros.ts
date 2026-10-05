// Generación de registros de alta y anulación con su encadenamiento.

import type { Config } from '../config.js';
import { transaccion, type Db, type EmisorRow, type RegistroRow } from '../db.js';
import type { RegistroAltaData, RegistroAnteriorRef, RegistroAnulacionData } from '../aeat/xml.js';
import { calcularTotales, type FacturaAltaInput, type FacturaAnulacionInput } from '../domain/factura.js';
import { fechaAeat, fechaHoraHuso } from '../domain/formato.js';
import { huellaAlta, huellaAnulacion } from '../domain/huella.js';
import { urlQr } from '../domain/qr.js';
import { emisorDeCliente, ErrorNegocio } from './clientes.js';

function registroAnterior(e: EmisorRow): RegistroAnteriorRef | undefined {
  if (!e.ultima_huella) return undefined;
  return {
    idEmisorFactura: e.nif,
    numSerieFactura: e.ultimo_num_serie!,
    fechaExpedicionFactura: e.ultima_fecha!,
    huella: e.ultima_huella,
  };
}

function registroPorReferencia(db: Db, clienteId: number, ref?: string): RegistroRow | undefined {
  if (!ref) return undefined;
  return db
    .prepare('SELECT * FROM registros WHERE cliente_id = ? AND referencia_externa = ?')
    .get(clienteId, ref) as unknown as RegistroRow | undefined;
}

function ultimoRegistroFactura(db: Db, nif: string, numSerie: string, fecha: string): RegistroRow | undefined {
  return db
    .prepare(
      `SELECT * FROM registros WHERE emisor_nif = ? AND num_serie = ? AND fecha_expedicion = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(nif, numSerie, fecha) as unknown as RegistroRow | undefined;
}

/** Inserta el registro y avanza la cadena del emisor en la misma transacción. */
function insertarEncadenado(
  db: Db,
  clienteId: number,
  emisorNif: string,
  construir: (anterior: RegistroAnteriorRef | undefined, fechaHora: string) => {
    datos: RegistroAltaData | RegistroAnulacionData;
    numSerie: string;
    fecha: string;
    qrUrl: string | null;
    referenciaExterna?: string;
  },
): RegistroRow {
  return transaccion(db, () => {
    // Releer el emisor dentro de la transacción: es la única fuente de verdad de la cadena.
    const emisor = db.prepare('SELECT * FROM emisores WHERE nif = ?').get(emisorNif) as unknown as EmisorRow;
    const r = construir(registroAnterior(emisor), fechaHoraHuso());
    const ins = db
      .prepare(
        `INSERT INTO registros (cliente_id, emisor_nif, tipo, num_serie, fecha_expedicion, referencia_externa,
                                datos_json, huella, qr_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        clienteId,
        emisorNif,
        r.datos.tipo,
        r.numSerie,
        r.fecha,
        r.referenciaExterna ?? null,
        JSON.stringify(r.datos),
        r.datos.huella,
        r.qrUrl,
      );
    db.prepare('UPDATE emisores SET ultima_huella = ?, ultimo_num_serie = ?, ultima_fecha = ? WHERE nif = ?').run(
      r.datos.huella,
      r.numSerie,
      r.fecha,
      emisorNif,
    );
    return db.prepare('SELECT * FROM registros WHERE id = ?').get(ins.lastInsertRowid) as unknown as RegistroRow;
  });
}

export function registrarAlta(
  db: Db,
  cfg: Config,
  clienteId: number,
  f: FacturaAltaInput,
): { registro: RegistroRow; duplicado: boolean } {
  const previo = registroPorReferencia(db, clienteId, f.referenciaExterna);
  if (previo) return { registro: previo, duplicado: true };

  const emisor = emisorDeCliente(db, clienteId, f.emisorNif);
  const fecha = fechaAeat(f.fechaExpedicion);

  const ultimo = ultimoRegistroFactura(db, emisor.nif, f.numSerie, fecha);
  if (ultimo && ultimo.tipo === 'alta' && ultimo.estado !== 'incorrecto') {
    throw new ErrorNegocio(409, `La factura ${f.numSerie} ya tiene un registro de alta (id ${ultimo.id})`);
  }
  // Si hubo un alta rechazada por la AEAT, el nuevo registro se marca como RechazoPrevio.
  const rechazoPrevio = ultimo?.tipo === 'alta' && ultimo.estado === 'incorrecto';

  const totales = calcularTotales(f);

  return {
    duplicado: false,
    registro: insertarEncadenado(db, clienteId, emisor.nif, (anterior, fechaHora) => {
      const base = {
        tipo: 'alta' as const,
        idEmisorFactura: emisor.nif,
        numSerieFactura: f.numSerie,
        fechaExpedicionFactura: fecha,
        nombreRazonEmisor: emisor.nombre_razon,
        rechazoPrevio: rechazoPrevio || undefined,
        tipoFactura: f.tipoFactura,
        tipoRectificativa: f.tipoRectificativa,
        facturasRectificadas: f.facturasRectificadas?.map((r) => ({
          idEmisorFactura: r.emisorNif,
          numSerieFactura: r.numSerie,
          fechaExpedicionFactura: fechaAeat(r.fechaExpedicion),
        })),
        descripcionOperacion: f.descripcion,
        destinatarios: f.destinatarios,
        desglose: totales.desglose,
        cuotaTotal: totales.cuotaTotal,
        importeTotal: totales.importeTotal,
        registroAnterior: anterior,
        fechaHoraHusoGenRegistro: fechaHora,
      };
      const huella = huellaAlta({
        idEmisorFactura: base.idEmisorFactura,
        numSerieFactura: base.numSerieFactura,
        fechaExpedicionFactura: base.fechaExpedicionFactura,
        tipoFactura: base.tipoFactura,
        cuotaTotal: base.cuotaTotal,
        importeTotal: base.importeTotal,
        huellaAnterior: anterior?.huella ?? '',
        fechaHoraHusoGenRegistro: fechaHora,
      });
      return {
        datos: { ...base, huella },
        numSerie: f.numSerie,
        fecha,
        referenciaExterna: f.referenciaExterna,
        qrUrl: urlQr(cfg.qrUrl, { nif: emisor.nif, numSerie: f.numSerie, fecha, importe: totales.importeTotal }),
      };
    }),
  };
}

export function registrarAnulacion(db: Db, clienteId: number, f: FacturaAnulacionInput): RegistroRow {
  const emisor = emisorDeCliente(db, clienteId, f.emisorNif);
  const fecha = fechaAeat(f.fechaExpedicion);

  const ultimo = ultimoRegistroFactura(db, emisor.nif, f.numSerie, fecha);
  if (!ultimo || ultimo.tipo !== 'alta') {
    throw new ErrorNegocio(404, `No hay un alta vigente de la factura ${f.numSerie} que anular`);
  }

  return insertarEncadenado(db, clienteId, emisor.nif, (anterior, fechaHora) => {
    const huella = huellaAnulacion({
      idEmisorFacturaAnulada: emisor.nif,
      numSerieFacturaAnulada: f.numSerie,
      fechaExpedicionFacturaAnulada: fecha,
      huellaAnterior: anterior?.huella ?? '',
      fechaHoraHusoGenRegistro: fechaHora,
    });
    return {
      datos: {
        tipo: 'anulacion',
        idEmisorFacturaAnulada: emisor.nif,
        numSerieFacturaAnulada: f.numSerie,
        fechaExpedicionFacturaAnulada: fecha,
        registroAnterior: anterior,
        fechaHoraHusoGenRegistro: fechaHora,
        huella,
      },
      numSerie: f.numSerie,
      fecha,
      qrUrl: null,
    };
  });
}

export function obtenerRegistro(db: Db, clienteId: number, id: number): RegistroRow {
  const r = db.prepare('SELECT * FROM registros WHERE id = ? AND cliente_id = ?').get(id, clienteId) as unknown as
    | RegistroRow
    | undefined;
  if (!r) throw new ErrorNegocio(404, 'Registro no encontrado');
  return r;
}

export function listarRegistros(
  db: Db,
  clienteId: number,
  filtros: { emisorNif?: string; estado?: string; limite?: number },
): RegistroRow[] {
  return db
    .prepare(
      `SELECT * FROM registros WHERE cliente_id = ?1
         AND (?2 IS NULL OR emisor_nif = ?2) AND (?3 IS NULL OR estado = ?3)
       ORDER BY id DESC LIMIT ?4`,
    )
    .all(clienteId, filtros.emisorNif ?? null, filtros.estado ?? null, Math.min(filtros.limite ?? 50, 500)) as unknown as RegistroRow[];
}
