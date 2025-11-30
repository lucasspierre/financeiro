import { ApplicationConfig, LOCALE_ID, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';

// IMPORTAÇÃO CORRETA PARA NG2-CHARTS V6+
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { routes } from './app.routes';

// Registra a formatação em Português
registerLocaleData(localePt);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(),
    provideRouter(routes),
    { provide: LOCALE_ID, useValue: 'pt-BR' },
    
    // REGISTRA O CHART.JS GLOBALMENTE
    provideCharts(withDefaultRegisterables()) 
  ],
};