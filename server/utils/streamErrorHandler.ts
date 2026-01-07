/**
 * Stream Error Handler
 * 
 * Safely parses streaming responses from AI models with error recovery.
 * Handles stream interruptions and incomplete JSON gracefully.
 */

export interface StreamParseOptions {
    onChunk?: (text: string) => void;
    onError?: (error: any) => void;
    maxChunks?: number;
}

export interface StreamParseResult {
    text: string;
    success: boolean;
    error?: any;
    truncated: boolean;
}

/**
 * Safely iterates through an async stream and accumulates text
 * with error recovery and fallback handling
 */
export async function safeStreamParse(
    streamGenerator: AsyncIterable<any>,
    options: StreamParseOptions = {}
): Promise<StreamParseResult> {
    const {
        onChunk = () => { },
        onError = () => { },
        maxChunks = 10000
    } = options;

    let accumulatedText = '';
    let lastValidText = '';
    let chunkCount = 0;
    let hadError = false;
    let errorDetails: any = null;

    try {
        for await (const chunk of streamGenerator) {
            chunkCount++;

            // Safety limit to prevent infinite loops
            if (chunkCount > maxChunks) {
                console.warn('[StreamParser] Max chunks exceeded, stopping iteration');
                break;
            }

            try {
                const text = chunk.text();
                if (text) {
                    accumulatedText += text;
                    onChunk(text);

                    // Save checkpoint every 10 chunks for recovery
                    if (chunkCount % 10 === 0) {
                        lastValidText = accumulatedText;
                    }
                }
            } catch (chunkError: any) {
                // Individual chunk parsing failed
                console.warn(`[StreamParser] Chunk ${chunkCount} parse error:`, chunkError.message);
                onError(chunkError);
                hadError = true;
                errorDetails = chunkError;
                // Continue processing other chunks
            }
        }

        return {
            text: accumulatedText,
            success: !hadError,
            error: errorDetails,
            truncated: false
        };

    } catch (streamError: any) {
        console.error('[StreamParser] Stream iteration failed:', streamError.message);
        onError(streamError);

        // If we have partial text, try to salvage it
        if (accumulatedText.length > 0) {
            console.log('[StreamParser] Attempting recovery with partial text');
            return {
                text: accumulatedText,
                success: false,
                error: streamError,
                truncated: true
            };
        }

        // If we have a last valid checkpoint, use it
        if (lastValidText.length > 0) {
            console.log('[StreamParser] Falling back to last checkpoint');
            return {
                text: lastValidText,
                success: false,
                error: streamError,
                truncated: true
            };
        }

        // Complete failure
        throw streamError;
    }
}

/**
 * Attempts to close incomplete JSON by balancing braces
 */
export function balanceJson(text: string): string {
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\') {
            escaped = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (char === '{') openBraces++;
        if (char === '}') openBraces--;
        if (char === '[') openBrackets++;
        if (char === ']') openBrackets--;
    }

    // Close any unclosed strings
    let result = text;
    if (inString) {
        result += '"';
    }

    // Close arrays
    while (openBrackets > 0) {
        result += ']';
        openBrackets--;
    }

    // Close objects
    while (openBraces > 0) {
        result += '}';
        openBraces--;
    }

    return result;
}
