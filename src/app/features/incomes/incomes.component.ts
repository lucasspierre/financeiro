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
import { gerarParcelasDeTodos, addMeses, gerarRangeMeses } from '../../core/utils/parcelas';
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
  filteredIncomes: Income[] = []; 
  
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
          const aT = new Date(a.date + 'T12:00:00').getTime();
          const bT = new Date(b.date + 'T12:00:00').getTime();
          return bT - aT;
        });

        this.mesesDisponiveis = this.gerarMesesDisponiveis();

        if (!this.mesFiltro) {
          if (
            this.snapshot.config.referenceMonth &&
            this.mesesDisponiveis.includes(this.snapshot.config.referenceMonth)
          ) {
            this.mesFiltro = this.snapshot.config.referenceMonth;
          } else if (this.mesesDisponiveis.length > 0) {
            const hoje = new Date();
            const mesAtual = `${hoje.getFullYear()}-${String(
              hoje.getMonth() + 1
            ).padStart(2, '0')}`;
            
            if (this.mesesDisponiveis.includes(mesAtual)) {
              this.mesFiltro = mesAtual;
            } else {
              this.mesFiltro = this.mesesDisponiveis[0];
            }
          }
        }

        this.atualizarReembolsosPendentes();
        this.processarFiltros(); 
        
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  // Helper para formatar YYYY-MM -> MM/YYYY
  formatMonthLabel(mesIso: string): string {
    if (!mesIso) return '';
    const [ano, mes] = mesIso.split('-');
    return `${mes}/${ano}`;
  }

  gerarMesesDisponiveis(): string[] {
    let minMes = '9999-99';
    let maxMes = '0000-00';
    const hoje = new Date();
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    
    if (mesAtual < minMes) minMes = mesAtual;
    if (mesAtual > maxMes) maxMes = mesAtual;

    for (const i of this.incomes) {
      const d = new Date(i.date + 'T12:00:00');
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (mes < minMes) minMes = mes;
      if (mes > maxMes) maxMes = mes;
    }

    if (this.snapshot && this.snapshot.expenses) {
      const todasParcelas = gerarParcelasDeTodos(this.snapshot.expenses, this.snapshot.cards);
      for (const p of todasParcelas) {
        if (p.isThirdParty) {
          if (p.mesReferencia < minMes) minMes = p.mesReferencia;
          if (p.mesReferencia > maxMes) maxMes = p.mesReferencia;
        }
      }
    }

    if (this.incomes.some(i => i.recurring)) {
        const mesFuturo12 = addMeses(mesAtual, 12);
        if (mesFuturo12 > maxMes) maxMes = mesFuturo12;
    }

    return gerarRangeMeses(minMes, maxMes);
  }

  onMesFiltroChange() {
    this.atualizarReembolsosPendentes();
    this.processarFiltros(); 
  }

  processarFiltros() {
    if (!this.mesFiltro) {
        this.filteredIncomes = [...this.incomes];
        return;
    }

    const reais = this.incomes.filter((i) => {
      const d = new Date(i.date + 'T12:00:00');
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return mes === this.mesFiltro;
    });

    const virtuais: Income[] = [];
    
    const ultimasRecorrentes = new Map<string, Income>();
    const sorted = [...this.incomes].sort((a,b) => a.date.localeCompare(b.date));
    
    for (const inc of sorted) {
        if (inc.recurring) {
            ultimasRecorrentes.set(inc.description, inc);
        }
    }

    for (const [desc, ult] of ultimasRecorrentes) {
        const mesUltimo = ult.date.substring(0, 7);

        if (this.mesFiltro > mesUltimo) {
            const jaExiste = reais.find(r => r.description === desc);
            
            if (!jaExiste) {
                const diaOriginal = ult.date.split('-')[2];
                const idVirtual = `VIRTUAL-${this.mesFiltro}-${desc.replace(/\s/g, '')}`;
                
                virtuais.push({
                    ...ult,
                    id: idVirtual,
                    date: `${this.mesFiltro}-${diaOriginal}`,
                });
            }
        }
    }

    this.filteredIncomes = [...reais, ...virtuais].sort((a,b) => {
        return new Date(b.date + 'T12:00:00').getTime() - new Date(a.date + 'T12:00:00').getTime();
    });
  }

  get totalMensal(): number {
    return this.filteredIncomes.reduce((s, i) => s + i.amount, 0);
  }

  get totalReembolsosMensal(): number {
    return this.filteredIncomes
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
      this.snapshot.cards
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

  confirmarVirtual(i: Income) {
    const novo: Omit<Income, 'id'> = {
        description: i.description,
        amount: i.amount,
        date: i.date,
        incomeType: i.incomeType,
        recurring: true,
        personName: i.personName,
        notes: i.notes
    };

    if (confirm(`Deseja efetivar a entrada "${i.description}" para este mês?`)) {
        this.api.addIncome(novo).subscribe(() => this.loadData());
    }
  }

  salvarEdicao() {
    if (!this.editing) return;

    if (this.editing.id.startsWith('VIRTUAL-')) {
        const novo: Omit<Income, 'id'> = { ...this.editing };
        const { id, ...payload } = novo as any; 
        
        this.api.addIncome(payload).subscribe(() => {
            this.editing = null;
            this.loadData();
        });
        return;
    }

    this.api
      .updateIncome(this.editing.id, this.editing)
      .subscribe(() => {
        this.editing = null;
        this.loadData();
      });
  }

  deletar(id: string) {
    if (id.startsWith('VIRTUAL-')) {
        alert('Este é um item PREVISTO gerado automaticamente (recorrente). Não pode ser excluído diretamente. Para removê-lo ou zerar o valor, você deve editar ou excluir a recorrência original no mês em que ela foi lançada pela primeira vez.');
        return;
    }
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