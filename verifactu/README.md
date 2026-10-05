# VERI*FACTU API

API REST para conectar el sistema de facturación de un cliente con la AEAT (sistema **VERI\*FACTU**).
El sistema del cliente manda cada factura en JSON y la API se encarga de:

1. Validar los datos (NIF, tipo de factura, desglose de IVA, rectificativas…).
2. Generar el **registro de facturación** con su **huella SHA-256 encadenada** al registro anterior del mismo emisor.
3. Devolver el **QR** y la leyenda **VERI\*FACTU** para imprimirlos en la factura.
4. Ponerlo en cola y enviarlo a la AEAT por **SOAP con certificado electrónico**, respetando el límite de 1000 registros por envío y el tiempo de espera que marca la AEAT.
5. Guardar la respuesta (CSV, estado y errores) y avisar al cliente por **webhook**.

> Es independiente de la app del hotel: el código vive solo en esta carpeta.

```
Sistema de facturación ──JSON──▶ API (/v1/facturas) ──▶ SQLite (registros encadenados)
                                                             │
                                          worker de envíos ──┘──SOAP + certificado──▶ AEAT
                                                             │
                              webhook ◀── resultado (Correcto / AceptadoConErrores / Incorrecto)
```

## Puesta en marcha

Requiere Node.js 22.5 o superior (se usa `node:sqlite`).

```bash
cd verifactu
npm install
cp .env.example .env   # y rellenar
npm test               # tests: huella con los ejemplos oficiales de la AEAT, flujo completo con una AEAT simulada
npm run dev
```

Con `AEAT_ENVIO_ACTIVO=false` (valor por defecto) la API genera los registros y los QR pero **no envía nada**.
Para enviar al entorno de pruebas de la AEAT hay que poner `AEAT_ENVIO_ACTIVO=true` e indicar el certificado `.p12`.

## Uso

```bash
# 1. Alta de un cliente de la API (devuelve la apiKey una sola vez)
curl -X POST localhost:3000/admin/clientes -H 'authorization: Bearer $ADMIN_TOKEN' \
  -H 'content-type: application/json' -d '{"nombre":"Cliente X","webhookUrl":"https://cliente.example/webhooks/verifactu"}'

# 2. Alta del emisor (empresa que expide las facturas)
curl -X POST localhost:3000/v1/emisores -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"nif":"B12345678","nombreRazon":"EMPRESA SL"}'

# 3. Registrar una factura
curl -X POST localhost:3000/v1/facturas -H "x-api-key: $KEY" -H 'content-type: application/json' -d '{
  "emisorNif": "B12345678",
  "numSerie": "2025-A-0001",
  "fechaExpedicion": "2025-10-05",
  "tipoFactura": "F1",
  "descripcion": "Servicios de consultoría",
  "destinatarios": [{ "nombreRazon": "CLIENTE SA", "nif": "A87654321" }],
  "desglose": [
    { "calificacionOperacion": "S1", "tipoImpositivo": 21, "baseImponible": 1000, "cuotaRepercutida": 210 }
  ],
  "referenciaExterna": "id-en-el-erp-123"
}'
```

Respuesta (`202`): id del registro, `estado: "pendiente"`, `huella`, `qr.url`, `qr.png` (data URL para incrustar en el PDF) y la leyenda.

### Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/admin/clientes` | Alta de cliente de la API (`Authorization: Bearer ADMIN_TOKEN`) |
| `POST` | `/v1/emisores` | Alta de emisor (NIF obligado a facturar) |
| `GET` | `/v1/emisores` | Emisores del cliente y estado de su cadena |
| `POST` | `/v1/facturas` | Registro de alta (factura nueva, rectificativa o corrección de una rechazada) |
| `POST` | `/v1/facturas/anulaciones` | Registro de anulación de una factura |
| `GET` | `/v1/facturas?emisorNif=&estado=&limite=` | Listado de registros |
| `GET` | `/v1/facturas/:id` | Estado de un registro (incluye CSV y errores de la AEAT) |
| `GET` | `/v1/facturas/:id/qr.png` | QR en PNG |
| `GET` | `/health` | Estado del servicio |

Todas las rutas `/v1` exigen la cabecera `x-api-key`.

### Estados de un registro

- `pendiente`: generado y en cola (o reintentando tras un error de red).
- `correcto`: aceptado por la AEAT.
- `aceptado_con_errores`: aceptado, pero la AEAT avisa de errores que hay que subsanar.
- `incorrecto`: rechazado. Se corrige enviando **otra vez** la factura a `POST /v1/facturas`: se genera un registro nuevo marcado como `RechazoPrevio`.

### Webhook

Si el cliente tiene `webhookUrl`, tras cada envío recibe:

```json
{ "evento": "registros.actualizados", "registros": [ { "id": 1, "estado": "correcto", "csv": "...", "error": null } ] }
```

### Idempotencia

Si se manda `referenciaExterna`, reenviar la misma factura devuelve el registro existente (`200`, `duplicado: true`) sin generar otro.
Así el sistema del cliente puede reintentar sin miedo a duplicar.

## Decisiones importantes

- **Los registros no se modifican nunca.** Si falla la conexión se reenvía el mismo registro. Si la AEAT lo rechaza, se genera uno nuevo. Es lo que exige la normativa.
- **La cadena es por emisor (NIF)** y se calcula en una transacción exclusiva para que dos peticiones simultáneas no la rompan.
- **Los importes** se calculan en céntimos enteros. `CuotaTotal` e `ImporteTotal` se calculan a partir del desglose, salvo que se indique `importeTotal`. El mismo texto exacto se usa en la huella y en el XML.
- **El orden de envío** es el de generación, con un máximo de 1000 registros por envío y respetando `TiempoEsperaEnvio`.

## Estructura

```
src/
  config.ts             variables de entorno, endpoints AEAT y datos del sistema informático
  db.ts                 esquema SQLite
  domain/
    factura.ts          validación del JSON de entrada y cálculo de totales
    huella.ts           hash SHA-256 de alta y anulación (especificación AEAT)
    formato.ts          importes, fechas y fecha-hora con huso horario
    qr.ts               URL y PNG del QR
  aeat/
    xml.ts              XML de RegistroAlta / RegistroAnulacion y sobre SOAP
    cliente.ts          envío HTTPS con certificado y lectura de la respuesta
  services/
    clientes.ts         clientes de la API y emisores
    registros.ts        generación de registros encadenados
    envios.ts           worker de envío a la AEAT y webhooks
  api/servidor.ts       endpoints REST (Fastify)
test/                   tests (node:test)
```

## Pendiente antes de producción

- [ ] **Validar el XML generado contra los XSD oficiales** de la AEAT (`SuministroLR.xsd`, `SuministroInformacion.xsd`) y hacer pruebas en el entorno de preproducción con un certificado de pruebas.
- [ ] Decidir el modelo de certificados: uno por cliente, o el nuestro con **apoderamiento o como colaborador social** (en ese caso hay que enviar `Representante` en la cabecera, ya soportado en `aeat/xml.ts`).
- [ ] **Declaración responsable** del sistema informático (los datos `SIF_*`).
- [ ] Campos que aún no se soportan: `Subsanacion`, `ImporteRectificacion` (rectificativas por sustitución), `FacturasSustituidas` (F3), terceros/`EmitidaPorTerceroODestinatario`, destinatarios extranjeros (`IDOtro`), `Macrodato`, `FechaOperacion`, y anulación `SinRegistroPrevio`.
- [ ] Consulta de registros enviados (`ConsultaFactuSistemaFacturacion`).
- [ ] Reintentos persistentes de los webhooks.
- [ ] PostgreSQL en lugar de SQLite si hay varias instancias, bloqueando por emisor con `SELECT … FOR UPDATE`.
- [ ] Copias de seguridad: los registros deben conservarse durante el plazo de prescripción.
