import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { loadConfig } from '../src/config.js';
import { abrirDb } from '../src/db.js';
import { crearServidor } from '../src/api/servidor.js';
import { ClienteAeat, type Transporte } from '../src/aeat/cliente.js';
import { ServicioEnvios } from '../src/services/envios.js';
import { huellaAlta } from '../src/domain/huella.js';

const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, isArray: (n) => n === 'RegistroFactura' });

function respuestaAeat(lineas: { tipo: string; num: string; fecha: string; estado: string; codigo?: string }[], estadoEnvio: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body>
<tikR:RespuestaRegFactuSistemaFacturacion xmlns:tikR="r" xmlns:tik="t">
<tikR:CSV>A-TESTCSV123</tikR:CSV><tikR:TiempoEsperaEnvio>60</tikR:TiempoEsperaEnvio><tikR:EstadoEnvio>${estadoEnvio}</tikR:EstadoEnvio>
${lineas
  .map(
    (l) => `<tikR:RespuestaLinea><tikR:IDFactura><tik:IDEmisorFactura>B12345678</tik:IDEmisorFactura>
<tik:NumSerieFactura>${l.num}</tik:NumSerieFactura><tik:FechaExpedicionFactura>${l.fecha}</tik:FechaExpedicionFactura></tikR:IDFactura>
<tikR:Operacion><tik:TipoOperacion>${l.tipo}</tik:TipoOperacion></tikR:Operacion><tikR:EstadoRegistro>${l.estado}</tikR:EstadoRegistro>
${l.codigo ? `<tikR:CodigoErrorRegistro>${l.codigo}</tikR:CodigoErrorRegistro><tikR:DescripcionErrorRegistro>Error de prueba</tikR:DescripcionErrorRegistro>` : ''}
</tikR:RespuestaLinea>`,
  )
  .join('')}
</tikR:RespuestaRegFactuSistemaFacturacion></env:Body></env:Envelope>`;
}

test('flujo completo: alta, encadenamiento, envío, rechazo y anulación', async () => {
  const cfg = { ...loadConfig(), dbPath: ':memory:', adminToken: 'admin' };
  const db = abrirDb(':memory:');
  const app = crearServidor(db, cfg);

  // Cliente y emisor
  let res = await app.inject({ method: 'POST', url: '/admin/clientes', payload: { nombre: 'Hotel X' } });
  assert.equal(res.statusCode, 401);
  res = await app.inject({
    method: 'POST',
    url: '/admin/clientes',
    headers: { authorization: 'Bearer admin' },
    payload: { nombre: 'Gestoría X' },
  });
  assert.equal(res.statusCode, 201);
  const headers = { 'x-api-key': res.json().apiKey };

  assert.equal((await app.inject({ method: 'GET', url: '/v1/emisores' })).statusCode, 401);
  res = await app.inject({ method: 'POST', url: '/v1/emisores', headers, payload: { nif: 'B12345678', nombreRazon: 'EMPRESA & CIA SL' } });
  assert.equal(res.statusCode, 201);

  const factura = (num: string, extra: object = {}) => ({
    emisorNif: 'B12345678',
    numSerie: num,
    fechaExpedicion: '2025-03-07',
    descripcion: 'Alojamiento <3 noches>',
    destinatarios: [{ nombreRazon: 'Cliente SA', nif: 'A87654321' }],
    desglose: [{ calificacionOperacion: 'S1', tipoImpositivo: 10, baseImponible: 300, cuotaRepercutida: 30 }],
    ...extra,
  });

  // Alta 1 y 2
  res = await app.inject({ method: 'POST', url: '/v1/facturas', headers, payload: factura('A-1', { referenciaExterna: 'ext-1' }) });
  assert.equal(res.statusCode, 202, res.body);
  const r1 = res.json();
  assert.equal(r1.estado, 'pendiente');
  assert.match(r1.qr.url, /ValidarQR\?nif=B12345678&numserie=A-1&fecha=07-03-2025&importe=330.00$/);
  assert.match(r1.qr.png, /^data:image\/png;base64,/);

  // Idempotencia por referencia externa
  res = await app.inject({ method: 'POST', url: '/v1/facturas', headers, payload: factura('A-1', { referenciaExterna: 'ext-1' }) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().id, r1.id);
  // Duplicado sin referencia
  res = await app.inject({ method: 'POST', url: '/v1/facturas', headers, payload: factura('A-1') });
  assert.equal(res.statusCode, 409);
  // Validación
  res = await app.inject({ method: 'POST', url: '/v1/facturas', headers, payload: { ...factura('A-9'), desglose: [] } });
  assert.equal(res.statusCode, 400);

  res = await app.inject({ method: 'POST', url: '/v1/facturas', headers, payload: factura('A-2') });
  const r2 = res.json();

  // El registro 2 está encadenado al 1 y su huella es reproducible.
  const fila2 = db.prepare('SELECT datos_json FROM registros WHERE id = ?').get(r2.id) as { datos_json: string };
  const d2 = JSON.parse(fila2.datos_json);
  assert.equal(d2.registroAnterior.huella, r1.huella);
  assert.equal(d2.registroAnterior.numSerieFactura, 'A-1');
  assert.equal(
    huellaAlta({
      idEmisorFactura: 'B12345678',
      numSerieFactura: 'A-2',
      fechaExpedicionFactura: '07-03-2025',
      tipoFactura: 'F1',
      cuotaTotal: '30.00',
      importeTotal: '330.00',
      huellaAnterior: r1.huella,
      fechaHoraHusoGenRegistro: d2.fechaHoraHusoGenRegistro,
    }),
    r2.huella,
  );

  // Envío: la AEAT acepta A-1 y rechaza A-2
  const enviados: string[] = [];
  let respuesta = '';
  let fallarRed = false;
  const transporte: Transporte = {
    async post(_url, body) {
      if (fallarRed) throw new Error('ECONNRESET');
      enviados.push(body);
      return { status: 200, body: respuesta };
    },
  };
  let reloj = 1_000_000;
  const envios = new ServicioEnvios(db, cfg, new ClienteAeat('https://aeat.test', transporte), () => {}, () => reloj);

  respuesta = respuestaAeat(
    [
      { tipo: 'Alta', num: 'A-1', fecha: '07-03-2025', estado: 'Correcto' },
      { tipo: 'Alta', num: 'A-2', fecha: '07-03-2025', estado: 'Incorrecto', codigo: '1100' },
    ],
    'ParcialmenteCorrecto',
  );
  const ciclo = await envios.ciclo();
  assert.deepEqual(ciclo, [{ emisor: 'B12345678', enviados: 2, estadoEnvio: 'ParcialmenteCorrecto' }]);

  // El sobre enviado es XML bien formado, con 2 registros en orden y escapado correcto
  assert.equal(XMLValidator.validate(enviados[0]), true);
  const sobre = parser.parse(enviados[0]).Envelope.Body.RegFactuSistemaFacturacion;
  assert.equal(sobre.Cabecera.ObligadoEmision.NIF, 'B12345678');
  assert.equal(sobre.Cabecera.ObligadoEmision.NombreRazon, 'EMPRESA & CIA SL');
  assert.equal(sobre.RegistroFactura.length, 2);
  assert.equal(sobre.RegistroFactura[0].RegistroAlta.Encadenamiento.PrimerRegistro, 'S');
  assert.equal(sobre.RegistroFactura[1].RegistroAlta.Encadenamiento.RegistroAnterior.Huella, r1.huella);
  assert.equal(sobre.RegistroFactura[0].RegistroAlta.DescripcionOperacion, 'Alojamiento <3 noches>');

  assert.equal((await app.inject({ method: 'GET', url: `/v1/facturas/${r1.id}`, headers })).json().estado, 'correcto');
  const e2 = (await app.inject({ method: 'GET', url: `/v1/facturas/${r2.id}`, headers })).json();
  assert.equal(e2.estado, 'incorrecto');
  assert.equal(e2.error.codigo, '1100');
  assert.equal(e2.csv, 'A-TESTCSV123');

  // Se corrige A-2 con un nuevo registro (RechazoPrevio) que sigue la cadena
  res = await app.inject({ method: 'POST', url: '/v1/facturas', headers, payload: factura('A-2') });
  assert.equal(res.statusCode, 202);
  const r3 = res.json();
  const d3 = JSON.parse((db.prepare('SELECT datos_json FROM registros WHERE id = ?').get(r3.id) as { datos_json: string }).datos_json);
  assert.equal(d3.rechazoPrevio, true);
  assert.equal(d3.registroAnterior.huella, r2.huella);

  // Hay que respetar el tiempo de espera de la AEAT (60 s)
  assert.deepEqual(await envios.ciclo(), []);

  // Error de red: sigue pendiente para reintento
  reloj += 60_000;
  fallarRed = true;
  assert.equal((await envios.ciclo())[0].error, 'ECONNRESET');
  assert.equal((await app.inject({ method: 'GET', url: `/v1/facturas/${r3.id}`, headers })).json().estado, 'pendiente');

  // Anulación de A-1
  res = await app.inject({
    method: 'POST',
    url: '/v1/facturas/anulaciones',
    headers,
    payload: { emisorNif: 'B12345678', numSerie: 'A-1', fechaExpedicion: '2025-03-07' },
  });
  assert.equal(res.statusCode, 202, res.body);
  const r4 = res.json();
  assert.equal(r4.tipo, 'anulacion');

  reloj += 60_000;
  fallarRed = false;
  respuesta = respuestaAeat(
    [
      { tipo: 'Alta', num: 'A-2', fecha: '07-03-2025', estado: 'Correcto' },
      { tipo: 'Anulacion', num: 'A-1', fecha: '07-03-2025', estado: 'Correcto' },
    ],
    'Correcto',
  );
  await envios.ciclo();
  const listado = (await app.inject({ method: 'GET', url: '/v1/facturas?estado=correcto', headers })).json();
  assert.deepEqual(listado.map((r: { id: number }) => r.id).sort(), [r1.id, r3.id, r4.id].sort());

  // QR en PNG
  res = await app.inject({ method: 'GET', url: `/v1/facturas/${r1.id}/qr.png`, headers });
  assert.equal(res.headers['content-type'], 'image/png');

  // Otro cliente no ve ni usa los datos del primero
  const otra = (await app.inject({ method: 'POST', url: '/admin/clientes', headers: { authorization: 'Bearer admin' }, payload: { nombre: 'Otro' } })).json();
  const h2 = { 'x-api-key': otra.apiKey };
  assert.equal((await app.inject({ method: 'GET', url: `/v1/facturas/${r1.id}`, headers: h2 })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/emisores', headers: h2, payload: { nif: 'B12345678', nombreRazon: 'X' } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/facturas', headers: h2, payload: factura('Z-1') })).statusCode, 404);

  await app.close();
});

test('SOAP Fault marca el envío como incorrecto', async () => {
  const cfg = { ...loadConfig(), dbPath: ':memory:' };
  const db = abrirDb(':memory:');
  const app = crearServidor(db, cfg);
  const { apiKey } = (await app.inject({ method: 'POST', url: '/admin/clientes', headers: { authorization: `Bearer ${cfg.adminToken}` }, payload: { nombre: 'C' } })).json();
  const headers = { 'x-api-key': apiKey };
  await app.inject({ method: 'POST', url: '/v1/emisores', headers, payload: { nif: 'B12345678', nombreRazon: 'E' } });
  const r = (await app.inject({
    method: 'POST',
    url: '/v1/facturas',
    headers,
    payload: { emisorNif: 'B12345678', numSerie: 'T-1', fechaExpedicion: '2025-03-07', tipoFactura: 'F2', descripcion: 'Ticket', desglose: [{ calificacionOperacion: 'S1', tipoImpositivo: 21, baseImponible: 10, cuotaRepercutida: 2.1 }] },
  })).json();

  const fault = `<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><env:Fault><faultcode>env:Client</faultcode><faultstring>Codigo[4102].El XML no cumple el esquema</faultstring></env:Fault></env:Body></env:Envelope>`;
  const envios = new ServicioEnvios(db, cfg, new ClienteAeat('x', { post: async () => ({ status: 500, body: fault }) }), () => {});
  await envios.ciclo();
  const e = (await app.inject({ method: 'GET', url: `/v1/facturas/${r.id}`, headers })).json();
  assert.equal(e.estado, 'incorrecto');
  assert.match(e.error.descripcion, /4102/);
  await app.close();
});
