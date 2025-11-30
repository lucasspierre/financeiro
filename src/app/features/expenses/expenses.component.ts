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
import { forkJoin, Observable } from 'rxjs'; 

// Interface unificada para exibição na tabela
interface ExpenseViewItem {
  id?: string;            // ID da despesa (só para contas avulsas)
  type: 'CONTA' | 'FATURA';
  date: string;           // Data de vencimento
  description: string;    // "Aluguel" ou "Fatura Nubank"
  categoryLabel: string;  // "Pix", "Financiamento", "Cartão"
  amount: number;
  cardId?: string;        // Se for fatura, qual cartão
  isPaid?: boolean;       // Indica se a conta foi paga
}

// Interface para os Detalhes da Parcela na Fatura
interface ParcelaDetalhe {
    description: string;
    amountTotal: number; // Valor total da compra original
    parcelaAtual: number; // Número da parcela neste mês
    parcelasTotal: number; // Total de parcelas
    valorParcela: number; // Valor desta parcela (que compõe a fatura)
    saldoRestante: number; // Saldo a pagar após esta parcela
    dateCompra: string;
    personName?: string;
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
  
  // Propriedades para Detalhes da Fatura
  showDetailsModal = false;
  faturaDetalhes: ParcelaDetalhe[] = [];
  faturaDetalhesCardName: string = '';
  faturaDetalhesTotal: number = 0;

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
    // isRecurring: [false], // REMOVIDO
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
        
        // Define o mês de filtro após o processamento
        if (!this.filterMonth && this.mesesDisponiveis.length > 0) {
             const hoje = new Date();
             const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
             
             // Prioriza o mês atual, se estiver no range
             if (this.mesesDisponiveis.includes(mesAtual)) {
                 this.filterMonth = mesAtual;
             } else {
                 // Caso contrário, usa o primeiro mês disponível
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

  // Helper para faturas (mantido inalterado)
  private getPurchasesForFatura(cardId: string, dueMonth: string, card: CreditCard | undefined): Expense[] {
      const purchases = this.snapshot.expenses.filter(e => e.type === 'CARTAO' && e.cardId === cardId);
      const bestPurchaseDay = card ? card.bestPurchaseDay : 1;
      const diaVencimento = card ? card.dueDay : 10;

      const contributingPurchases: Expense[] = [];

      for (const purchase of purchases) {
          const parcels = gerarParcelasDeUmaDespesa(purchase, bestPurchaseDay, diaVencimento);
          
          const parcelDueThisMonth = parcels.find(p => addMeses(p.mesReferencia, 1) === dueMonth);
          
          if (parcelDueThisMonth) {
              contributingPurchases.push(purchase);
          }
      }
      return contributingPurchases;
  }


  processarDespesasHibridas() {
    this.allItems = [];
    
    // 1. Determinação do Range de Meses
    const hoje = new Date().toISOString().substring(0, 7);
    let minMes = hoje;
    let maxMes = hoje; 
    
    // Garante que o range inclui o mês da despesa mais antiga
    this.snapshot.expenses.forEach(e => {
        const mesRef = e.date.substring(0, 7);
        if (mesRef < minMes) minMes = mesRef;
    });

    // 2. Contas Avulsas (Pix/Financiamento) - SEM LÓGICA DE RECORRÊNCIA
    const contas = this.snapshot.expenses.filter(e => e.type !== 'CARTAO');
    
    for (const c of contas) {
        const mesRef = c.date.substring(0, 7); 
        
        // Adiciona apenas o item que existe no DB. Nenhuma projeção.
        this.allItems.push({
            id: c.id, 
            type: 'CONTA',
            date: c.date, 
            description: c.description,
            categoryLabel: c.type === 'PIX_DEBITO' ? 'Pix/Débito' : 'Financiamento',
            amount: c.amount,
            isPaid: c.isPaid,           
        });

        // Atualiza o range com base nas datas de vencimento das contas (inalterado)
        if (mesRef > maxMes) maxMes = mesRef;
    }
    
    // 3. Faturas (o cálculo das faturas permanece igual)
    const comprasCartao = this.snapshot.expenses.filter(e => e.type === 'CARTAO');
    const faturasMap = new Map<string, number>();

    for (const compra of comprasCartao) {
        const card = this.snapshot.cards.find(c => c.id === compra.cardId);
        const bestPurchaseDay = card ? card.bestPurchaseDay : 1;
        const diaVencimento = card ? card.dueDay : 10;
        const parcelas = gerarParcelasDeUmaDespesa(compra, bestPurchaseDay, diaVencimento);

        for (const p of parcelas) {
            const dueMonth = addMeses(p.mesReferencia, 1);
            const chave = `${compra.cardId || 'unknown'}|${dueMonth}`; 
            
            const atual = faturasMap.get(chave) || 0;
            faturasMap.set(chave, atual + p.valor);
            
            // Atualiza o range com base nas datas de vencimento das faturas
            if (dueMonth > maxMes) maxMes = dueMonth;
            if (dueMonth < minMes) minMes = dueMonth;
        }
    }

    // Gerando a lista final de Faturas a partir do mapa agrupado por Mês de Vencimento
    for (const [chave, valor] of faturasMap) {
        const [cardId, dueMonth] = chave.split('|'); 
        
        // Filtra para exibir apenas as faturas dentro do range de meses
        if (dueMonth >= minMes && dueMonth <= maxMes) {
            const card = this.snapshot.cards.find(c => c.id === cardId);
            
            const comprasDaFatura = this.getPurchasesForFatura(cardId, dueMonth, card);
            const allPaid = comprasDaFatura.length > 0 && comprasDaFatura.every(e => e.isPaid);
            
            const diaVenc = card ? String(card.dueDay).padStart(2, '0') : '10';
            const dataVencimento = `${dueMonth}-${diaVenc}`;

            this.allItems.push({
                type: 'FATURA',
                date: dataVencimento, 
                description: `Fatura ${card ? card.name : 'Cartão'}`,
                categoryLabel: 'Fatura Cartão',
                amount: valor,
                cardId: cardId === 'unknown' ? undefined : cardId,
                isPaid: allPaid
            });
        }
    }

    this.mesesDisponiveis = gerarRangeMeses(minMes, maxMes);
  }
  
  // Método para carregar os detalhes da fatura (inalterado)
  openFaturaDetails(item: ExpenseViewItem) {
    if (item.type !== 'FATURA' || !item.cardId) return;

    this.faturaDetalhes = [];
    this.faturaDetalhesTotal = 0;
    
    const card = this.snapshot.cards.find(c => c.id === item.cardId);
    if (!card) return;

    this.faturaDetalhesCardName = card.name;
    const dueMonth = item.date.substring(0, 7); 

    const despesasCartao = this.snapshot.expenses.filter(e => e.type === 'CARTAO' && e.cardId === item.cardId);
    
    const bestPurchaseDay = card.bestPurchaseDay;
    const diaVencimento = card.dueDay;

    for (const compra of despesasCartao) {
        const parcelas = gerarParcelasDeUmaDespesa(compra, bestPurchaseDay, diaVencimento);
        const parcelaPagaNesteMes = parcelas.find(p => addMeses(p.mesReferencia, 1) === dueMonth);

        if (parcelaPagaNesteMes) {
            const nextMesCompetencia = addMeses(parcelaPagaNesteMes.mesReferencia, 1);
            
            const saldoRestante = parcelas
              .filter(p => p.mesReferencia >= nextMesCompetencia) 
              .reduce((sum, p) => sum + p.valor, 0);

            const detalhe: ParcelaDetalhe = {
                description: compra.description,
                amountTotal: compra.amount,
                parcelaAtual: parcelaPagaNesteMes.numero,
                parcelasTotal: parcelaPagaNesteMes.total,
                valorParcela: parcelaPagaNesteMes.valor,
                saldoRestante: saldoRestante,
                dateCompra: compra.date,
                personName: compra.personName
            };
            this.faturaDetalhes.push(detalhe);
            this.faturaDetalhesTotal += detalhe.valorParcela;
        }
    }
    
    this.faturaDetalhes.sort((a, b) => a.dateCompra.localeCompare(b.dateCompra));

    this.showDetailsModal = true;
  }
  
  closeFaturaDetails() {
    this.showDetailsModal = false;
  }

  // Marcar/Desmarcar como pago (incluindo faturas)
  markAsPaid(item: ExpenseViewItem) {
    if (!item.id && item.type === 'CONTA') {
        alert('Esta é uma conta virtual/recorrente. Apenas itens com ID real podem ser pagos no DB. Por favor, lance a conta real no formulário.');
        return;
    }
    
    const newStatus = !item.isPaid; 
    let updateObservables: Observable<any>[] = [];

    if (item.type === 'CONTA' && item.id) {
      // 1. CONTA AVULSA (single update)
      updateObservables.push(this.api.updateExpense(item.id, { isPaid: newStatus }));

    } else if (item.type === 'FATURA' && item.cardId) {
      // 2. FATURA (multiple updates nos itens base)
      const card = this.snapshot.cards.find(c => c.id === item.cardId);
      const dueMonth = item.date.substring(0, 7);
      
      const purchasesToUpdate = this.getPurchasesForFatura(item.cardId, dueMonth, card);
      
      // Coleta todos os Observables de atualização da API (um para cada compra na fatura)
      updateObservables = purchasesToUpdate.map(p => 
          this.api.updateExpense(p.id, { isPaid: newStatus })
      );

    } else {
      return;
    }

    // Executa todas as atualizações em paralelo e recarrega após a conclusão
    if (updateObservables.length > 0) {
        forkJoin(updateObservables).subscribe({
            next: () => {
                this.loadData();
            },
            error: (err) => {
                console.error('Erro ao atualizar status de pagamento:', err);
                alert(`Erro ao marcar como ${newStatus ? 'pago' : 'não pago'}.`);
            }
        });
    }
  }

  get filteredItems(): ExpenseViewItem[] {
      let list = [...this.allItems];

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
      isPaid: false 
    };

    this.api.addExpense(newExpense).subscribe(() => {
      this.expenseForm.reset({
        type: 'PIX_DEBITO',
        date: new Date().toISOString().substring(0, 10),
      });
      this.loadData();
    });
  }

  // Remoção do Pop-up de Confirmação e exclusão imediata.
  deletar(item: ExpenseViewItem) {
      if (item.type === 'FATURA') {
          alert('Para alterar o valor da fatura, vá na aba "Cartões" e edite as compras deste mês.');
          return;
      }
      this.api.deleteExpense(item.id!).subscribe(() => this.loadData());
  }
}