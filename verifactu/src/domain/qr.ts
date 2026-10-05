// Código QR que debe imprimirse en la factura (Orden HAC/1177/2024, art. 21).
// Debe medir entre 30x30 y 40x40 mm y usar nivel de corrección de errores M.
// Junto al QR se imprime la leyenda "VERI*FACTU".

import QRCode from 'qrcode';

export const LEYENDA_VERIFACTU = 'Factura verificable en la sede electrónica de la AEAT';

export interface DatosQr {
  nif: string;
  numSerie: string;
  fecha: string; // dd-mm-aaaa
  importe: string; // ImporteTotal
}

export function urlQr(baseUrl: string, d: DatosQr): string {
  const params = new URLSearchParams({
    nif: d.nif,
    numserie: d.numSerie,
    fecha: d.fecha,
    importe: d.importe,
  });
  // URLSearchParams codifica el espacio como "+"; la AEAT espera %20.
  return `${baseUrl}?${params.toString().replace(/\+/g, '%20')}`;
}

export async function qrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { errorCorrectionLevel: 'M', type: 'png', margin: 2, width: 300 });
}

export async function qrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 300 });
}
