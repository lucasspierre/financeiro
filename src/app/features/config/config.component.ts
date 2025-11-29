import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinanceApiService } from '../../core/services/finance-api.service';
import { FinanceConfig, FinanceSnapshot } from '../../core/models/finance.models';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './config.component.html',
  styleUrls: ['./config.component.scss']
})
export class ConfigComponent implements OnInit {

  private api = inject(FinanceApiService);
  private fb = inject(FormBuilder);

  loading = true;
  saving = false;

  configForm = this.fb.group({
    monthlyLimit: [null as number | null, [Validators.required, Validators.min(0)]],
    referenceMonth: ['', Validators.required], // formato '2025-11'
  });

  ngOnInit() {
    this.loadConfig();
  }

  loadConfig() {
    this.loading = true;

    this.api.getSnapshot().subscribe({
      next: (snap: FinanceSnapshot) => {
        const c = snap.config;

        this.configForm.patchValue({
          monthlyLimit: c.monthlyLimit,
          referenceMonth: c.referenceMonth,
        });

        this.loading = false;
      },
      error: () => this.loading = false
    });
  }

  saveConfig() {
    if (this.configForm.invalid) return;

    this.saving = true;

    const updated: Partial<FinanceConfig> = {
      monthlyLimit: this.configForm.value.monthlyLimit!,
      referenceMonth: this.configForm.value.referenceMonth!,
    };

    this.api.updateConfig(updated).subscribe({
      next: () => {
        this.saving = false;
      },
      error: () => this.saving = false
    });
  }
}
