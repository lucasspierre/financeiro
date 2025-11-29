import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinanceApiService } from '../../core/services/finance-api.service';
import {
  Expense,
  ExpenseType,
  FinanceSnapshot,
} from '../../core/models/finance.models';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  FormsModule,
} from '@angular/forms';
import { gerarParcelasDeTodos } from '../../core/utils/parcelas';
import { ParcelaReal } from '../../core/models/parcela-real.model';

interface LinhaParcelasFuturas {
  expenseId: string;
  description: string;
  personName?: string;
  isThirdParty: boolean;
  valoresPorMes: { [mes: string]: number }; // "YYYY-MM" -> soma das parcelas
}

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './expenses.component.html',
  styleUrls: ['./expenses.component.scss'],
})
export class ExpensesComponent implements OnInit {
  private api = inject(FinanceApiService);
  private fb = inject(FormBuilder);

  orderMode: 'ASC' | 'DESC' = 'DESC';

  expenses: Expense[] = [];
  loading = true;

  editing: Expense | null = null;

  // FILTRO DE MÊS (extrato)
  mesFiltro: string = '';
  mesesDisponiveis: string[] = [];

  // PARCELAS FUTURAS (tabela por mês)
  mesesFuturosHeader: string[] = [];
  parcelasFuturasLinhas: LinhaParcelasFuturas[] = [];
  totaisMes: { [mes: string]: number } = {};
  totaisMesTerceiros: { [mes: string]: number } = {};
  totaisMesMeus: { [mes: string]: number } = {};

  expenseTypes: { value: ExpenseType; label: string }[] = [
    { value: 'CARTAO', label: 'Cartão (minhas compras)' },
    { value: 'CARTAO_EMPRESTADO', label: 'Cartão emprestado (terceiros)' },
    { value: 'PIX_DEBITO', label: 'Pix / Débito' },
    { value: 'FINANCIAMENTO', label: 'Financiamento / Empréstimo' },
  ];

  expenseForm = this.fb.group({
    description: ['', Validators.required],
    amount: [
      null as number | null,
      [Validators.required, Validators.min(0.01)],
    ],
    date: ['', Validators.required],
    type: ['CARTAO' as ExpenseType, Validators.required],
    totalInstallments: [null as number | null],
    installmentValue: [null as number | null],
    personName: [''],
    notes: [''],
  });

  ngOnInit() {
    this.loadExpenses();
  }

  trocarOrdenacao(modo: 'ASC' | 'DESC') {
    this.orderMode = modo;
    this.loadExpenses();
  }

  deletar(id: string) {
    if (!confirm('Deseja realmente excluir esta despesa?')) return;
    this.api.deleteExpense(id).subscribe(() => this.loadExpenses());
  }

  iniciarEdicao(item: Expense) {
    this.editing = { ...item };
  }

  salvarEdicao() {
    if (!this.editing) return;
    this.api.updateExpense(this.editing.id, this.editing).subscribe(() => {
      this.editing = null;
      this.loadExpenses();
    });
  }

  loadExpenses() {
    this.loading = true;

    this.api.getSnapshot().subscribe({
      next: (snap: FinanceSnapshot) => {
        this.expenses = snap.expenses.sort((a, b) => {
          const aT = new Date(a.date).getTime();
          const bT = new Date(b.date).getTime();
          return this.orderMode === 'ASC' ? aT - bT : bT - aT;
        });

        // Meses disponíveis para extrato (por data de compra)
        this.mesesDisponiveis = this.gerarMesesDisponiveis();

        if (!this.mesFiltro && this.mesesDisponiveis.length > 0) {
          this.mesFiltro = this.mesesDisponiveis[0];
        }

        // Montar tabela de parcelas futuras
        this.montarParcelasFuturas();

        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  // ---------- VALOR PARCELA ----------
  getValorParcela(e: Expense): number {
    if (e.installmentValue && e.installmentValue > 0) {
      return e.installmentValue;
    }

    if (
      (e.type === 'CARTAO' || e.type === 'CARTAO_EMPRESTADO') &&
      e.totalInstallments &&
      e.totalInstallments > 0
    ) {
      return Math.round((e.amount / e.totalInstallments) * 100) / 100;
    }

    return e.amount;
  }

  getTotalParcelas(e: Expense): number {
    if (e.totalInstallments && e.totalInstallments > 0) {
      return e.totalInstallments;
    }
    return 1;
  }

  // ---------- MESES DISPONÍVEIS (extrato) ----------
  gerarMesesDisponiveis(): string[] {
    const meses = new Set<string>();

    for (const e of this.expenses) {
      const d = new Date(e.date);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        '0'
      )}`;
      meses.add(mes);
    }

    return Array.from(meses).sort().reverse(); // mais recente primeiro
  }

  // ---------- DESPESAS FILTRADAS (extrato) ----------
  get despesasFiltradas(): Expense[] {
    if (!this.mesFiltro) return this.expenses;

    return this.expenses.filter((e) => {
      const d = new Date(e.date);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        '0'
      )}`;
      return mes === this.mesFiltro;
    });
  }

  // ---------- TOTALIZADORES DO EXTRATO ----------
  get totalMensal(): number {
    return this.despesasFiltradas.reduce((s, e) => s + e.amount, 0);
  }

  get totalParcelaMensal(): number {
    return this.despesasFiltradas.reduce(
      (s, e) => s + this.getValorParcela(e),
      0
    );
  }

  // ---------- PARCELAS FUTURAS (tabela por mês) ----------
  private montarParcelasFuturas() {
    // Gera TODAS as parcelas de cartão (meu + terceiros)
    const todasParcelas: ParcelaReal[] = gerarParcelasDeTodos(
      this.expenses,
      28
    );

    if (!todasParcelas.length) {
      this.mesesFuturosHeader = [];
      this.parcelasFuturasLinhas = [];
      this.totaisMes = {};
      this.totaisMesTerceiros = {};
      this.totaisMesMeus = {};
      return;
    }

    // Mês atual (inclui no range)
    const hoje = new Date();
    const mesAtual = `${hoje.getFullYear()}-${String(
      hoje.getMonth() + 1
    ).padStart(2, '0')}`;

    // Filtrar apenas parcelas a partir do mês atual (incluindo)
    const futuras = todasParcelas.filter(
      (p) => p.mesReferencia >= mesAtual
    );

    if (!futuras.length) {
      this.mesesFuturosHeader = [];
      this.parcelasFuturasLinhas = [];
      this.totaisMes = {};
      this.totaisMesTerceiros = {};
      this.totaisMesMeus = {};
      return;
    }

    // Descobrir último mês entre as parcelas
    let maxMes = futuras[0].mesReferencia;
    for (const p of futuras) {
      if (p.mesReferencia > maxMes) maxMes = p.mesReferencia;
    }

    // Montar range de meses: do mesAtual até maxMes (opção C + incluir mês atual)
    this.mesesFuturosHeader = this.gerarRangeMeses(mesAtual, maxMes);

    // Construir linhas por despesa
    const mapaLinhas = new Map<string, LinhaParcelasFuturas>();

    for (const p of futuras) {
      let linha = mapaLinhas.get(p.expenseId);
      if (!linha) {
        linha = {
          expenseId: p.expenseId,
          description: p.description,
          personName: p.personName,
          isThirdParty: p.isThirdParty,
          valoresPorMes: {},
        };
        mapaLinhas.set(p.expenseId, linha);
      }

      linha.valoresPorMes[p.mesReferencia] =
        (linha.valoresPorMes[p.mesReferencia] || 0) + p.valor;
    }

    this.parcelasFuturasLinhas = Array.from(mapaLinhas.values());

    // Totais por mês
    this.totaisMes = {};
    this.totaisMesTerceiros = {};
    this.totaisMesMeus = {};

    for (const mes of this.mesesFuturosHeader) {
      let totalGeral = 0;
      let totalTerceiros = 0;
      let totalMeus = 0;

      for (const linha of this.parcelasFuturasLinhas) {
        const valor = linha.valoresPorMes[mes] || 0;
        totalGeral += valor;
        if (linha.isThirdParty) {
          totalTerceiros += valor;
        } else {
          totalMeus += valor;
        }
      }

      this.totaisMes[mes] = totalGeral;
      this.totaisMesTerceiros[mes] = totalTerceiros;
      this.totaisMesMeus[mes] = totalMeus;
    }
  }

  private gerarRangeMeses(inicio: string, fim: string): string[] {
    const [yIni, mIni] = inicio.split('-').map(Number);
    const [yFim, mFim] = fim.split('-').map(Number);

    const resultado: string[] = [];

    let ano = yIni;
    let mes = mIni;

    while (ano < yFim || (ano === yFim && mes <= mFim)) {
      resultado.push(
        `${ano}-${String(mes).padStart(2, '0')}`
      );

      mes += 1;
      if (mes > 12) {
        mes = 1;
        ano += 1;
      }
    }

    return resultado;
  }

  formatMesLabel(m: string): string {
    const [ano, mes] = m.split('-');
    return `${mes}/${ano.slice(-2)}`;
  }

  // ---------- SUBMIT ----------
  submitForm() {
    if (this.expenseForm.invalid) return;

    const form = this.expenseForm.value;

    const newExpense: Omit<Expense, 'id'> = {
      description: form.description!,
      amount: form.amount!,
      date: form.date!,
      type: form.type!,
      totalInstallments:
        form.totalInstallments && form.totalInstallments > 0
          ? form.totalInstallments
          : undefined,
      installmentValue:
        form.installmentValue && form.installmentValue > 0
          ? form.installmentValue
          : undefined,
      personName:
        form.type === 'CARTAO_EMPRESTADO' && form.personName
          ? form.personName
          : undefined,
      notes: form.notes || undefined,
    };

    this.api.addExpense(newExpense).subscribe(() => {
      this.expenseForm.reset({
        type: 'CARTAO',
        date: new Date().toISOString().substring(0, 10),
      });
      this.loadExpenses();
    });
  }
}
