import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Expense,
  Income,
  FinanceSnapshot,
  FinanceConfig,
  CreditCard, // Importar
} from '../models/finance.models';

@Injectable({ providedIn: 'root' })
export class FinanceApiService {
  private readonly BASE_URL = 'http://localhost:3000/api';

  constructor(private http: HttpClient) {}

  // SNAPSHOT
  getSnapshot(): Observable<FinanceSnapshot> {
    return this.http.get<FinanceSnapshot>(`${this.BASE_URL}/snapshot`);
  }

  // --- CARTOES (NOVO) ---
  addCard(card: Omit<CreditCard, 'id'>): Observable<CreditCard> {
    return this.http.post<CreditCard>(`${this.BASE_URL}/cards`, card);
  }

  updateCard(id: string, payload: Partial<CreditCard>): Observable<any> {
    return this.http.put(`${this.BASE_URL}/cards/${id}`, payload);
  }

  deleteCard(id: string): Observable<any> {
    return this.http.delete(`${this.BASE_URL}/cards/${id}`);
  }
  // ----------------------

  // DESPESAS
  addExpense(expense: Omit<Expense, 'id'>): Observable<Expense> {
    return this.http.post<Expense>(`${this.BASE_URL}/expenses`, expense);
  }

  updateExpense(id: string, payload: Partial<Expense>): Observable<any> {
    return this.http.put(`${this.BASE_URL}/expenses/${id}`, payload);
  }

  deleteExpense(id: string): Observable<any> {
    return this.http.delete(`${this.BASE_URL}/expenses/${id}`);
  }

  // ENTRADAS
  addIncome(income: Omit<Income, 'id'>): Observable<Income> {
    return this.http.post<Income>(`${this.BASE_URL}/incomes`, income);
  }

  updateIncome(id: string, payload: Partial<Income>): Observable<any> {
    return this.http.put(`${this.BASE_URL}/incomes/${id}`, payload);
  }

  deleteIncome(id: string): Observable<any> {
    return this.http.delete(`${this.BASE_URL}/incomes/${id}`);
  }

  // CONFIG
  updateConfig(config: Partial<FinanceConfig>): Observable<FinanceConfig> {
    return this.http.put<FinanceConfig>(`${this.BASE_URL}/config`, config);
  }
}