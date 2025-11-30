import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinanceApiService } from '../../core/services/finance-api.service';
import {
  Expense,
  ExpenseType,
  FinanceSnapshot,
  CreditCard
} from '../../core/models/finance.models';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  FormsModule,
} from '@angular/forms';
import { gerarParcelasDeUmaDespesa, gerarRangeMeses, addMeses } from '../../core/utils/parcelas';

// Interface unificada para exibição na tabela
interface ExpenseViewItem {
  id?: string;            // ID da despesa (só para contas avulsas)
  type: 'CONTA' | 'FATURA';
  date: string;           // Data de vencimento
  description: string;    // "Aluguel" ou "Fatura Nubank"
  categoryLabel: string;  // "Pix", "Financiamento", "Cartão"
  amount: number;
  cardId?: string;        // Se for fatura, qual cartão
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

  loading = true;
  snapshot!: FinanceSnapshot;
  
  // Listas
  allItems: ExpenseViewItem[] = [];     
  
  // Filtros
  filterMonth: string = '';      
  filterCategory: string = '';   
  sortOrder: string = 'DATE_ASC';

  mesesDisponiveis: string[] = [];

  // Formulário
  expenseTypes: { value: ExpenseType; label: string }[] = [
    { value: 'PIX_DEBITO', label: 'Pix / Débito / Dinheiro' },
    { value: 'FINANCIAMENTO', label: 'Financiamento / Boleto' },
  ];

  expenseForm = this.fb.group({
    description: ['', Validators.required],
    amount: [
      null as number | null,
      [Validators.required, Validators.min(0.01)],
    ],
    date: ['', Validators.required],
    type: ['PIX_DEBITO' as ExpenseType, Validators.required],
    notes: [''],
  });

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.loading = true;
    this.api.getSnapshot().subscribe({
      next: (snap) => {
        this.snapshot = snap;
        this.processarDespesasHibridas();
        
        if (!this.filterMonth && this.mesesDisponiveis.length > 0) {
             const hoje = new Date();
             const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
             
             if (this.mesesDisponiveis.includes(mesAtual)) {
                 this.filterMonth = mesAtual;
             } else {
                 this.filterMonth = this.mesesDisponiveis[0];
             }
        }

        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  // Helper para formatar YYYY-MM -> MM/YYYY no template
  formatMonthLabel(mesIso: string): string {
    if (!mesIso) return '';
    const [ano, mes] = mesIso.split('-');
    return `${mes}/${ano}`;
  }

  processarDespesasHibridas() {
    this.allItems = [];
    
    let minMes = '9999-99';
    let maxMes = '0000-00';
    const hoje = new Date().toISOString().substring(0, 7);
    
    // O range de meses para o filtro é baseado no MÊS DE VENCIMENTO.
    if (hoje < minMes) minMes = hoje;
    if (hoje > maxMes) maxMes = hoje;

    // 1. Contas (Data de Vencimento = Data de Referência/Competência)
    const contas = this.snapshot.expenses.filter(e => e.type !== 'CARTAO');
    for (const c of contas) {
        const mesRef = c.date.substring(0, 7); 
        this.allItems.push({
            id: c.id,
            type: 'CONTA',
            date: c.date, // Data de Vencimento é a data da conta
            description: c.description,
            categoryLabel: c.type === 'PIX_DEBITO' ? 'Pix/Débito' : 'Financiamento',
            amount: c.amount
        });
        if (mesRef < minMes) minMes = mesRef;
        if (mesRef > maxMes) maxMes = mesRef;
    }

    // 2. Faturas (Data de Vencimento)
    // CORREÇÃO 1: Devemos filtrar APENAS as compras de CARTÃO.
    const comprasCartao = this.snapshot.expenses.filter(e => e.type === 'CARTAO');
    
    // O mapa deve agrupar pelo MÊS DE VENCIMENTO (Due Month), pois a filtragem da lista final é por VENCIMENTO.
    const faturasMap = new Map<string, number>();

    for (const compra of comprasCartao) {
        const card = this.snapshot.cards.find(c => c.id === compra.cardId);
        const bestPurchaseDay = card ? card.bestPurchaseDay : 1;
        const parcelas = gerarParcelasDeUmaDespesa(compra, bestPurchaseDay);

        for (const p of parcelas) {
            // mesRef é o mês de competência (Referência)
            const mesRef = p.mesReferencia; 
            
            // CORREÇÃO 2: O mês de vencimento (Due Month) é o MÊS DE REFERÊNCIA + 1 MÊS
            const dueMonth = addMeses(mesRef, 1);
            
            // A chave de agrupamento deve ser baseada no MÊS DE VENCIMENTO e no Card ID
            const chave = `${compra.cardId || 'unknown'}|${dueMonth}`; 
            
            const atual = faturasMap.get(chave) || 0;
            faturasMap.set(chave, atual + p.valor);
            
            // Usa o mês de vencimento para determinar o range dos filtros
            if (dueMonth > maxMes) maxMes = dueMonth;
            if (dueMonth < minMes) minMes = dueMonth;
        }
    }

    // Gerando a lista final de Faturas a partir do mapa agrupado por Mês de Vencimento
    for (const [chave, valor] of faturasMap) {
        const [cardId, dueMonth] = chave.split('|'); // dueMonth é o Mês de Vencimento
        const card = this.snapshot.cards.find(c => c.id === cardId);
        
        // Dia de Vencimento
        const diaVenc = card ? String(card.dueDay).padStart(2, '0') : '10';
        // Data de Vencimento
        const dataVencimento = `${dueMonth}-${diaVenc}`;

        this.allItems.push({
            type: 'FATURA',
            date: dataVencimento, // Data de Vencimento (usada para filtragem)
            description: `Fatura ${card ? card.name : 'Cartão'}`,
            categoryLabel: 'Fatura Cartão',
            amount: valor,
            cardId: cardId === 'unknown' ? undefined : cardId
        });
    }

    // O range de meses disponíveis agora considera o mês de Vencimento das faturas/contas
    this.mesesDisponiveis = gerarRangeMeses(minMes, maxMes);
  }

  get filteredItems(): ExpenseViewItem[] {
      let list = [...this.allItems];

      // filterMonth agora representa o MÊS DE VENCIMENTO
      if (this.filterMonth) {
          list = list.filter(item => item.date.startsWith(this.filterMonth));
      }

      if (this.filterCategory) {
          if (this.filterCategory === 'FATURA') {
              list = list.filter(item => item.type === 'FATURA');
          } else if (this.filterCategory === 'CONTA') {
              list = list.filter(item => item.type === 'CONTA');
          }
      }

      return list.sort((a, b) => {
          const dateA = new Date(a.date + 'T12:00:00').getTime();
          const dateB = new Date(b.date + 'T12:00:00').getTime();

          switch (this.sortOrder) {
              case 'DATE_ASC': return dateA - dateB;
              case 'DATE_DESC': return dateB - dateA;
              case 'VAL_DESC': return b.amount - a.amount;
              case 'VAL_ASC': return a.amount - b.amount;
              default: return 0;
          }
      });
  }

  get totalFiltered(): number {
      return this.filteredItems.reduce((acc, item) => acc + item.amount, 0);
  }

  submitForm() {
    if (this.expenseForm.invalid) return;
    const val = this.expenseForm.value;

    const newExpense: Omit<Expense, 'id'> = {
      description: val.description!,
      amount: val.amount!,
      date: val.date!,
      type: val.type!,
      notes: val.notes || undefined,
    };

    this.api.addExpense(newExpense).subscribe(() => {
      this.expenseForm.reset({
        type: 'PIX_DEBITO',
        date: new Date().toISOString().substring(0, 10),
      });
      this.loadData();
    });
  }

  deletar(item: ExpenseViewItem) {
      if (item.type === 'FATURA') {
          alert('Para alterar o valor da fatura, vá na aba "Cartões" e edite as compras deste mês.');
          return;
      }
      if (!confirm('Deseja realmente excluir esta conta?')) return;
      this.api.deleteExpense(item.id!).subscribe(() => this.loadData());
  }
}