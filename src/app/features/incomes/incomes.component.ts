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
import {
  gerarParcelasDeTodos,
  addMeses,
  gerarRangeMeses,
} from '../../core/utils/parcelas';
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
  
  // Controla o item sendo editado
  editing: Income | null = null;

  mesFiltro: string = '';
  mesesDisponiveis: string[] = [];
  sortOrder: string = 'DATE_DESC';

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

        // LÓGICA CORRIGIDA: Removemos o referenceMonth e priorizamos o mês atual
        if (!this.mesFiltro) {
            const hoje = new Date();
            const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
            
            if (this.mesesDisponiveis.includes(mesAtual)) {
              this.mesFiltro = mesAtual;
            } else if (this.mesesDisponiveis.length > 0) {
              // Se não tiver o mês atual, pega o mais recente (primeiro da lista, pois geralmente invertemos no template ou aqui)
              // Como gerarRangeMeses retorna crescente, e queremos o mais recente se não tiver o atual:
              // Vamos pegar o último da lista se a lista for crescente, ou o primeiro se você inverteu em outro lugar.
              // No padrão do gerarRangeMeses ele é crescente. Vamos pegar o último (mais futuro) ou o primeiro.
              // Geralmente em financeiro, se não tem o mês atual, mostra o último mês com dados.
              this.mesFiltro = this.mesesDisponiveis[this.mesesDisponiveis.length - 1];
            }
        }

        this.atualizarReembolsosPendentes();
        this.processarFiltros();
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  } 

  formatMonthLabel(mesIso: string): string {
    if (!mesIso) return '';
    const [ano, mes] = mesIso.split('-');
    return `${mes}/${ano}`;
  }

  gerarMesesDisponiveis(): string[] {
    let minMes = '9999-99';
    let maxMes = '0000-00';
    const hoje = new Date();
    const mesAtual = `${hoje.getFullYear()}-${String(
      hoje.getMonth() + 1
    ).padStart(2, '0')}`;
    if (mesAtual < minMes) minMes = mesAtual;
    if (mesAtual > maxMes) maxMes = mesAtual;

    for (const i of this.incomes) {
      const d = new Date(i.date + 'T12:00:00');
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        '0'
      )}`;
      if (mes < minMes) minMes = mes;
      if (mes > maxMes) maxMes = mes;
    }

    if (this.snapshot && this.snapshot.expenses) {
      const todasParcelas = gerarParcelasDeTodos(
        this.snapshot.expenses,
        this.snapshot.cards
      );
      for (const p of todasParcelas) {
        if (p.isThirdParty) {
          const dueMonth = addMeses(p.mesReferencia, 1);
          if (dueMonth < minMes) minMes = dueMonth;
          if (dueMonth > maxMes) maxMes = dueMonth;
        }
      }
    }

    // Considera projeção futura para itens recorrentes ativos
    if (this.incomes.some((i) => i.recurring)) {
      const mesFuturo12 = addMeses(mesAtual, 12);
      if (mesFuturo12 > maxMes) maxMes = mesFuturo12;
    }

    return gerarRangeMeses(minMes, maxMes);
  }

  onMesFiltroChange() {
    this.atualizarReembolsosPendentes();
    this.processarFiltros();
  }

  private applySort(a: Income, b: Income): number {
    const dateA = new Date(a.date + 'T12:00:00').getTime();
    const dateB = new Date(b.date + 'T12:00:00').getTime();

    switch (this.sortOrder) {
      case 'DATE_DESC':
        return dateB - dateA; 
      case 'DATE_ASC':
        return dateA - dateB; 
      case 'VAL_DESC':
        return b.amount - a.amount; 
      case 'VAL_ASC':
        return a.amount - b.amount; 
      default:
        return 0;
    }
  }

  processarFiltros() {
    if (!this.mesFiltro) {
      this.filteredIncomes = [...this.incomes];
      this.filteredIncomes.sort((a, b) => this.applySort(a, b));
      return;
    }

    // 1. Entradas REAIS deste mês
    const reais = this.incomes.filter((i) => {
      const d = new Date(i.date + 'T12:00:00');
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        '0'
      )}`;
      return mes === this.mesFiltro;
    });

    // 2. Entradas VIRTUAIS (Projeção)
    const virtuais: Income[] = [];
    const ultimasRecorrentes = new Map<string, Income>();
    
    // Ordena por data (crescente) para garantir que pegamos a última ocorrência
    const sorted = [...this.incomes].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    // Mapeia a última ocorrência de cada descrição (independente de ser recorrente ou não)
    for (const inc of sorted) {
        ultimasRecorrentes.set(inc.description, inc);
    }

    for (const [desc, ult] of ultimasRecorrentes) {
      // Se a última ocorrência NÃO for recorrente (foi desativada), não projeta
      if (!ult.recurring) continue;

      const mesUltimo = ult.date.substring(0, 7);

      // Se a última ocorrência é anterior ao filtro atual, projeta
      if (this.mesFiltro > mesUltimo) {
        // Verifica se já existe uma entrada real com essa descrição neste mês
        const jaExiste = reais.find((r) => r.description === desc);
        if (!jaExiste) {
          const diaOriginal = ult.date.split('-')[2];
          const idVirtual = `VIRTUAL-${this.mesFiltro}-${desc.replace(
            /\s/g,
            ''
          )}`;
          virtuais.push({
            ...ult,
            id: idVirtual,
            date: `${this.mesFiltro}-${diaOriginal}`,
          });
        }
      }
    }

    this.filteredIncomes = [...reais, ...virtuais].sort((a, b) =>
      this.applySort(a, b)
    );
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

    const parcelasTerceirosMes = todasParcelas.filter((p) => {
      const dueMonth = addMeses(p.mesReferencia, 1);
      return p.isThirdParty && (!this.mesFiltro || dueMonth === this.mesFiltro);
    });

    const idsParcelasRecebidas = new Set(
      this.incomes
        .filter((i) => i.incomeType === 'REEMBOLSO' && i.parcelaReferenteId)
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
    
    // Scroll para o formulário
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  iniciarEdicao(i: Income) {
    this.editing = { ...i };

    this.incomeForm.patchValue({
      description: i.description,
      amount: i.amount,
      date: i.date,
      incomeType: i.incomeType,
      recurring: i.recurring || false,
      personName: i.personName || '',
      parcelaReferenteId: i.parcelaReferenteId || '',
      notes: i.notes || ''
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  cancelarEdicao() {
    this.editing = null;
    this.incomeForm.reset({
      incomeType: 'PONTUAL',
      date: new Date().toISOString().substring(0, 10),
      recurring: false,
    });
  }

  confirmarVirtual(i: Income) {
    // Popup removido conforme solicitado
    const novo: Omit<Income, 'id'> = {
      description: i.description,
      amount: i.amount,
      date: i.date,
      incomeType: i.incomeType,
      recurring: true, // Mantém recorrente para continuar a cadeia
      personName: i.personName,
      notes: i.notes,
    };

    this.api.addIncome(novo).subscribe(() => this.loadData());
  }

  deletar(id: string) {
    if (id.startsWith('VIRTUAL-')) {
      alert(
        'Este é um item PREVISTO gerado automaticamente (recorrente). Para parar de projetar este valor, edite a entrada original do mês anterior e desmarque a opção "Recorrente".'
      );
      return;
    }
    // Popup removido conforme solicitado
    this.api.deleteIncome(id).subscribe(() => this.loadData());
  }

  submitForm() {
    if (this.incomeForm.invalid) return;

    const v = this.incomeForm.value;

    const incomePayload: any = {
      description: v.description!,
      amount: v.amount!,
      date: v.date!,
      incomeType: v.incomeType!,
      // Salva o estado do checkbox independentemente do tipo
      recurring: !!v.recurring, 
      personName:
        v.incomeType === 'REEMBOLSO' && v.personName ? v.personName : undefined,
      parcelaReferenteId:
        v.incomeType === 'REEMBOLSO' && v.parcelaReferenteId
          ? v.parcelaReferenteId
          : undefined,
      notes: v.notes || undefined,
    };

    if (this.editing) {
      // Se for virtual, cria novo
      if (this.editing.id.startsWith('VIRTUAL-')) {
         this.api.addIncome(incomePayload).subscribe(() => {
           this.cancelarEdicao();
           this.loadData();
         });
      } else {
         // Se for real, atualiza
         this.api.updateIncome(this.editing.id, incomePayload).subscribe(() => {
           this.cancelarEdicao();
           this.loadData();
         });
      }
    } else {
      this.api.addIncome(incomePayload).subscribe(() => {
        this.cancelarEdicao();
        this.loadData();
      });
    }
  }
}