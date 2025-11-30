import { Component, OnInit, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; // Necessário para o ngModel do filtro
import { FinanceApiService } from '../../core/services/finance-api.service';
import { FinanceSnapshot, Expense, Income } from '../../core/models/finance.models';
import { gerarParcelasDeTodos, addMeses, gerarRangeMeses, gerarParcelasDeUmaDespesa } from '../../core/utils/parcelas';
import { ParcelaReal } from '../../core/models/parcela-real.model';

// Importações do ng2-charts
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData, ChartType } from 'chart.js';

interface LinhaEntradasFuturas {
  id: string;
  description: string;
  type: 'RECORRENTE' | 'TERCEIROS';
  personName?: string;
  valoresPorMes: { [mes: string]: number };
}

interface ResumoConta {
    description: string;
    amount: number;
    date: string;
    type: 'CONTA' | 'FATURA';
    categoryLabel: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  // Importante: FormsModule para o select e BaseChartDirective para os gráficos
  imports: [CommonModule, BaseChartDirective, FormsModule], 
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  private api = inject(FinanceApiService);

  @ViewChild(BaseChartDirective) chart: BaseChartDirective | undefined;

  loading = true;
  snapshot!: FinanceSnapshot;

  // Filtros
  filterMonth: string = '';
  availableMonths: string[] = [];

  // KPIs do Mês Selecionado
  monthExpensesSum = 0;
  monthIncomeSum = 0;
  saldoMes = 0;
  percentageUsed = 0;
  
  // Detalhe KPIs
  totalCartaoMes = 0;
  totalNaoCartaoMes = 0;

  // Dados Específicos
  terceirosTotalCompras = 0;
  terceirosParcelasMes = 0;
  terceirosParcelasFuturas = 0;

  // Tabela Projeção (Macro)
  mesesFuturosHeader: string[] = [];
  entradasFuturasLinhas: LinhaEntradasFuturas[] = [];
  totaisMesFuturo: { [mes: string]: number } = {};
  
  // Lista "Contas do Mês" (Híbrida: Contas + Faturas)
  contasDoMes: ResumoConta[] = [];

  // --- GRÁFICO DE BARRAS (Fluxo 6 meses) ---
  public barChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'bottom' },
    },
    scales: {
      y: { 
          beginAtZero: true, 
          grid: { color: '#f0f0f0' },
          ticks: {
              // callback: (value) => 'R$ ' + value 
          }
      },
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

  // --- GRÁFICO DE ROSCA (Titular vs Terceiros) ---
  public doughnutChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: { position: 'right' }
    }
  };
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

  ngOnInit() {
    this.loadAll();
  }

  loadAll() {
    this.loading = true;
    this.api.getSnapshot().subscribe({
      next: (snap) => {
        this.snapshot = snap;
        
        // 1. Gera meses disponíveis para o filtro
        this.gerarMesesDisponiveis();

        // 2. Define mês padrão (referência ou atual)
        if (!this.filterMonth) {
             const ref = snap.config.referenceMonth;
             const hoje = new Date().toISOString().slice(0, 7);
             // Se a referência existe na lista, usa ela. Senão, usa hoje.
             this.filterMonth = this.availableMonths.includes(ref) ? ref : hoje;
             
             // Fallback: Se nem hoje nem ref estão na lista (ex: lista vazia ou muito futura), pega o primeiro
             if (!this.availableMonths.includes(this.filterMonth) && this.availableMonths.length > 0) {
                 this.filterMonth = this.availableMonths[0];
             }
        }

        // 3. Processa dados com base no filtro
        this.atualizarDashboard();
        
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  // Chamado quando muda o filtro ou carrega dados
  atualizarDashboard() {
      this.processarKPIsDoMes();
      this.montarContasDoMes(); // Gera a lista unificada (Contas + Faturas)
      this.montarGraficoRosca(); // Gera gráfico Titular x Terceiros
      
      // Estes são "Macro", podem partir do mês atual ou do filtro
      this.montarProjecaoFutura(); 
      this.montarGraficoFluxo();
  }

  private processarKPIsDoMes() {
    const [ano, mes] = this.filterMonth.split('-').map(Number);

    // 1. Entradas do Mês Selecionado
    const incomesMes = this.snapshot.incomes.filter((i) => {
      const d = new Date(i.date + 'T12:00:00');
      // Filtra pela data da entrada
      return d.getFullYear() === ano && d.getMonth() + 1 === mes; 
    });
    this.monthIncomeSum = incomesMes.reduce((s, i) => s + i.amount, 0);

    // 2. Despesas do Mês Selecionado (Cartão + Contas)
    
    // A) Faturas de Cartão que VENCEM neste mês (Mês de Vencimento = filterMonth)
    const despesasCartao = this.snapshot.expenses.filter(e => e.type === 'CARTAO');
    let somaParcelas = 0;
    
    for (const compra of despesasCartao) {
        const card = this.snapshot.cards.find(c => c.id === compra.cardId);
        const bestPurchaseDay = card ? card.bestPurchaseDay : 1;
        const diaVencimento = card ? card.dueDay : 10;
        const parcelas = gerarParcelasDeUmaDespesa(compra, bestPurchaseDay, diaVencimento);
        
        // CORREÇÃO: Busca a parcela cujo DUE MONTH (Vencimento) é o mês filtrado.
        const p = parcelas.find(p => {
            const dueMonth = addMeses(p.mesReferencia, 1);
            return dueMonth === this.filterMonth;
        });

        if (p) somaParcelas += p.valor;
    }
    this.totalCartaoMes = somaParcelas;

    // B) Contas Avulsas que VENCEM/Ocorrem neste mês
    const despesasNaoCartao = this.snapshot.expenses.filter((e) => {
      const d = new Date(e.date + 'T12:00:00');
      // Filtra pela data da conta (vencimento/ocorrência)
      const mesRef = d.getFullYear() === ano && d.getMonth() + 1 === mes;
      const isConta = e.type !== 'CARTAO';
      return mesRef && isConta;
    });
    this.totalNaoCartaoMes = despesasNaoCartao.reduce((s, e) => s + e.amount, 0);

    // Totais KPI
    this.monthExpensesSum = this.totalCartaoMes + this.totalNaoCartaoMes;
    this.saldoMes = this.monthIncomeSum - this.monthExpensesSum;
    this.percentageUsed = this.snapshot.config.monthlyLimit > 0
        ? (this.monthExpensesSum / this.snapshot.config.monthlyLimit) * 100
        : 0;

    // KPI Terceiros (Geral)
    const despesasTerceiros = despesasCartao.filter(e => !!e.personName);
    this.terceirosTotalCompras = despesasTerceiros.reduce((s, e) => s + e.amount, 0);
    
    // Todas as parcelas geradas
    const todasParcelasRaw = gerarParcelasDeTodos(despesasCartao, this.snapshot.cards); 
    const parcelasTerceiros = todasParcelasRaw.filter(p => p.isThirdParty);
    
    // CORREÇÃO: Mostra o que tem pra receber NESTE mês (VENCIMENTO)
    this.terceirosParcelasMes = parcelasTerceiros
      .filter((p) => addMeses(p.mesReferencia, 1) === this.filterMonth) // Vencimento = filterMonth
      .reduce((s, p) => s + p.valor, 0);

    // CORREÇÃO: Mostra o que tem pra receber DEPOIS deste mês (VENCIMENTO > filterMonth)
    this.terceirosParcelasFuturas = parcelasTerceiros
      .filter((p) => addMeses(p.mesReferencia, 1) > this.filterMonth) // Vencimento > filterMonth
      .reduce((s, p) => s + p.valor, 0);
  }

  private montarContasDoMes() {
      this.contasDoMes = [];
      const [ano, mes] = this.filterMonth.split('-').map(Number);

      // 1. Adiciona Contas Avulsas (Pix/Boletos)
      const contas = this.snapshot.expenses.filter(e => e.type !== 'CARTAO');
      for(const c of contas) {
          const d = new Date(c.date + 'T12:00:00');
          // Verifica se cai no mês selecionado (Vencimento/Ocorrência)
          if (d.getFullYear() === ano && d.getMonth() + 1 === mes) {
              this.contasDoMes.push({
                  description: c.description,
                  amount: c.amount,
                  date: c.date,
                  type: 'CONTA',
                  categoryLabel: c.type === 'FINANCIAMENTO' ? 'Financiamento' : 'Conta/Pix'
              });
          }
      }

      // 2. Adiciona Faturas de Cartão (Agrupadas por Cartão)
      const comprasCartao = this.snapshot.expenses.filter(e => e.type === 'CARTAO');
      const faturasMap = new Map<string, number>(); // CardId -> Valor (totalizado no mês de vencimento filtrado)

      for(const compra of comprasCartao) {
          const card = this.snapshot.cards.find(c => c.id === compra.cardId);
          const bestPurchaseDay = card ? card.bestPurchaseDay : 1;
          const diaVencimento = card ? card.dueDay : 10;
          const parcelas = gerarParcelasDeUmaDespesa(compra, bestPurchaseDay, diaVencimento);
          
          for (const p of parcelas) {
              const mesRef = p.mesReferencia;
              // CORREÇÃO: O mês de vencimento é 1 mês após o mês de referência
              const dueMonth = addMeses(mesRef, 1); 
              
              if (dueMonth === this.filterMonth) { // Filtra apenas o que VENCE no mês
                  const cardId = compra.cardId || 'unknown';
                  // Agrupa pelo CardId para somar o total da fatura que vence neste mês
                  faturasMap.set(cardId, (faturasMap.get(cardId) || 0) + p.valor);
              }
          }
      }

      for (const [cardId, valor] of faturasMap) {
          const card = this.snapshot.cards.find(c => c.id === cardId);
          // Calcula vencimento: YYYY-MM-DiaVencimento
          const diaVenc = card ? String(card.dueDay).padStart(2, '0') : '10';
          // CORREÇÃO: O mês de vencimento é o this.filterMonth
          const dataVenc = `${this.filterMonth}-${diaVenc}`;

          this.contasDoMes.push({
              description: `Fatura ${card ? card.name : 'Cartão'}`,
              amount: valor,
              date: dataVenc,
              type: 'FATURA',
              categoryLabel: 'Cartão Crédito'
          });
      }

      // Ordenar por data de vencimento
      this.contasDoMes.sort((a, b) => a.date.localeCompare(b.date));
  }

  private montarGraficoRosca() {
      // Gráfico Doughnut: Titular vs Terceiros (no mês selecionado)
      const despesasCartao = this.snapshot.expenses.filter(e => e.type === 'CARTAO');
      let totalTitular = 0;
      let totalTerceiros = 0;

      for (const compra of despesasCartao) {
          const card = this.snapshot.cards.find(c => c.id === compra.cardId);
          const bestPurchaseDay = card ? card.bestPurchaseDay : 1; 
          const diaVencimento = card ? card.dueDay : 10;
          const parcelas = gerarParcelasDeUmaDespesa(compra, bestPurchaseDay, diaVencimento);
          
          // CORREÇÃO: Busca a parcela cujo DUE MONTH (Vencimento) é o mês filtrado.
          const p = parcelas.find(p => {
              const dueMonth = addMeses(p.mesReferencia, 1);
              return dueMonth === this.filterMonth;
          });
          
          if (p) {
              if (compra.personName) {
                  totalTerceiros += p.valor;
              } else {
                  totalTitular += p.valor;
              }
          }
      }
      
      // Atualiza dados do gráfico
      this.doughnutChartData.datasets[0].data = [totalTitular, totalTerceiros];
      
      // Força atualização se o componente do gráfico já existir
      this.chart?.update();
  }

  private montarGraficoFluxo() {
    // Projeta 6 meses a partir do mês selecionado
    const mesesGrafico = this.mesesFuturosHeader.slice(0, 6);
    const labels = mesesGrafico.map(m => this.formatMesLabel(m));
    
    // Entradas (já calculadas em montarProjecaoFutura)
    const dataEntradas = mesesGrafico.map(m => this.totaisMesFuturo[m] || 0);
    
    // Saídas (Parcelas Cartão conhecidas)
    const despesasCartao = this.snapshot.expenses.filter(e => e.type === 'CARTAO');
    const todasParcelas = gerarParcelasDeTodos(despesasCartao, this.snapshot.cards);
    
    // A lista de Saídas no gráfico representa o TOTAL A VENCER no mês
    const dataSaidas = mesesGrafico.map(mes => {
        return todasParcelas
            .filter(p => {
                 // CORREÇÃO: Filtra pelo MÊS DE VENCIMENTO (Competência + 1 mês)
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

  // --- UTILITÁRIOS ---

  private montarProjecaoFutura() {
    // Inicia a projeção a partir do mês do filtro
    const inicio = this.filterMonth || new Date().toISOString().slice(0, 7);
    
    this.mesesFuturosHeader = [];
    for(let i=0; i<12; i++) {
        this.mesesFuturosHeader.push(addMeses(inicio, i));
    }

    const mapa = new Map<string, LinhaEntradasFuturas>();

    // A) Reembolsos (Terceiros)
    const despesasCartao = this.snapshot.expenses.filter(e => e.type === 'CARTAO');
    const todasParcelas = gerarParcelasDeTodos(despesasCartao, this.snapshot.cards); // simplificado
    // Aqui vamos iterar sobre o MÊS DE VENCIMENTO
    
    const pFuturas = todasParcelas.filter(p => p.isThirdParty); // Todas as parcelas de terceiros

    for(const p of pFuturas) {
        const dueMonth = addMeses(p.mesReferencia, 1); // Mês de Vencimento
        
        if (this.mesesFuturosHeader.includes(dueMonth)) { // Verifica se o vencimento está no range do cabeçalho
            const key = `T-${p.personName}-${p.description}`;
            if(!mapa.has(key)) mapa.set(key, { id: key, description: p.description, type: 'TERCEIROS', personName: p.personName, valoresPorMes: {} });
            // Usa dueMonth (Vencimento) como chave do mês
            mapa.get(key)!.valoresPorMes[dueMonth] = (mapa.get(key)!.valoresPorMes[dueMonth] || 0) + p.valor;
        }
    }

    // B) Recorrentes (Não precisam de alteração)
    const ultimas = new Map<string, any>();
    this.snapshot.incomes.filter(i => i.recurring).sort((a,b)=>a.date.localeCompare(b.date)).forEach(i => ultimas.set(i.description, i));

    for(const m of this.mesesFuturosHeader) {
        // Reais
        this.snapshot.incomes.filter(i=> (i.incomeType==='RECORRENTE'||i.incomeType==='SALARIO') && i.date.startsWith(m)).forEach(r => {
             const k = `R-${r.description}`;
             if(!mapa.has(k)) mapa.set(k, { id: k, description: r.description, type: 'RECORRENTE', personName: 'Eu', valoresPorMes: {} });
             mapa.get(k)!.valoresPorMes[m] = r.amount;
        });
        // Virtuais
        for(const ult of ultimas.values()) {
             const k = `R-${ult.description}`;
             if(!mapa.has(k)) mapa.set(k, { id: k, description: ult.description, type: 'RECORRENTE', personName: 'Eu', valoresPorMes: {} });
             const linha = mapa.get(k)!;
             if(!linha.valoresPorMes[m]) {
                 const mesUlt = ult.date.slice(0,7);
                 if(m > mesUlt) linha.valoresPorMes[m] = ult.amount;
             }
        }
    }
    
    this.entradasFuturasLinhas = Array.from(mapa.values());
    this.totaisMesFuturo = {};
    this.mesesFuturosHeader.forEach(m => {
        this.totaisMesFuturo[m] = this.entradasFuturasLinhas.reduce((acc, c) => acc + (c.valoresPorMes[m]||0), 0);
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
    // Devemos usar o mês de VENCIMENTO das faturas para definir o range máximo
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