export interface ParcelaReal {
  parcelaId: string;      // ID sintético: expenseId + "#númeroDaParcela"

  numero: number;         // nº da parcela (1,2,...)
  total: number;          // total de parcelas
  valor: number;          // valor da parcela

  mesReferencia: string;  // "YYYY-MM"
  competenciaDate: string;// data equivalente ao vencimento (fechamento)

  description: string;    // descrição da compra original
  expenseId: string;
  personName?: string;
  isThirdParty: boolean;  // se veio de CARTAO_EMPRESTADO
}
