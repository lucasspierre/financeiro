import { Component, OnInit, inject, ViewChild, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FinanceApiService } from '../../core/services/finance-api.service';
import { FinanceSnapshot } from '../../core/models/finance.models';
import { gerarParcelasDeTodos, addMeses, gerarRangeMeses, gerarParcelasDeUmaDespesa } from '../../core/utils/parcelas';
import { classifyDescription } from '../../core/utils/classification.utils';

// Importações do ng2-charts e Chart.js
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData, ChartType } from 'chart.js';

interface CelulaValor {
    valor: number;
    confirmado: boolean;
}

interface LinhaEntradasFuturas {
  id: string;
  description: string;
  type: 'RECORRENTE' | 'TERCEIROS';
  personName?: string;
  valoresPorMes: { [mes: string]: CelulaValor };
}

interface ResumoConta {
    description: string;
    amount: number;
    date: string;
    type: 'CONTA' | 'FATURA';
    categoryLabel: string;
    isPaid: boolean;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, BaseChartDirective, FormsModule], 
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  private api = inject(FinanceApiService);
  private ngZone = inject(NgZone);

  @ViewChild(BaseChartDirective) chart: BaseChartDirective | undefined;

  loading = true;
  snapshot!: FinanceSnapshot;

  // Filtros
  filterMonth: string = '';
  availableMonths: string[] = [];

  // KPIs
  monthExpensesSum = 0;
  monthIncomeSum = 0;
  saldoMes = 0;
  
  // Teto Mensal (Novo)
  currentMonthlyLimit = 0;
  percentageUsed = 0;
  
  // Totais
  totalCartaoMes = 0;
  totalNaoCartaoMes = 0;
  totalTitularMes = 0;
  totalTerceirosMes = 0;
  totalFaturasDisplay = 0; 

  // Dados Específicos
  terceirosTotalCompras = 0;
  terceirosParcelasMes = 0;
  terceirosParcelasFuturas = 0;

  // Listas
  mesesFuturosHeader: string[] = [];
  entradasFuturasLinhas: LinhaEntradasFuturas[] = [];
  totaisMesFuturo: { [mes: string]: number } = {};
  contasDoMes: ResumoConta[] = [];

  // --- GRÁFICO DE BARRAS ---
  public barChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'bottom' },
    },
    scales: {
      y: { beginAtZero: true, grid: { color: '#f0f0f0' } },
      x: { grid: { display: false } }
    }
  };
  public barChartType: ChartType = 'bar';
  public barChartData: ChartData<'bar'> = {
    labels: [],
    datasets: [
      { data: [], label: 'Entradas', backgroundColor: '#198754', borderRadius: 4, hoverBackgroundColor: '#146c43' },
      { data: [], label: 'Saídas', backgroundColor: '#dc3545', borderRadius: 4, hoverBackgroundColor: '#b02a37' }
    ]
  };

  // --- GRÁFICO DE ROSCA ---
  public doughnutChartType: ChartType = 'doughnut';
  public doughnutChartData: ChartData<'doughnut'> = {
      labels: ['Titular (Eu)', 'Terceiros'],
      datasets: [{ 
          data: [0, 0], 
          backgroundColor: ['#0d6efd', '#ffc107'],
          hoverBackgroundColor: ['#0b5ed7', '#ffca2c'],
          borderWidth: 0
      }]
  };
  
  public doughnutChartOptions!: ChartConfiguration['options'];

  ngOnInit() {
    this.initChartOptions();
    this.loadAll();
  }

  initChartOptions() {
    this.doughnutChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
          legend: { 
            position: 'right',
            onClick: (e, legendItem, legend) => {
                const index = legendItem.index as number;
                const chart = legend.chart;
                chart.toggleDataVisibility(index);
                chart.update();
                this.ngZone.run(() => {
                    this.atualizarTotalFaturaDisplay(chart);
                });
            }
          }
      }
    };
  }

  atualizarTotalFaturaDisplay(chart: any) {
      const isTitularVisible = chart.getDataVisibility(0) !== false;
      const isTerceirosVisible = chart.getDataVisibility(1) !== false;

      let soma = 0;
      if (isTitularVisible) soma += this.totalTitularMes;
      if (isTerceirosVisible) soma += this.totalTerceirosMes;

      this.totalFaturasDisplay = soma;
  }

  loadAll() {
    this.loading = true;
    this.api.getSnapshot().subscribe({
      next: (snap) => {
        this.snapshot = snap;
        this.gerarMesesDisponiveis();

        if (!this.filterMonth) {
             const hoje = new Date().toISOString().slice(0, 7);
             if (this.availableMonths.includes(hoje)) {
                 this.filterMonth = hoje;
             } else if (this.availableMonths.length > 0) {
                 this.filterMonth = this.availableMonths[0];
             }
        }

        this.atualizarDashboard();
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  atualizarDashboard() {
      this.processarKPIsDoMes();
      this.montarContasDoMes();
      this.montarGraficoRosca(); 
      this.montarProjecaoFutura(); 
      this.montarGraficoFluxo();
  }

  private processarKPIsDoMes() {
    const [ano, mes] = this.filterMonth.split('-').map(Number);

    const incomesMes = this.snapshot.incomes.filter((i) => {
      const d = new Date(i.date + 'T12:00:00');
      return d.getFullYear() === ano && d.getMonth() + 1 === mes; 
    });
    this.monthIncomeSum = incomesMes.reduce((s, i) => s + i.amount, 0);

    const despesasCartao = this.snapshot.expenses.filter(e => e.type === 'CARTAO');
    let somaParcelas = 0;
    
    // TETO: Somar apenas categorias inclusas
    let gastosParaOTeto = 0;
    const regras = this.snapshot.config.classificationRules || [];

    for (const compra of despesasCartao) {
        const card = this.snapshot.cards.find(c => c.id === compra.cardId);
        const bestPurchaseDay = card ? card.bestPurchaseDay : 1;
        const diaVencimento = card ? card.dueDay : 10;
        const parcelas = gerarParcelasDeUmaDespesa(compra, bestPurchaseDay, diaVencimento);
        
        const p = parcelas.find(p => {
            const dueMonth = addMeses(p.mesReferencia, 1);
            return dueMonth === this.filterMonth;
        });

        if (p) {
            somaParcelas += p.valor;
            // Classifica e verifica se entra no teto
            const matches = classifyDescription(compra.description, regras);
            const entraNoTeto = matches.some(r => r.includedInLimit);
            if (entraNoTeto) {
                gastosParaOTeto += p.valor;
            }
        }
    }
    this.totalCartaoMes = somaParcelas;

    const despesasNaoCartao = this.snapshot.expenses.filter((e) => {
      const d = new Date(e.date + 'T12:00:00');
      const mesRef = d.getFullYear() === ano && d.getMonth() + 1 === mes;
      const isConta = e.type !== 'CARTAO';
      return mesRef && isConta;
    });
    this.totalNaoCartaoMes = 0;
    for (const e of despesasNaoCartao) {
        this.totalNaoCartaoMes += e.amount;
        
        const matches = classifyDescription(e.description, regras);
        const entraNoTeto = matches.some(r => r.includedInLimit);
        if (entraNoTeto) {
             gastosParaOTeto += e.amount;
        }
    }

    this.monthExpensesSum = this.totalCartaoMes + this.totalNaoCartaoMes;
    this.saldoMes = this.monthIncomeSum - this.monthExpensesSum;

    // Teto Mensal (Mês Atual)
    const limits = this.snapshot.config.monthlyLimits || [];
    const limitObj = limits.find(l => l.month === this.filterMonth);
    this.currentMonthlyLimit = limitObj ? limitObj.amount : 0;

    if (this.currentMonthlyLimit > 0) {
        this.percentageUsed = (gastosParaOTeto / this.currentMonthlyLimit) * 100;
    } else {
        this.percentageUsed = 0;
    }

    const despesasTerceiros = despesasCartao.filter(e => !!e.personName);
    this.terceirosTotalCompras = despesasTerceiros.reduce((s, e) => s + e.amount, 0);
    
    const todasParcelasRaw = gerarParcelasDeTodos(despesasCartao, this.snapshot.cards); 
    const parcelasTerceiros = todasParcelasRaw.filter(p => p.isThirdParty);
    
    this.terceirosParcelasMes = parcelasTerceiros
      .filter((p) => addMeses(p.mesReferencia, 1) === this.filterMonth)
      .reduce((s, p) => s + p.valor, 0);

    this.terceirosParcelasFuturas = parcelasTerceiros
      .filter((p) => addMeses(p.mesReferencia, 1) > this.filterMonth)
      .reduce((s, p) => s + p.valor, 0);
  }

  private montarContasDoMes() {
      this.contasDoMes = [];
      const [ano, mes] = this.filterMonth.split('-').map(Number);

      const contas = this.snapshot.expenses.filter(e => e.type !== 'CARTAO');
      for(const c of contas) {
          const d = new Date(c.date + 'T12:00:00');
          if (d.getFullYear() === ano && d.getMonth() + 1 === mes) {
              this.contasDoMes.push({
                  description: c.description,
                  amount: c.amount,
                  date: c.date,
                  type: 'CONTA',
                  categoryLabel: c.type === 'FINANCIAMENTO' ? 'Financiamento' : 'Conta/Pix',
                  isPaid: !!c.isPaid
              });
          }
      }

      const comprasCartao = this.snapshot.expenses.filter(e => e.type === 'CARTAO');
      const faturasMap = new Map<string, number>();
      const faturasStatusMap = new Map<string, boolean>();

      for(const compra of comprasCartao) {
          const card = this.snapshot.cards.find(c => c.id === compra.cardId);
          const bestPurchaseDay = card ? card.bestPurchaseDay : 1;
          const diaVencimento = card ? card.dueDay : 10;
          const parcelas = gerarParcelasDeUmaDespesa(compra, bestPurchaseDay, diaVencimento);
          
          for (const p of parcelas) {
              const dueMonth = addMeses(p.mesReferencia, 1);
              if (dueMonth === this.filterMonth) {
                  const cardId = compra.cardId || 'unknown';
                  faturasMap.set(cardId, (faturasMap.get(cardId) || 0) + p.valor);
                  
                  const currentStatus = faturasStatusMap.has(cardId) ? faturasStatusMap.get(cardId) : true;
                  if (!compra.isPaid) {
                      faturasStatusMap.set(cardId, false);
                  } else {
                      faturasStatusMap.set(cardId, currentStatus!);
                  }
              }
          }
      }

      for (const [cardId, valor] of faturasMap) {
          const card = this.snapshot.cards.find(c => c.id === cardId);
          const diaVenc = card ? String(card.dueDay).padStart(2, '0') : '10';
          const dataVenc = `${this.filterMonth}-${diaVenc}`;
          const isPaid = faturasStatusMap.get(cardId) !== false;

          this.contasDoMes.push({
              description: `Fatura ${card ? card.name : 'Cartão'}`,
              amount: valor,
              date: dataVenc,
              type: 'FATURA',
              categoryLabel: 'Cartão Crédito',
              isPaid: isPaid
          });
      }

      this.contasDoMes.sort((a, b) => a.date.localeCompare(b.date));
  }

  private montarGraficoRosca() {
      const despesasCartao = this.snapshot.expenses.filter(e => e.type === 'CARTAO');
      
      this.totalTitularMes = 0;
      this.totalTerceirosMes = 0;

      for (const compra of despesasCartao) {
          const card = this.snapshot.cards.find(c => c.id === compra.cardId);
          const bestPurchaseDay = card ? card.bestPurchaseDay : 1; 
          const diaVencimento = card ? card.dueDay : 10;
          const parcelas = gerarParcelasDeUmaDespesa(compra, bestPurchaseDay, diaVencimento);
          
          const p = parcelas.find(p => {
              const dueMonth = addMeses(p.mesReferencia, 1);
              return dueMonth === this.filterMonth;
          });
          
          if (p) {
              if (compra.personName) {
                  this.totalTerceirosMes += p.valor;
              } else {
                  this.totalTitularMes += p.valor;
              }
          }
      }
      
      this.doughnutChartData.datasets[0].data = [this.totalTitularMes, this.totalTerceirosMes];
      this.totalFaturasDisplay = this.totalTitularMes + this.totalTerceirosMes;
      this.chart?.update();
  }

  private montarGraficoFluxo() {
    const mesesGrafico = this.mesesFuturosHeader.slice(0, 6);
    const labels = mesesGrafico.map(m => this.formatMesLabel(m));
    const dataEntradas = mesesGrafico.map(m => this.totaisMesFuturo[m] || 0);
    
    const despesasCartao = this.snapshot.expenses.filter(e => e.type === 'CARTAO');
    const todasParcelas = gerarParcelasDeTodos(despesasCartao, this.snapshot.cards);
    
    const dataSaidas = mesesGrafico.map(mes => {
        return todasParcelas
            .filter(p => {
                 const dueMonth = addMeses(p.mesReferencia, 1); 
                 return dueMonth === mes; 
            })
            .reduce((acc, p) => acc + p.valor, 0);
    });

    this.barChartData.labels = labels;
    this.barChartData.datasets[0].data = dataEntradas;
    this.barChartData.datasets[1].data = dataSaidas;
    this.chart?.update();
  }

  private montarProjecaoFutura() {
    const inicio = this.filterMonth || new Date().toISOString().slice(0, 7);
    
    this.mesesFuturosHeader = [];
    for(let i=0; i<12; i++) {
        this.mesesFuturosHeader.push(addMeses(inicio, i));
    }

    const mapa = new Map<string, LinhaEntradasFuturas>();

    const despesasCartao = this.snapshot.expenses.filter(e => e.type === 'CARTAO');
    const todasParcelas = gerarParcelasDeTodos(despesasCartao, this.snapshot.cards);
    const pFuturas = todasParcelas.filter(p => p.isThirdParty);

    for(const p of pFuturas) {
        const dueMonth = addMeses(p.mesReferencia, 1); 
        
        if (this.mesesFuturosHeader.includes(dueMonth)) {
            const personKey = p.personName || 'Terceiro';
            const key = `T-${personKey}`;
            
            if(!mapa.has(key)) {
                mapa.set(key, { 
                    id: key, 
                    description: `Reembolsos (${personKey})`, 
                    type: 'TERCEIROS', 
                    personName: personKey, 
                    valoresPorMes: {} 
                });
            }
            
            const linha = mapa.get(key)!;
            const atual = linha.valoresPorMes[dueMonth]?.valor || 0;
            linha.valoresPorMes[dueMonth] = { valor: atual + p.valor, confirmado: false };
        }
    }

    const ultimas = new Map<string, any>();
    this.snapshot.incomes.filter(i => i.recurring).sort((a,b)=>a.date.localeCompare(b.date)).forEach(i => ultimas.set(i.description, i));

    for(const m of this.mesesFuturosHeader) {
        this.snapshot.incomes.filter(i=> i.recurring && i.date.startsWith(m)).forEach(r => {
             const k = `R-${r.description}`;
             if(!mapa.has(k)) mapa.set(k, { id: k, description: r.description, type: 'RECORRENTE', personName: 'Eu', valoresPorMes: {} });
             mapa.get(k)!.valoresPorMes[m] = { valor: r.amount, confirmado: true };
        });
        
        for(const ult of ultimas.values()) {
             const k = `R-${ult.description}`;
             if(!ult.recurring) continue; 

             if(!mapa.has(k)) mapa.set(k, { id: k, description: ult.description, type: 'RECORRENTE', personName: 'Eu', valoresPorMes: {} });
             const linha = mapa.get(k)!;
             
             if(!linha.valoresPorMes[m]) {
                 const mesUlt = ult.date.slice(0,7);
                 if(m > mesUlt) {
                     linha.valoresPorMes[m] = { valor: ult.amount, confirmado: false };
                 }
             }
        }
    }
    
    this.entradasFuturasLinhas = Array.from(mapa.values());
    this.totaisMesFuturo = {};
    this.mesesFuturosHeader.forEach(m => {
        this.totaisMesFuturo[m] = this.entradasFuturasLinhas.reduce((acc, c) => acc + (c.valoresPorMes[m]?.valor || 0), 0);
    });
  }

  gerarMesesDisponiveis() {
    let min = '9999-99', max = '0000-00';
    const atual = new Date().toISOString().slice(0, 7);
    if(atual < min) min = atual; if(atual > max) max = atual;

    this.snapshot.expenses.forEach(e => {
        const m = e.date.slice(0, 7);
        if(m<min) min=m; if(m>max) max=m;
    });
    
    const todas = gerarParcelasDeTodos(this.snapshot.expenses.filter(e=>e.type==='CARTAO'), this.snapshot.cards);
    todas.forEach(p => { 
        const dueMonth = addMeses(p.mesReferencia, 1);
        if(dueMonth > max) max = dueMonth; 
    });
    
    this.availableMonths = gerarRangeMeses(min, max);
  }

  formatMesLabel(m: string): string {
    if(!m) return '';
    const [ano, mes] = m.split('-');
    return `${mes}/${ano}`;
  }
}