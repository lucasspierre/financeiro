// Modelo de Cartão de Crédito
export interface CreditCard {
  id: string;
  name: string;       // Ex: "Nubank", "Inter"
  bestPurchaseDay: number; // Dia do melhor dia de compra (data limite para entrar na fatura seguinte)
  dueDay: number;     // Dia do vencimento
  color?: string;     // Para diferenciar na UI (opcional)
}

// TIPOS DE DESPESA
export type ExpenseType =
  | 'CARTAO'            // Gasto no cartão de crédito
  | 'PIX_DEBITO'        // Pagamentos à vista (Pix / Débito)
  | 'FINANCIAMENTO';    // Financiamentos / Empréstimos

export interface Expense {
  id: string;
  description: string;
  amount: number;      // valor total da compra ou contrato
  date: string;        // data da compra
  type: ExpenseType;

  // Campos específicos de cartão
  cardId?: string;            // ID do cartão utilizado
  totalInstallments?: number; // número de parcelas
  installmentValue?: number;  // valor da parcela

  // Campos opcionais
  personName?: string;        // Quem fez a compra (se vazio = Titular/Eu)
  notes?: string;             // Observação
  
  isPaid?: boolean;           // Se a conta já foi paga (para Pix/Financiamento)
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

export interface FinanceConfig {
  monthlyLimit: number;
  referenceMonth: string;
}

export interface FinanceSnapshot {
  expenses: Expense[];
  incomes: Income[];
  cards: CreditCard[];
  config: FinanceConfig;
}