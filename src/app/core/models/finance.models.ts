// TIPOS DE DESPESA
export type ExpenseType =
  | 'CARTAO'            // Seu cartão (à vista ou parcelado)
  | 'CARTAO_EMPRESTADO' // Cartão emprestado para terceiros
  | 'PIX_DEBITO'        // Pagamentos à vista (Pix / Débito)
  | 'FINANCIAMENTO';    // Financiamentos / Empréstimos

export interface Expense {
  id: string;
  description: string;
  amount: number;      // valor total da compra ou contrato
  date: string;        // data da compra
  type: ExpenseType;

  totalInstallments?: number; // número de parcelas (se vazio -> 1)
  installmentValue?: number;  // valor da parcela (opcional)

  personName?: string;        // apenas para CARTAO_EMPRESTADO
  notes?: string;
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

  // Para reembolso de cartão
  personName?: string;        // quem está te pagando
  parcelaReferenteId?: string; // id da parcela gerada a partir da despesa
}

export interface FinanceConfig {
  monthlyLimit: number;   // teto mensal
  referenceMonth: string; // "YYYY-MM"
}

export interface FinanceSnapshot {
  expenses: Expense[];
  incomes: Income[];
  config: FinanceConfig;
}
