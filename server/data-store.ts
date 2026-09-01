import fs from 'node:fs';
import path from 'node:path';
import { CombinedGeneratedRecord, ObservableTransaction } from '../lib/types.js';
import { ObservableTransactionDTO, serializeObservableTransactionDTO } from './dto.js';

export interface PaginationOptions {
  limit?: number;
  offset?: number;
  failure_reason?: string;
  payment_method?: string;
  subscription_status?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export class TransactionDataStore {
  private records: CombinedGeneratedRecord[] = [];
  private recordsById = new Map<string, CombinedGeneratedRecord>();

  constructor(fixturePath?: string) {
    const resolvedPath = fixturePath ?? path.resolve(process.cwd(), 'data', 'fixtures', 'transactions.json');
    if (fs.existsSync(resolvedPath)) {
      const rawData = fs.readFileSync(resolvedPath, 'utf-8');
      this.records = JSON.parse(rawData);
      for (const record of this.records) {
        this.recordsById.set(record.observable.transaction_id, record);
      }
    }
  }

  public getRecordById(transactionId: string): CombinedGeneratedRecord | undefined {
    return this.recordsById.get(transactionId);
  }

  public getObservableById(transactionId: string): ObservableTransaction | undefined {
    return this.recordsById.get(transactionId)?.observable;
  }

  public getPaginatedTransactions(options: PaginationOptions): PaginatedResult<ObservableTransactionDTO> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    let filtered = this.records.map(r => r.observable);

    if (options.failure_reason) {
      filtered = filtered.filter(tx => tx.failure_reason === options.failure_reason);
    }
    if (options.payment_method) {
      filtered = filtered.filter(tx => tx.payment_method === options.payment_method);
    }
    if (options.subscription_status) {
      filtered = filtered.filter(tx => tx.subscription_status === options.subscription_status);
    }

    const total = filtered.length;
    const paged = filtered.slice(offset, offset + limit);
    const items = paged.map(tx => serializeObservableTransactionDTO(tx));

    return {
      items,
      total,
      limit,
      offset,
    };
  }
}
