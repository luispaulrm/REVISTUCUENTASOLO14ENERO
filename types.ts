
export type BillingModel =
  | 'MULTIPLICATIVE_EXACT'      // A: Recalculable (Standard)
  | 'PRORATED_REFERENCE_PRICE'  // B: Not recalculable (Reference Price)
  | 'UNIT_PRICE_UNTRUSTED';     // C: Not recalculable (Parsing/Logic Error)

export interface BillingItem {
  index?: number;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number; // Stated by clinic
  calculatedTotal: number; // calculated by JS: qty * unitPrice OR authoritative total
  hasCalculationError: boolean;
  valorIsa?: number;
  bonificacion?: number;
  copago?: number;

  // New Validation Metadata
  billingModel?: BillingModel;
  authoritativeTotal?: number; // The "truth" value (valorIsa or Total)
  unitPriceTrust?: number; // 0.0 to 1.0
  qtyIsProration?: boolean;
  suspectedColumnShift?: boolean;
  toleranceApplied?: number;
}

export interface BillingSection {
  category: string;
  items: BillingItem[];
  sectionTotal: number; // Stated by clinic
  calculatedSectionTotal: number; // sum of item totals
  hasSectionError: boolean;
  isTaxConfusion?: boolean; // detected when diff is ~19%
  isUnjustifiedCharge?: boolean; // detected when clinic total > item sum and not taxes
}

export interface PhaseUsage {
  phase: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  estimatedCostCLP: number;
}

export interface UsageMetrics {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  estimatedCost: number;
  estimatedCostCLP: number;
  phases?: PhaseUsage[];
}

export interface ExtractedAccount {
  clinicName: string;
  patientName: string;
  invoiceNumber: string;
  date: string;
  sections: BillingSection[];
  clinicStatedTotal: number;
  extractedTotal: number; // sum of all sections
  totalItems: number; // count of all captured rows
  isBalanced: boolean;
  discrepancy: number;
  currency: string;
  usage?: UsageMetrics;
}

export interface ContractRegla {
  'PÁGINA ORIGEN': string;
  'CÓDIGO/SECCIÓN': string;
  'SUBCATEGORÍA': string;
  'VALOR EXTRACTO LITERAL DETALLADO': string;
}

export interface ContractCobertura {
  'PRESTACIÓN CLAVE': string;
  'MODALIDAD/RED': string;
  '% BONIFICACIÓN': string;
  'COPAGO FIJO': string;
  'TOPE LOCAL 1 (VAM/EVENTO)': string;
  'TOPE LOCAL 2 (ANUAL/UF)': string;
  'RESTRICCIÓN Y CONDICIONAMIENTO': string;
  'ANCLAJES'?: string[];
}

export interface Contract {
  diseno_ux: {
    nombre_isapre: string;
    titulo_plan: string;
    subtitulo_plan: string;
    layout: string;
    funcionalidad: string;
    salida_json: string;
  };
  reglas: ContractRegla[];
  coberturas: ContractCobertura[];
  usage?: UsageMetrics;
}

export enum AppStatus {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

// ============================================================================
// EventoHospitalario - New Architecture Types (v3)
// ============================================================================

export type TipoEvento = 'QUIRURGICO' | 'MEDICO' | 'MIXTO';
export type TipoAnclaje = 'CODIGO_PRINCIPAL' | 'INGRESO' | 'UCI' | 'PROTOCOLO' | 'PRESTADOR_FECHA';
export type NivelConfianza = 'ALTA' | 'MEDIA' | 'BAJA';
export type RecomendacionAccion = 'IMPUGNAR' | 'SOLICITAR_ACLARACION' | 'ACEPTAR';
export type OrigenProbable = 'CLINICA_FACTURACION' | 'ISAPRE_LIQUIDACION' | 'PAM_ESTRUCTURA' | 'MIXTO' | 'DESCONOCIDO';
export type RazonHeuristica = 'EQUIPO_QUIRURGICO' | 'MULTIPLE_SESSIONS' | 'UNKNOWN';

export interface ItemOrigen {
  folio?: string;
  codigo: string;
  cantidad: number;
  total: number;
  copago: number;
  descripcion?: string;
}

export interface HeursiticaConsolidacion {
  sum_cantidades: number;
  tolerancia: number;
  razon: RazonHeuristica;
}

export interface HonorarioConsolidado {
  codigo: string;
  descripcion: string;
  items_origen: ItemOrigen[];
  es_fraccionamiento_valido: boolean;
  heuristica: HeursiticaConsolidacion;
}

export interface Anclaje {
  tipo: TipoAnclaje;
  valor: string; // The code or 'FECHA_INGRESO'
}

export interface AnalisisFinanciero {
  tope_cumplido: boolean;
  valor_unidad_inferido?: number;
  metodo_validacion: 'FACTOR_ESTANDAR' | 'INFERENCIA_BAM' | 'MANUAL';
  glosa_tope?: string; // e.g., "70% tope 2.2 VAM"
}

export interface EventoHospitalario {
  id_evento: string;
  tipo_evento: TipoEvento;
  anclaje: Anclaje;
  prestador: string;
  fecha_inicio: string;
  fecha_fin: string;
  posible_continuidad: boolean; // Gap < 48h, same provider
  total_copago?: number; // Sum of items to prevent "0 copay" hallucinations
  total_bonificacion?: number;
  subeventos: EventoHospitalario[]; // Max depth 2
  honorarios_consolidados: HonorarioConsolidado[];
  nivel_confianza: NivelConfianza;
  recomendacion_accion: RecomendacionAccion;
  origen_probable: OrigenProbable;
  analisis_financiero?: AnalisisFinanciero;
}

// ============================================================================
// Canonical Rules Engine Types (v4)
// ============================================================================

export type AuditDecision =
  | "OK_VERIFICABLE"
  | "ERROR_CONTRATO_PROBADO"
  | "COPAGO_INDETERMINADO_POR_OPACIDAD"
  | "ZONA_GRIS_REQUIERE_ANTECEDENTES";

export interface RuleResult {
  ruleId: string; // e.g., "C-01"
  description: string;
  violated: boolean;
  details?: string;
}

export interface FlagResult {
  flagId: string; // e.g., "F-01"
  description: string;
  detected: boolean;
  riskLevel: "HIGH" | "MEDIUM" | "LOW";
  metadata?: any;
}

export interface ExplainableOutput {
  decisionGlobal: AuditDecision;
  fundamento: string[];
  principioAplicado: string;
  legalText?: string;
}
