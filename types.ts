export interface RawTransaction {
    BA: string;
    monthly: string;
    actCode: string;
    amount: string;
}

export interface ProcessedTransaction {
    id: number;
    BA: string;
    monthly: string;
    actCode: string;
    amount: number;
    // Features
    baTransactionCount: number;
    actCodeAvgAmount: number;
    deviationFromAvg: number; // Percentage or ratio
    isSuspiciousCandidate: boolean;
    // AI Results
    fraudScore?: number; // 0-1
    aiReasoning?: string;
}

export interface ActCodeStats {
    [code: string]: {
        totalAmount: number;
        count: number;
        average: number;
    };
}

export interface BAStats {
    [ba: string]: number; // Count of transactions
}

export enum FraudRiskLevel {
    LOW = 'Low',
    MEDIUM = 'Medium',
    HIGH = 'High',
    CRITICAL = 'Critical'
}

export interface AIAnalysisResult {
    id: number;
    fraudScore: number;
    reason: string;
}