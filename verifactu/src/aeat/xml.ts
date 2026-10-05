// Construcción del XML de los registros y del sobre SOAP (RegFactuSistemaFacturacion).
// Esquemas oficiales: SuministroLR.xsd y SuministroInformacion.xsd de la AEAT.
// IMPORTANTE: antes de producción, validar el XML generado contra los XSD vigentes.

import type { SistemaInformatico } from '../config.js';
import type { LineaDesgloseNormalizada } from '../domain/factura.js';

const NS_BASE =
  'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws';
export const NS_SUM = `${NS_BASE}/SuministroLR.xsd`;
export const NS_SUM1 = `${NS_BASE}/SuministroInformacion.xsd`;

export interface RegistroAnteriorRef {
  idEmisorFactura: string;
  numSerieFactura: string;
  fechaExpedicionFactura: string;
  huella: string;
}

/** Registro de alta completo, listo para serializar (todo en texto ya formateado). */
export interface RegistroAltaData {
  tipo: 'alta';
  idEmisorFactura: string;
  numSerieFactura: string;
  fechaExpedicionFactura: string;
  nombreRazonEmisor: string;
  subsanacion?: boolean;
  rechazoPrevio?: boolean;
  tipoFactura: string;
  tipoRectificativa?: string;
  facturasRectificadas?: { idEmisorFactura: string; numSerieFactura: string; fechaExpedicionFactura: string }[];
  descripcionOperacion: string;
  destinatarios: { nombreRazon: string; nif: string }[];
  desglose: LineaDesgloseNormalizada[];
  cuotaTotal: string;
  importeTotal: string;
  registroAnterior?: RegistroAnteriorRef;
  fechaHoraHusoGenRegistro: string;
  huella: string;
}

export interface RegistroAnulacionData {
  tipo: 'anulacion';
  idEmisorFacturaAnulada: string;
  numSerieFacturaAnulada: string;
  fechaExpedicionFacturaAnulada: string;
  registroAnterior?: RegistroAnteriorRef;
  fechaHoraHusoGenRegistro: string;
  huella: string;
}

export type RegistroData = RegistroAltaData | RegistroAnulacionData;

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Elemento <sum1:Nombre>valor</sum1:Nombre>; se omite si el valor es undefined. */
function el(nombre: string, valor: string | undefined): string {
  return valor === undefined ? '' : `<sum1:${nombre}>${escapeXml(valor)}</sum1:${nombre}>`;
}

function grupo(nombre: string, contenido: string): string {
  return `<sum1:${nombre}>${contenido}</sum1:${nombre}>`;
}

function encadenamiento(ant?: RegistroAnteriorRef): string {
  if (!ant) return grupo('Encadenamiento', el('PrimerRegistro', 'S'));
  return grupo(
    'Encadenamiento',
    grupo(
      'RegistroAnterior',
      el('IDEmisorFactura', ant.idEmisorFactura) +
        el('NumSerieFactura', ant.numSerieFactura) +
        el('FechaExpedicionFactura', ant.fechaExpedicionFactura) +
        el('Huella', ant.huella),
    ),
  );
}

function sistemaInformatico(s: SistemaInformatico): string {
  return grupo(
    'SistemaInformatico',
    el('NombreRazon', s.nombreRazon) +
      el('NIF', s.nif) +
      el('NombreSistemaInformatico', s.nombreSistemaInformatico) +
      el('IdSistemaInformatico', s.idSistemaInformatico) +
      el('Version', s.version) +
      el('NumeroInstalacion', s.numeroInstalacion) +
      el('TipoUsoPosibleSoloVerifactu', s.tipoUsoPosibleSoloVerifactu) +
      el('TipoUsoPosibleMultiOT', s.tipoUsoPosibleMultiOT) +
      el('IndicadorMultiplesOT', s.indicadorMultiplesOT),
  );
}

function detalleDesglose(l: LineaDesgloseNormalizada): string {
  return grupo(
    'DetalleDesglose',
    el('Impuesto', l.impuesto) +
      el('ClaveRegimen', l.claveRegimen) +
      el('CalificacionOperacion', l.calificacionOperacion) +
      el('OperacionExenta', l.operacionExenta) +
      el('TipoImpositivo', l.tipoImpositivo) +
      el('BaseImponibleOimporteNoSujeto', l.baseImponible) +
      el('CuotaRepercutida', l.cuotaRepercutida) +
      el('TipoRecargoEquivalencia', l.tipoRecargoEquivalencia) +
      el('CuotaRecargoEquivalencia', l.cuotaRecargoEquivalencia),
  );
}

export function registroAltaXml(r: RegistroAltaData, sif: SistemaInformatico): string {
  const rectificadas = r.facturasRectificadas?.length
    ? grupo(
        'FacturasRectificadas',
        r.facturasRectificadas
          .map((f) =>
            grupo(
              'IDFacturaRectificada',
              el('IDEmisorFactura', f.idEmisorFactura) +
                el('NumSerieFactura', f.numSerieFactura) +
                el('FechaExpedicionFactura', f.fechaExpedicionFactura),
            ),
          )
          .join(''),
      )
    : '';
  const destinatarios = r.destinatarios.length
    ? grupo(
        'Destinatarios',
        r.destinatarios
          .map((d) => grupo('IDDestinatario', el('NombreRazon', d.nombreRazon) + el('NIF', d.nif)))
          .join(''),
      )
    : '';

  return grupo(
    'RegistroAlta',
    el('IDVersion', '1.0') +
      grupo(
        'IDFactura',
        el('IDEmisorFactura', r.idEmisorFactura) +
          el('NumSerieFactura', r.numSerieFactura) +
          el('FechaExpedicionFactura', r.fechaExpedicionFactura),
      ) +
      el('NombreRazonEmisor', r.nombreRazonEmisor) +
      (r.subsanacion ? el('Subsanacion', 'S') : '') +
      (r.rechazoPrevio ? el('RechazoPrevio', 'S') : '') +
      el('TipoFactura', r.tipoFactura) +
      el('TipoRectificativa', r.tipoRectificativa) +
      rectificadas +
      el('DescripcionOperacion', r.descripcionOperacion) +
      destinatarios +
      grupo('Desglose', r.desglose.map(detalleDesglose).join('')) +
      el('CuotaTotal', r.cuotaTotal) +
      el('ImporteTotal', r.importeTotal) +
      encadenamiento(r.registroAnterior) +
      sistemaInformatico(sif) +
      el('FechaHoraHusoGenRegistro', r.fechaHoraHusoGenRegistro) +
      el('TipoHuella', '01') +
      el('Huella', r.huella),
  );
}

export function registroAnulacionXml(r: RegistroAnulacionData, sif: SistemaInformatico): string {
  return grupo(
    'RegistroAnulacion',
    el('IDVersion', '1.0') +
      grupo(
        'IDFactura',
        el('IDEmisorFacturaAnulada', r.idEmisorFacturaAnulada) +
          el('NumSerieFacturaAnulada', r.numSerieFacturaAnulada) +
          el('FechaExpedicionFacturaAnulada', r.fechaExpedicionFacturaAnulada),
      ) +
      encadenamiento(r.registroAnterior) +
      sistemaInformatico(sif) +
      el('FechaHoraHusoGenRegistro', r.fechaHoraHusoGenRegistro) +
      el('TipoHuella', '01') +
      el('Huella', r.huella),
  );
}

export interface Cabecera {
  obligado: { nombreRazon: string; nif: string };
  /** Si se envía en nombre del obligado (apoderamiento / colaborador social). */
  representante?: { nombreRazon: string; nif: string };
}

/** Sobre SOAP con hasta 1000 registros de un mismo obligado tributario. */
export function sobreSoap(cab: Cabecera, registros: RegistroData[], sif: SistemaInformatico): string {
  if (registros.length === 0 || registros.length > 1000) {
    throw new Error('Un envío debe contener entre 1 y 1000 registros');
  }
  const cabecera =
    grupo('ObligadoEmision', el('NombreRazon', cab.obligado.nombreRazon) + el('NIF', cab.obligado.nif)) +
    (cab.representante
      ? grupo('Representante', el('NombreRazon', cab.representante.nombreRazon) + el('NIF', cab.representante.nif))
      : '');
  const cuerpo = registros
    .map(
      (r) =>
        `<sum:RegistroFactura>${r.tipo === 'alta' ? registroAltaXml(r, sif) : registroAnulacionXml(r, sif)}</sum:RegistroFactura>`,
    )
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sum="${NS_SUM}" xmlns:sum1="${NS_SUM1}">` +
    '<soapenv:Header/><soapenv:Body><sum:RegFactuSistemaFacturacion>' +
    `<sum:Cabecera>${cabecera}</sum:Cabecera>` +
    cuerpo +
    '</sum:RegFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>'
  );
}
