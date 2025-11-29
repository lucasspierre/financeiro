import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  FormsModule,
} from '@angular/forms';
import { FinanceApiService } from '../../core/services/finance-api.service';
import {
  FinanceSnapshot,
  Income,
  IncomeType,
} from '../../core/models/finance.models';
import { gerarParcelasDeTodos } from '../../core/utils/parcelas';
import { ParcelaReal } from '../../core/models/parcela-real.model';

@Component({
  selector: 'app-incomes',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './incomes.component.html',
  styleUrls: ['./incomes.component.scss'],
})
export class IncomesComponent implements OnInit {
  private api = inject(FinanceApiService);
  private fb = inject(FormBuilder);

  loading = true;
  snapshot!: FinanceSnapshot;

  incomes: Income[] = [];
  editing: Income | null = null;

  mesFiltro: string = '';
  mesesDisponiveis: string[] = [];

  reembolsosPendentesMes: ParcelaReal[] = [];

  incomeTypes: { value: IncomeType; label: string }[] = [
    { value: 'SALARIO', label: 'Salário' },
    { value: 'RECORRENTE', label: 'Recorrente' },
    { value: 'PONTUAL', label: 'Pontual' },
    { value: 'REEMBOLSO', label: 'Reembolso cartão' },
  ];

  incomeForm = this.fb.group({
    description: ['', Validators.required],
    amount: [
      null as number | null,
      [Validators.required, Validators.min(0.01)],
    ],
    date: ['', Validators.required],
    incomeType: ['PONTUAL' as IncomeType, Validators.required],
    recurring: [false],
    personName: [''],
    parcelaReferenteId: [''],
    notes: [''],
  });

  ngOnInit(): void {
    this.loadData();
  }

  loadData() {
    this.loading = true;

    this.api.getSnapshot().subscribe({
      next: (snap) => {
        this.snapshot = snap;

        this.incomes = [...snap.incomes].sort((a, b) => {
          const aT = new Date(a.date).getTime();
          const bT = new Date(b.date).getTime();
          return bT - aT;
        });

        this.mesesDisponiveis = this.gerarMesesDisponiveis();

        if (!this.mesFiltro) {
          if (this.snapshot.config.referenceMonth) {
            this.mesFiltro = this.snapshot.config.referenceMonth;
          } else if (this.mesesDisponiveis.length > 0) {
            this.mesFiltro = this.mesesDisponiveis[0];
          }
        }

        this.atualizarReembolsosPendentes();
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  gerarMesesDisponiveis(): string[] {
    const meses = new Set<string>();

    for (const i of this.incomes) {
      const d = new Date(i.date);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      meses.add(mes);
    }

    return Array.from(meses).sort().reverse();
  }

  onMesFiltroChange() {
    this.atualizarReembolsosPendentes();
  }

  get incomesFiltradas(): Income[] {
    if (!this.mesFiltro) return this.incomes;

    return this.incomes.filter((i) => {
      const d = new Date(i.date);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return mes === this.mesFiltro;
    });
  }

  get totalMensal(): number {
    return this.incomesFiltradas.reduce((s, i) => s + i.amount, 0);
  }

  get totalReembolsosMensal(): number {
    return this.incomesFiltradas
      .filter((i) => i.incomeType === 'REEMBOLSO')
      .reduce((s, i) => s + i.amount, 0);
  }

  atualizarReembolsosPendentes() {
    if (!this.snapshot) {
      this.reembolsosPendentesMes = [];
      return;
    }

    const todasParcelas = gerarParcelasDeTodos(
      this.snapshot.expenses,
      28
    );

    const parcelasTerceirosMes = todasParcelas.filter(
      (p) =>
        p.isThirdParty &&
        (!this.mesFiltro || p.mesReferencia === this.mesFiltro)
    );

    const idsParcelasRecebidas = new Set(
      this.incomes
        .filter(
          (i) =>
            i.incomeType === 'REEMBOLSO' && i.parcelaReferenteId
        )
        .map((i) => i.parcelaReferenteId as string)
    );

    this.reembolsosPendentesMes = parcelasTerceirosMes.filter(
      (p) => !idsParcelasRecebidas.has(p.parcelaId)
    );
  }

  preencherReembolso(p: ParcelaReal) {
    const descricaoBase = p.description || 'Compra cartão';
    const pessoa = p.personName ? ` ${p.personName}` : '';
    const texto = `Reembolso${pessoa} - ${descricaoBase} (${p.numero}/${p.total})`;

    this.incomeForm.patchValue({
      incomeType: 'REEMBOLSO',
      description: texto,
      amount: p.valor,
      date: new Date().toISOString().substring(0, 10),
      personName: p.personName || '',
      parcelaReferenteId: p.parcelaId,
    });
  }

  iniciarEdicao(i: Income) {
    this.editing = { ...i };
  }

  salvarEdicao() {
    if (!this.editing) return;

    this.api
      .updateIncome(this.editing.id, this.editing)
      .subscribe(() => {
        this.editing = null;
        this.loadData();
      });
  }

  deletar(id: string) {
    if (!confirm('Deseja realmente excluir esta entrada?')) return;

    this.api.deleteIncome(id).subscribe(() => this.loadData());
  }

  submitForm() {
    if (this.incomeForm.invalid) return;

    const v = this.incomeForm.value;

    const newIncome: Omit<Income, 'id'> = {
      description: v.description!,
      amount: v.amount!,
      date: v.date!,
      incomeType: v.incomeType!,
      recurring:
        (v.incomeType === 'SALARIO' || v.incomeType === 'RECORRENTE')
          ? !!v.recurring
          : undefined,
      personName:
        v.incomeType === 'REEMBOLSO' && v.personName
          ? v.personName
          : undefined,
      parcelaReferenteId:
        v.incomeType === 'REEMBOLSO' && v.parcelaReferenteId
          ? v.parcelaReferenteId
          : undefined,
      notes: v.notes || undefined,
    };

    this.api.addIncome(newIncome).subscribe(() => {
      this.incomeForm.reset({
        incomeType: 'PONTUAL',
        date: new Date().toISOString().substring(0, 10),
        recurring: false,
      });
      this.loadData();
    });
  }
}
