import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinanceApiService } from '../../core/services/finance-api.service';
import { FinanceConfig, FinanceSnapshot, ClassificationRule, MonthlyLimit } from '../../core/models/finance.models';
import { FormBuilder, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './config.component.html',
  styleUrls: ['./config.component.scss']
})
export class ConfigComponent implements OnInit {

  private api = inject(FinanceApiService);
  private fb = inject(FormBuilder);

  loading = true;
  saving = false;

  // Lista local de regras para edição
  rules: ClassificationRule[] = [];
  
  // Lista local de tetos mensais
  monthlyLimits: MonthlyLimit[] = [];

  // Variaveis auxiliares para adicionar nova categoria
  newCatName: string = '';
  newCatColor: string = '#6c757d';
  newCatIncluded: boolean = true; // Padrão: conta no teto

  // Variavel auxiliar para adicionar keyword
  newKeywordInputs: { [key: number]: string } = {};

  // Variaveis para adicionar novo teto
  newLimitMonth: string = '';
  newLimitAmount: number | null = null;

  configForm = this.fb.group({}); // Sem campos, pois referenceMonth foi removido

  ngOnInit() {
    this.loadConfig();
  }

  loadConfig() {
    this.loading = true;

    this.api.getSnapshot().subscribe({
      next: (snap: FinanceSnapshot) => {
        const c = snap.config;
        const hoje = new Date().toISOString().slice(0, 7);

        // Carrega listas ou inicia vazio
        this.rules = c.classificationRules || [];
        this.monthlyLimits = c.monthlyLimits || [];
        
        // Ordena tetos por mês (mais recente primeiro, opcional)
        this.monthlyLimits.sort((a, b) => b.month.localeCompare(a.month));

        // Define mês atual como padrão para adicionar novo teto
        this.newLimitMonth = hoje;

        this.loading = false;
      },
      error: () => this.loading = false
    });
  }

  // --- GESTÃO DE TETOS MENSAIS ---

  addMonthlyLimit() {
    if (!this.newLimitMonth || !this.newLimitAmount || this.newLimitAmount <= 0) return;

    // Verifica se já existe teto para este mês
    const existingIndex = this.monthlyLimits.findIndex(l => l.month === this.newLimitMonth);

    if (existingIndex >= 0) {
      // Atualiza existente
      this.monthlyLimits[existingIndex].amount = this.newLimitAmount;
    } else {
      // Adiciona novo
      this.monthlyLimits.push({
        month: this.newLimitMonth,
        amount: this.newLimitAmount
      });
      // Reordena
      this.monthlyLimits.sort((a, b) => b.month.localeCompare(a.month));
    }

    this.newLimitAmount = null; // Limpa valor, mantém mês
  }

  removeMonthlyLimit(index: number) {
    this.monthlyLimits.splice(index, 1);
  }

  // --- GESTÃO DE CATEGORIAS ---

  addCategory() {
    if (!this.newCatName.trim()) return;

    this.rules.push({
      name: this.newCatName,
      color: this.newCatColor,
      keywords: [],
      includedInLimit: this.newCatIncluded
    });

    // Limpa inputs
    this.newCatName = '';
    this.newCatColor = '#6c757d';
    this.newCatIncluded = true;
  }

  removeCategory(index: number) {
    this.rules.splice(index, 1);
  }

  // --- GESTÃO DE PALAVRAS-CHAVE ---

  addKeyword(ruleIndex: number) {
    const text = this.newKeywordInputs[ruleIndex];
    if (!text || !text.trim()) return;

    if (!this.rules[ruleIndex].keywords.includes(text.toUpperCase())) {
      this.rules[ruleIndex].keywords.push(text.toUpperCase());
    }
    
    this.newKeywordInputs[ruleIndex] = '';
  }

  removeKeyword(ruleIndex: number, keywordIndex: number) {
    this.rules[ruleIndex].keywords.splice(keywordIndex, 1);
  }

  // --- SALVAR TUDO ---

  saveConfig() {
    this.saving = true;

    const updated: Partial<FinanceConfig> = {
      classificationRules: this.rules,
      monthlyLimits: this.monthlyLimits
    };

    this.api.updateConfig(updated).subscribe({
      next: () => {
        this.saving = false;
        // REMOVIDO: alert('Configurações salvas com sucesso!');
      },
      error: (err) => {
        console.error(err);
        this.saving = false;
        alert('Erro ao salvar configurações.');
      }
    });
  }
}