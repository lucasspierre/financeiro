import { Routes } from '@angular/router';
import { DashboardComponent } from './features/dashboard/dashboard.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  {
    path: 'expenses',
    loadComponent: () =>
      import('./features/expenses/expenses.component').then(m => m.ExpensesComponent),
  },
  {
    path: 'incomes',
    loadComponent: () =>
      import('./features/incomes/incomes.component').then(m => m.IncomesComponent),
  },
  {
    path: 'config',
    loadComponent: () =>
      import('./features/config/config.component').then(m => m.ConfigComponent),
  },
];
