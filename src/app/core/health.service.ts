import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';
import { HealthResponse } from './models';

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly api = inject(ApiClient);

  check(): Promise<HealthResponse> {
    return this.api.request<HealthResponse>({
      method: 'GET',
      path: '/health',
      anonymous: true,
    });
  }
}
