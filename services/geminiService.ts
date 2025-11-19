import { GoogleGenAI, Type } from "@google/genai";
import { ProcessedTransaction, AIAnalysisResult } from "../types";

export const analyzeFraudWithGemini = async (
    transactions: ProcessedTransaction[]
): Promise<AIAnalysisResult[]> => {
    // Filter only top suspicious candidates to send to API to save tokens
    // We send the top 30 most deviating transactions for deep analysis
    const candidates = transactions
        .filter(t => t.isSuspiciousCandidate)
        .sort((a, b) => b.deviationFromAvg - a.deviationFromAvg)
        .slice(0, 30);

    if (candidates.length === 0) return [];

    // Check for API Key
    if (!process.env.API_KEY) {
        console.error("API_KEY is missing in environment variables.");
        throw new Error("API Key not found. Please configure environment variables.");
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const prompt = `
    You are a financial fraud detection expert. Analyze the following list of suspicious transactions.
    Each item contains the Business Area (BA), Amount, Activity Code (actCode), Avg Amount for that Code, and Deviation Ratio.

    Task:
    1. Evaluate the risk of fraud based on the amount deviation, frequency anomalies (if implied), and high value.
    2. Assign a fraud score between 0.0 (safe) and 1.0 (definite fraud).
    3. Provide a short, concise reason (under 20 words) for your score.

    Input Data (JSON):
    ${JSON.stringify(candidates.map(c => ({
        id: c.id,
        BA: c.BA,
        actCode: c.actCode,
        amount: c.amount,
        avgAmountForCode: c.actCodeAvgAmount,
        deviationRatio: c.deviationFromAvg
    })))}
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.NUMBER },
                            fraudScore: { type: Type.NUMBER },
                            reason: { type: Type.STRING }
                        }
                    }
                }
            }
        });

        if (response.text) {
            const results = JSON.parse(response.text) as AIAnalysisResult[];
            return results;
        }
        return [];
    } catch (error) {
        console.error("Gemini API Error:", error);
        throw error;
    }
};