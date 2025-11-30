import { Expense, CreditCard } from "../models/finance.models";
import { ParcelaReal } from "../models/parcela-real.model";

export function gerarParcelasDeTodos(
  expenses: Expense[],
  cards: CreditCard[]
): ParcelaReal[] {
  const parcelas: ParcelaReal[] = [];

  for (const e of expenses) {
    if (e.type === 'CARTAO') {
        const card = cards.find(c => c.id === e.cardId);
        // Usamos o bestPurchaseDay e dueDay configurados no cartão.
        const bestPurchaseDay = card ? card.bestPurchaseDay : 1;
        const dueDay = card ? card.dueDay : 10;
        
        // Passa o dia de referência para o cálculo da primeira parcela
        const lista = gerarParcelasDeUmaDespesa(e, bestPurchaseDay, dueDay);
        parcelas.push(...lista);
    }
  }
  return parcelas;
}

export function gerarParcelasDeUmaDespesa(
  expense: Expense,
  bestPurchaseDay: number, // Dia limite para a compra entrar na próxima fatura
  diaVencimento: number = 10 // Padrão se não informado
): ParcelaReal[] {
  const parcelas: ParcelaReal[] = [];
  
  // Força meio-dia para evitar problemas de fuso horário
  const dataCompra = new Date(expense.date + 'T12:00:00');
  
  // Calcula o mês da primeira parcela (Competência)
  // O diaVencimento agora é crucial para o cálculo.
  const mesInicial = getMesReferenciaInicial(dataCompra, bestPurchaseDay, diaVencimento);

  const qtd = expense.totalInstallments && expense.totalInstallments > 0 ? expense.totalInstallments : 1;
  const valorParcela = expense.installmentValue ? expense.installmentValue : Math.round((expense.amount / qtd) * 100) / 100;

  for (let i = 0; i < qtd; i++) {
    const mesParcela = addMeses(mesInicial, i);
    const numeroParcela = i + 1;
    const idFixo = `${expense.id}#${numeroParcela}`;

    parcelas.push({
      parcelaId: idFixo, 
      competenciaDate: mesParcela,
      expenseId: expense.id,
      numero: numeroParcela,
      total: qtd,
      valor: valorParcela,
      mesReferencia: mesParcela,
      description: expense.description,
      personName: expense.personName,
      isThirdParty: !!expense.personName, 
    });
  }
  return parcelas;
}

/**
 * Calcula o Mês de Competência da fatura (Mês de Referência).
 * O vencimento real da fatura será Mês de Competência + 1.
 * * @param dataCompra Data da compra.
 * @param bestPurchaseDay O dia seguinte ao fechamento (o melhor dia de compra).
 * @param diaVencimento Dia de vencimento da fatura.
 * @returns Mês de Competência no formato "YYYY-MM".
 */
export function getMesReferenciaInicial(dataCompra: Date, bestPurchaseDay: number, diaVencimento: number): string {
  const diaCompra = dataCompra.getDate();
  const mesCompraStr = `${dataCompra.getFullYear()}-${String(dataCompra.getMonth() + 1).padStart(2, '0')}`;
  
  // Dia de Fechamento (CLOSE) é o dia anterior ao Melhor Dia de Compra (BPD).
  // Usamos bestPurchaseDay - 1. Se BPD for 1, fechamento é o último dia do mês anterior.
  const diaFechamento = bestPurchaseDay - 1;
  
  let offsetMeses;

  // LÓGICA REFINADA BASEADA NA RELAÇÃO ENTRE FECHAMENTO E VENCIMENTO
  // A lógica só é válida se diaVencimento e diaFechamento (ou BPD) forem tratados
  // como dias dentro do mesmo MÊS-CALENDÁRIO DA COMPRA.

  // Tipo B (Ex: Nubank, XP): Fechamento (5) ANTES do Vencimento (12). Ciclo dentro do mês.
  const isCycleWithinMonth = diaFechamento < diaVencimento && diaFechamento >= 1;

  // Tipo A (Ex: BB): Fechamento (26) APÓS o Vencimento (10). Ciclo cruza o mês.
  // Também inclui o caso de BPD=1, onde diaFechamento é 0 (ou seja, no mês anterior), 
  // forçando o caso Type A, já que a compra sempre cai após o fechamento do ciclo atual.
  
  if (isCycleWithinMonth) { // Type B: CLOSE < DUE (Nubank, XP)
      if (diaCompra <= diaFechamento) {
          // Compra ANTES/NO FECHAMENTO. Compete Month = Mês de Compra - 1.
          // Ex: Compra 03/11 (<= 5). Compete: Outubro. Vence: Novembro.
          offsetMeses = -1;
      } else {
          // Compra APÓS FECHAMENTO. Compete Month = Mês de Compra.
          // Ex: Compra 28/11 (> 5). Compete: Novembro. Vence: Dezembro.
          offsetMeses = 0;
      }
  } else { // Type A: CLOSE >= DUE (BB) ou BPD = 1
      if (diaCompra <= diaFechamento) {
          // Compra ANTES/NO FECHAMENTO. Compete Month = Mês de Compra.
          // Ex: Compra 21/11 (<= 26). Compete: Novembro. Vence: Dezembro.
          offsetMeses = 0;
      } else {
          // Compra APÓS FECHAMENTO. Compete Month = Mês de Compra + 1.
          // Ex: Compra 28/11 (> 26). Compete: Dezembro. Vence: Janeiro.
          offsetMeses = 1;
      }
  }
  
  // O valor retornado é o MÊS DE COMPETÊNCIA ("YYYY-MM")
  return addMeses(mesCompraStr, offsetMeses);
}

export function addMeses(mesAno: string, quantidade: number): string {
  let [ano, mes] = mesAno.split("-").map(Number);
  mes -= 1; // Ajusta para base 0
  mes += quantidade;
  
  // Recalcula ano e mês
  ano += Math.floor(mes / 12);
  mes = mes % 12;
  
  // Corrige bug de módulo negativo em JS se houver
  if (mes < 0) {
      mes += 12;
      ano -= 1;
  }

  return `${ano}-${String(mes + 1).padStart(2, "0")}`;
}

export function gerarRangeMeses(inicio: string, fim: string): string[] {
    if (inicio > fim) return [inicio];
    const lista: string[] = [];
    let atual = inicio;
    let count = 0; 
    while (atual <= fim && count < 120) {
        lista.push(atual);
        atual = addMeses(atual, 1);
        count++;
    }
    return lista.reverse();
}