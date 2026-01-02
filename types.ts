
export interface BillingItem {
  index?: number;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number; // Stated by clinic
  calculatedTotal: number; // calculated by JS: qty * unitPrice
  hasCalculationError: boolean;
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

export interface UsageMetrics {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  estimatedCost: number;
  estimatedCostCLP: number;
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

export enum AppStatus {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}
