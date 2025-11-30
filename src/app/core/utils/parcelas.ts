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
        // Aqui assumimos que 'closingDay' no cadastro do cartão
        // representa o "MELHOR DIA DE COMPRA" (o dia que a fatura vira).
        const bestDay = card ? card.closingDay : 1;
        const dueDay = card ? card.dueDay : 10;
        
        const lista = gerarParcelasDeUmaDespesa(e, bestDay, dueDay);
        parcelas.push(...lista);
    }
  }
  return parcelas;
}

export function gerarParcelasDeUmaDespesa(
  expense: Expense,
  melhorDiaCompra: number, // Antigo diaFechamento
  diaVencimento: number = 10 // Padrão se não informado
): ParcelaReal[] {
  const parcelas: ParcelaReal[] = [];
  
  // Força meio-dia para evitar problemas de fuso horário
  const dataCompra = new Date(expense.date + 'T12:00:00');
  
  // Calcula o mês da primeira parcela
  const mesInicial = getMesReferenciaInicial(dataCompra, melhorDiaCompra, diaVencimento);

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

export function getMesReferenciaInicial(dataCompra: Date, melhorDiaCompra: number, diaVencimento: number): string {
  let ano = dataCompra.getFullYear();
  let mes = dataCompra.getMonth(); // 0-11
  const dia = dataCompra.getDate();

  // LÓGICA DO MELHOR DIA DE COMPRA:
  // Se comprei no dia 5 e o melhor dia é 5 -> Fatura do próximo mês.
  // Se comprei no dia 4 e o melhor dia é 5 -> Fatura deste mês.
  
  if (dia >= melhorDiaCompra) {
      // Compra entrou na fatura nova -> Pula para o próximo mês
      mes += 1; 
  }
  // Se dia < melhorDiaCompra, mantém no mês atual (mes += 0)

  // Ajuste de ano (virada de Dezembro para Janeiro)
  if (mes > 11) {
    ano += Math.floor(mes / 12);
    mes = mes % 12;
  }
  
  return `${ano}-${String(mes + 1).padStart(2, "0")}`;
}

export function addMeses(mesAno: string, quantidade: number): string {
  let [ano, mes] = mesAno.split("-").map(Number);
  mes -= 1; // Ajusta para base 0
  mes += quantidade;
  
  // Recalcula ano e mês
  ano += Math.floor(mes / 12);
  mes = mes % 12;
  
  // Corrige bug de módulo negativo em JS se houver (não deve ocorrer aqui pois qtd > 0)
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