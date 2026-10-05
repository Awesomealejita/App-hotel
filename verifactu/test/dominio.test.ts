import { test } from 'node:test';
import assert from 'node:assert/strict';
import { huellaAlta, huellaAnulacion } from '../src/domain/huella.js';
import { aCentimos, fechaAeat, fechaHoraHuso, formatoImporte } from '../src/domain/formato.js';
import { urlQr } from '../src/domain/qr.js';
import { calcularTotales, facturaAltaSchema } from '../src/domain/factura.js';

// Ejemplos del documento oficial de la AEAT sobre la generación de la huella.
const H1 = '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60';
const H2 = 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97';

test('huella de alta: primer registro (ejemplo AEAT)', () => {
  assert.equal(
    huellaAlta({
      idEmisorFactura: '89890001K',
      numSerieFactura: '12345678/G33',
      fechaExpedicionFactura: '01-01-2024',
      tipoFactura: 'F1',
      cuotaTotal: '12.35',
      importeTotal: '123.45',
      huellaAnterior: '',
      fechaHoraHusoGenRegistro: '2024-01-01T19:20:30+01:00',
    }),
    H1,
  );
});

test('huella de alta: registro encadenado (ejemplo AEAT)', () => {
  assert.equal(
    huellaAlta({
      idEmisorFactura: '89890001K',
      numSerieFactura: '12345679/G34',
      fechaExpedicionFactura: '01-01-2024',
      tipoFactura: 'F1',
      cuotaTotal: '12.35',
      importeTotal: '123.45',
      huellaAnterior: H1,
      fechaHoraHusoGenRegistro: '2024-01-01T19:20:35+01:00',
    }),
    H2,
  );
});

test('huella de anulación (ejemplo AEAT)', () => {
  assert.equal(
    huellaAnulacion({
      idEmisorFacturaAnulada: '89890001K',
      numSerieFacturaAnulada: '12345679/G34',
      fechaExpedicionFacturaAnulada: '01-01-2024',
      huellaAnterior: H2,
      fechaHoraHusoGenRegistro: '2024-01-01T19:20:40+01:00',
    }),
    '177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68',
  );
});

test('formatos de importe y fecha', () => {
  assert.equal(formatoImporte(aCentimos(0.1 + 0.2)), '0.30');
  assert.equal(formatoImporte(aCentimos('-5.5')), '-5.50');
  assert.equal(formatoImporte(aCentimos(1234)), '1234.00');
  assert.equal(fechaAeat('2025-03-07'), '07-03-2025');
  assert.throws(() => fechaAeat('07/03/2025'));
});

test('fecha y hora con huso horario de Madrid (invierno y verano)', () => {
  assert.equal(fechaHoraHuso(new Date('2025-01-15T09:00:00Z')), '2025-01-15T10:00:00+01:00');
  assert.equal(fechaHoraHuso(new Date('2025-07-15T09:00:00Z')), '2025-07-15T11:00:00+02:00');
  assert.equal(fechaHoraHuso(new Date('2025-07-15T09:00:00Z'), 'Atlantic/Canary'), '2025-07-15T10:00:00+01:00');
});

test('URL del QR', () => {
  assert.equal(
    urlQr('https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR', {
      nif: '89890001K',
      numSerie: '12345679/G34',
      fecha: '01-01-2024',
      importe: '241.4',
    }),
    'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=12345679%2FG34&fecha=01-01-2024&importe=241.4',
  );
});

test('totales calculados a partir del desglose', () => {
  const f = facturaAltaSchema.parse({
    emisorNif: 'b12345678',
    numSerie: 'A-1',
    fechaExpedicion: '2025-03-07',
    descripcion: 'Servicios',
    destinatarios: [{ nombreRazon: 'Cliente SA', nif: 'A87654321' }],
    desglose: [
      { calificacionOperacion: 'S1', tipoImpositivo: 21, baseImponible: 100, cuotaRepercutida: 21 },
      { calificacionOperacion: 'S1', tipoImpositivo: 10, baseImponible: '50.5', cuotaRepercutida: '5.05' },
      { operacionExenta: 'E1', baseImponible: 10 },
    ],
  });
  assert.equal(f.emisorNif, 'B12345678');
  const t = calcularTotales(f);
  assert.equal(t.cuotaTotal, '26.05');
  assert.equal(t.importeTotal, '186.55');
  assert.equal(t.desglose[1].baseImponible, '50.50');
});

test('validaciones de negocio del esquema', () => {
  const base = {
    emisorNif: 'B12345678',
    numSerie: 'A-1',
    fechaExpedicion: '2025-03-07',
    descripcion: 'x',
    desglose: [{ calificacionOperacion: 'S1', baseImponible: 1, cuotaRepercutida: 0.21, tipoImpositivo: 21 }],
  };
  assert.equal(facturaAltaSchema.safeParse(base).success, false, 'F1 sin destinatario');
  assert.equal(facturaAltaSchema.safeParse({ ...base, tipoFactura: 'F2' }).success, true);
  assert.equal(facturaAltaSchema.safeParse({ ...base, tipoFactura: 'R5' }).success, false, 'R sin tipoRectificativa');
  assert.equal(
    facturaAltaSchema.safeParse({
      ...base,
      tipoFactura: 'F2',
      desglose: [{ calificacionOperacion: 'S1', operacionExenta: 'E1', baseImponible: 1 }],
    }).success,
    false,
    'sujeta y exenta a la vez',
  );
});
