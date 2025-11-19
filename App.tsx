import React, { useState, useMemo } from 'react';
import Papa from 'papaparse';
import { RawTransaction, ProcessedTransaction, ActCodeStats, BAStats, AIAnalysisResult } from './types';
import { analyzeFraudWithGemini } from './services/geminiService';
import { saveFraudAnalysisResults } from './services/supabaseService';
import { UploadCloud, AlertTriangle, BarChart3, ShieldCheck, Loader2, FileSpreadsheet, Database, CheckCircle2 } from 'lucide-react';
import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter, ZAxis } from 'recharts';

const App: React.FC = () => {
  const [rawData, setRawData] = useState<RawTransaction[]>([]);
  const [processedData, setProcessedData] = useState<ProcessedTransaction[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<AIAnalysisResult[]>([]);

  // 1. File Upload & Parse
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setProcessedData([]);
    setAnalysisResults([]);
    setSaveStatus('idle');

    Papa.parse<RawTransaction>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          setRawData(results.data);
          processFeatures(results.data);
        } else {
          setError("ไม่พบข้อมูลในไฟล์ CSV หรือรูปแบบไม่ถูกต้อง");
          setIsProcessing(false);
        }
      },
      error: (err: Error) => {
        setError(`Error parsing CSV: ${err.message}`);
        setIsProcessing(false);
      }
    });
  };

  // 2. Feature Engineering
  const processFeatures = (data: RawTransaction[]) => {
    try {
      const actCodeStats: ActCodeStats = {};
      const baStats: BAStats = {};

      // First Pass: Calculate aggregates
      data.forEach(row => {
        const amountStr = row.amount ? row.amount.replace(/,/g, '') : "0";
        const amount = parseFloat(amountStr) || 0;
        const actCode = row.actCode;
        const ba = row.BA;

        if (!actCode || !ba) return;

        // Update ActCode Stats
        if (!actCodeStats[actCode]) {
            actCodeStats[actCode] = { totalAmount: 0, count: 0, average: 0 };
        }
        actCodeStats[actCode].totalAmount += amount;
        actCodeStats[actCode].count += 1;

        // Update BA Stats
        baStats[ba] = (baStats[ba] || 0) + 1;
      });

      // Calculate Averages
      Object.keys(actCodeStats).forEach(code => {
        const stat = actCodeStats[code];
        stat.average = stat.totalAmount / stat.count;
      });

      // Second Pass: Create Processed Transactions
      const processed: ProcessedTransaction[] = [];
      
      data.forEach((row, index) => {
        const amountStr = row.amount ? row.amount.replace(/,/g, '') : "0";
        const amount = parseFloat(amountStr) || 0;
        
        if (!row.actCode || !row.BA) return;

        const avg = actCodeStats[row.actCode]?.average || 0;
        
        // Feature: Deviation Ratio (How many times larger than average)
        const deviation = avg === 0 ? 0 : amount / avg;

        // Logic to flag suspicious candidates for AI
        // Threshold: Amount > 3x average OR (High volume BA and Deviation > 2x)
        const isSuspicious = deviation > 3.0 || (baStats[row.BA] > 100 && deviation > 2.0); 

        processed.push({
          id: index,
          BA: row.BA,
          monthly: row.monthly,
          actCode: row.actCode,
          amount: amount,
          baTransactionCount: baStats[row.BA] || 0,
          actCodeAvgAmount: avg,
          deviationFromAvg: deviation,
          isSuspiciousCandidate: isSuspicious
        });
      });

      setProcessedData(processed);
      setIsProcessing(false);
    } catch (err) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการประมวลผลข้อมูล Feature Engineering");
      setIsProcessing(false);
    }
  };

  // 3. AI Analysis
  const runAIAnalysis = async () => {
    if (processedData.length === 0) return;
    
    setIsAnalyzing(true);
    setError(null);
    setSaveStatus('idle');

    try {
      const results = await analyzeFraudWithGemini(processedData);
      setAnalysisResults(results);
      if (results.length === 0) {
        setError("ไม่พบรายการที่เข้าข่ายน่าสงสัยอย่างมีนัยสำคัญ หรือ API ไม่ตอบกลับข้อมูล");
      }
    } catch (err) {
      console.error(err);
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อกับ Gemini API: ตรวจสอบ API Key ใน Environment Variable");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 4. Save to Database
  const handleSaveToDatabase = async () => {
    if (topRiskyTransactions.length === 0) return;
    
    setIsSaving(true);
    try {
        await saveFraudAnalysisResults(topRiskyTransactions);
        setSaveStatus('success');
    } catch (err) {
        console.error(err);
        setError("เกิดข้อผิดพลาดในการบันทึกข้อมูลลง Supabase: ตรวจสอบ URL และ Key");
        setSaveStatus('error');
    } finally {
        setIsSaving(false);
    }
  };

  // Prepare Data for Charts
  const topRiskyTransactions = useMemo(() => {
    if (analysisResults.length === 0) return [];
    
    return analysisResults
      .sort((a, b) => b.fraudScore - a.fraudScore)
      .map(res => {
        const original = processedData.find(p => p.id === res.id);
        if (!original) return null;
        return { ...original, ...res };
      })
      .filter((item): item is (ProcessedTransaction & AIAnalysisResult) => item !== null);
  }, [analysisResults, processedData]);

  const scatterData = useMemo(() => {
    // Sample down for visualization performance (top 500 highest amounts)
    return processedData
        .sort((a,b) => b.amount - a.amount)
        .slice(0, 500)
        .map(d => ({
            name: d.BA,
            x: d.actCode,
            y: d.amount,
            z: d.deviationFromAvg, // Size of bubble
            risk: d.isSuspiciousCandidate ? 'High' : 'Normal'
        }));
  }, [processedData]);

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-12">
      
      {/* Top Navigation */}
      <nav className="bg-white border-b border-slate-200 px-6 py-4 mb-8">
         <div className="max-w-7xl mx-auto flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg">
              <ShieldCheck className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-xl font-bold text-slate-800">
                Fraud Detection AI <span className="text-slate-400 font-normal text-sm ml-2">Powered by Gemini</span>
            </h1>
         </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 space-y-8">
        
        {/* Control Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Step 1: Upload */}
          <div className="md:col-span-1 bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-full">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-primary font-bold">1</div>
                <h2 className="text-lg font-semibold text-slate-800">Upload CSV Data</h2>
            </div>
            
            <label htmlFor="csv-upload" className="flex flex-col items-center justify-center w-full h-40 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 hover:bg-blue-50 transition-colors group">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <UploadCloud className="w-10 h-10 mb-3 text-slate-400 group-hover:text-primary" />
                    <p className="mb-2 text-sm text-slate-500"><span className="font-semibold">Click to upload</span></p>
                    <p className="text-xs text-slate-400">CSV files only</p>
                </div>
                <input id="csv-upload" type="file" className="hidden" accept=".csv" onChange={handleFileUpload} />
            </label>

            {isProcessing && (
                <div className="mt-4 flex items-center justify-center gap-2 text-primary text-sm animate-pulse">
                    <Loader2 className="w-4 h-4 animate-spin" /> Processing features...
                </div>
            )}
            
            {!isProcessing && processedData.length > 0 && (
                <div className="mt-4 p-4 bg-green-50 border border-green-100 text-green-700 rounded-lg text-sm flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4" />
                    Loaded {processedData.length.toLocaleString()} transactions
                </div>
            )}
          </div>

          {/* Step 2: Analysis Control */}
          <div className="md:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between h-full">
             <div>
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-primary font-bold">2</div>
                    <h2 className="text-lg font-semibold text-slate-800">AI Fraud Analysis</h2>
                </div>
                <p className="text-slate-600 mb-6 text-sm leading-relaxed">
                    ระบบจะใช้ Feature Engineering คัดกรองธุรกรรมที่มีความเบี่ยงเบน (Deviation) สูง 
                    จากนั้นส่งข้อมูลไปยัง <strong>Gemini API</strong> เพื่อให้คะแนนความเสี่ยง (Fraud Score 0-1) 
                    และระบุเหตุผลประกอบการตัดสินใจ
                </p>
             </div>

             <div className="flex flex-col gap-4">
                 {error && (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" /> {error}
                    </div>
                 )}
                 
                 <div className="flex gap-4">
                    <button 
                        onClick={runAIAnalysis}
                        disabled={processedData.length === 0 || isAnalyzing}
                        className={`flex-1 py-4 rounded-xl font-semibold text-white transition-all flex items-center justify-center gap-3 shadow-md
                            ${processedData.length === 0 || isAnalyzing 
                                ? 'bg-slate-300 cursor-not-allowed shadow-none' 
                                : 'bg-gradient-to-r from-primary to-blue-600 hover:from-blue-600 hover:to-primary hover:shadow-lg transform active:scale-[0.99]'}
                        `}
                    >
                        {isAnalyzing ? <Loader2 className="w-6 h-6 animate-spin" /> : <BarChart3 className="w-6 h-6" />}
                        {isAnalyzing ? 'Analyzing Data...' : 'Run Fraud Detection'}
                    </button>

                    {analysisResults.length > 0 && (
                        <button 
                            onClick={handleSaveToDatabase}
                            disabled={isSaving || saveStatus === 'success'}
                            className={`px-6 py-4 rounded-xl font-semibold text-white transition-all flex items-center justify-center gap-3 shadow-md
                                ${isSaving 
                                    ? 'bg-slate-400' 
                                    : saveStatus === 'success' 
                                        ? 'bg-green-600' 
                                        : 'bg-slate-800 hover:bg-slate-900'}
                            `}
                        >
                            {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : 
                             saveStatus === 'success' ? <CheckCircle2 className="w-5 h-5" /> : 
                             <Database className="w-5 h-5" />}
                            {isSaving ? 'Saving...' : saveStatus === 'success' ? 'Saved!' : 'Save Results'}
                        </button>
                    )}
                 </div>
             </div>
          </div>
        </div>

        {/* Visualization Area */}
        {processedData.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Chart: Amount Distribution */}
                <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-[450px] flex flex-col">
                    <h3 className="font-semibold text-slate-700 mb-2 flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-slate-400" />
                        Transaction Amount Distribution (Top 500)
                    </h3>
                    <p className="text-xs text-slate-400 mb-6">Showing ActCode vs Amount. Size of bubble represents deviation from average.</p>
                    
                    <div className="flex-1 w-full min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis type="category" dataKey="x" name="ActCode" allowDuplicatedCategory={false} tick={{fontSize: 12}} interval={0} angle={-45} textAnchor="end" height={60} />
                                <YAxis type="number" dataKey="y" name="Amount" unit="฿" tick={{fontSize: 12}} />
                                <ZAxis type="number" dataKey="z" range={[50, 500]} name="Deviation" />
                                <Tooltip 
                                    cursor={{ strokeDasharray: '3 3' }} 
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const data = payload[0].payload;
                                            return (
                                                <div className="bg-white p-3 border border-slate-200 shadow-xl rounded-lg text-sm">
                                                    <p className="font-bold text-slate-800">BA: {data.name}</p>
                                                    <p>ActCode: {data.x}</p>
                                                    <p className="text-primary">Amount: {data.y.toLocaleString()} ฿</p>
                                                    <p className="text-slate-500">Deviation: {data.z.toFixed(2)}x</p>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Scatter name="Transactions" data={scatterData} fill="#3b82f6" fillOpacity={0.6} />
                            </ScatterChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Stats Summary */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-full">
                         <h3 className="font-semibold text-slate-700 mb-4">Summary</h3>
                         <div className="space-y-4">
                            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                                <p className="text-slate-500 text-xs uppercase font-semibold">Total Transactions</p>
                                <p className="text-2xl font-bold text-slate-800">{processedData.length.toLocaleString()}</p>
                            </div>
                            <div className="p-4 bg-orange-50 rounded-lg border border-orange-100">
                                <p className="text-orange-600 text-xs uppercase font-semibold">Suspicious Candidates</p>
                                <p className="text-2xl font-bold text-orange-700">
                                    {processedData.filter(d => d.isSuspiciousCandidate).length.toLocaleString()}
                                </p>
                                <p className="text-xs text-orange-600/70 mt-1">Flagged for AI review</p>
                            </div>
                            <div className="p-4 bg-red-50 rounded-lg border border-red-100">
                                <p className="text-red-600 text-xs uppercase font-semibold">Confirmed High Risk</p>
                                <p className="text-2xl font-bold text-red-700">
                                    {analysisResults.filter(r => r.fraudScore > 0.7).length}
                                </p>
                                <p className="text-xs text-red-600/70 mt-1">Fraud Score {'>'} 0.7</p>
                            </div>
                         </div>
                    </div>
                </div>
            </div>
        )}

        {/* Results Table */}
        {analysisResults.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                        Top Detected Risks (Sorted by Score)
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-100">
                            <tr>
                                <th className="px-6 py-4">Fraud Score</th>
                                <th className="px-6 py-4">Reasoning (AI)</th>
                                <th className="px-6 py-4">BA</th>
                                <th className="px-6 py-4">Act Code</th>
                                <th className="px-6 py-4 text-right">Amount</th>
                                <th className="px-6 py-4 text-right">Deviation</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {topRiskyTransactions.map((item) => (
                                <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className={`w-2 h-8 rounded-full
                                                ${(item.fraudScore || 0) > 0.8 ? 'bg-red-500' : 
                                                  (item.fraudScore || 0) > 0.5 ? 'bg-orange-500' : 'bg-yellow-500'}
                                            `}></div>
                                            <span className={`text-base font-bold
                                                ${(item.fraudScore || 0) > 0.8 ? 'text-red-600' : 
                                                  (item.fraudScore || 0) > 0.5 ? 'text-orange-600' : 'text-yellow-600'}
                                            `}>
                                                {((item.fraudScore || 0) * 100).toFixed(0)}%
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <p className="text-slate-700 font-medium">{item.aiReasoning || item.reason}</p>
                                    </td>
                                    <td className="px-6 py-4 font-mono text-slate-600">{item.BA}</td>
                                    <td className="px-6 py-4">
                                        <span className="px-2 py-1 bg-slate-100 rounded text-slate-600 text-xs font-mono">{item.actCode}</span>
                                    </td>
                                    <td className="px-6 py-4 text-right font-medium text-slate-800">
                                        {item.amount?.toLocaleString()} ฿
                                    </td>
                                    <td className="px-6 py-4 text-right text-slate-500">
                                        {item.deviationFromAvg?.toFixed(1)}x
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}
      </main>
    </div>
  );
}

export default App;