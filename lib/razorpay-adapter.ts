import { ObservableTransaction, RecoveryAction, ExecutionResult } from './types.js';

export const RAZORPAY_API_BASE_URL = 'https://api.razorpay.com/v1';

export interface RazorpayAdapterOptions {
  keyId?: string;
  keySecret?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

/**
 * Sanitizes strings, error messages, and stack traces to ensure credential values never leak into logs or errors.
 */
export function sanitizeSecrets(text: string, secret?: string, keyId?: string): string {
  let sanitized = text;
  if (secret && secret.trim().length > 0) {
    sanitized = sanitized.split(secret).join('[REDACTED_SECRET]');
  }
  if (keyId && keyId.trim().length > 0) {
    sanitized = sanitized.split(keyId).join('[REDACTED_KEY_ID]');
  }
  return sanitized;
}

/**
 * RAZORPAY PAYMENT PROVIDER EXECUTION ADAPTER
 * 
 * Responsible exclusively for communicating with Razorpay API in test-mode.
 * Translates RecoveryActions into valid Razorpay API requests or application-level execution results.
 */
export class RazorpayExecutionAdapter {
  private keyId: string | undefined;
  private keySecret: string | undefined;
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(options?: RazorpayAdapterOptions) {
    this.keyId = options?.keyId ?? process.env.RAZORPAY_KEY_ID;
    this.keySecret = options?.keySecret ?? process.env.RAZORPAY_KEY_SECRET;
    this.baseUrl = options?.baseUrl ?? RAZORPAY_API_BASE_URL;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
  }

  /**
   * Executes a governed RecoveryAction against Razorpay API.
   */
  public async executeAction(
    transaction: ObservableTransaction,
    action: RecoveryAction
  ): Promise<ExecutionResult> {
    // 1. Credentials Guard
    if (!this.keyId || !this.keySecret) {
      return {
        success: false,
        provider: 'razorpay',
        action,
        status_message: 'Razorpay execution error: Missing credentials (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).',
        details: { error_type: 'MISSING_CREDENTIALS' },
      };
    }

    try {
      switch (action) {
        case 'retry_now':
          return await this.handleRetryNow(transaction);
        case 'retry_later':
          return await this.handleRetryLater(transaction);
        case 'send_reminder':
          return await this.handleSendReminder(transaction);
        case 'request_payment_method_update':
          return await this.handlePaymentMethodUpdate(transaction);
        case 'escalate':
          return this.handleEscalate(transaction);
        default:
          return {
            success: false,
            provider: 'razorpay',
            action,
            unsupported_action: true,
            status_message: `Unsupported RecoveryAction '${action}' by Razorpay adapter.`,
          };
      }
    } catch (err: any) {
      const rawMessage = err?.message ?? String(err);
      const safeMessage = sanitizeSecrets(rawMessage, this.keySecret, this.keyId);

      return {
        success: false,
        provider: 'razorpay',
        action,
        status_message: `Razorpay API execution failure: ${safeMessage}`,
        details: { error_type: err?.name ?? 'API_ERROR' },
      };
    }
  }

  /**
   * ACTION 1: retry_now
   * Endpoint: POST /v1/payment_links
   * Official Doc: Razorpay Payment Links API (Creates a payment link and sends immediate SMS/Email notification)
   */
  private async handleRetryNow(transaction: ObservableTransaction): Promise<ExecutionResult> {
    // POST /v1/payment_links
    const payload = {
      amount: Math.round(transaction.amount * 100), // convert to paise
      currency: transaction.currency,
      accept_partial: false,
      description: `Payment recovery for transaction ${transaction.transaction_id}`,
      customer: {
        name: `Customer ${transaction.customer_id}`,
        contact: '+919999999999',
        email: `customer_${transaction.customer_id}@example.com`,
      },
      notify: {
        sms: true,
        email: true,
      },
      reminder_enable: true,
      notes: {
        transaction_id: transaction.transaction_id,
        recovery_action: 'retry_now',
      },
    };

    const resData = await this.makeApiCall('POST', '/payment_links', payload);
    return {
      success: true,
      provider: 'razorpay',
      action: 'retry_now',
      provider_reference_id: resData.id ?? `plink_mock_${transaction.transaction_id}`,
      status_message: `Created Razorpay Payment Link ${resData.id ?? ''} with immediate notification for retry_now.`,
      details: {
        short_url: resData.short_url,
        status: resData.status,
      },
    };
  }

  /**
   * ACTION 2: retry_later
   * Endpoint: POST /v1/payment_links
   * Official Doc: Application-Level Scheduling + Razorpay Payment Links API
   * Note: Razorpay has no native delayed-execution endpoint for one-time payments.
   */
  private async handleRetryLater(transaction: ObservableTransaction): Promise<ExecutionResult> {
    const payload = {
      amount: Math.round(transaction.amount * 100),
      currency: transaction.currency,
      accept_partial: false,
      description: `Scheduled payment recovery for transaction ${transaction.transaction_id}`,
      customer: {
        name: `Customer ${transaction.customer_id}`,
        contact: '+919999999999',
        email: `customer_${transaction.customer_id}@example.com`,
      },
      notify: {
        sms: false,
        email: false,
      },
      notes: {
        transaction_id: transaction.transaction_id,
        recovery_action: 'retry_later',
      },
    };

    const resData = await this.makeApiCall('POST', '/payment_links', payload);
    return {
      success: true,
      provider: 'razorpay',
      action: 'retry_later',
      provider_reference_id: resData.id ?? `plink_mock_${transaction.transaction_id}`,
      status_message: `Created Razorpay Payment Link ${resData.id ?? ''} for application-level scheduled delivery.`,
      details: {
        short_url: resData.short_url,
        status: resData.status,
        scheduled_by_application: true,
      },
    };
  }

  /**
   * ACTION 3: send_reminder
   * Endpoint: POST /v1/payment_links
   * Official Doc: Razorpay Payment Links API (Creates/resends notification link)
   */
  private async handleSendReminder(transaction: ObservableTransaction): Promise<ExecutionResult> {
    const payload = {
      amount: Math.round(transaction.amount * 100),
      currency: transaction.currency,
      accept_partial: false,
      description: `Payment reminder for transaction ${transaction.transaction_id}`,
      customer: {
        name: `Customer ${transaction.customer_id}`,
        contact: '+919999999999',
        email: `customer_${transaction.customer_id}@example.com`,
      },
      notify: {
        sms: true,
        email: true,
      },
      notes: {
        transaction_id: transaction.transaction_id,
        recovery_action: 'send_reminder',
      },
    };

    const resData = await this.makeApiCall('POST', '/payment_links', payload);
    return {
      success: true,
      provider: 'razorpay',
      action: 'send_reminder',
      provider_reference_id: resData.id ?? `plink_mock_${transaction.transaction_id}`,
      status_message: `Sent Razorpay Payment Link reminder ${resData.id ?? ''} to customer.`,
      details: {
        short_url: resData.short_url,
        status: resData.status,
      },
    };
  }

  /**
   * ACTION 4: request_payment_method_update
   * Endpoint: POST /v1/payment_links
   * Official Doc: Razorpay Payment Links API (Payment link allows customer to choose new payment method)
   */
  private async handlePaymentMethodUpdate(transaction: ObservableTransaction): Promise<ExecutionResult> {
    const payload = {
      amount: Math.round(transaction.amount * 100),
      currency: transaction.currency,
      accept_partial: false,
      description: `Please update payment method for transaction ${transaction.transaction_id}`,
      customer: {
        name: `Customer ${transaction.customer_id}`,
        contact: '+919999999999',
        email: `customer_${transaction.customer_id}@example.com`,
      },
      notify: {
        sms: true,
        email: true,
      },
      notes: {
        transaction_id: transaction.transaction_id,
        recovery_action: 'request_payment_method_update',
      },
    };

    const resData = await this.makeApiCall('POST', '/payment_links', payload);
    return {
      success: true,
      provider: 'razorpay',
      action: 'request_payment_method_update',
      provider_reference_id: resData.id ?? `plink_mock_${transaction.transaction_id}`,
      status_message: `Created Razorpay Payment Link ${resData.id ?? ''} allowing customer to select a new payment method.`,
      details: {
        short_url: resData.short_url,
        status: resData.status,
      },
    };
  }

  /**
   * ACTION 5: escalate
   * Official Doc: Application-Level Only (No Razorpay API endpoint exists)
   */
  private handleEscalate(transaction: ObservableTransaction): ExecutionResult {
    return {
      success: false,
      provider: 'razorpay',
      action: 'escalate',
      unsupported_action: true,
      status_message: `Application-level action — no direct Razorpay API operation exists for escalate on transaction ${transaction.transaction_id}.`,
      details: {
        escalated_internally: true,
      },
    };
  }

  /**
   * Helper method for executing HTTP requests to Razorpay API with Basic Auth.
   */
  private async makeApiCall(method: 'GET' | 'POST', path: string, body?: any): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const authHeader = `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;

    const reqInit: RequestInit = {
      method,
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined) {
      reqInit.body = JSON.stringify(body);
    }

    try {
      const response = await this.fetchFn(url, reqInit);

      if (!response.ok) {
        const errorText = await response.text();
        const safeError = sanitizeSecrets(errorText, this.keySecret, this.keyId);
        throw new Error(`Razorpay API returned HTTP ${response.status}: ${safeError}`);
      }

      const jsonText = await response.text();
      try {
        return JSON.parse(jsonText);
      } catch (e) {
        throw new Error('Failed to parse Razorpay API response as JSON.');
      }
    } catch (err: any) {
      const safeErrMessage = sanitizeSecrets(err?.message ?? String(err), this.keySecret, this.keyId);
      const newErr = new Error(safeErrMessage);
      newErr.name = err?.name ?? 'FetchError';
      throw newErr;
    }
  }
}
