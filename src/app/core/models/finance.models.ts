// Modelo de Cartão de Crédito
export interface CreditCard {
  id: string;
  name: string;
  bestPurchaseDay: number;
  dueDay: number;
  color?: string;
}

// TIPOS DE DESPESA
export type ExpenseType =
  | 'CARTAO'
  | 'PIX_DEBITO'
  | 'FINANCIAMENTO';

export interface ClassificationRule {
  name: string;        
  color: string;       
  keywords: string[];
  includedInLimit?: boolean; 
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  date: string;
  type: ExpenseType;
  cardId?: string;
  totalInstallments?: number;
  installmentValue?: number;
  personName?: string;
  notes?: string;
  isPaid?: boolean;
  recurring?: boolean;
  
  // ALTERADO: Agora suporta múltiplas classificações calculadas
  classifications?: ClassificationRule[]; 
}

// TIPOS DE ENTRADA
export type IncomeType =
  | 'SALARIO'
  | 'RECORRENTE'
  | 'PONTUAL'
  | 'REEMBOLSO';

export interface Income {
  id: string;
  description: string;
  amount: number;
  date: string;
  incomeType: IncomeType;
  recurring?: boolean;
  notes?: string;
  personName?: string;
  parcelaReferenteId?: string;
}

export interface MonthlyLimit {
  month: string;
  amount: number;
}

export interface FinanceConfig {
  monthlyLimits?: MonthlyLimit[];
  classificationRules?: ClassificationRule[];
}

export interface FinanceSnapshot {
  expenses: Expense[];
  incomes: Income[];
  cards: CreditCard[];
  config: FinanceConfig;
}