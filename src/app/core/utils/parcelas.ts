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

export function getMesReferenciaInicial(dataCompra: Date, bestPurchaseDay: number, diaVencimento: number): string {
  let ano = dataCompra.getFullYear();
  let mes = dataCompra.getMonth(); // 0-11 (Mês da Compra)
  const dia = dataCompra.getDate(); // Dia da Compra
  
  // LÓGICA DO MELHOR DIA DE COMPRA (BPD):
  // O BPD é o primeiro dia do ciclo da FATURA FUTURA.
  // Se a compra é feita NO DIA ou APÓS o BPD, ela vai para a COMPETÊNCIA do MÊS SEGUINTE.
  
  if (dia >= bestPurchaseDay) {
      // Compra feita NO DIA ou APÓS o BPD.
      // Entra no ciclo cuja COMPETÊNCIA é o mês seguinte.
      mes += 1;
  }

  // Ajuste de ano (virada de Dezembro para Janeiro)
  if (mes > 11) {
    ano += Math.floor(mes / 12);
    mes = mes % 12;
  }
  
  // O valor retornado é o MÊS DE COMPETÊNCIA (Due Month = Competência + 1)
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