// Cliente SOAP contra los servicios web VERI*FACTU de la AEAT.
// La autenticación es por certificado electrónico (TLS mutuo) en formato PKCS#12.

import { readFileSync } from 'node:fs';
import https from 'node:https';
import { XMLParser } from 'fast-xml-parser';

export type EstadoEnvio = 'Correcto' | 'ParcialmenteCorrecto' | 'Incorrecto';
export type EstadoRegistro = 'Correcto' | 'AceptadoConErrores' | 'Incorrecto';

export interface RespuestaLinea {
  numSerieFactura: string;
  fechaExpedicionFactura: string;
  tipoOperacion: string; // Alta | Anulacion
  estadoRegistro: EstadoRegistro;
  codigoError?: string;
  descripcionError?: string;
}

export interface RespuestaEnvio {
  csv?: string;
  estadoEnvio: EstadoEnvio;
  /** Segundos que hay que esperar antes del siguiente envío. */
  tiempoEsperaEnvio: number;
  lineas: RespuestaLinea[];
  xml: string;
}

export class ErrorSoap extends Error {
  constructor(
    message: string,
    readonly codigo?: string,
    readonly xml?: string,
  ) {
    super(message);
  }
}

/** SOAP Fault: la AEAT ha rechazado el envío completo (no se debe reintentar igual). */
export class FaultSoap extends ErrorSoap {}

export interface Transporte {
  post(url: string, body: string): Promise<{ status: number; body: string }>;
}

/** Transporte HTTPS con certificado cliente. */
export function transporteHttps(certPath: string, certPassword?: string): Transporte {
  const agent = new https.Agent({
    pfx: readFileSync(certPath),
    passphrase: certPassword,
    keepAlive: true,
  });
  return {
    post(url, body) {
      return new Promise((resolve, reject) => {
        const req = https.request(
          url,
          {
            method: 'POST',
            agent,
            headers: {
              'Content-Type': 'text/xml; charset=utf-8',
              'Content-Length': Buffer.byteLength(body),
              SOAPAction: '',
            },
            timeout: 60_000,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
          },
        );
        req.on('timeout', () => req.destroy(new Error('Timeout en la conexión con la AEAT')));
        req.on('error', reject);
        req.end(body);
      });
    },
  };
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name) => name === 'RespuestaLinea',
});

export function parsearRespuesta(xml: string): RespuestaEnvio {
  const doc = parser.parse(xml);
  const body = doc?.Envelope?.Body;
  if (!body) throw new ErrorSoap('Respuesta SOAP sin Body', undefined, xml);
  if (body.Fault) {
    throw new FaultSoap(String(body.Fault.faultstring ?? 'SOAP Fault'), String(body.Fault.faultcode ?? ''), xml);
  }
  const r = body.RespuestaRegFactuSistemaFacturacion;
  if (!r) throw new ErrorSoap('Respuesta inesperada de la AEAT', undefined, xml);

  const lineas: RespuestaLinea[] = (r.RespuestaLinea ?? []).map((l: any) => ({
    numSerieFactura: String(l.IDFactura?.NumSerieFactura ?? l.IDFactura?.NumSerieFacturaAnulada ?? ''),
    fechaExpedicionFactura: String(
      l.IDFactura?.FechaExpedicionFactura ?? l.IDFactura?.FechaExpedicionFacturaAnulada ?? '',
    ),
    tipoOperacion: String(l.Operacion?.TipoOperacion ?? ''),
    estadoRegistro: String(l.EstadoRegistro) as EstadoRegistro,
    codigoError: l.CodigoErrorRegistro !== undefined ? String(l.CodigoErrorRegistro) : undefined,
    descripcionError: l.DescripcionErrorRegistro !== undefined ? String(l.DescripcionErrorRegistro) : undefined,
  }));

  return {
    csv: r.CSV !== undefined ? String(r.CSV) : undefined,
    estadoEnvio: String(r.EstadoEnvio) as EstadoEnvio,
    tiempoEsperaEnvio: Number(r.TiempoEsperaEnvio ?? 60),
    lineas,
    xml,
  };
}

export class ClienteAeat {
  constructor(
    private readonly url: string,
    private readonly transporte: Transporte,
  ) {}

  async enviar(sobre: string): Promise<RespuestaEnvio> {
    const res = await this.transporte.post(this.url, sobre);
    // La AEAT devuelve los SOAP Fault con HTTP 500: se parsean igualmente.
    if (res.status !== 200 && !res.body.includes('Envelope')) {
      throw new ErrorSoap(`HTTP ${res.status} de la AEAT`, String(res.status), res.body);
    }
    return parsearRespuesta(res.body);
  }
}
