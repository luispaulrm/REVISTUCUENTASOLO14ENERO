import { GoogleGenerativeAI } from "@google/generative-ai";

export interface StreamChunk {
    text: string;
    usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
    };
}

export class GeminiService {
    private client: GoogleGenerativeAI;

    constructor(apiKey: string) {
        this.client = new GoogleGenerativeAI(apiKey);
    }

    async extractWithStream(
        image: string,
        mimeType: string,
        prompt: string,
        config: {
            maxTokens?: number;
            responseMimeType?: string;
            responseSchema?: any;
        } = {}
    ): Promise<AsyncIterable<StreamChunk>> {
        const model = this.client.getGenerativeModel({
            model: "gemini-3-pro-preview",
            generationConfig: {
                maxOutputTokens: config.maxTokens || 64000,
                responseMimeType: config.responseMimeType,
                responseSchema: config.responseSchema,
            }
        });

        const resultStream = await model.generateContentStream([
            { text: prompt },
            {
                inlineData: {
                    data: image,
                    mimeType: mimeType
                }
            }
        ]);

        return this.processStream(resultStream);
    }

    private async *processStream(resultStream: any): AsyncIterable<StreamChunk> {
        for await (const chunk of resultStream.stream) {
            const chunkText = chunk.text();
            const usage = chunk.usageMetadata;

            yield {
                text: chunkText,
                usageMetadata: usage ? {
                    promptTokenCount: usage.promptTokenCount || 0,
                    candidatesTokenCount: usage.candidatesTokenCount || 0,
                    totalTokenCount: usage.totalTokenCount || 0
                } : undefined
            };
        }
    }
}
