/**
 * Retry Logic with Exponential Backoff
 * 
 * Retries a function with exponential backoff when specific errors occur.
 * Designed to handle API overload errors (503) from Gemini.
 */

export interface RetryOptions {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    shouldRetry?: (error: any) => boolean;
    onRetry?: (attempt: number, error: any, delay: number) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
    maxRetries: 3,
    initialDelay: 2000, // 2 seconds - fixed delay as per user request
    maxDelay: 10000, // 10 seconds max
    shouldRetry: (error: any) => {
        const msg = error?.message || String(error);
        const status = error?.status || error?.statusCode;

        // Detect 429 (Rate Limit / Saturación)
        const is429 = msg.includes('429') || msg.includes('Too Many Requests') ||
            msg.includes('RESOURCE_EXHAUSTED') || status === 429;

        // Detect 500 (Server Error)
        const is500 = msg.includes('500') || msg.includes('Internal Server Error') ||
            status === 500;

        // Detect 503 (Overloaded)
        const is503 = msg.includes('503') || msg.includes('overloaded') ||
            msg.includes('Service Unavailable') || status === 503;

        return is429 || is500 || is503;
    },
    onRetry: () => { }
};

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let lastError: any;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            // Check if we should retry this error
            if (!opts.shouldRetry(error)) {
                throw error;
            }

            // Check if we've exhausted retries
            if (attempt >= opts.maxRetries) {
                throw error;
            }

            // Calculate backoff delay: 2^attempt * initialDelay, capped at maxDelay
            const backoffDelay = Math.min(
                opts.initialDelay * Math.pow(2, attempt),
                opts.maxDelay
            );

            // Notify about retry
            opts.onRetry(attempt + 1, error, backoffDelay);

            // Wait before retrying
            await delay(backoffDelay);
        }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError;
}
