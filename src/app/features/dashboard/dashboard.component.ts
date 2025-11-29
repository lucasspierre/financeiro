import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinanceApiService } from '../../core/services/finance-api.service';
import { FinanceSnapshot, Expense } from '../../core/models/finance.models';
import { gerarParcelasDeTodos } from '../../core/utils/parcelas';
import { ParcelaReal } from '../../core/models/parcela-real.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  private api = inject(FinanceApiService);

  loading = true;

  snapshot!: FinanceSnapshot;

  monthExpensesSum = 0;
  monthIncomeSum = 0;
  saldoMes = 0;
  percentageUsed = 0;

  parcelasDoMes: ParcelaReal[] = [];
  gastosFinanciamento: Expense[] = [];

  // Totais de cartão emprestado (terceiros)
  terceirosTotalCompras = 0;
  terceirosParcelasMes = 0;
  terceirosParcelasFuturas = 0;

  ngOnInit() {
    this.loadAll();
  }

  loadAll() {
    this.loading = true;

    this.api.getSnapshot().subscribe({
      next: (snap) => {
        this.snapshot = snap;
        this.processarDashboard();
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  private processarDashboard() {
    const mesRef = this.snapshot.config.referenceMonth; // "YYYY-MM"
    const [ano, mes] = mesRef.split('-').map(Number);

    // ===============================
    // 1) ENTRADAS DO MÊS
    // ===============================
    const incomesMes = this.snapshot.incomes.filter((i) => {
      const d = new Date(i.date);
      return d.getFullYear() === ano && d.getMonth() + 1 === mes;
    });
    this.monthIncomeSum = incomesMes.reduce((s, i) => s + i.amount, 0);

    // ===============================
    // 2) PARCELAS DO CARTÃO (MEU + TERCEIROS)
    // ===============================
    const todasParcelas = gerarParcelasDeTodos(this.snapshot.expenses, 28);

    this.parcelasDoMes = todasParcelas.filter(
      (p) => p.mesReferencia === mesRef
    );

    const somaParcelasMes = this.parcelasDoMes.reduce(
      (s, p) => s + p.valor,
      0
    );

    // ===============================
    // 3) DESPESAS NÃO-CARTÃO (PIX/DEBITO + FINANCIAMENTO)
    // ===============================
    const despesasNaoCartao = this.snapshot.expenses.filter((e) => {
      const d = new Date(e.date);
      const isMesRef = d.getFullYear() === ano && d.getMonth() + 1 === mes;
      const isCartao = e.type === 'CARTAO' || e.type === 'CARTAO_EMPRESTADO';
      return isMesRef && !isCartao;
    });

    const somaNaoCartao = despesasNaoCartao.reduce(
      (s, e) => s + e.amount,
      0
    );

    this.monthExpensesSum = somaParcelasMes + somaNaoCartao;

    // ===============================
    // 4) SALDO + TETO
    // ===============================
    this.saldoMes = this.monthIncomeSum - this.monthExpensesSum;

    this.percentageUsed =
      this.snapshot.config.monthlyLimit > 0
        ? (this.monthExpensesSum / this.snapshot.config.monthlyLimit) * 100
        : 0;

    // ===============================
    // 5) FINANCIAMENTO (somente para lista)
    // ===============================
    this.gastosFinanciamento = this.snapshot.expenses.filter(
      (e) => e.type === 'FINANCIAMENTO'
    );

    // ===============================
    // 6) CARTÃO EMPRESTADO (TERCEIROS)
    // ===============================
    const despesasTerceiros = this.snapshot.expenses.filter(
      (e) => e.type === 'CARTAO_EMPRESTADO'
    );

    this.terceirosTotalCompras = despesasTerceiros.reduce(
      (s, e) => s + e.amount,
      0
    );

    const parcelasTerceiros = todasParcelas.filter((p) => p.isThirdParty);

    this.terceirosParcelasMes = parcelasTerceiros
      .filter((p) => p.mesReferencia === mesRef)
      .reduce((s, p) => s + p.valor, 0);

    this.terceirosParcelasFuturas = parcelasTerceiros
      .filter((p) => p.mesReferencia > mesRef)
      .reduce((s, p) => s + p.valor, 0);
  }
}
