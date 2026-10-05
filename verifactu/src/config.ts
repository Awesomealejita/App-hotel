// Configuración leída de variables de entorno (ver .env.example).

export type AeatEntorno = 'pruebas' | 'produccion';

const ENDPOINTS: Record<AeatEntorno, { soap: string; soapSello: string; qr: string }> = {
  pruebas: {
    soap: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
    soapSello: 'https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
    qr: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR',
  },
  produccion: {
    soap: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
    soapSello: 'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
    qr: 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR',
  },
};

/** Datos del sistema informático (SIF) que viajan en cada registro. */
export interface SistemaInformatico {
  nombreRazon: string;
  nif: string;
  nombreSistemaInformatico: string;
  idSistemaInformatico: string; // 2 caracteres
  version: string;
  numeroInstalacion: string;
  tipoUsoPosibleSoloVerifactu: 'S' | 'N';
  tipoUsoPosibleMultiOT: 'S' | 'N';
  indicadorMultiplesOT: 'S' | 'N';
}

export interface Config {
  port: number;
  dbPath: string;
  adminToken: string;
  entorno: AeatEntorno;
  soapUrl: string;
  qrUrl: string;
  certPath?: string;
  certPassword?: string;
  /** Si es false el worker no envía a la AEAT (útil en desarrollo). */
  envioActivo: boolean;
  intervaloWorkerMs: number;
  sistemaInformatico: SistemaInformatico;
}

function env(name: string, def?: string): string {
  const v = process.env[name] ?? def;
  if (v === undefined) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export function loadConfig(): Config {
  const entorno = env('AEAT_ENTORNO', 'pruebas') as AeatEntorno;
  if (!(entorno in ENDPOINTS)) throw new Error(`AEAT_ENTORNO inválido: ${entorno}`);
  const ep = ENDPOINTS[entorno];
  const usaSello = env('AEAT_CERT_SELLO', 'false') === 'true';

  return {
    port: Number(env('PORT', '3000')),
    dbPath: env('DB_PATH', 'data/verifactu.db'),
    adminToken: env('ADMIN_TOKEN', 'cambia-esto'),
    entorno,
    soapUrl: process.env.AEAT_SOAP_URL ?? (usaSello ? ep.soapSello : ep.soap),
    qrUrl: ep.qr,
    certPath: process.env.AEAT_CERT_PATH,
    certPassword: process.env.AEAT_CERT_PASSWORD,
    envioActivo: env('AEAT_ENVIO_ACTIVO', 'false') === 'true',
    intervaloWorkerMs: Number(env('WORKER_INTERVALO_MS', '5000')),
    sistemaInformatico: {
      nombreRazon: env('SIF_NOMBRE_RAZON', 'MI EMPRESA SL'),
      nif: env('SIF_NIF', 'B00000000'),
      nombreSistemaInformatico: env('SIF_NOMBRE', 'VerifactuAPI'),
      idSistemaInformatico: env('SIF_ID', 'VA'),
      version: env('SIF_VERSION', '0.1.0'),
      numeroInstalacion: env('SIF_NUMERO_INSTALACION', '1'),
      tipoUsoPosibleSoloVerifactu: 'S',
      tipoUsoPosibleMultiOT: 'S',
      indicadorMultiplesOT: 'S',
    },
  };
}
