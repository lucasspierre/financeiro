import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  FormsModule,
} from '@angular/forms';
import { FinanceApiService } from '../../core/services/finance-api.service';
import { CreditCard, Expense, FinanceSnapshot } from '../../core/models/finance.models';

@Component({
  selector: 'app-cards',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './cards.component.html',
  styleUrls: ['./cards.component.scss']
})
export class CardsComponent implements OnInit {
  private api = inject(FinanceApiService);
  private fb = inject(FormBuilder);

  loading = true;
  snapshot!: FinanceSnapshot;
  
  cards: CreditCard[] = [];
  purchases: Expense[] = []; 

  selectedCardId: string | null = null;
  editingCard: CreditCard | null = null;
  showCardForm = false;
  editingPurchaseId: string | null = null; 

  filterMonth: string = '';   
  filterPerson: string = '';  
  sortOrder: string = 'DATE_DESC'; 
  
  availableMonths: string[] = [];
  availablePeople: string[] = [];

  cardForm = this.fb.group({
    name: ['', Validators.required],
    bestPurchaseDay: [null as number | null, [Validators.required, Validators.min(1), Validators.max(31)]],
    dueDay: [null as number | null, [Validators.required, Validators.min(1), Validators.max(31)]],
    color: ['#0d6efd']
  });

  purchaseForm = this.fb.group({
    description: ['', Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    date: [new Date().toISOString().substring(0, 10), Validators.required],
    cardId: ['', Validators.required],
    totalInstallments: [1, [Validators.required, Validators.min(1)]],
    personName: [''], 
    notes: ['']
  });

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.loading = true;
    this.api.getSnapshot().subscribe({
      next: (snap) => {
        this.snapshot = snap;
        this.cards = snap.cards || [];
        this.purchases = snap.expenses.filter(e => e.type === 'CARTAO');
        
        if (!this.selectedCardId && this.cards.length > 0) {
          this.selectCard(this.cards[0].id);
        } else if (this.selectedCardId) {
            this.updateFilterOptions();
        }
        this.loading = false;
      },
      error: () => this.loading = false
    });
  }

  formatMonthLabel(mesIso: string): string {
    if (!mesIso) return '';
    const [ano, mes] = mesIso.split('-');
    return `${mes}/${ano}`;
  }

  selectCard(id: string) {
    this.selectedCardId = id;
    this.purchaseForm.patchValue({ cardId: id });
    this.filterMonth = '';
    this.filterPerson = '';
    this.editingPurchaseId = null;
    this.updateFilterOptions();
  }

  getCardById(id: string | null): CreditCard | undefined {
    if (!id) return undefined;
    return this.cards.find(c => c.id === id);
  }

  updateFilterOptions() {
      if (!this.selectedCardId) return;
      
      const cartaoPurchases = this.purchases.filter(p => p.cardId === this.selectedCardId);

      const meses = new Set<string>();
      cartaoPurchases.forEach(p => {
          const d = new Date(p.date + 'T12:00:00');
          const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          meses.add(m);
      });
      this.availableMonths = Array.from(meses).sort().reverse();

      const pessoas = new Set<string>();
      cartaoPurchases.forEach(p => {
          if (p.personName) pessoas.add(p.personName);
      });
      this.availablePeople = Array.from(pessoas).sort();
  }

  get filteredPurchases(): Expense[] {
      if (!this.selectedCardId) return [];

      let list = this.purchases.filter(p => p.cardId === this.selectedCardId);

      if (this.filterMonth) {
          list = list.filter(p => {
              const d = new Date(p.date + 'T12:00:00');
              const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              return m === this.filterMonth;
          });
      }

      if (this.filterPerson) {
          if (this.filterPerson === 'TITULAR') {
              list = list.filter(p => !p.personName);
          } else {
              list = list.filter(p => p.personName === this.filterPerson);
          }
      }

      return list.sort((a, b) => {
          const dateA = new Date(a.date + 'T12:00:00').getTime();
          const dateB = new Date(b.date + 'T12:00:00').getTime();
          
          switch (this.sortOrder) {
              case 'DATE_DESC': return dateB - dateA; 
              case 'DATE_ASC': return dateA - dateB;
              case 'VAL_DESC': return b.amount - a.amount;
              case 'VAL_ASC': return a.amount - b.amount;
              default: return 0;
          }
      });
  }

  get totalFilteredOriginal(): number {
      return this.filteredPurchases.reduce((acc, p) => acc + p.amount, 0);
  }
  
  get totalFilteredParcela(): number {
      return this.filteredPurchases.reduce((acc, p) => {
          const qtd = p.totalInstallments || 1;
          return acc + (p.amount / qtd);
      }, 0);
  }

  saveCard() {
    if (this.cardForm.invalid) return;
    const val = this.cardForm.value;
    
    const newCard: Omit<CreditCard, 'id'> = {
      name: val.name!,
      bestPurchaseDay: val.bestPurchaseDay!,
      dueDay: val.dueDay!,
      color: val.color || '#0d6efd'
    };

    if (this.editingCard) {
      this.api.updateCard(this.editingCard.id, newCard).subscribe(() => {
        this.resetCardForm();
        this.loadData();
      });
    } else {
      this.api.addCard(newCard).subscribe(() => {
        this.resetCardForm();
        this.loadData();
      });
    }
  }

  editCard(c: CreditCard) {
    this.editingCard = c;
    this.cardForm.patchValue(c);
    this.showCardForm = true;
  }

  deleteCard(id: string) {
    if(!confirm('Excluir este cartão? As compras vinculadas podem ficar órfãs.')) return;
    this.api.deleteCard(id).subscribe(() => {
        this.selectedCardId = null;
        this.loadData();
    });
  }

  resetCardForm() {
    this.editingCard = null;
    this.showCardForm = false;
    this.cardForm.reset({ color: '#0d6efd' });
  }

  startEditPurchase(p: Expense) {
      this.editingPurchaseId = p.id;
      this.purchaseForm.patchValue({
          description: p.description,
          amount: p.amount,
          date: p.date,
          cardId: p.cardId,
          totalInstallments: p.totalInstallments || 1,
          personName: p.personName || '',
          notes: p.notes || ''
      });
      
      window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  cancelEditPurchase() {
      this.editingPurchaseId = null;
      this.purchaseForm.reset({
        date: new Date().toISOString().substring(0, 10),
        totalInstallments: 1,
        cardId: this.selectedCardId 
      });
  }

  savePurchase() {
    if (this.purchaseForm.invalid) return;
    const val = this.purchaseForm.value;

    const expensePayload: any = {
      description: val.description!,
      amount: val.amount!,
      date: val.date!,
      type: 'CARTAO',
      cardId: val.cardId!,
      totalInstallments: val.totalInstallments || 1,
      personName: val.personName || undefined,
      notes: val.notes || undefined
    };

    if (this.editingPurchaseId) {
        this.api.updateExpense(this.editingPurchaseId, expensePayload).subscribe(() => {
            this.cancelEditPurchase(); 
            this.loadData();
        });
    } else {
        this.api.addExpense(expensePayload).subscribe(() => {
            this.cancelEditPurchase(); 
            this.loadData();
        });
    }
  }
  
  deletePurchase(id: string) {
      if(confirm('Tem certeza que deseja excluir esta compra?')) {
          this.api.deleteExpense(id).subscribe(() => this.loadData());
      }
  }
}