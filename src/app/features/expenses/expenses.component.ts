import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinanceApiService } from '../../core/services/finance-api.service';
import {
  Expense,
  ExpenseType,
  FinanceSnapshot,
  CreditCard,
  ClassificationRule
} from '../../core/models/finance.models'; 
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  FormsModule,
} from '@angular/forms';
import { gerarParcelasDeUmaDespesa, gerarRangeMeses, addMeses } from '../../core/utils/parcelas';
import { forkJoin, Observable } from 'rxjs'; 
import { classifyDescription } from '../../core/utils/classification.utils'; 

// Interface unificada para exibição na tabela
interface ExpenseViewItem {
  id?: string;            
  type: 'CONTA' | 'FATURA';
  date: string;           
  description: string;    
  categoryLabel: string;  
  amount: number;
  cardId?: string;        
  isPaid?: boolean;       
  
  recurring?: boolean;    
  isVirtual?: boolean;    
  notes?: string;
  realExpenseType?: ExpenseType; 

  // Agora é um array de classificações
  classifications?: ClassificationRule[];
}

// Interface para os Detalhes da Parcela na Fatura
interface ParcelaDetalhe {
    description: string;
    amountTotal: number;
    parcelaAtual: number;
    parcelasTotal: number;
    valorParcela: number;
    saldoRestante: number;
    dateCompra: string;
    personName?: string;
    
    classifications?: ClassificationRule[];
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
  rules: ClassificationRule[] = []; 
  
  allItems: ExpenseViewItem[] = [];     
  filterMonth: string = '';      
  filterCategory: string = '';   
  sortOrder: string = 'DATE_ASC';

  mesesDisponiveis: string[] = [];
  
  editingItem: ExpenseViewItem | null = null;

  // Detalhes da Fatura
  showDetailsModal = false;
  faturaDetalhes: ParcelaDetalhe[] = [];
  faturaDetalhesCardName: string = '';
  faturaDetalhesTotal: number = 0;

  expenseTypes: { value: ExpenseType; label: string }[] = [
    { value: 'PIX_DEBITO', label: 'Pix / Débito / Dinheiro' },
    { value: 'FINANCIAMENTO', label: 'Financiamento / Boleto' },
  ];

  expenseForm = this.fb.group({
    description: ['', Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    date: ['', Validators.required],
    type: ['PIX_DEBITO' as ExpenseType, Validators.required],
    notes: [''],
    recurring: [false], 
  });

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.loading = true;
    this.api.getSnapshot().subscribe({
      next: (snap) => {
        this.snapshot = snap;
        this.rules = snap.config.classificationRules || []; 
        
        this.processarDespesasHibridas();
        
        // Define o mês atual se não houver filtro
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

  formatMonthLabel(mesIso: string): string {
    if (!mesIso) return '';
    const [ano, mes] = mesIso.split('-');
    return `${mes}/${ano}`;
  }

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
    const hoje = new Date().toISOString().substring(0, 7);
    let minMes = hoje;
    let maxMes = hoje; 
    
    this.snapshot.expenses.forEach(e => {
        const mesRef = e.date.substring(0, 7);
        if (mesRef < minMes) minMes = mesRef;
    });

    // 1. Processar Contas Avulsas REAIS
    const contasReais = this.snapshot.expenses.filter(e => e.type !== 'CARTAO');
    
    const ultimasRecorrentes = new Map<string, Expense>();
    // Ordena para garantir que pegamos a última versão da conta
    contasReais.sort((a, b) => a.date.localeCompare(b.date));

    for (const c of contasReais) {
        const mesRef = c.date.substring(0, 7); 
        
        // Classificação Múltipla
        const matches = classifyDescription(c.description, this.rules);

        this.allItems.push({
            id: c.id, 
            type: 'CONTA',
            date: c.date, 
            description: c.description,
            categoryLabel: c.type === 'PIX_DEBITO' ? 'Pix/Débito' : 'Financiamento',
            amount: c.amount,
            isPaid: c.isPaid,
            recurring: c.recurring,
            notes: c.notes,
            realExpenseType: c.type,
            classifications: matches
        });

        if (mesRef > maxMes) maxMes = mesRef;
        
        // Guarda a última ocorrência (para verificar se a recorrência continua)
        ultimasRecorrentes.set(c.description, c);
    }

    // 2. Gerar Contas VIRTUAIS (Projeção)
    const tetoProjecao = addMeses(maxMes < hoje ? hoje : maxMes, 12);

    for (const [desc, ult] of ultimasRecorrentes) {
        // Se a última ocorrência NÃO for recorrente, interrompe a projeção
        if (!ult.recurring) continue;

        let proximoMes = addMeses(ult.date.substring(0, 7), 1);
        const diaOriginal = ult.date.split('-')[2];
        
        // Classifica também o item virtual
        const matches = classifyDescription(desc, this.rules);

        while (proximoMes <= tetoProjecao) {
            const jaExiste = this.allItems.some(
                item => item.description === desc && item.date.substring(0, 7) === proximoMes && !item.isVirtual
            );

            if (!jaExiste) {
                this.allItems.push({
                    id: `VIRTUAL-${proximoMes}-${desc.replace(/\s/g, '')}`,
                    type: 'CONTA',
                    date: `${proximoMes}-${diaOriginal}`,
                    description: desc,
                    categoryLabel: ult.type === 'PIX_DEBITO' ? 'Pix/Débito' : 'Financiamento',
                    amount: ult.amount,
                    isPaid: false,
                    recurring: true,
                    isVirtual: true,
                    notes: ult.notes,
                    realExpenseType: ult.type,
                    classifications: matches
                });
                
                if (proximoMes > maxMes) maxMes = proximoMes;
            }
            proximoMes = addMeses(proximoMes, 1);
        }
    }
    
    // 3. Faturas de Cartão
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
            
            if (dueMonth > maxMes) maxMes = dueMonth;
            if (dueMonth < minMes) minMes = dueMonth;
        }
    }

    for (const [chave, valor] of faturasMap) {
        const [cardId, dueMonth] = chave.split('|'); 
        
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

            // Classificação Múltipla no Modal
            const matches = classifyDescription(compra.description, this.rules);

            const detalhe: ParcelaDetalhe = {
                description: compra.description,
                amountTotal: compra.amount,
                parcelaAtual: parcelaPagaNesteMes.numero,
                parcelasTotal: parcelaPagaNesteMes.total,
                valorParcela: parcelaPagaNesteMes.valor,
                saldoRestante: saldoRestante,
                dateCompra: compra.date,
                personName: compra.personName,
                classifications: matches
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

  markAsPaid(item: ExpenseViewItem) {
    if (item.isVirtual) {
        alert('Você precisa confirmar (efetivar) esta conta prevista antes de marcar como paga.');
        return;
    }
    if (!item.id && item.type === 'CONTA') return;
    
    const newStatus = !item.isPaid; 
    let updateObservables: Observable<any>[] = [];

    if (item.type === 'CONTA' && item.id) {
      updateObservables.push(this.api.updateExpense(item.id, { isPaid: newStatus }));
    } else if (item.type === 'FATURA' && item.cardId) {
      const card = this.snapshot.cards.find(c => c.id === item.cardId);
      const dueMonth = item.date.substring(0, 7);
      const purchasesToUpdate = this.getPurchasesForFatura(item.cardId, dueMonth, card);
      updateObservables = purchasesToUpdate.map(p => 
          this.api.updateExpense(p.id, { isPaid: newStatus })
      );
    } else {
      return;
    }

    if (updateObservables.length > 0) {
        forkJoin(updateObservables).subscribe({
            next: () => this.loadData(),
            error: (err) => console.error('Erro ao atualizar status de pagamento:', err)
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

    const expenseData: any = {
      description: val.description!,
      amount: val.amount!,
      date: val.date!,
      type: val.type!,
      recurring: !!val.recurring,
      notes: val.notes || undefined,
      isPaid: false 
    };

    if (this.editingItem) {
        if (this.editingItem.isVirtual) {
            this.api.addExpense(expenseData).subscribe(() => {
                this.cancelEdit();
                this.loadData();
            });
        } else {
            this.api.updateExpense(this.editingItem.id!, expenseData).subscribe(() => {
                this.cancelEdit();
                this.loadData();
            });
        }
    } else {
        this.api.addExpense(expenseData).subscribe(() => {
            this.cancelEdit();
            this.loadData();
        });
    }
  }

  startEdit(item: ExpenseViewItem) {
      this.editingItem = item;
      this.expenseForm.patchValue({
          description: item.description,
          amount: item.amount,
          date: item.date, 
          type: item.realExpenseType || 'PIX_DEBITO',
          recurring: !!item.recurring,
          notes: item.notes || ''
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  cancelEdit() {
      this.editingItem = null;
      this.expenseForm.reset({
        type: 'PIX_DEBITO',
        date: new Date().toISOString().substring(0, 10),
        recurring: false
      });
  }

  confirmarVirtual(item: ExpenseViewItem) {
      const newExpense: any = {
          description: item.description,
          amount: item.amount,
          date: item.date,
          type: item.realExpenseType || 'PIX_DEBITO',
          recurring: true, 
          notes: item.notes,
          isPaid: false
      };
      this.api.addExpense(newExpense).subscribe(() => this.loadData());
  }

  deletar(item: ExpenseViewItem) {
      if (item.type === 'FATURA') {
          alert('Para alterar o valor da fatura, vá na aba "Cartões" e edite as compras deste mês.');
          return;
      }
      if (item.isVirtual) {
          alert('Esta é uma conta PREVISTA. Para remover a recorrência, edite o lançamento original do mês anterior e desmarque a opção "Fixo".');
          return;
      }
      this.api.deleteExpense(item.id!).subscribe(() => this.loadData());
  }
}