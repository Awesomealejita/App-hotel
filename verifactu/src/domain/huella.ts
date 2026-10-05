// Cálculo de la huella (hash SHA-256) según el documento de la AEAT
// "Detalle de las especificaciones técnicas para generación de la huella o hash
// de los registros de facturación". Los valores se concatenan como pares
// clave=valor separados por "&", sin espacios iniciales/finales, y el resultado
// se expresa en hexadecimal en mayúsculas.

import { createHash } from 'node:crypto';

export interface DatosHuellaAlta {
  idEmisorFactura: string;
  numSerieFactura: string;
  fechaExpedicionFactura: string; // dd-mm-aaaa
  tipoFactura: string;
  cuotaTotal: string;
  importeTotal: string;
  huellaAnterior: string; // vacío si es el primer registro
  fechaHoraHusoGenRegistro: string;
}

export interface DatosHuellaAnulacion {
  idEmisorFacturaAnulada: string;
  numSerieFacturaAnulada: string;
  fechaExpedicionFacturaAnulada: string;
  huellaAnterior: string;
  fechaHoraHusoGenRegistro: string;
}

function sha256Mayus(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex').toUpperCase();
}

function concatenar(pares: [string, string][]): string {
  return pares.map(([k, v]) => `${k}=${v.trim()}`).join('&');
}

export function huellaAlta(d: DatosHuellaAlta): string {
  return sha256Mayus(
    concatenar([
      ['IDEmisorFactura', d.idEmisorFactura],
      ['NumSerieFactura', d.numSerieFactura],
      ['FechaExpedicionFactura', d.fechaExpedicionFactura],
      ['TipoFactura', d.tipoFactura],
      ['CuotaTotal', d.cuotaTotal],
      ['ImporteTotal', d.importeTotal],
      ['Huella', d.huellaAnterior],
      ['FechaHoraHusoGenRegistro', d.fechaHoraHusoGenRegistro],
    ]),
  );
}

export function huellaAnulacion(d: DatosHuellaAnulacion): string {
  return sha256Mayus(
    concatenar([
      ['IDEmisorFacturaAnulada', d.idEmisorFacturaAnulada],
      ['NumSerieFacturaAnulada', d.numSerieFacturaAnulada],
      ['FechaExpedicionFacturaAnulada', d.fechaExpedicionFacturaAnulada],
      ['Huella', d.huellaAnterior],
      ['FechaHoraHusoGenRegistro', d.fechaHoraHusoGenRegistro],
    ]),
  );
}
