import { Expense } from "../models/finance.models";
import { ParcelaReal } from "../models/parcela-real.model";

// ============= REGRA DO FECHAMENTO =================================================
// Se compra.day <= FECHAMENTO → 1º parcela = próximo mês
// Se compra.day > FECHAMENTO → 1º parcela = próximo mês + 1
// ====================================================================================

export function gerarParcelasDeTodos(
  expenses: Expense[],
  diaFechamento: number
): ParcelaReal[] {
  const parcelas: ParcelaReal[] = [];

  for (const e of expenses) {
    const lista = gerarParcelasDeUmaDespesa(e, diaFechamento);
    parcelas.push(...lista);
  }

  return parcelas;
}

export function gerarParcelasDeUmaDespesa(
  expense: Expense,
  diaFechamento: number
): ParcelaReal[] {
  const parcelas: ParcelaReal[] = [];

  const dataCompra = new Date(expense.date);
  const diaCompra = dataCompra.getDate();

  // 👉 REGRA CORRETA DO FECHAMENTO
  const mesInicial = getMesReferenciaInicial(dataCompra, diaFechamento);

  const qtd =
    expense.totalInstallments && expense.totalInstallments > 0
      ? expense.totalInstallments
      : 1;

  const valorParcela = expense.installmentValue
    ? expense.installmentValue
    : Math.round((expense.amount / qtd) * 100) / 100;

  for (let i = 0; i < qtd; i++) {
    const mesParcela = addMeses(mesInicial, i);

    parcelas.push({
      parcelaId: crypto.randomUUID(), // ← necessário pelo seu modelo
      competenciaDate: mesParcela,    // ← equivalente ao mês de referência

      expenseId: expense.id,
      numero: i + 1,
      total: qtd,
      valor: valorParcela,
      mesReferencia: mesParcela,

      description: expense.description,
      personName: expense.personName,
      isThirdParty: expense.type === "CARTAO_EMPRESTADO",
    });
  }

  return parcelas;
}

// Determina o mês da primeira parcela respeitando FECHAMENTO
export function getMesReferenciaInicial(dataCompra: Date, diaFechamento: number): string {
  let ano = dataCompra.getFullYear();
  let mes = dataCompra.getMonth(); // 0–11
  const dia = dataCompra.getDate();

  // Padrão: primeira parcela no mês seguinte
  mes += 1;

  // Se passou do fechamento → pula um mês a mais
  if (dia > diaFechamento) {
    mes += 1;
  }

  // Ajuste de ano correto (base zero)
  if (mes > 11) {
    ano += Math.floor(mes / 12);
    mes = mes % 12;
  }

  // Converter para YYYY-MM
  return `${ano}-${String(mes + 1).padStart(2, "0")}`;
}


// Auxiliar para somar meses "YYYY-MM"
export function addMeses(mesAno: string, quantidade: number): string {
  let [ano, mes] = mesAno.split("-").map(Number);
  mes -= 1; // para base zero

  mes += quantidade;

  ano += Math.floor(mes / 12);
  mes = mes % 12;

  return `${ano}-${String(mes + 1).padStart(2, "0")}`;
}
