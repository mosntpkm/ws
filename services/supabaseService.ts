import { createClient } from '@supabase/supabase-js';
import { ProcessedTransaction, AIAnalysisResult } from "../types";

// Initialize Supabase Client
// Note: In a real Vite app, use import.meta.env.VITE_... but we fallback to process.env for compatibility with the current setup structure if needed.
// Casting import.meta to any to avoid TS errors if generic ImportMeta interface doesn't include env (common in mixed setups without vite-env.d.ts)
const supabaseUrl = process.env.VITE_SUPABASE_URL || (import.meta as any).env?.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || (import.meta as any).env?.VITE_SUPABASE_ANON_KEY;

export const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

export const saveFraudAnalysisResults = async (
    transactions: (ProcessedTransaction & AIAnalysisResult)[]
) => {
    if (!supabase) {
        throw new Error("Supabase client not initialized. Missing Environment Variables.");
    }

    // Prepare data for insertion (mapping frontend types to database columns)
    const recordsToInsert = transactions.map(t => ({
        ba: t.BA,
        monthly: t.monthly,
        act_code: t.actCode,
        amount: t.amount,
        fraud_score: t.fraudScore,
        deviation_ratio: t.deviationFromAvg,
        ai_reason: t.aiReasoning || t.reason,
        is_flagged: true
    }));

    const { data, error } = await supabase
        .from('fraud_detections')
        .insert(recordsToInsert)
        .select();

    if (error) {
        console.error("Supabase Insert Error:", error);
        throw error;
    }

    return data;
};