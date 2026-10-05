// Modelo de entrada de la API (JSON) y su normalización a datos del registro.

import { z } from 'zod';
import { aCentimos, formatoImporte } from './formato.js';

const nif = z.string().trim().min(9).max(9).toUpperCase();
const importe = z.union([z.number(), z.string().regex(/^-?\d+(\.\d{1,2})?$/)]);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD');

export const TIPOS_FACTURA = ['F1', 'F2', 'F3', 'R1', 'R2', 'R3', 'R4', 'R5'] as const;

const lineaDesglose = z
  .object({
    /** 01 IVA, 02 IPSI, 03 IGIC, 05 otros. */
    impuesto: z.enum(['01', '02', '03', '05']).default('01'),
    /** Clave de régimen (01 general, 02 exportación, ...). */
    claveRegimen: z.string().regex(/^\d{2}$/).default('01'),
    /** S1/S2 sujeta, N1/N2 no sujeta. Excluyente con operacionExenta. */
    calificacionOperacion: z.enum(['S1', 'S2', 'N1', 'N2']).optional(),
    /** E1..E6 exenta. Excluyente con calificacionOperacion. */
    operacionExenta: z.enum(['E1', 'E2', 'E3', 'E4', 'E5', 'E6']).optional(),
    tipoImpositivo: importe.optional(),
    baseImponible: importe,
    cuotaRepercutida: importe.optional(),
    tipoRecargoEquivalencia: importe.optional(),
    cuotaRecargoEquivalencia: importe.optional(),
  })
  .refine((l) => !!l.calificacionOperacion !== !!l.operacionExenta, {
    message: 'Indica calificacionOperacion o operacionExenta (solo uno)',
  });

export const facturaAltaSchema = z
  .object({
    emisorNif: nif,
    numSerie: z.string().trim().min(1).max(60),
    fechaExpedicion: fecha,
    tipoFactura: z.enum(TIPOS_FACTURA).default('F1'),
    descripcion: z.string().trim().min(1).max(500),
    destinatarios: z
      .array(z.object({ nombreRazon: z.string().trim().min(1).max(120), nif }))
      .max(1000)
      .default([]),
    desglose: z.array(lineaDesglose).min(1).max(12),
    /** Si no se indica, se calcula a partir del desglose. */
    importeTotal: importe.optional(),
    /** Solo rectificativas (R1-R5). S = sustitución, I = diferencias. */
    tipoRectificativa: z.enum(['S', 'I']).optional(),
    facturasRectificadas: z
      .array(z.object({ emisorNif: nif, numSerie: z.string().trim().min(1), fechaExpedicion: fecha }))
      .optional(),
    /** Referencia propia del sistema del cliente, para idempotencia. */
    referenciaExterna: z.string().max(100).optional(),
  })
  .superRefine((f, ctx) => {
    const esRect = f.tipoFactura.startsWith('R');
    if (esRect && !f.tipoRectificativa) {
      ctx.addIssue({ code: 'custom', path: ['tipoRectificativa'], message: 'Obligatorio en rectificativas' });
    }
    if (!esRect && f.tipoRectificativa) {
      ctx.addIssue({ code: 'custom', path: ['tipoRectificativa'], message: 'Solo para rectificativas' });
    }
    if (f.tipoFactura === 'F1' && f.destinatarios.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['destinatarios'], message: 'F1 requiere destinatario' });
    }
    if (f.tipoFactura === 'F2' && f.destinatarios.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['destinatarios'], message: 'F2 (simplificada) no lleva destinatario' });
    }
  });

export type FacturaAltaInput = z.infer<typeof facturaAltaSchema>;

export const facturaAnulacionSchema = z.object({
  emisorNif: nif,
  numSerie: z.string().trim().min(1).max(60),
  fechaExpedicion: fecha,
});

export type FacturaAnulacionInput = z.infer<typeof facturaAnulacionSchema>;

/** Línea del desglose con importes ya formateados para XML. */
export interface LineaDesgloseNormalizada {
  impuesto: string;
  claveRegimen: string;
  calificacionOperacion?: string;
  operacionExenta?: string;
  tipoImpositivo?: string;
  baseImponible: string;
  cuotaRepercutida?: string;
  tipoRecargoEquivalencia?: string;
  cuotaRecargoEquivalencia?: string;
}

export interface TotalesFactura {
  desglose: LineaDesgloseNormalizada[];
  cuotaTotal: string;
  importeTotal: string;
}

const opt = (v: number | string | undefined) => (v === undefined ? undefined : formatoImporte(aCentimos(v)));

/** Calcula CuotaTotal e ImporteTotal y formatea importes del desglose. */
export function calcularTotales(f: FacturaAltaInput): TotalesFactura {
  let cuota = 0;
  let base = 0;
  let recargo = 0;
  const desglose = f.desglose.map((l) => {
    base += aCentimos(l.baseImponible);
    cuota += l.cuotaRepercutida !== undefined ? aCentimos(l.cuotaRepercutida) : 0;
    recargo += l.cuotaRecargoEquivalencia !== undefined ? aCentimos(l.cuotaRecargoEquivalencia) : 0;
    return {
      impuesto: l.impuesto,
      claveRegimen: l.claveRegimen,
      calificacionOperacion: l.calificacionOperacion,
      operacionExenta: l.operacionExenta,
      tipoImpositivo: opt(l.tipoImpositivo),
      baseImponible: formatoImporte(aCentimos(l.baseImponible)),
      cuotaRepercutida: opt(l.cuotaRepercutida),
      tipoRecargoEquivalencia: opt(l.tipoRecargoEquivalencia),
      cuotaRecargoEquivalencia: opt(l.cuotaRecargoEquivalencia),
    };
  });
  // La AEAT incluye la cuota de recargo de equivalencia en CuotaTotal.
  const cuotaTotal = cuota + recargo;
  const importeTotal = f.importeTotal !== undefined ? aCentimos(f.importeTotal) : base + cuotaTotal;
  return { desglose, cuotaTotal: formatoImporte(cuotaTotal), importeTotal: formatoImporte(importeTotal) };
}
